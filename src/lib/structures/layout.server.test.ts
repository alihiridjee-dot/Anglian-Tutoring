import { describe, expect, test } from "bun:test";
import { readBrief } from "@/lib/figures/figureBrief";
import { layOutStructures } from "./layout.server";

describe("a writer's skeletal formulae are laid out before the questions are checked", () => {
  test("a question's figure and its answer pictures", () => {
    const reply = {
      questions: [
        { prompt: "one", figure: JSON.stringify({ kind: "skeletal-formula", smiles: "CCC(C)=O" }) },
        {
          prompt: "two",
          figure: "",
          option_figures: JSON.stringify(
            ["CCO", "CC=O", "CC(=O)O", "COC"].map((smiles) => ({
              kind: "skeletal-formula",
              smiles,
            })),
          ),
        },
        { prompt: "three", figure: JSON.stringify({ kind: "pie-chart", slices: [] }) },
      ],
    };
    const untouched = reply.questions[2].figure;
    layOutStructures(reply);
    const one = readBrief(JSON.parse(reply.questions[0].figure));
    expect("brief" in one).toBe(true);
    const four = JSON.parse(reply.questions[1].option_figures!) as unknown[];
    expect(four.length).toBe(4);
    for (const brief of four) expect("brief" in readBrief(brief)).toBe(true);
    expect(reply.questions[1].figure).toBe("");
    expect(reply.questions[2].figure).toBe(untouched);
  });

  test("SMILES that does not read is left for the kind to refuse", () => {
    const reply = {
      questions: [{ figure: JSON.stringify({ kind: "skeletal-formula", smiles: "C1CC" }) }],
    };
    layOutStructures(reply);
    const read = readBrief(JSON.parse(reply.questions[0].figure));
    expect(read).toEqual({ problem: "could not be laid out from its SMILES" });
  });
});

describe("a writer's dot-and-cross SMILES becomes atoms and bonds before it is checked", () => {
  const laid = (smiles: string, letter: string | null = null) => {
    const reply = {
      questions: [{ figure: JSON.stringify({ kind: "dot-and-cross", smiles, letter }) }],
    };
    layOutStructures(reply);
    return readBrief(JSON.parse(reply.questions[0].figure));
  };

  test("one central atom, two atoms, and central atoms in a row all draw", () => {
    for (const smiles of [
      "N",
      "O",
      "Cl",
      "ClCl",
      "[H][H]",
      "N#N",
      "O=C=O",
      "CC",
      "C=C",
      "CO",
      "OO",
      "CCO",
    ])
      expect([smiles, "brief" in laid(smiles)]).toEqual([smiles, true]);
    // Hydrogens come written out: NH₃ is four atoms and three bonds.
    const ammonia = laid("N");
    expect("brief" in ammonia && ammonia.brief).toMatchObject({
      atoms: ["N", "H", "H", "H"],
      bonds: [
        { atoms: [0, 1], order: 1 },
        { atoms: [0, 2], order: 1 },
        { atoms: [0, 3], order: 1 },
      ],
    });
    expect("brief" in laid("O", "X")).toBe(true);
  });

  test("an ion, a ring, a letter on a row, or SMILES that does not read is refused", () => {
    expect(laid("[NH4+]")).toEqual({ problem: "could not be laid out from its SMILES" });
    expect(laid("c1ccccc1")).toEqual({ problem: "could not be laid out from its SMILES" });
    expect(laid("C1CC1")).toEqual({ problem: "must be one molecule with no rings" });
    expect(laid("CC", "X")).toEqual({ problem: "letter needs a molecule with one central atom" });
    expect(laid("C1CC")).toEqual({ problem: "could not be laid out from its SMILES" });
  });
});

describe("a writer's ionic SMILES becomes ions before it is checked", () => {
  const laid = (smiles: string, shells: string | null = "outer") => {
    const reply = {
      questions: [{ figure: JSON.stringify({ kind: "ionic-bonding", smiles, shells }) }],
    };
    layOutStructures(reply);
    return readBrief(JSON.parse(reply.questions[0].figure));
  };

  test("each ion read with its charge, and drawn in its own order", () => {
    for (const smiles of [
      "[Na+].[Cl-]",
      "[Mg+2].[O-2]",
      "[Mg++].[O--]",
      "[Mg+2].[Cl-].[Cl-]",
      "[Na+].[Na+].[O-2]",
      "[K+].[K+].[S-2]",
      "[Ca+2].[F-].[F-]",
      "[Li+].[F-]",
    ])
      for (const shells of ["outer", "all"])
        expect([smiles, shells, "brief" in laid(smiles, shells)]).toEqual([smiles, shells, true]);
    // The metal ion between its two chloride ions.
    const chloride = laid("[Cl-].[Cl-].[Mg+2]", "all");
    expect("brief" in chloride && chloride.brief).toMatchObject({
      smiles: "[Cl-].[Cl-].[Mg+2]",
      ions: [
        { element: "Cl", charge: -1 },
        { element: "Mg", charge: 2 },
        { element: "Cl", charge: -1 },
      ],
      shells: "all",
    });
    // No shells given: the outer shells only.
    const salt = laid("[Na+].[Cl-]", null);
    expect("brief" in salt && salt.brief).toMatchObject({ shells: "outer" });
  });

  test("a molecule, a compound ion, a wrong or missing charge, or the wrong mix of ions is refused", () => {
    expect(laid("Cl[Na]")).toEqual({ problem: "could not be laid out from its SMILES" });
    expect(laid("[OH-].[Na+]")).toEqual({ problem: "could not be laid out from its SMILES" });
    expect(laid("[Na].[Cl]")).toEqual({
      problem: "has Na with no charge: write each ion with its charge, as [Na+]",
    });
    expect(laid("[Na+2].[O-2]")).toEqual({
      problem: "has Na with charge +2, but its ion is Na⁺",
    });
    expect(laid("[Mg+2].[Cl-]")).toEqual({
      problem: "has charges adding up to +1, not 0: Mg²⁺ and Cl⁻ make MgCl₂",
    });
    expect(laid("[Al+3].[F-].[F-].[F-]")).toEqual({
      problem: "has Al: the ions drawn are those of Li, Na, K, Mg or Ca with O, S, F or Cl",
    });
    expect(laid("[Na+].[K+].[O-2]")).toEqual({
      problem: "must be the ions of one metal and one non-metal",
    });
    expect(laid("[Na+].[Cl-]", "inner")).toEqual({ problem: 'shells must be "outer" or "all"' });
  });
});
