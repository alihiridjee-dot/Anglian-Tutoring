import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { periodicTable } from "./periodicTable";

const [alkali, groups] = periodicTable.samples.map((s) => s.brief);
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

describe("a periodic table outline is held to its elements' cells", () => {
  test("a letter one cell along from its element", () => {
    // A moved from sodium's cell to magnesium's: group 2, not an alkali metal.
    const svg = swap(
      drawn(alkali),
      'x="18.5" y="116.5" text-anchor="middle">A<',
      'x="37.5" y="116.5" text-anchor="middle">A<',
    );
    expect(problemsOf(svg, alkali)).toEqual([
      "The letter A is not written in Na's cell, at (18.5, 116.5)",
      'Text "A" at (37.5, 116.5) is not a letter in its cell or a group number',
    ]);
  });

  test("letters swapped between two elements", () => {
    // B (oxygen) and D (neon) trade places: the noble gas now reads as a group 6 element.
    const svg = drawn(groups)
      .replace(
        'x="303.5" y="114.5" text-anchor="middle">B<',
        'x="303.5" y="114.5" text-anchor="middle">X<',
      )
      .replace(
        'x="341.5" y="114.5" text-anchor="middle">D<',
        'x="341.5" y="114.5" text-anchor="middle">B<',
      )
      .replace(
        'x="303.5" y="114.5" text-anchor="middle">X<',
        'x="303.5" y="114.5" text-anchor="middle">D<',
      );
    expect(problemsOf(svg, groups)).toEqual([
      "The letter B is not written in O's cell, at (303.5, 114.5)",
      "The letter D is not written in Ne's cell, at (341.5, 114.5)",
      'Text "D" at (303.5, 114.5) is not a letter in its cell or a group number',
      'Text "B" at (341.5, 114.5) is not a letter in its cell or a group number',
    ]);
  });

  test("a cell the table hasn't got, or one missing", () => {
    const svg = drawn(alkali);
    // A cell in period 1 above lithium's group: hydrogen would seem to have a neighbour.
    expect(
      problemsOf(
        swap(svg, "</svg>", '<rect class="qf-line" x="28" y="56" width="19" height="22"/></svg>'),
        alkali,
      ),
    ).toEqual([
      "The table has 37 cells; its 4 periods have 36",
      "The line from (28, 56) to (47, 56) is not the edge of one of the table's cells",
    ]);
    expect(
      problemsOf(
        swap(svg, '<rect class="qf-line" x="9" y="56" width="19" height="22"/>', ""),
        alkali,
      ),
    ).toEqual([
      "The table is missing the cell at (9, 56)",
      "The table has 35 cells; its 4 periods have 36",
    ]);
  });

  test("a wrong group number, or a caption", () => {
    const svg = drawn(groups);
    expect(
      problemsOf(swap(svg, 'text-anchor="middle">0<', 'text-anchor="middle">8<'), groups),
    ).toEqual([
      "The group number 0 is not written above its column",
      'Text "8" at (341.5, 70) is not a letter in its cell or a group number',
    ]);
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="60" y="180" text-anchor="middle">metals</text></svg>',
        ),
        groups,
      ),
    ).toEqual([
      'Text "metals" at (60, 180) is not a letter in its cell or a group number',
      "The table has 13 texts; the brief has 12",
    ]);
  });
});

describe("a periodic table brief names real elements in the periods drawn", () => {
  test("an element below the periods drawn, or a lanthanide", () => {
    expect(problem({ ...groups, letters: [{ element: "Fe", letter: "A" }] })).toBe(
      "has Fe, which is in period 4, below the 3 drawn",
    );
    expect(problem({ ...groups, periods: 6, letters: [{ element: "Ce", letter: "A" }] })).toBe(
      "has Ce, a lanthanide, which the table's outline leaves out",
    );
  });

  test("a symbol that isn't an element's, or a letter used twice", () => {
    expect(problem({ ...groups, letters: [{ element: "Xx", letter: "A" }] })).toBe(
      'has "Xx", which is not an element\'s symbol up to Rn',
    );
    expect(
      problem({
        ...groups,
        letters: [
          { element: "Na", letter: "A" },
          { element: "Mg", letter: "A" },
        ],
      }),
    ).toBe("uses a letter twice");
  });

  test("every element sits in its own group and period", () => {
    // Spot checks against the table: the cell a letter lands in is the element's.
    const at = (element: string) => {
      const svg = drawn({
        kind: "periodic-table",
        periods: 6,
        groupNumbers: false,
        letters: [{ element, letter: "A" }],
      });
      const m = /x="([\d.]+)" y="([\d.]+)" text-anchor="middle">A</.exec(svg)!;
      return [
        Math.round((Number(m[1]) - 18.5) / 19) + 1,
        Math.round((Number(m[2]) - 5.5 - 11 - 34) / 22) + 1,
      ];
    };
    expect(at("H")).toEqual([1, 1]);
    expect(at("He")).toEqual([18, 1]);
    expect(at("B")).toEqual([13, 2]);
    expect(at("Ar")).toEqual([18, 3]);
    expect(at("Fe")).toEqual([8, 4]);
    expect(at("Ag")).toEqual([11, 5]);
    expect(at("Ba")).toEqual([2, 6]);
    expect(at("Hf")).toEqual([4, 6]);
    expect(at("Rn")).toEqual([18, 6]);
  });
});
