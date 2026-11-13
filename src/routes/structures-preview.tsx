import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { StoredFigure } from "@/components/QuestionFigure";
import { Chip, PageHeader, SectionHeading, Spinner } from "@/components/Shared";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import {
  type Chem,
  drawSkeletal,
  loadChem,
  readStructure,
  sameStructure,
} from "@/lib/structures/structure";

// DEV ONLY — a try-it page for carrying organic structures as SMILES: draw or
// paste one, and see the standard spelling, the formula, our own skeletal
// drawing and whether it matches a mark scheme's answer.
export const Route = createFileRoute("/structures-preview")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  head: () => ({ meta: [{ title: "Structures — Anglia Educate" }] }),
  component: StructuresPreview,
});

const EXAMPLES: [string, string][] = [
  ["Paracetamol", "c1cc(O)ccc1NC(C)=O"],
  ["Oxymetazoline", "Cc1cc(C(C)(C)C)c(O)c(C)c1CC1=NCCN1"],
  ["Valine, one optical isomer", "CC(C)[C@H](N)C(=O)O"],
  ["E-but-2-ene", "C/C=C/C"],
  ["Glycine zwitterion", "[NH3+]CC(=O)[O-]"],
];

// Behind DEV so the drawing tool's weight stays out of a production build
// until a page students can reach asks for it.
const StructureEditor = import.meta.env.DEV
  ? lazy(() => import("@/components/structures/StructureEditor"))
  : null;

function StructuresPreview() {
  const [chem, setChem] = useState<Chem | null>(null);
  const [smiles, setSmiles] = useState(EXAMPLES[0][1]);
  const [answer, setAnswer] = useState("CC(=O)Nc1ccc(O)cc1");

  useEffect(() => {
    let live = true;
    void loadChem().then((c) => live && setChem(c));
    return () => {
      live = false;
    };
  }, []);

  const read = useMemo(() => (chem ? readStructure(chem, smiles) : null), [chem, smiles]);
  const drawn = useMemo(() => (chem ? drawSkeletal(chem, smiles) : null), [chem, smiles]);
  const same = useMemo(
    () => (chem ? sameStructure(chem, smiles, answer) : null),
    [chem, smiles, answer],
  );

  return (
    <div className="page-aurora relative min-h-screen">
      <div className={`mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12 ${SUBJECT_TINT.chemistry}`}>
        <span className="chip chip-solid tint-amber">Structures — development only</span>
        <PageHeader eyebrow="Organic structures as SMILES" title="Draw a structure" />

        <section className="premium-card space-y-4 p-4 sm:p-5">
          <SectionHeading title="Draw it" />
          {StructureEditor ? (
            <Suspense fallback={<Spinner />}>
              <StructureEditor smiles={smiles} onDraw={setSmiles} />
            </Suspense>
          ) : null}
        </section>

        <section className="premium-card space-y-4 p-4 sm:p-5">
          <SectionHeading title="Or paste it" />
          <div>
            <label htmlFor="structure-smiles" className="eyebrow text-[10px]">
              SMILES
            </label>
            <input
              id="structure-smiles"
              type="text"
              spellCheck={false}
              autoComplete="off"
              placeholder="CC(=O)Nc1ccc(O)cc1"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              className="premium-input mt-1 h-11 w-full rounded-xl px-4 font-mono text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(([name, value]) => (
              <button
                key={name}
                type="button"
                onClick={() => setSmiles(value)}
                className="btn-premium px-3 py-2 text-sm"
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        <section className="premium-card space-y-4 p-4 sm:p-5">
          <SectionHeading title="What the site stores and draws" />
          {!read ? (
            <Spinner />
          ) : "problem" in read ? (
            <p className="font-bold">{read.problem}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{read.structure.formula}</Chip>
                <Chip>Mᵣ {read.structure.mr}</Chip>
              </div>
              <div>
                <p className="eyebrow text-[10px]">Standard spelling</p>
                <p className="mt-1 break-all font-mono text-sm font-bold">
                  {read.structure.smiles}
                </p>
              </div>
              {drawn && "svg" in drawn ? <StoredFigure figure={drawn} /> : null}
            </>
          )}
        </section>

        <section className="premium-card space-y-4 p-4 sm:p-5">
          <SectionHeading title="Mark it against an answer" />
          <div>
            <label htmlFor="structure-answer" className="eyebrow text-[10px]">
              Mark scheme answer, as SMILES
            </label>
            <input
              id="structure-answer"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="premium-input mt-1 h-11 w-full rounded-xl px-4 font-mono text-sm"
            />
          </div>
          {same === null ? null : same ? (
            <Chip tint="tint-emerald" className="chip-solid">
              Same molecule
            </Chip>
          ) : (
            <Chip tint="tint-rose" className="chip-solid">
              Different molecule
            </Chip>
          )}
        </section>
      </div>
    </div>
  );
}
