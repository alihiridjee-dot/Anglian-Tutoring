import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { rayDiagram } from "./rayDiagram";

const [mirror, block, lens] = rayDiagram.samples.map((s) => s.brief);
const svgOf = (brief: (typeof rayDiagram.samples)[number]["brief"]) => drawWithCode(brief)!.svg;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("a plane mirror is held to the law of reflection", () => {
  const svg = svgOf(mirror);
  const problemsOf = (s: string) => checkFigure(s, mirror).problems;

  test("a reflected ray that leaves at the wrong angle", () => {
    // Reflected at 50° to the normal, where the incident ray comes in at 40°.
    const moved = swap(
      svg,
      'x1="180" y1="216" x2="231.42" y2="154.72" marker-end="url(#qf-head)"/><line class="qf-line" x1="231.42" y1="154.72" x2="282.85" y2="93.43"/>',
      'x1="180" y1="216" x2="241.28" y2="164.58" marker-end="url(#qf-head)"/><line class="qf-line" x1="241.28" y1="164.58" x2="302.57" y2="113.15"/>',
    );
    expect(problemsOf(moved)).toContain(
      "The reflected ray leaves at 50° to the normal; it must leave at 40°, the angle of incidence",
    );
    expect(problemsOf(moved)).toContain(
      "The reflected ray (up to its arrowhead) is not drawn from (180, 216) to (231.42, 154.72)",
    );
  });

  test("a reflected ray arrowed back towards the mirror", () => {
    const reversed = swap(
      svg,
      'x1="180" y1="216" x2="231.42" y2="154.72" marker-end',
      'x1="231.42" y1="154.72" x2="180" y2="216" marker-end',
    );
    expect(problemsOf(reversed)).toContain(
      "There must be one ray arrowed towards the mirror at (180, 216); there are 2",
    );
  });

  test("a label in the wrong angle", () => {
    // "r" moved across the normal, into the angle of incidence.
    const moved = swap(svg, 'x="193.51" y="184.88"', 'x="166.49" y="184.88"');
    expect(problemsOf(moved)).toContain('The label "r" is not inside the angle of reflection');
    // "50°" moved across to the reflected ray's side of the mirror.
    const crossed = swap(svg, 'x="132.87" y="200.02"', 'x="227.13" y="200.02"');
    expect(problemsOf(crossed)).toContain(
      'The label "50°" is not inside the angle between the incident ray and the mirror',
    );
  });

  test("an extra ray, or a caption", () => {
    expect(
      problemsOf(
        swap(svg, "</svg>", '<line class="qf-line" x1="180" y1="216" x2="300" y2="60"/></svg>'),
      ),
    ).toContain('The <line class="qf-line"> at (180, 216) is not part of the ray diagram');
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="300" y="60" text-anchor="middle">r = 40°</text></svg>',
        ),
      ),
    ).toContain('Text "r = 40°" is not part of the ray diagram');
  });
});

describe("a glass block is held to refraction", () => {
  const svg = svgOf(block);
  const problemsOf = (s: string) => checkFigure(s, block).problems;

  test("a ray bent away from the normal inside the block", () => {
    // At 55° to the normal inside the glass, where it went in at 40°.
    const bent = swap(
      svg,
      'x1="147.36" y1="112" x2="180" y2="182" marker-end',
      'x1="147.36" y1="112" x2="247.33" y2="182" marker-end',
    );
    expect(problemsOf(bent)).toContain(
      "The ray inside the block is at 55° to the normal; the brief's angle of refraction is 25°",
    );
    expect(problemsOf(bent)).toContain(
      "The ray inside the block bends away from the normal: entering glass, it bends towards it",
    );
  });

  test("a ray that comes out not parallel to the ray going in", () => {
    const tilted = swap(
      svg,
      'x1="212.64" y1="252" x2="243.5" y2="288.77" marker-end',
      'x1="212.64" y1="252" x2="230" y2="295" marker-end',
    );
    expect(
      problemsOf(tilted).some((p) => p.endsWith("it must leave parallel to the ray going in")),
    ).toBe(true);
  });

  test("the angle of refraction's label moved out of the block", () => {
    const out = swap(svg, 'x="169.11" y="216.12"', 'x="169.11" y="280"');
    expect(problemsOf(out)).toContain('The label "25°" is not inside the angle of refraction');
  });
});

