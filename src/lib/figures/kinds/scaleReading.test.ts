import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { scaleReading, type ScaleBrief } from "./scaleReading";

const [cylinder, , newtonMeter] = scaleReading.samples.map((s) => s.brief as ScaleBrief);
const ruler: ScaleBrief = {
  kind: "scale-reading",
  instrument: "ruler",
  min: 0,
  max: 8,
  step: 1,
  minor: 5,
  readings: [1.4, 6.2],
  unit: "cm",
};
const protractor: ScaleBrief = {
  kind: "scale-reading",
  instrument: "protractor",
  min: 0,
  max: 180,
  step: 10,
  minor: 5,
  readings: [128],
  unit: "°",
};
const svgOf = (brief: ScaleBrief) => drawWithCode(brief)!.svg;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("a liquid's level is held to its reading", () => {
  const svg = svgOf(cylinder);
  const problemsOf = (s: string) => checkFigure(s, cylinder).problems;
  const meniscus =
    "150,209.8 158,211.96 166,213.64 174,214.84 182,215.56 190,215.8 198,215.56 206,214.84 214,213.64 222,211.96 230,209.8";

  test("a meniscus one small division low", () => {
    // 46 cm³ is at y = 215.8; each 2 cm³ division is 5.4 lower down the cylinder.
    const lower = meniscus.replace(
      /,([\d.]+)/g,
      (_, y: string) => `,${(Number(y) + 5.4).toFixed(2)}`,
    );
    const moved = problemsOf(
      swap(svg, `class="qf-data" points="${meniscus}"`, `class="qf-data" points="${lower}"`),
    );
    expect(moved).toContain(
      "The bottom of the meniscus reads 44 cm³ on the scale drawn; the brief's reading is 46 cm³",
    );
    expect(moved).toContain("The meniscus is not drawn at (150, 209.8)");
  });

  test("a meniscus curved the wrong way, so its edge is read", () => {
    const flipped =
      "150,215.8 158,213.64 166,211.96 174,210.76 182,210.04 190,209.8 198,210.04 206,210.76 214,211.96 222,213.64 230,215.8";
    expect(
      problemsOf(
        swap(svg, `class="qf-data" points="${meniscus}"`, `class="qf-data" points="${flipped}"`),
      ),
    ).toContain("The meniscus's lowest point is not in the middle of the tube");
  });
});

describe("a pointer, an arm or an object's ends are held to the readings", () => {
  test("a newton-meter's pointer moved one small division down", () => {
    const svg = svgOf(newtonMeter);
    // 6.4 N is at y = 236.4; each 0.2 N division is 5.2 further down.
    const moved = swap(
      svg,
      'points="198,236.4 212,230.4 212,242.4"',
      'points="198,241.6 212,235.6 212,247.6"',
    );
    expect(checkFigure(moved, newtonMeter).problems).toContain(
      "The pointer reads 6.6 N on the scale drawn; the brief's reading is 6.4 N",
    );
  });

  test("an object whose right end is moved along the ruler", () => {
    const svg = svgOf(ruler);
    // 6.2 cm is at x = 36 + 6.2 × 36 = 259.2; 6.4 cm at 266.4.
    const moved = swap(
      svg,
      'points="86.4,80 259.2,80 259.2,108 86.4,108"',
      'points="86.4,80 266.4,80 266.4,108 86.4,108"',
    );
    expect(checkFigure(moved, ruler).problems).toContain(
      "The object's right end reads 6.4 cm on the scale drawn; the brief's reading is 6.2 cm",
    );
  });

  test("a protractor's arm at the wrong angle", () => {
    const svg = svgOf(protractor);
    const moved = swap(svg, 'x2="93.81" y2="85.68"', 'x2="86.32" y2="91.96"');
    expect(checkFigure(moved, protractor).problems).toContain(
      "The arm reads 132° on the scale drawn; the brief's reading is 128°",
    );
  });
});

describe("the scale itself is held to its values", () => {
  const svg = svgOf(newtonMeter);
  const problemsOf = (s: string) => checkFigure(s, newtonMeter).problems;

  test("two numbers swapped, so the scale is out of order", () => {
    const swapped = svg
      .replace('y="231" text-anchor="end">6<', 'y="231" text-anchor="end">X<')
      .replace('y="257" text-anchor="end">7<', 'y="257" text-anchor="end">6<')
      .replace('y="231" text-anchor="end">X<', 'y="231" text-anchor="end">7<');
    const problems = problemsOf(swapped);
    expect(problems).toContain('The scale\'s number "6" is out of step with the others');
    expect(problems).toContain(
      'The number "6" at its tick is not written at (172, 231) (end, qf-small)',
    );
  });

  test("a tick missing, an extra mark, or a caption that gives the reading", () => {
    expect(
      problemsOf(swap(svg, '<line class="qf-line" x1="196" y1="236.4" x2="189" y2="236.4"/>', "")),
    ).toContain("The small tick for 6.4 is not drawn from (196, 236.4) to (189, 236.4)");
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<line class="qf-line" x1="196" y1="236.4" x2="230" y2="236.4"/></svg>',
        ),
      ),
    ).toContain('The <line class="qf-line"> at (196, 236.4) is not part of the newton-meter');
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="300" y="240" text-anchor="end">6.4 N</text></svg>',
        ),
      ),
    ).toContain('Text "6.4 N" is not part of the newton-meter');
  });
});

describe("a scale's brief must be true", () => {
  test("an instrument read in a unit it doesn't read in", () => {
    expect(problem({ ...newtonMeter, unit: "kg" })).toBe(
      'has unit "kg", but a newton-meter reads in N',
    );
    expect(problem({ ...cylinder, instrument: "burette" })).toBe(
      "a burette reads from 0 to 50 cm³",
    );
    expect(problem({ ...newtonMeter, min: 2, max: 12 })).toBe("a newton-meter's scale starts at 0");
  });

  test("a reading off the scale, or between the marks", () => {
    expect(problem({ ...cylinder, readings: [104] })).toBe("has a reading, 104, outside the scale");
    // Divisions of 2 cm³: 45 is half way between two, 45.5 is neither.
    expect(problem({ ...cylinder, readings: [45] })).toBeNull();
    expect(problem({ ...cylinder, readings: [45.5] })).toBe(
      "has a reading, 45.5, that is not on a small division or half way between two",
    );
    expect(problem({ ...ruler, readings: [3] })).toBe("needs two readings, the object's two ends");
    expect(problem({ ...protractor, readings: [0] })).toBe(
      "needs a protractor reading above 0: at 0 its arms lie on each other",
    );
  });

  test("a scale too fine to show apart, or one that doesn't run in whole steps", () => {
    expect(
      problem({
        ...cylinder,
        instrument: "thermometer",
        unit: "°C",
        min: -10,
        max: 110,
        minor: 10,
        readings: [20],
      }),
    ).toBe("has too many small divisions to show apart: use fewer, or a smaller range");
    expect(problem({ ...cylinder, max: 95 })).toBe("must run from min to max in whole steps");
    expect(problem({ ...cylinder, minor: 3 })).toBe("minor must be 1, 2, 4, 5 or 10");
  });
});
