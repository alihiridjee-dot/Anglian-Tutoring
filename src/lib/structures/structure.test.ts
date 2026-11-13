import { describe, expect, test } from "bun:test";
import * as chem from "openchemlib";
import { readBrief } from "@/lib/figures/figureBrief";
import { checkFigure } from "@/lib/figures/figureCheck";
import { drawWithCode } from "@/lib/figures/figureDraw";
import {
  drawSkeletal,
  readStructure,
  sameStructure,
  skeletalBrief,
  structureProblems,
  structureTokens,
  withoutStructures,
} from "./structure";

// Molecules of the kind an A-level organic paper draws.
const MOLECULES = [
  "CC(=O)Nc1ccc(O)cc1",
  "Cc1cc(C(C)(C)C)c(O)c(C)c1CC1=NCCN1",
  "CC(C)[C@H](N)C(=O)O",
  "C/C=C/C",
  "[NH3+]CC(=O)[O-]",
  "CC12CCC3C(CCC4=CC(=O)CCC34C)C1CCC2O",
  "CC1(O)CCC(O)CC1",
  "BrCCCCBr",
  "NC(Cc1ccccc1)C(=O)NC(C)C(=O)O",
  "Cc1ccc(cc1)[N+](=O)[O-]",
  "ClC(Cl)(F)F",
  "N#CC(C)O",
  "c1ccc2ccccc2c1",
  "C[C@@H](Cl)CC",
  "c1ccncc1",
  "CS(=O)(=O)O",
];

describe("a molecule read from SMILES", () => {
  test("its formula, in Hill order, and its relative mass", () => {
    const read = readStructure(chem, "c1cc(O)ccc1NC(C)=O");
    if ("problem" in read) throw new Error(read.problem);
    expect(read.structure.formula).toBe("C₈H₉NO₂");
    expect(read.structure.mr).toBe(151.2);
    expect(read.structure.counts.H).toBe(9);
  });

  test("one molecule however it is spelled, isomers apart", () => {
    expect(sameStructure(chem, "OCC", "C(C)O")).toBe(true);
    expect(sameStructure(chem, "c1cc(O)ccc1NC(C)=O", "CC(=O)Nc1ccc(O)cc1")).toBe(true);
    expect(sameStructure(chem, "C/C=C/C", "C/C=C\\C")).toBe(false);
    expect(sameStructure(chem, "C[C@H](N)C(=O)O", "C[C@@H](N)C(=O)O")).toBe(false);
    expect(sameStructure(chem, "CCO", "not smiles((")).toBeNull();
  });
});

describe("a molecule laid out as a skeletal formula", () => {
  test("every one reads as a brief, draws, and passes the checker against it", () => {
    for (const smiles of MOLECULES) {
      const laid = skeletalBrief(chem, smiles);
      if ("problem" in laid) throw new Error(`${smiles}: ${laid.problem}`);
      const read = readBrief(laid.brief);
      if ("problem" in read) throw new Error(`${smiles}: ${read.problem}`);
      const problems = checkFigure(drawWithCode(read.brief)!.svg, read.brief).problems;
      if (problems.length) throw new Error(`${smiles}: ${problems.join("; ")}`);
    }
  });

  test("benzene has its circle; pyridine keeps its double bonds", () => {
    const benzene = drawSkeletal(chem, "c1ccccc1");
    const pyridine = drawSkeletal(chem, "c1ccncc1");
    if ("problem" in benzene || "problem" in pyridine) throw new Error("did not draw");
    expect(benzene.svg).toContain("<circle");
    expect(pyridine.svg).not.toContain("<circle");
  });

  test("SMILES that does not read says so", () => {
    expect(drawSkeletal(chem, "C1CC")).toEqual({
      problem: "That is not a structure SMILES can spell",
    });
  });
});

describe("structures carried in a question's text", () => {
  const text = "Compound C, shown below, is refluxed.\n⟦skeletal: CC(O)C(C)(O)CO⟧ + 3[O] →";

  test("each token is read in order, with how it was drawn", () => {
    expect(structureTokens(text)).toEqual([
      { style: "skeletal", smiles: "CC(O)C(C)(O)CO", raw: "⟦skeletal: CC(O)C(C)(O)CO⟧" },
    ]);
    expect(structureTokens("⟦displayed: CC(=O)O⟧ and ⟦skeletal: CCO⟧").map((t) => t.style)).toEqual(
      ["displayed", "skeletal"],
    );
    expect(withoutStructures(text)).toBe("Compound C, shown below, is refluxed.\n  + 3[O] →");
  });

  test("a sound token has no problems", () => {
    expect(structureProblems(chem, text)).toEqual([]);
  });

  test("a token that is not a molecule is named", () => {
    expect(structureProblems(chem, "⟦skeletal: C1CC⟧")).toEqual([
      "SMILES does not read: ⟦skeletal: C1CC⟧",
    ]);
    expect(structureProblems(chem, "⟦skeletal: CC(C)(C)(C)C⟧")).toEqual([
      "C has too many bonds in ⟦skeletal: CC(C)(C)(C)C⟧",
    ]);
    expect(structureProblems(chem, "⟦skeletal: [*]CC([*])Cl⟧")).toEqual([
      "placeholder atom in ⟦skeletal: [*]CC([*])Cl⟧",
    ]);
    expect(structureProblems(chem, "⟦sketch: CCO⟧")).toEqual([
      "not a structure token: ⟦sketch: CCO⟧",
    ]);
  });
});