describe("a lens is held to 1/f = 1/u + 1/v", () => {
  const svg = svgOf(lens);
  const problemsOf = (s: string) => checkFigure(s, lens).problems;

  test("an image drawn where the lens doesn't put it", () => {
    // f = 10, u = 15: v = 30, at x = 150 + 30 × 6 = 330. Drawn at 300 instead.
    const moved = swap(
      svg,
      'x1="330" y1="123" x2="330" y2="213" marker-end',
      'x1="300" y1="123" x2="300" y2="213" marker-end',
    );
    expect(problemsOf(moved)).toContain(
      "The image is drawn at x = 300; 1/f = 1/u + 1/v puts it 30 from the lens, at x = 330",
    );
  });

  test("a real image drawn the right way up", () => {
    const upright = swap(
      svg,
      'x1="330" y1="123" x2="330" y2="213" marker-end',
      'x1="330" y1="123" x2="330" y2="33" marker-end',
    );
    expect(problemsOf(upright)).toContain(
      "The image points the wrong way: a real image is upside down",
    );
  });

  test("a ray through the centre that bends at the lens", () => {
    const bent = swap(
      svg,
      'x1="150" y1="123" x2="330" y2="213"/>',
      'x1="150" y1="123" x2="330" y2="190"/>',
    );
    expect(problemsOf(bent)).toContain(
      "The ray through the centre of the lens after the lens is not drawn from (150, 123) to (330, 213)",
    );
  });
});

describe("a ray diagram's brief must be true", () => {
  test("a mirror's angle labelled with the wrong size", () => {
    expect(problem({ ...mirror, angles: [{ at: "reflection", label: "50°" }] })).toBe(
      "labels the angle of reflection 50°, but it is 40°",
    );
    expect(
      problem({
        ...mirror,
        angles: [
          { at: "incidence", label: "x" },
          { at: "reflection", label: "x" },
        ],
      }),
    ).toBe("uses a letter twice");
  });

  test("a block that bends the ray away from the normal, or as no glass does", () => {
    expect(problem({ ...block, refraction: 45, angles: [] })).toBe(
      "has refraction no smaller than incidence: entering glass, a ray bends towards the normal",
    );
    expect(problem({ ...block, refraction: 38, angles: [] })).toBe(
      "bends the ray as no glass does: sin i ÷ sin r is 1.04, not from 1.3 to 2.5",
    );
    // sin 40° ÷ sin 25° is 1.52, not 1.6.
    expect(problem({ ...block, index: 1.6 })).toBe(
      "has angles that don't fit its refractive index: sin i ÷ sin r is 1.52",
    );
    expect(problem({ ...block, index: 1.52 })).toBeNull();
  });

  test("an angle too narrow for its label", () => {
    expect(
      problem({
        ...block,
        incidence: 25,
        refraction: 16,
        angles: [{ at: "refraction", label: "16°" }],
      }),
    ).toBe('has an angle too narrow for its label "16°": use a shorter label');
    expect(
      problem({
        ...block,
        incidence: 25,
        refraction: 16,
        angles: [{ at: "refraction", label: "r" }],
      }),
    ).toBeNull();
  });

  test("a lens whose object is at F, or too far for its image to fit", () => {
    const refused =
      "puts the object where its image won't fit: for a converging lens objectDistance must be 1.4 to 4 times focalLength, or 0.4 to 0.7 times it";
    expect(problem({ ...lens, objectDistance: 10 })).toBe(refused);
    expect(problem({ ...lens, objectDistance: 50 })).toBe(refused);
    expect(problem({ ...lens, setup: "diverging-lens", objectDistance: 40 })).toBe(
      "objectDistance must be 0.5 to 3 times focalLength for a diverging lens",
    );
    expect(problem({ ...lens, focalLength: -10 })).toBe(
      "needs focalLength, objectDistance and objectHeight above 0",
    );
  });
});
