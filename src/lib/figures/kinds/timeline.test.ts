import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { timeline, type TimelineBrief } from "./timeline";

const brief = timeline.samples[0].brief as unknown as TimelineBrief;
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

describe("a timeline is held to its values and its names", () => {
  test("an event's dot away from its value", () => {
    // First mammals moved from 200 to 250 million years ago.
    const moved = swap('cx="230.67" cy="68" r="5"', 'cx="205.33" cy="68" r="5"');
    expect(problemsOf(moved)).toContain(
      'The dot for "first mammals" is not on the scale at 200 (x = 230.67)',
    );
  });

  test("two events' names swapped", () => {
    const swapped = swap(
      'x="230.67" y="42" text-anchor="middle">first mammals<',
      'x="230.67" y="42" text-anchor="middle">first land plants<',
      swap(
        'x="93.87" y="42" text-anchor="middle">first land plants<',
        'x="93.87" y="42" text-anchor="middle">first mammals<',
      ),
    );
    expect(problemsOf(swapped)).toContain(
      'The name at the top of the line up from 470 is "first mammals"; the brief names it "first land plants"',
    );
  });

  test("a period's bar too short: the Mesozoic would look 60 million years shorter", () => {
    const short = swap('x="204.32" y="134" width="94.24"', 'x="204.32" y="134" width="64"');
    expect(problemsOf(short)).toContain(
      'The bar for "Mesozoic" does not run from 252 to 66 (x = 204.32 to 298.56)',
    );
  });

  test("an extra dot, or a caption giving a value away", () => {
    const dot = swap("</svg>", '<circle class="qf-dot" cx="150" cy="68" r="5"/></svg>');
    expect(problemsOf(dot)).toContain("The timeline has 4 dots; the brief has 3 events");
    const caption = swap(
      "</svg>",
      '<text class="qf-text" x="300" y="150" text-anchor="middle">186</text></svg>',
    );
    expect(problemsOf(caption)).toContain(
      "Text \"186\" is not an event's or period's name or part of the scale",
    );
  });
});

describe("a timeline brief must fit its scale", () => {
  test("a value off the scale, or a scale that doesn't say which way it runs", () => {
    expect(problem({ ...brief, events: [{ at: 700, name: "first cells" }] })).toBe(
      "has an event that is not a value on the scale",
    );
    expect(problem({ ...brief, scale: { ...brief.scale, ago: undefined } })).toBe(
      "scale's ago must be true or false",
    );
  });

  test("events crowded together, or a period too short to see", () => {
    expect(
      problem({
        ...brief,
        periods: [],
        events: [
          { at: 300, name: "a" },
          { at: 305, name: "b" },
        ],
      }),
    ).toBe("has two events too close together to tell apart");
    const crowd = ["first fish", "first insects", "first reptiles", "first trees", "first birds"];
    expect(
      problem({
        ...brief,
        periods: [],
        events: crowd.map((name, i) => ({ at: 300 + 30 * i, name })),
      }),
    ).toBe("has events too close together to name: at most three rows of names");
    expect(problem({ ...brief, periods: [{ from: 10, to: 5, name: "short" }] })).toBe(
      "has a period too short to draw as a bar",
    );
  });
});
