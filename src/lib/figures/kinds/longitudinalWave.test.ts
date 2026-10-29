import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { COILS, coilXs, longitudinalWave } from "./longitudinalWave";

// A at the rarefaction, B at the compression, C the wavelength.
const brief = longitudinalWave.samples[0].brief;
const svg = drawWithCode(brief)!.svg;
const swap = (from: string, to: string, s = svg) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problemsOf = (s: string) => checkFigure(s, brief).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("the row of lines bunches and spreads as a longitudinal wave does", () => {
  const xs = coilXs();
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);

  test("closest at the compressions, a quarter and three quarters of the way along", () => {
    const narrowest = Math.min(...gaps);
    const at = gaps.flatMap((g, i) =>
      Math.abs(g - narrowest) < 1e-6 ? [(xs[i] + xs[i + 1]) / 2] : [],
    );
    expect(at.map((x) => Math.round(x))).toEqual([105, 255]);
    expect(narrowest).toBeCloseTo(COILS.spacing * 0.4, 1);
  });

  test("widest at the rarefactions, at the ends and in the middle", () => {
    const widest = Math.max(...gaps);
    expect(gaps[0]).toBeCloseTo(widest, 0);
    expect(xs[15]).toBe(180);
    expect(xs[16] - xs[15]).toBeCloseTo(widest, 0);
    // Never crossing: every line right of the one before it.
    expect(gaps.every((g) => g > 3)).toBe(true);
  });
});

describe("a longitudinal wave is held to its lines and letters", () => {
  test("a line moved, which blurs the compression", () => {
    const moved = swap(
      'x1="102.98" y1="100" x2="102.98" y2="172"',
      'x1="96" y1="100" x2="96" y2="172"',
    );
    expect(problemsOf(moved)).toContain(
      "The line 8 of 31 is not drawn from (102.98, 100) to (102.98, 172)",
    );
    expect(problemsOf(moved)).toContain(
      "The qf-line line from (96, 100) to (96, 172) is not part of the figure",
    );
  });

  test("evenly spaced lines: no compressions or rarefactions at all", () => {
    let even = svg;
    coilXs().forEach((x, i) => {
      const at = Number(x.toFixed(2));
      even = even.replace(
        `x1="${at}" y1="100" x2="${at}" y2="172"`,
        `x1="${30 + 10 * i}" y1="100" x2="${30 + 10 * i}" y2="172"`,
      );
    });
    expect(problemsOf(even)).toContain(
      "The line 2 of 31 is not drawn from (45.83, 100) to (45.83, 172)",
    );
  });

  test("the letters for the compression and the rarefaction swapped", () => {
    const swapped = svg
      .replace('x="180" y="44" text-anchor="middle">A', 'x="180" y="44" text-anchor="middle">X')
      .replace('x="105" y="44" text-anchor="middle">B', 'x="105" y="44" text-anchor="middle">A')
      .replace('x="180" y="44" text-anchor="middle">X', 'x="180" y="44" text-anchor="middle">B');
    expect(problemsOf(swapped)).toContain(
      'The compression arrow\'s letter, "B", is not written at (105, 44)',
    );
    expect(problemsOf(swapped)).toContain(
      'The rarefaction arrow\'s letter, "A", is not written at (180, 44)',
    );
  });

  test("the wavelength drawn from a compression to a rarefaction: half a wavelength", () => {
    const half = swap('x1="105" y1="196" x2="255" y2="196"', 'x1="105" y1="196" x2="180" y2="196"');
    expect(problemsOf(half)).toContain(
      "The wavelength arrow (from one compression to the next) is not drawn from (105, 196) to (255, 196)",
    );
  });

  test("an extra arrow or a caption naming a feature", () => {
    expect(
      problemsOf(
        swap(
          "</svg>",
          '<line class="qf-line" x1="255" y1="52" x2="255" y2="92" marker-end="url(#qf-head)"/></svg>',
        ),
      ),
    ).toContain("The arrow from (255, 52) to (255, 92) is not part of the figure");
    expect(
      problemsOf(
        swap(
          "</svg>",
          '<text class="qf-text" x="105" y="24" text-anchor="middle">compression</text></svg>',
        ),
      ),
    ).toContain('Text "compression" at (105, 24) is not part of the figure');
  });
});

describe("a longitudinal brief names each feature once", () => {
  test("arrows that are not features of a longitudinal wave, or shown twice", () => {
    expect(problem({ kind: "longitudinal-wave", arrows: [] })).toBe("needs 1 to 3 arrows");
    expect(
      problem({ kind: "longitudinal-wave", arrows: [{ shows: "amplitude", letter: "A" }] }),
    ).toBe('has an arrow that does not show "compression", "rarefaction" or "wavelength"');
    expect(
      problem({
        kind: "longitudinal-wave",
        arrows: [
          { shows: "compression", letter: "A" },
          { shows: "compression", letter: "B" },
        ],
      }),
    ).toBe("has two arrows showing the same thing, or sharing a letter");
    expect(
      problem({ kind: "longitudinal-wave", arrows: [{ shows: "compression", letter: "AB" }] }),
    ).toBe("needs one capital letter for each arrow");
  });
});
