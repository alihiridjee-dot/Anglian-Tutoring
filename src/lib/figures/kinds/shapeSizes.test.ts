import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { shapeSizes, type ShapeBrief } from "./shapeSizes";

const swap = (s: string, from: string, to: string) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

// The aluminium block: 5.0 cm wide, 2.0 cm high, 3.0 cm deep.
const block = shapeSizes.samples[0].brief as ShapeBrief;
const cuboid = drawWithCode(block)!.svg;
// The base of the box: 0.50 m by 0.40 m.
const base = shapeSizes.samples[1].brief as ShapeBrief;
const rectangle = drawWithCode(base)!.svg;
const tin: ShapeBrief = {
  kind: "shape-sizes",
  shape: "cylinder",
  unit: "cm",
  decimals: 1,
  sizes: { diameter: 6, height: 4 },
  letters: { height: "h" },
};

describe("a shape is drawn in proportion to its sizes", () => {
  test("a rectangle's sides as its sizes give them: 0.50 by 0.40", () => {
    const [, w, h] =
      /<rect class="qf-line" x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/.exec(
        rectangle,
      )!;
    expect(Number(w) / Number(h)).toBeCloseTo(0.5 / 0.4, 2);
  });

  test("a cuboid's front face 5 by 2, its depth set back at 45° and halved", () => {
    expect(cuboid).toContain(
      '<rect class="qf-line" x="100.3" y="95.55" width="148.5" height="59.4"/>',
    );
    // The back corner is (31.5, 31.5) up and right: 3 cm at the front's scale, halved, along 45°.
    const scale = 148.5 / 5;
    expect(280.3 - 248.79).toBeCloseTo((3 * scale) / 2 / Math.SQRT2, 1);
    expect(cuboid).toContain(
      '<line class="qf-line" x1="248.79" y1="95.55" x2="280.3" y2="64.05"/>',
    );
  });
});

describe("a shape is held to its proportions and its labels", () => {
  test("a rectangle drawn square, as if its sizes were equal", () => {
    const square = swap(rectangle, 'height="140"', 'height="175"');
    expect(checkFigure(square, base).problems.join("\n")).toContain(
      "The rectangle (0.5 by 0.4, in proportion) is not drawn where it belongs",
    );
  });

  test("the width and height labels swapped", () => {
    const swapped = cuboid
      .replace(">5.0 cm<", ">X<")
      .replace(">2.0 cm<", ">5.0 cm<")
      .replace(">X<", ">2.0 cm<");
    const problems = checkFigure(swapped, block).problems;
    expect(problems).toContain('The width label, "5.0 cm", is not written at (174.54, 189.95)');
    expect(problems).toContain('The height label, "2.0 cm", is not written at (74.3, 130.75)');
  });

  test("a dimension line moved off its edge, so it measures something else", () => {
    // The depth's dimension line drawn along the top instead of the bottom right edge.
    const moved = swap(
      cuboid,
      'x1="258.69" y1="164.85" x2="290.19" y2="133.35"',
      'x1="131.8" y1="54.05" x2="280.3" y2="54.05"',
    );
    expect(checkFigure(moved, block).problems).toContain(
      "The depth dimension line is not drawn from (258.69, 164.85) to (290.19, 133.35)",
    );
  });

  test("a caption that gives the answer away, or a stray line", () => {
    expect(
      checkFigure(
        swap(
          cuboid,
          "</svg>",
          '<text class="qf-text" x="180" y="240" text-anchor="middle">V = 30 cm³</text></svg>',
        ),
        block,
      ).problems,
    ).toContain('Text "V = 30 cm³" at (180, 240) is not part of the figure');
    expect(
      checkFigure(
        swap(
          cuboid,
          "</svg>",
          '<line class="qf-line" x1="131.8" y1="64.05" x2="131.8" y2="123.45"/></svg>',
        ),
        block,
      ).problems,
    ).toContain(
      "The qf-line line from (131.8, 64.05) to (131.8, 123.45) is not part of the figure",
    );
  });

  test("a cylinder's letter for the size asked for, in bold beside its edge", () => {
    const svg = drawWithCode(tin)!.svg;
    expect(svg).toContain('class="qf-strong"');
    expect(checkFigure(svg, tin).problems).toEqual([]);
    const answered = svg.replace(
      /class="qf-strong" (x="[\d.]+" y="[\d.]+" text-anchor="start")>h</,
      'class="qf-text" $1>4.0 cm<',
    );
    expect(checkFigure(answered, tin).problems.join("\n")).toContain(
      'The height label, "h", is not written at',
    );
  });
});

describe("a shape brief holds the sizes its shape needs", () => {
  test("the wrong sizes for the shape", () => {
    expect(problem({ ...block, sizes: { width: 5, height: 2 } })).toBe(
      "needs a cuboid's sizes as {width, height, depth}",
    );
    expect(problem({ ...tin, sizes: { height: 4 } })).toBe(
      "needs a cylinder's sizes as {height, and diameter or radius}",
    );
    expect(problem({ ...base, letters: { radius: "r" } })).toBe(
      "has a letter for radius, which the rectangle has no size for",
    );
  });

  test("a size written with fewer decimal places than it has", () => {
    expect(problem({ ...block, sizes: { width: 5.25, height: 2, depth: 3 } })).toBe(
      "has a width with more decimal places than decimals",
    );
  });

  test("sizes too different to draw in proportion", () => {
    expect(problem({ ...base, sizes: { width: 10, height: 0.5 } })).toBe(
      "has sizes too different to draw in proportion",
    );
  });

  test("sizes within 3 times of each other always draw", () => {
    for (const w of [1, 2, 3])
      for (const h of [1, 2, 3]) {
        expect(problem({ ...base, decimals: 0, sizes: { width: w, height: h } })).toBeNull();
        expect(problem({ ...tin, decimals: 0, sizes: { radius: w, height: h * 2 } })).toBeNull();
        expect(
          problem({ ...block, decimals: 0, sizes: { width: w, height: h, depth: Math.max(w, h) } }),
        ).toBeNull();
      }
  });
});
