/**
 * An organic structure held as a SMILES string: read, compared and drawn as a
 * skeletal formula in the question figures' own classes (lib/figures). The
 * chemistry (parsing, the standard form two spellings share, the 2D layout)
 * is OpenChemLib's, loaded only by the page that needs it; everything here
 * takes the loaded library, so nothing else in the site carries it.
 */
import { CANVAS_WIDTH } from "@/lib/figures/figure";
import { checkFigure } from "@/lib/figures/figureCheck";
import {
  SKELETAL_MAX_HEIGHT,
  SKELETAL_PAD,
  skeletalFormula,
} from "@/lib/figures/kinds/skeletalFormula";

export type Chem = typeof import("openchemlib");

let loading: Promise<Chem> | null = null;
/** OpenChemLib, fetched once, in the browser. */
export const loadChem = (): Promise<Chem> => (loading ??= import("openchemlib"));

const SMALL = "₀₁₂₃₄₅₆₇₈₉";
const small = (n: number) =>
  String(n)
    .split("")
    .map((d) => SMALL[Number(d)])
    .join("");

const rank = (el: string) => (el === "C" ? 0 : el === "H" ? 1 : 2);

export type Structure = {
  /** The one spelling every way of writing this molecule comes out as. */
  smiles: string;
  /** The same for any two drawings of one molecule, isomers told apart. */
  id: string;
  /** C₈H₉NO₂ */
  formula: string;
  /** Relative molecular mass, to one decimal place. */
  mr: number;
  /** How many of each element. */
  counts: Record<string, number>;
};

/** A molecule's facts from its SMILES, or what is wrong with it. */
export function readStructure(
  chem: Chem,
  smiles: string,
): { structure: Structure } | { problem: string } {
  const typed = smiles.trim();
  if (!typed) return { problem: "Nothing to read yet" };
  let m: InstanceType<Chem["Molecule"]>;
  try {
    m = chem.Molecule.fromSmiles(typed);
  } catch {
    return { problem: "That is not a structure SMILES can spell" };
  }
  if (m.getAllAtoms() === 0) return { problem: "Nothing to read yet" };
  const f = m.getMolecularFormula();
  const counts: Record<string, number> = {};
  for (const [, el, n] of f.formula.matchAll(/([A-Z][a-z]?)(\d*)/g))
    counts[el] = (counts[el] ?? 0) + (n ? Number(n) : 1);
  return {
    structure: {
      smiles: m.toIsomericSmiles(),
      id: m.getIDCode(),
      // Hill order, as formulae are printed: carbon, hydrogen, then the rest by letter.
      formula: Object.keys(counts)
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
        .map((el) => `${el}${counts[el] > 1 ? small(counts[el]) : ""}`)
        .join(""),
      mr: Math.round(f.relativeWeight * 10) / 10,
      counts,
    },
  };
}

/** Whether two SMILES spell the same molecule, E/Z and optical isomers apart. */
export function sameStructure(chem: Chem, a: string, b: string): boolean | null {
  const [x, y] = [readStructure(chem, a), readStructure(chem, b)];
  if ("problem" in x || "problem" in y) return null;
  return x.structure.id === y.structure.id;
}

/** A bond's length when the molecule has the room. */
const BOND = 34;

/**
 * The molecule laid out as a skeletal formula's brief (figures/kinds/
 * skeletalFormula): each atom but hydrogen with its place, hydrogens and
 * charge, each bond with its order and wedge, each benzene ring. Scaled so a
 * bond is BOND units long, or shorter when the molecule would not fit the
 * canvas. The kind's own `read` then holds it to the canvas and to valency.
 */
