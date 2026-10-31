import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { dotAndCross } from "./dotAndCross";

const [ammonia, carbonDioxide, water] = dotAndCross.samples.map((s) => s.brief);
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
const cross = (x: number, y: number) =>
  `<line class="qf-line" x1="${x - 3.5}" y1="${y - 3.5}" x2="${x + 3.5}" y2="${y + 3.5}"/><line class="qf-line" x1="${x - 3.5}" y1="${y + 3.5}" x2="${x + 3.5}" y2="${y - 3.5}"/>`;

describe("a dot-and-cross diagram is held to each atom's electrons", () => {
  test("a shared pair missing its dot", () => {
    // The N–H bond on the left keeps only the hydrogen's electron: no bond at all.
    const svg = swap(drawn(ammonia), '<circle class="qf-ink" cx="149" cy="64" r="3.5"/>', "");
    expect(problemsOf(svg, ammonia)).toEqual([
      "The overlap of the central N and the left H holds 0 dots and 1 cross; its single bond needs 1 dot and 1 cross",
      "The diagram has 7 electrons; the brief's atoms have 8 outer electrons",
    ]);
  });

  test("a lone pair's dot drawn as a cross", () => {
    // Nitrogen's lone pair would read as one electron of its own and one of hydrogen's.
    const svg = swap(
      drawn(ammonia),
      '<circle class="qf-ink" cx="174" cy="27" r="3.5"/>',
      cross(174, 27),
    );
    expect(problemsOf(svg, ammonia)).toEqual([
      "The central N's own part of its shell holds 1 dot and 1 cross; it needs 2 dots and 0 crosses",
      "The cross at (174, 27) is not where an electron goes",
    ]);
  });

  test("an extra electron, or one outside every shell", () => {
    // A fifth pair of crosses on oxygen: 10 electrons, not 8.
    const svg = drawn(carbonDioxide);
    const extra = swap(svg, "</svg>", `${cross(70, 94)}${cross(70, 106)}</svg>`);
    expect(problemsOf(extra, carbonDioxide)).toEqual([
      "The left O's own part of its shell holds 0 dots and 6 crosses; it needs 0 dots and 4 crosses",
      "The cross at (70, 94) is not where an electron goes",
      "The cross at (70, 106) is not where an electron goes",
      "The diagram has 18 electrons; the brief's atoms have 16 outer electrons",
    ]);
    const stray = swap(svg, "</svg>", '<circle class="qf-ink" cx="180" cy="180" r="3.5"/></svg>');
    expect(problemsOf(stray, carbonDioxide)).toContain(
      "The dot at (180, 180) is outside every shell",
    );
  });

  test("a shell drawn the wrong size, the hidden element named, or a caption", () => {
    const svg = drawn(water);
    expect(
      problemsOf(
        swap(
          svg,
          '<circle class="qf-line" cx="108" cy="100" r="48"/>',
          '<circle class="qf-line" cx="108" cy="100" r="40"/>',
        ),
        water,
      ),
    ).toEqual(["The shell of the left H is not drawn at (108, 100) with radius 48"]);
    // The letter X stands for oxygen: writing O gives the answer away.
    expect(
      problemsOf(
        swap(
          svg,
          'class="qf-strong" x="180" y="105.5" text-anchor="middle">X<',
          'class="qf-strong" x="180" y="105.5" text-anchor="middle">O<',
        ),
        water,
      ),
    ).toEqual([
      '"X" is not written in the middle of the central O\'s shell',
      'Text "O" is not an atom\'s symbol',
    ]);
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="180" y="190" text-anchor="middle">covalent</text></svg>',
        ),
        water,
      ),
    ).toEqual([
      'Text "covalent" is not an atom\'s symbol',
      "The diagram has 4 texts; it has one for each of its 3 atoms",
    ]);
  });
});

describe("a dot-and-cross brief must give every atom a full outer shell", () => {
  test("bonds that leave an atom short of, or over, eight", () => {
    // CO₂ with single bonds: carbon ends with 6, each oxygen with 7.
    expect(
      problem({
        ...carbonDioxide,
        around: [
          { symbol: "O", bonds: 1 },
          { symbol: "O", bonds: 1 },
        ],
      }),
    ).toBe("gives the central C 6 outer electrons once bonded, not 8");
    // Hydrogen with a double bond: four electrons in a shell that holds two.
    expect(
      problem({
        kind: "dot-and-cross",
        centre: "O",
        around: [{ symbol: "H", bonds: 2 }],
        letter: null,
      }),
    ).toBe("gives a bonded H 3 outer electrons, not 2");
  });

  test("an element it doesn't draw, too many atoms, or a letter that isn't one", () => {
    expect(problem({ ...ammonia, centre: "Na" })).toBe(
      "centre must be one of H, C, Si, N, P, O, S, F, Cl, Br, I",
    );
    expect(
      problem({
        ...ammonia,
        around: Array.from({ length: 5 }, () => ({ symbol: "H", bonds: 1 })),
      }),
    ).toBe("needs 1 to 4 atoms around the centre");
    expect(problem({ ...water, letter: "XY" })).toBe("letter must be null or one capital letter");
  });
});
