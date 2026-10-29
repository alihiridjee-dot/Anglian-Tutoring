import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { REGIONS, emSpectrum, type SpectrumBrief } from "./emSpectrum";

const swap = (s: string, from: string, to: string) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

// Radio waves on the left, infrared lettered A, no arrow.
const lettered = emSpectrum.samples[0].brief as SpectrumBrief;
const plain = drawWithCode(lettered)!.svg;
// Gamma rays on the left, microwaves P, ultraviolet Q, "increasing wavelength" pointing right.
const arrowed = emSpectrum.samples[1].brief as SpectrumBrief;
const witharrow = drawWithCode(arrowed)!.svg;

describe("the spectrum is held to its order, its letters and its arrow", () => {
  test("two regions drawn in each other's boxes", () => {
    const swapped = plain
      .replace(
        'x="186.23" y="96" text-anchor="middle">visible',
        'x="234.95" y="96" text-anchor="middle">visible',
      )
      .replace(
        'x="234.95" y="96" text-anchor="middle">ultra-',
        'x="186.23" y="96" text-anchor="middle">ultra-',
      );
    const problems = checkFigure(swapped, lettered).problems;
    expect(problems).toContain(
      'The name in box 4, "visible light", is not written at (186.23, 96)',
    );
    expect(problems).toContain(
      'The name in box 5, "ultra- violet", is not written at (234.95, 96)',
    );
  });

  test("a letter in the wrong box", () => {
    // A moved from infrared's box to microwaves', and microwaves' name to infrared's.
    const moved = plain
      .replace(
        'x="137.58" y="105.5" text-anchor="middle">A',
        'x="86.75" y="105.5" text-anchor="middle">A',
      )
      .replace(
        'x="86.75" y="96" text-anchor="middle">micro-',
        'x="137.58" y="96" text-anchor="middle">micro-',
      );
    expect(checkFigure(moved, lettered).problems).toContain(
      'The letter in box 3 (for infrared), "A", is not written at (137.58, 105.5)',
    );
  });

  test("the arrow pointing the wrong way", () => {
    const reversed = swap(
      witharrow,
      'x1="48" y1="124" x2="312" y2="124"',
      'x1="312" y1="124" x2="48" y2="124"',
    );
    const problems = checkFigure(reversed, arrowed).problems;
    expect(problems).toContain(
      "The arrow labelled increasing wavelength points towards gamma rays",
    );
    expect(problems).toContain(
      "The arrow labelled increasing wavelength (pointing right) must point to (312, 124), with its one head there",
    );
  });

  test("a divider moved, so a box is the wrong size, or a caption naming a letter", () => {
    const moved = swap(
      plain,
      'x1="114.27" y1="72" x2="114.27" y2="128"',
      'x1="120" y1="72" x2="120" y2="128"',
    );
    expect(checkFigure(moved, lettered).problems).toContain(
      "The line between box 2 and box 3 is not drawn from (114.27, 72) to (114.27, 128)",
    );
    const caption = swap(
      plain,
      "</svg>",
      '<text class="qf-text" x="180" y="170" text-anchor="middle">A is infrared</text></svg>',
    );
    expect(checkFigure(caption, lettered).problems).toContain(
      'Text "A is infrared" at (180, 170) is not part of the figure',
    );
  });

  test("the box widths don't change with what is lettered, so a box never hints at its region", () => {
    const none = drawWithCode({ ...lettered, blanks: [] })!.svg;
    const dividers = (s: string) => s.match(/<line[^>]*\/>/g);
    expect(dividers(none)).toEqual(dividers(plain));
  });
});

describe("a spectrum brief must be the real spectrum", () => {
  test("the regions out of order", () => {
    const shuffled = [...REGIONS];
    [shuffled[2], shuffled[3]] = [shuffled[3], shuffled[2]];
    expect(problem({ ...lettered, regions: shuffled })).toBe(
      "has the regions out of order: the spectrum runs radio waves, microwaves, infrared, visible light, ultraviolet, X-rays, gamma rays, or the reverse",
    );
    expect(problem({ ...lettered, regions: REGIONS.slice(1) })).toStartWith(
      "needs all seven regions",
    );
  });

  test("an arrow pointing the way that isn't true", () => {
    expect(problem({ ...lettered, arrow: { label: "increasing frequency", points: "left" } })).toBe(
      "has an arrow labelled increasing frequency pointing towards radio waves: frequency increases towards gamma rays",
    );
    expect(problem({ ...arrowed, arrow: { label: "increasing wavelength", points: "left" } })).toBe(
      "has an arrow labelled increasing wavelength pointing towards gamma rays: wavelength increases towards radio waves",
    );
    expect(
      problem({ ...lettered, arrow: { label: "increasing speed", points: "right" } }),
    ).toStartWith("has an arrow label that is not one of");
  });

  test("blanks: each a real region, once, with its own capital letter", () => {
    expect(problem({ ...lettered, blanks: [{ region: "sound", letter: "A" }] })).toBe(
      "has a blank whose region is not one of the seven",
    );
    expect(
      problem({
        ...lettered,
        blanks: [
          { region: "infrared", letter: "A" },
          { region: "X-rays", letter: "A" },
        ],
      }),
    ).toBe("uses a letter twice");
  });

  test("the usual short names are read as the regions", () => {
    const read = readBrief({
      ...lettered,
      regions: ["radio", "microwave", "IR", "visible", "UV", "x-ray", "gamma"],
      blanks: [{ region: "uv", letter: "B" }],
    });
    expect("brief" in read && read.brief).toMatchObject({
      regions: [...REGIONS],
      blanks: [{ region: "ultraviolet", letter: "B" }],
    });
  });
});
