import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { displayedFormula } from "./displayedFormula";

const [ethanol, acid, polymer] = displayedFormula.samples.map((s) => s.brief);
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

describe("a displayed formula is held to its atoms and bonds", () => {
  test("a double bond drawn as a single bond", () => {
    // The acid's C=O loses one of its two lines: it reads as a C–O single bond.
    const svg = swap(
      drawn(acid),
      '<line class="qf-line" x1="202" y1="59.3" x2="202" y2="89.7"/>',
      "",
    );
    expect(problemsOf(svg, acid)).toEqual([
      "The double bond between the C in cell [3, 1] and the O in cell [3, 0] is not drawn as 2 lines between them",
      "The formula has 10 lines; the brief's bonds need 11",
    ]);
  });

  test("two atoms written in each other's cells", () => {
    // Ethanol's second carbon and its oxygen swapped: an ether, not an alcohol.
    const svg = drawn(ethanol)
      .replace(
        'x="180" y="105.5" text-anchor="middle">C<',
        'x="180" y="105.5" text-anchor="middle">O<',
      )
      .replace(
        'x="230" y="105.5" text-anchor="middle">O<',
        'x="230" y="105.5" text-anchor="middle">C<',
      );
    expect(problemsOf(svg, ethanol)).toEqual([
      "The C in cell [2, 1] is not written at (180, 100)",
      "The O in cell [3, 1] is not written at (230, 100)",
      'Text "O" at (180, 105.5) is not an atom, a letter or the n',
      'Text "C" at (230, 105.5) is not an atom, a letter or the n',
    ]);
  });

  test("letters swapped between two bonds", () => {
    // B (the C–C bond) and D (the O–H bond) trade places: the answer moves.
    const svg = drawn(ethanol)
      .replace('x="155" y="93" text-anchor="middle">B<', 'x="155" y="93" text-anchor="middle">D<')
      .replace(
        'x="255.56" y="93" text-anchor="middle">D<',
        'x="255.56" y="93" text-anchor="middle">B<',
      );
    const problems = problemsOf(svg, ethanol);
    expect(problems).toContain(
      "The letter B is not written where its bond's letter goes, (155, 93)",
    );
    expect(problems).toContain(
      "The letter D is not written where its bond's letter goes, (255.56, 93)",
    );
  });

  test("an extra bond, a stray dot or a caption", () => {
    const svg = drawn(ethanol);
    // A line from the oxygen up to nowhere: a bond the brief hasn't got.
    expect(
      problemsOf(
        swap(svg, "</svg>", '<line class="qf-line" x1="230" y1="59.3" x2="230" y2="89.7"/></svg>'),
        ethanol,
      ),
    ).toEqual([
      "The qf-line line from (230, 59.3) to (230, 89.7) is not a bond in the brief",
      "The formula has 9 lines; the brief's bonds need 8",
    ]);
    expect(
      problemsOf(
        swap(svg, "</svg>", '<circle class="qf-ink" cx="230" cy="80" r="3"/></svg>'),
        ethanol,
      ),
    ).toEqual(['The <circle class="qf-ink"> at (230, 80) is not part of the displayed formula']);
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="180" y="190" text-anchor="middle">ethanol</text></svg>',
        ),
        ethanol,
      ),
    ).toEqual([
      'Text "ethanol" at (180, 190) is not an atom, a letter or the n',
      "The formula has 14 texts; the brief has 13",
    ]);
  });

  test("a repeat unit without its brackets' open bonds, or its n", () => {
    const svg = drawn(polymer);
    expect(
      problemsOf(
        swap(svg, '<line class="qf-line" x1="214.24" y1="100" x2="249" y2="100"/>', ""),
        polymer,
      ),
    ).toContain(
      "The open bond from the C in cell [1, 1] does not run out through the right bracket to (249, 100)",
    );
    expect(
      problemsOf(
        swap(svg, '<text class="qf-text" x="239" y="174" text-anchor="start">n</text>', ""),
        polymer,
      ),
    ).toContain("The n is not written beside the right bracket's foot");
  });
});

describe("a displayed formula's brief must be true chemistry", () => {
  const b = ethanol as unknown as {
    atoms: { symbol: string; cell: number[] }[];
    bonds: { atoms: number[]; order: number; letter?: string }[];
  };
  const unlettered = { ...b, bonds: b.bonds.map(({ atoms, order }) => ({ atoms, order })) };

  test("an atom making the wrong number of bonds", () => {
    // Ethanol's C–C bond made double: each carbon would make five bonds.
    expect(
      problem({
        ...unlettered,
        bonds: unlettered.bonds.map((x, i) => (i === 1 ? { ...x, order: 2 } : x)),
      }),
    ).toBe("has the C in cell [1, 1] making 5 bonds, not 4");
    // An O=H double bond: oxygen and hydrogen each make one bond too many.
    expect(
      problem({
        ...unlettered,
        bonds: unlettered.bonds.map((x, i) => (i === 3 ? { ...x, order: 2 } : x)),
      }),
    ).toBe("has the O in cell [3, 1] making 3 bonds, not 2");
  });

  test("a bond between cells that aren't neighbours, or atoms not joined up", () => {
    expect(
      problem({
        ...unlettered,
        bonds: [...unlettered.bonds.slice(0, 7), { atoms: [2, 4], order: 1 }],
      }),
    ).toBe(
      "has a bond between cells [2, 1] and [4, 1], which are not next to each other across or down",
    );
    expect(
      problem({
        kind: "displayed-formula",
        atoms: [
          { symbol: "H", cell: [0, 0] },
          { symbol: "H", cell: [1, 0] },
          { symbol: "Cl", cell: [0, 2] },
          { symbol: "Cl", cell: [1, 2] },
        ],
        bonds: [
          { atoms: [0, 1], order: 1 },
          { atoms: [2, 3], order: 1 },
        ],
        polymer: null,
      }),
    ).toBe("has atoms that aren't joined to the rest");
  });

  test("a symbol it doesn't know, or a letter it can't place", () => {
    expect(
      problem({
        ...unlettered,
        atoms: unlettered.atoms.map((a, i) => (i === 3 ? { ...a, symbol: "Xx" } : a)),
      }),
    ).toBe('has an atom "Xx" that is not H, C, N, O, F, Cl, Br, I, CH₃ or OH');
    expect(
      problem({
        ...unlettered,
        atoms: unlettered.atoms.map((a, i) => (i === 1 ? { ...a, letter: "A" } : a)),
      }),
    ).toBe("has a letter on the C in cell [1, 1], which needs an empty cell above or below it");
  });

  test("a repeat unit whose open bonds don't leave from its ends", () => {
    expect(problem({ ...polymer, polymer: [0, 2] })).toBe(
      "has a repeat unit whose open bonds don't leave from its leftmost and rightmost columns on one row",
    );
    // Without its open bonds, each carbon of poly(propene)'s unit makes only three.
    expect(problem({ ...polymer, polymer: null })).toBe(
      "has the C in cell [0, 1] making 3 bonds, not 4",
    );
  });
});
