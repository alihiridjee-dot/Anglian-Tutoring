import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { electronShells } from "./electronShells";

const [magnesium, sodium, oxide] = electronShells.samples.map((s) => s.brief);
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

describe("an atom's shells are held to its electrons", () => {
  test("an outer electron moved in to the shell below", () => {
    // Magnesium's second outer electron drawn on shell 2: 2, 9, 1 reads as group 1.
    const svg = swap(
      drawn(magnesium),
      '<circle class="qf-ink" cx="180" cy="178" r="4"/>',
      '<circle class="qf-ink" cx="201.43" cy="48.26" r="4"/>',
    );
    expect(problemsOf(svg, magnesium)).toEqual([
      "Shell 2 holds 9 electrons; the brief gives it 8",
      "Shell 3 holds 1 electron; the brief gives it 2",
    ]);
  });

  test("an electron off every shell, or bunched up on its own", () => {
    const svg = drawn(sodium);
    expect(
      problemsOf(
        swap(
          svg,
          '<circle class="qf-ink" cx="180" cy="22" r="4"/>',
          '<circle class="qf-ink" cx="180" cy="12" r="4"/>',
        ),
        sodium,
      ),
    ).toEqual([
      "The electron at (180, 12) is not on any of the atom's shells",
      "Shell 3 holds 0 electrons; the brief gives it 1",
    ]);
    // One of the eight slid round towards its neighbour: still eight, but not evenly spaced.
    expect(
      problemsOf(
        swap(
          svg,
          '<circle class="qf-ink" cx="236" cy="100" r="4"/>',
          '<circle class="qf-ink" cx="233.26" cy="82.48" r="4"/>',
        ),
        sodium,
      ),
    ).toEqual(["Shell 2's electrons are not evenly spaced round it from 12 o'clock"]);
  });

  test("an ion drawn without its brackets, or with the wrong charge", () => {
    const svg = drawn(oxide);
    const bare = svg.replace(/<polyline[^>]*\/>/g, "");
    expect(problemsOf(bare, oxide)).toEqual([
      "The ion's left bracket is not drawn from (108, 32) to (108, 168)",
      "The ion's right bracket is not drawn from (252, 32) to (252, 168)",
      "The ion has 0 brackets; it needs 2",
    ]);
    expect(problemsOf(swap(svg, ">2−<", ">2+<"), oxide)).toEqual([
      'The charge "2−" is not written at the right bracket\'s top',
      'Text "2+" is not the symbol or the charge',
    ]);
  });

  test("the hidden element named, or an extra shell", () => {
    const svg = drawn(magnesium);
    // X stands for magnesium: its symbol would give the answer away.
    expect(
      problemsOf(swap(svg, 'text-anchor="middle">X<', 'text-anchor="middle">Mg<'), magnesium),
    ).toEqual(['"X" is not written in the nucleus', 'Text "Mg" is not the letter or the charge']);
    expect(
      problemsOf(
        swap(svg, "</svg>", '<circle class="qf-line" cx="180" cy="100" r="88"/></svg>'),
        magnesium,
      ),
    ).toEqual(["The diagram has 5 circles; the nucleus and 3 shells need 4"]);
  });
});

describe("an atom's brief must be the element's real structure", () => {
  test("shells that aren't the element's, or the atom's shells on its ion", () => {
    expect(problem({ ...sodium, shells: [2, 8, 2] })).toBe(
      "has shells 2, 8, 2, but Na has 2, 8, 1",
    );
    expect(problem({ ...sodium, charge: 1 })).toBe("has shells 2, 8, 1, but the Na⁺ ion has 2, 8");
    expect(problem({ ...oxide, shells: [2, 6] })).toBe("has shells 2, 6, but the O²⁻ ion has 2, 8");
  });

  test("an ion the element doesn't form, or an element past calcium", () => {
    expect(problem({ ...oxide, charge: 2 })).toBe("has O with charge +2, but its ion is O²⁻");
    expect(problem({ ...oxide, element: "Ne", charge: -1, shells: [2, 8, 1] })).toBe(
      "has Ne with charge −1, but Ne forms no simple ion",
    );
    expect(problem({ ...sodium, element: "Fe" })).toBe(
      "element must be the symbol of one of the first 20 elements, H to Ca",
    );
  });
});
