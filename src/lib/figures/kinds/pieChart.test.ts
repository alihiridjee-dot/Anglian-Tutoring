import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { pieChart } from "./pieChart";

const brief = pieChart.samples[0].brief;
const svg = drawWithCode(brief)!.svg;
const swap = (from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problemsOf = (s: string) => checkFigure(s, brief).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("a pie chart is held to its slices", () => {
  test("a cut where its percentage doesn't put it", () => {
    // The cut after gas (38%) moved round to 45%: gas would look bigger.
    const moved = swap('x2="177.72" y2="193.98"', 'x2="141.67" y2="215.3"');
    expect(problemsOf(moved)).toContain(
      "The cut at 38% is not drawn from the centre to (177.72, 193.98)",
    );
  });

  test("letters swapped between slices, or a key that names the wrong slice", () => {
    const swapped = svg
      .replace('middle">A<', 'middle">X<')
      .replace('middle">B<', 'middle">A<')
      .replace('middle">X<', 'middle">B<');
    expect(problemsOf(swapped)).toEqual([
      "The letter A is not in the middle of its slice",
      "The letter B is not in the middle of its slice",
    ]);
    expect(problemsOf(swap(">gas 38%<", ">gas 26%<"))).toContain(
      'The key\'s row for A is not "A gas 38%"',
    );
  });

  test("an extra cut, or a caption", () => {
    expect(
      problemsOf(
        swap("</svg>", '<line class="qf-line" x1="112" y1="124" x2="16" y2="124"/></svg>'),
      ),
    ).toContain("The chart has 7 cuts; its 6 slices need 6");
    expect(
      problemsOf(
        swap(
          "</svg>",
          '<text class="qf-text" x="300" y="220" text-anchor="middle">35%</text></svg>',
        ),
      ),
    ).toContain('Text "35%" is not a slice\'s letter or the key');
  });

  test("a brief whose slices don't add up, or are too thin to letter", () => {
    expect(
      problem({
        ...brief,
        slices: [
          { name: "gas", percent: 60 },
          { name: "coal", percent: 30 },
        ],
      }),
    ).toBe("has percents that don't add up to 100");
    expect(
      problem({
        ...brief,
        slices: [
          { name: "gas", percent: 97 },
          { name: "coal", percent: 3 },
        ],
      }),
    ).toBe("has a slice under 6 percent, too thin to letter");
    expect(
      problem({
        ...brief,
        slices: [
          { name: "hydroelectricity", percent: 50 },
          { name: "coal", percent: 50 },
        ],
      }),
    ).toBe("has a name too long for the key");
  });
});