export function skeletalBrief(
  chem: Chem,
  smiles: string,
): { brief: Record<string, unknown> } | { problem: string } {
  const M = chem.Molecule;
  let m: InstanceType<Chem["Molecule"]>;
  try {
    m = M.fromSmiles(smiles.trim());
  } catch {
    return { problem: "That is not a structure SMILES can spell" };
  }
  const count = m.getAllAtoms();
  if (count === 0) return { problem: "Nothing to draw yet" };
  m.ensureHelperArrays(M.cHelperCIP);
  const raw: [number, number][] = Array.from({ length: count }, (_, i) => [
    m.getAtomX(i),
    m.getAtomY(i),
  ]);
  const bondCount = m.getAllBonds();
  let mean = 0;
  for (let k = 0; k < bondCount; k++) {
    const [i, j] = [m.getBondAtom(0, k), m.getBondAtom(1, k)];
    mean += Math.hypot(raw[i][0] - raw[j][0], raw[i][1] - raw[j][1]);
  }
  mean = bondCount ? mean / bondCount : 1;
  const span = (k: 0 | 1) => Math.max(...raw.map((p) => p[k])) - Math.min(...raw.map((p) => p[k]));
  const scale = Math.min(
    BOND / mean,
    span(0) ? (CANVAS_WIDTH - 2 * SKELETAL_PAD) / span(0) : Infinity,
    span(1) ? (SKELETAL_MAX_HEIGHT - 2 * SKELETAL_PAD) / span(1) : Infinity,
  );
  // The circle is benzene's: a ring of six aromatic carbons. Any other
  // aromatic ring is drawn with its double bonds.
  const rings: number[][] = [];
  const set = m.getRingSet();
  for (let r = 0; r < set.getSize(); r++) {
    const ring = Array.from(set.getRingAtoms(r));
    if (set.isAromatic(r) && ring.length === 6 && ring.every((i) => m.getAtomLabel(i) === "C"))
      rings.push(ring);
  }
  return {
    brief: {
      kind: "skeletal-formula",
      smiles: smiles.trim(),
      atoms: raw.map(([x, y], i) => ({
        symbol: m.getAtomLabel(i),
        at: [x * scale, y * scale],
        h: m.getImplicitHydrogens(i),
        charge: m.getAtomCharge(i),
      })),
      bonds: Array.from({ length: bondCount }, (_, k) => {
        const type = m.getBondType(k);
        return {
          atoms: [m.getBondAtom(0, k), m.getBondAtom(1, k)],
          order: m.getBondOrder(k),
          wedge: type === M.cBondTypeUp ? "up" : type === M.cBondTypeDown ? "down" : null,
        };
      }),
      rings,
    },
  };
}

/** The molecule drawn as a skeletal formula, held to its brief like any figure. */
export function drawSkeletal(
  chem: Chem,
  smiles: string,
): { svg: string; alt: string } | { problem: string } {
  const laid = skeletalBrief(chem, smiles);
  if ("problem" in laid) return laid;
  const read = skeletalFormula.read(
    laid.brief,
    (brief) => checkFigure(skeletalFormula.draw(brief).svg).problems,
  );
  if ("problem" in read) return { problem: `The drawing ${read.problem}` };
  return skeletalFormula.draw(read.brief);
}

/**
 * A drawn structure carried inside a question's text, where the paper printed
 * the drawing: ⟦skeletal: CC(=O)O⟧ or ⟦displayed: CC(=O)O⟧. The style is how
 * the paper drew it, since a question can turn on it ("how many H atoms").
 */
export const STRUCTURE_TOKEN = /⟦(skeletal|displayed): ?([^⟧]*)⟧/g;
/** Anything written between the token's brackets, well formed or not. */
const ANY_TOKEN = /⟦[^⟧]*⟧?|⟧/g;

export type StructureToken = { style: "skeletal" | "displayed"; smiles: string; raw: string };

/** Every structure a text carries, in reading order. */
export function structureTokens(text: string | null | undefined): StructureToken[] {
  return [...(text ?? "").matchAll(STRUCTURE_TOKEN)].map((m) => ({
    style: m[1] as StructureToken["style"],
    smiles: m[2].trim(),
    raw: m[0],
  }));
}

/** The text with its structures taken out: what must be the paper's own words. */
export const withoutStructures = (text: string | null | undefined) =>
  (text ?? "").replace(ANY_TOKEN, " ");

/**
 * What is wrong with the structures a text carries: a token that is not one
 * of the two styles, SMILES that does not read, an atom with more bonds than
 * it can make, or a placeholder atom (a repeat unit's open bond is not a
 * molecule, and is not carried this way).
 */
export function structureProblems(chem: Chem, text: string | null | undefined): string[] {
  const problems: string[] = [];
  const good = new Set(structureTokens(text).map((t) => t.raw));
  for (const m of (text ?? "").matchAll(ANY_TOKEN))
    if (!good.has(m[0])) problems.push(`not a structure token: ${m[0].slice(0, 40)}`);
  for (const t of structureTokens(text)) {
    if (!t.smiles) {
      problems.push(`empty structure: ${t.raw}`);
      continue;
    }
    if (t.smiles.includes("*")) {
      problems.push(`placeholder atom in ${t.raw}`);
      continue;
    }
    let m: InstanceType<Chem["Molecule"]>;
    try {
      m = chem.Molecule.fromSmiles(t.smiles);
    } catch {
      problems.push(`SMILES does not read: ${t.raw}`);
      continue;
    }
    m.ensureHelperArrays(chem.Molecule.cHelperCIP);
    for (let a = 0; a < m.getAllAtoms(); a++)
      if (m.getFreeValence(a) < 0) {
        problems.push(`${m.getAtomLabel(a)} has too many bonds in ${t.raw}`);
        break;
      }
  }
  return problems;
}
