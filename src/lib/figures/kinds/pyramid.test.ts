import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { pyramid, type PyramidBrief } from "./pyramid";

const brief = pyramid.samples[0].brief;
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
const levels = (brief as unknown as PyramidBrief).levels;

describe("a pyramid is held to its values and the order of its levels", () => {
  test("a bar out of proportion to its value", () => {
    const wide = swap('x="135.5" y="78" width="37"', 'x="124" y="78" width="60"');
    expect(problemsOf(wide)).toContain(
      "The bar for level 2 (primary consumers) is not 37 units wide, centred, in row 2 from the bottom: its width must be in proportion to its value",
    );
  });

  test("two levels' names swapped: producers would sit above their consumers", () => {
    const swapped = swap(
      '>primary<tspan x="236" dy="18">consumers</tspan></text>',
      ">producers</text>",
      swap(
        'y="149.5" text-anchor="start">producers<',
        'y="149.5" text-anchor="start">primary consumers<',
      ),
    );
    expect(problemsOf(swapped)).toContain(
      'The name "producers" is not written beside its bar, at the bottom',
    );
    expect(problemsOf(swapped)).toContain(
      'The name "primary consumers" is not written beside its bar, in row 2 from the bottom',
    );
  });

  test("a value changed, or an extra bar", () => {
    const value = swap('text-anchor="end">150<', 'text-anchor="end">15<');
    expect(problemsOf(value)).toContain(
      "The value 150 is not written beside the bar for level 2 (primary consumers)",
    );
    const bar = swap(
      "</svg>",
      '<rect class="qf-line" x="140" y="20" width="28" height="14"/></svg>',
    );
    expect(problemsOf(bar)).toContain(
      'The <rect class="qf-line"> at (140, 20) is not one of the pyramid\'s bars',
    );
  });
});

describe("a pyramid brief keeps to the rules of a food chain", () => {
  test("producers at the bottom, consumers in order", () => {
    expect(problem({ ...brief, levels: [levels[1], levels[0], levels[2]] })).toBe(
      'has "primary consumers" as level 1: it belongs second from the bottom, with the producers at the bottom',
    );
  });

  test("biomass falls at each level, and every bar can be seen", () => {
    expect(
      problem({
        ...brief,
        levels: [
          { name: "phytoplankton", value: 100 },
          { name: "zooplankton", value: 300 },
        ],
      }),
    ).toBe("has biomass that doesn't fall at each level up the pyramid");
    expect(
      problem({
        ...brief,
        levels: [
          { name: "grass", value: 5000 },
          { name: "rabbits", value: 100 },
        ],
      }),
    ).toBe("has a value under a fortieth of the largest, too thin to draw");
    expect(problem({ ...brief, of: "energy" })).toBe('of must be "numbers" or "biomass"');
  });
});
