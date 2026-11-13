import { type ComponentType, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/Shared";

/**
 * Where a student draws a structure: Ketcher, with only the tools an A-level
 * answer needs (bonds, wedges, rings, atoms, charges, erase, undo), kept in
 * step with a SMILES string both ways. What is drawn is read and marked by
 * lib/structures. Ketcher is heavy, so it is fetched when this first shows
 * and a page should import this file lazily too.
 */

type KetcherApi = {
  setMolecule: (structure: string) => Promise<unknown>;
  getSmiles: () => Promise<string>;
  editor: { subscribe: (event: string, handler: () => void) => unknown };
};
type KetcherParts = {
  Editor: ComponentType<Record<string, unknown>>;
  provider: unknown;
};

/**
 * Every tool that is not part of drawing one molecule: reaction arrows and
 * mapping, R-groups, S-groups, shapes and text, the 3D view, image
 * recognition, and the panels that would work the answer out for the student
 * (calculated values, structure check, CIP labels).
 */
const HIDDEN_TOOLS = Object.fromEntries(
  [
    "arom",
    "dearom",
    "cip",
    "check",
    "analyse",
    "recognize",
    "miew",
    "settings",
    "help",
    "about",
    "sgroup",
    "reaction-plus",
    "arrows",
    "reaction-mapping-tools",
    "reaction-automap",
    "reaction-map",
    "reaction-unmap",
    "rgroup",
    "rgroup-label",
    "rgroup-fragment",
    "rgroup-attpoints",
    "shape",
    "shape-ellipse",
    "shape-rectangle",
    "shape-line",
    "text",
    "enhanced-stereo",
    "create-monomer",
  ].map((name) => [name, { hidden: true }]),
);

let loading: Promise<KetcherParts> | null = null;
const loadKetcher = (): Promise<KetcherParts> =>
  (loading ??= (async () => {
    // Ketcher was built for a bundler that supplies Node's globals.
    const scope = globalThis as unknown as { global?: unknown; process?: unknown };
    scope.global ??= globalThis;
    scope.process ??= { env: {} };
    const [react, standalone] = await Promise.all([
      import("ketcher-react"),
      // The build without image rendering: about a quarter of the default's
      // download, and drawing and reading SMILES need none of what it drops.
      // @ts-expect-error -- the package's exports map leaves this entry's types out; they are the main entry's.
      import("ketcher-standalone/dist/binaryWasmNoRender") as Promise<
        typeof import("ketcher-standalone")
      >,
      import("ketcher-react/dist/index.css"),
    ]);
    return {
      Editor: react.Editor as unknown as ComponentType<Record<string, unknown>>,
      provider: new standalone.StandaloneStructServiceProvider(),
    };
  })());

export default function StructureEditor({
  smiles,
  onDraw,
}: {
  /** The structure to show; a change from outside is drawn in. */
  smiles: string;
  /** Called with the SMILES of whatever the student has drawn. */
  onDraw: (smiles: string) => void;
}) {
  const [parts, setParts] = useState<KetcherParts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const ketcher = useRef<KetcherApi | null>(null);
  /** The spelling the editor last sent out, so it is not sent straight back in. */
  const sent = useRef<string | null>(null);
  /** True while a structure from outside is being drawn in. */
  const applying = useRef(false);

  useEffect(() => {
    let live = true;
    loadKetcher()
      .then((p) => live && setParts(p))
      .catch((e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const api = ketcher.current;
    if (!ready || !api || smiles === sent.current) return;
    sent.current = smiles;
    // The editor reports this as a change of its own; it is not the student's.
    applying.current = true;
    api
      .setMolecule(smiles.trim())
      .catch(() => {
        // Half-typed SMILES: the editor keeps what it has until it reads.
      })
      .finally(() => setTimeout(() => (applying.current = false), 0));
  }, [ready, smiles]);

  if (!parts)
    return problem ? (
      <p className="font-bold">The drawing tool did not load: {problem}</p>
    ) : (
      <Spinner />
    );
  return (
    <div className="space-y-2">
      <div className="h-[30rem] w-full overflow-hidden rounded-xl bg-white sm:h-[36rem]">
        <parts.Editor
          staticResourcesUrl=""
          structServiceProvider={parts.provider}
          disableMacromoleculesEditor
          buttons={HIDDEN_TOOLS}
          errorHandler={(message: string) => setProblem(message)}
          onInit={(api: KetcherApi) => {
            try {
              api.editor.subscribe("change", () => {
                if (applying.current) return;
                setProblem(null);
                void api.getSmiles().then((drawn) => {
                  sent.current = drawn;
                  onDraw(drawn);
                });
              });
            } catch {
              // React's development double mount: this editor was already taken
              // down, and the one that replaces it reports in its own turn.
              return;
            }
            ketcher.current = api;
            (window as unknown as { ketcher?: KetcherApi }).ketcher = api;
            sent.current = null;
            setReady(true);
          }}
        />
      </div>
      {problem ? <p className="font-bold">{problem}</p> : null}
    </div>
  );
}
