import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { ionicBonding } from "./ionicBonding";

const [salt, chloride] = ionicBonding.samples.map((s) => s.brief);
const drawn = (brief: unknown) => drawWithCode(brief as never)!.svg;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problemsOf = (svg: string, brief: unknown) => checkFigure(svg, brief as never).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

/** The chloride ion's gained electron: the cross low in its left-hand pair. */
const GAINED =
  '<line class="qf-line" x1="196.95" y1="102.5" x2="203.95" y2="109.5"/>' +
  '<line class="qf-line" x1="196.95" y1="109.5" x2="203.95" y2="102.5"/>';

describe("an ionic diagram is held to where each electron came from", () => {
  test("the electron chlorine gained drawn as one of its own", () => {
    const svg = swap(drawn(salt), GAINED, '<circle class="qf-ink" cx="200.45" cy="106" r="3.5"/>');
    expect(problemsOf(svg, salt)).toEqual([
      "The shell of the right Cl⁻ ion holds 8 dots; it needs 7 dots and 1 cross",
      "The dot at (200.45, 106) is not where an electron goes",
    ]);
  });

  test("the gained electron left out", () => {
    expect(problemsOf(swap(drawn(salt), GAINED, ""), salt)).toEqual([
      "The shell of the right Cl⁻ ion holds 7 dots; it needs 7 dots and 1 cross",
      "The diagram has 15 electrons; its ions need 16",
    ]);
  });

  test("an ion drawn without its brackets, or with the wrong charge", () => {
    const svg = drawn(salt);
    const bare = svg.replace(/<polyline[^>]*\/>/g, "");
    expect(problemsOf(bare, salt)).toEqual([
      "The left bracket of the left Na⁺ ion is not drawn from (57.12, 50) to (57.12, 150)",
      "The right bracket of the left Na⁺ ion is not drawn from (153.12, 50) to (153.12, 150)",
      "The left bracket of the right Cl⁻ ion is not drawn from (192, 50) to (192, 150)",
      "The right bracket of the right Cl⁻ ion is not drawn from (288, 50) to (288, 150)",
      "The diagram has 0 brackets; its 2 ions need 4",
    ]);
    expect(problemsOf(swap(svg, ">−<", ">2−<"), salt)).toEqual([
      'The charge "−" of the right Cl⁻ ion is not written at its right bracket\'s top',
      'Text "2−" is not an ion\'s symbol or charge',
    ]);
  });

  test("a metal ion between its two non-metal ions, whatever order they come in", () => {
    const read = readBrief({
      kind: "ionic-bonding",
      smiles: null,
      ions: [
        { element: "Mg", charge: 2 },
        { element: "Cl", charge: -1 },
        { element: "Cl", charge: -1 },
      ],
      shells: "outer",
    });
    expect(read).toEqual({ brief: { ...chloride, smiles: null } });
  });

  test("a formula that does not balance names the one that does", () => {
    expect(
      problem({
        kind: "ionic-bonding",
        smiles: null,
        ions: [
          { element: "Na", charge: 1 },
          { element: "O", charge: -2 },
        ],
        shells: "all",
      }),
    ).toBe("has charges adding up to −1, not 0: Na⁺ and O²⁻ make Na₂O");
    expect(problem({ kind: "ionic-bonding", smiles: "[Na+].[Cl-]", shells: "outer" })).toBe(
      "could not be laid out from its SMILES",
    );
  });
});
