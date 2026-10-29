import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { moments } from "./moments";

// The seesaw: 400 N at 0.5 m and W at 4 m on a 4 m plank pivoted at 2 m.
const brief = moments.samples[0].brief;
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
const force = (f: Record<string, unknown>) => ({
  at: 1,
  direction: "down",
  name: "",
  size: 100,
  distance: null,
  ...f,
});

describe("a beam on a pivot is held to its forces", () => {
  test("the sample draws to scale: the pivot in the middle, each arrow at its distance", () => {
    expect(svg).toContain('<polygon class="qf-line" points="180,109 192,131 168,131"/>');
    expect(svg).toContain('x1="75" y1="51" x2="75" y2="99" marker-end="url(#qf-head)"');
    expect(svg).toContain('x1="320" y1="51" x2="320" y2="99" marker-end="url(#qf-head)"');
    expect(problemsOf(svg)).toEqual([]);
  });

  test("a force moved along the beam, which changes its moment", () => {
    // 400 N drawn at 0.8 m from the end instead of 0.5 m: 1.2 m from the pivot, not 1.5 m.
    const moved = swap('x1="75" y1="51" x2="75" y2="99"', 'x1="96" y1="51" x2="96" y2="99"');
    expect(problemsOf(moved)).toContain(
      "The 400 N arrow (pointing down, 0.5 m from the beam's left end) is not drawn from (75, 51) to (75, 99)",
    );
    expect(problemsOf(moved)).toContain(
      "The arrow from (96, 51) to (96, 99) is not part of the figure",
    );
  });

  test("the pivot moved off its place", () => {
    const moved = swap('points="180,109 192,131 168,131"', 'points="200,109 212,131 188,131"');
    expect(problemsOf(moved).join("\n")).toContain(
      "The pivot (2 m from the beam's left end) is not drawn where it belongs",
    );
  });

  test("a force pointing the wrong way", () => {
    const reversed = swap('x1="320" y1="51" x2="320" y2="99"', 'x1="320" y1="99" x2="320" y2="51"');
    expect(problemsOf(reversed)).toContain("The W arrow points up; the brief has it pointing down");
  });

  test("labels swapped between the forces, or between the distances", () => {
    const labels = svg
      .replace(
        'x="75" y="41" text-anchor="middle">400 N',
        'x="320" y="41" text-anchor="middle">400 N',
      )
      .replace('x="320" y="41" text-anchor="middle">W', 'x="75" y="41" text-anchor="middle">W');
    expect(problemsOf(labels)).toContain(
      'The label above the arrow 0.5 m from the beam\'s left end, "400 N", is not written at (75, 41)',
    );
    const distances = svg
      .replace(">1.5 m<", ">X<")
      .replace(">2.0 m<", ">1.5 m<")
      .replace(">X<", ">2.0 m<");
    expect(problemsOf(distances)).toContain(
      'The distance label for the 400 N arrow, "1.5 m", is not written at (127.5, 168)',
    );
  });

  test("an extra force or a caption that gives the answer away", () => {
    expect(
      problemsOf(
        swap(
          "</svg>",
          '<line class="qf-line" x1="180" y1="51" x2="180" y2="99" marker-end="url(#qf-head)"/></svg>',
        ),
      ),
    ).toContain("The arrow from (180, 51) to (180, 99) is not part of the figure");
    expect(
      problemsOf(
        swap(
          "</svg>",
          '<text class="qf-text" x="250" y="190" text-anchor="middle">W = 300 N</text></svg>',
        ),
      ),
    ).toContain('Text "W = 300 N" at (250, 190) is not part of the figure');
  });
});

describe("a moments brief must fit and make sense", () => {
  const beam = { kind: "moments", length: 4, unit: "m", pivot: 2 };

  test("forces on the beam, at most 4, each with a direction", () => {
    expect(problem({ ...beam, forces: [] })).toBe("needs 1 to 4 forces");
    expect(problem({ ...beam, forces: [force({ at: 5 })] })).toBe(
      "has a force whose at is not from 0 to length, with at most 2 decimal places",
    );
    expect(problem({ ...beam, pivot: 4.5, forces: [force({})] })).toBe(
      "needs the pivot from 0 to length, with at most 2 decimal places",
    );
    expect(problem({ ...beam, forces: [force({ direction: "left" })] })).toBe(
      'has a force whose direction is not "up" or "down"',
    );
  });

  test("a distance marked from the pivot to a force at the pivot has no length", () => {
    expect(problem({ ...beam, forces: [force({ at: 2, distance: "value" })] })).toBe(
      "marks a distance for a force at the pivot",
    );
  });

  test("forces whose labels would meet, or a distance too short to write", () => {
    expect(problem({ ...beam, forces: [force({ at: 0.5 }), force({ at: 0.7, size: 250 })] })).toBe(
      "has two forces too close together for their labels",
    );
    expect(problem({ ...beam, forces: [force({ at: 1.8, distance: "value" })] })).toBe(
      "marks a distance too short to write its value under it",
    );
  });

  test("the force asked for needs a name, and only one unknown of each name", () => {
    expect(problem({ ...beam, forces: [force({ size: null })] })).toBe(
      "needs a name (a letter) for the force whose size is asked for",
    );
    expect(
      problem({
        ...beam,
        forces: [force({ at: 0, size: null, name: "W" }), force({ at: 4, size: null, name: "W" })],
      }),
    ).toBe("names two unknown forces alike");
  });

  test("every marked distance is written to the same decimal places", () => {
    const read = readBrief(brief);
    expect("brief" in read && drawWithCode(read.brief)!.alt).toContain(
      "1.5 m to 400 N; 2.0 m to W",
    );
  });
});
