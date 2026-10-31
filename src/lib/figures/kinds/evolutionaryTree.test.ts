import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { evolutionaryTree } from "./evolutionaryTree";

const cats = evolutionaryTree.samples[0].brief;
const vertebrates = evolutionaryTree.samples[1].brief;
const catsSvg = drawWithCode(cats)!.svg;
const vertebratesSvg = drawWithCode(vertebrates)!.svg;
const swap = (s: string, from: string, to: string) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("an evolutionary tree is held to its grouping, its ages and its letters", () => {
  test("two species' names swapped: the lion would look closest to the jaguar", () => {
    const swapped = swap(
      swap(catsSvg, 'y="97.5" text-anchor="start">jaguar<', 'y="97.5" text-anchor="start">lion<'),
      'y="129.5" text-anchor="start">lion<',
      'y="129.5" text-anchor="start">jaguar<',
    );
    expect(checkFigure(swapped, cats).problems).toContain(
      "The branches drawn group the species as ((tiger, snow leopard), (lion, (jaguar, leopard))); the brief groups them as ((tiger, snow leopard), (jaguar, (lion, leopard)))",
    );
  });

  test("letters swapped between branch points", () => {
    const swapped = swap(
      swap(catsSvg, 'x="131" y="110" text-anchor="end">C<', 'x="131" y="110" text-anchor="end">D<'),
      'x="179" y="134" text-anchor="end">D<',
      'x="179" y="134" text-anchor="end">C<',
    );
    const problems = checkFigure(swapped, cats).problems;
    expect(problems).toContain(
      'The letter beside the branch point joining jaguar, lion and leopard is "D"; the brief gives it C',
    );
    expect(problems).toContain(
      'The letter beside the branch point joining lion and leopard is "C"; the brief gives it D',
    );
  });

  test("a branch point away from its age: mammals and birds splitting 50 million years too late", () => {
    // The 300 mya branch point (x = 101.33) moved to 250 mya (x = 123.11), its branches with it.
    const moved = vertebratesSvg
      .replace(
        'x1="79.56" y1="116" x2="101.33" y2="116"',
        'x1="79.56" y1="116" x2="112.22" y2="116"',
      )
      .replace(
        'x1="101.33" y1="92" x2="101.33" y2="140"',
        'x1="112.22" y1="92" x2="112.22" y2="140"',
      )
      .replace('x1="101.33" y1="92" x2="232" y2="92"', 'x1="112.22" y1="92" x2="232" y2="92"')
      .replace(
        'x1="101.33" y1="140" x2="123.11" y2="140"',
        'x1="112.22" y1="140" x2="123.11" y2="140"',
      );
    expect(checkFigure(moved, vertebrates).problems).toContain(
      "The branch point joining mammals, reptiles and birds is not at 300 million years ago (x = 101.33)",
    );
  });

  test("a stray branch, or a caption", () => {
    const stray = swap(
      catsSvg,
      "</svg>",
      '<line class="qf-line" x1="136" y1="140" x2="136" y2="180"/></svg>',
    );
    expect(checkFigure(stray, cats).problems).toContain(
      "The upright line from (136, 140) to (136, 180) has no branch into it",
    );
    const caption = swap(
      catsSvg,
      "</svg>",
      '<text class="qf-text" x="40" y="180" text-anchor="start">common ancestor</text></svg>',
    );
    expect(checkFigure(caption, cats).problems).toContain(
      "Text \"common ancestor\" is not a species' name, a branch point's letter or part of the time scale",
    );
  });
});

describe("an evolutionary tree brief must make sense in time", () => {
  test("a branch point older than the one it branches from", () => {
    expect(
      problem({
        ...vertebrates,
        tree: {
          branches: ["fish", { branches: ["amphibians", "mammals"], mya: 420, letter: "" }],
          mya: 400,
          letter: "",
        },
      }),
    ).toBe("has a branch point older than the one it branches from");
  });

  test("ages without a scale, or a scale without ages", () => {
    expect(problem({ ...cats, tree: { branches: ["a", "b", "c"], mya: 5, letter: "" } })).toBe(
      "gives a branch point's mya but has no time scale",
    );
    expect(problem({ ...vertebrates, tree: [["fish", "amphibians"], "mammals"] })).toBe(
      "has a time scale, so every branch point needs its mya",
    );
  });

  test("too many species, a branch point that doesn't split, or letters too close to fit", () => {
    expect(
      problem({
        ...cats,
        tree: [
          ["a", "b", "c"],
          ["d", "e", "f"],
          ["g", "h", "i"],
        ],
      }),
    ).toBe("needs 3 to 8 species");
    expect(problem({ ...cats, tree: [["a"], "b", "c"] })).toBe(
      "has a branch point that doesn't split into 2 or 3 branches",
    );
    expect(
      problem({
        ...vertebrates,
        tree: {
          branches: ["fish", { branches: ["amphibians", "mammals"], mya: 380, letter: "B" }],
          mya: 400,
          letter: "A",
        },
      }),
    ).toBe("has branch points too close in time to draw apart with the letter B");
  });
});
