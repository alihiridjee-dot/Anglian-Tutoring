import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure, type Pt } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { SPOTS, fieldLayout, fieldPattern, type FieldBrief } from "./fieldPattern";

const swap = (s: string, from: string, to: string) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};
const drawn = (b: FieldBrief) => drawWithCode(b)!.svg;

// Plates: + on top, letters A (top left), B (centre), C (bottom right).
const plates = fieldPattern.samples[0].brief as FieldBrief;
// A wire with the current into the page, unlabelled.
const wire = fieldPattern.samples[1].brief as FieldBrief;
const charge: FieldBrief = {
  kind: "field-pattern",
  field: "point-charge",
  charge: "+",
  labelled: true,
  points: [
    { letter: "A", spot: "near left" },
    { letter: "B", spot: "far right" },
  ],
};
const magnet = fieldPattern.samples[2].brief as FieldBrief;

describe("every arrow points the way the physics makes it", () => {
  test("from the + plate to the − plate", () => {
    expect(drawn(plates)).toContain('x1="80" y1="62" x2="80" y2="140" marker-end="url(#qf-head)"');
    const flipped = { ...plates, plates: { top: "−", bottom: "+" } } as FieldBrief;
    expect(drawn(flipped)).toContain(
      'x1="80" y1="218" x2="80" y2="140" marker-end="url(#qf-head)"',
    );
  });

  test("away from a + charge, towards a − charge", () => {
    // The line up and to the right, at 22.5°: its arrow out from the charge at (202, 151).
    expect(drawn(charge)).toContain(
      'x1="202.17" y1="150.82" x2="255.76" y2="128.62" marker-end="url(#qf-head)"',
    );
    expect(drawn({ ...charge, charge: "−" })).toContain(
      'x1="309.34" y1="106.42" x2="255.76" y2="128.62" marker-end="url(#qf-head)"',
    );
  });

  test("round a wire by the right-hand grip rule: clockwise as seen when the current goes into the page", () => {
    // On the inner ring's upper right, clockwise runs down and to the right.
    expect(drawn(wire)).toContain(
      'x1="202.93" y1="127.22" x2="212.78" y2="137.07" marker-end="url(#qf-head)"',
    );
    // Out of the page, the same arrow runs up and to the left: anticlockwise.
    expect(drawn({ ...wire, current: "out of the page" })).toContain(
      'x1="212.78" y1="137.07" x2="202.93" y2="127.22" marker-end="url(#qf-head)"',
    );
  });

  test("out of a magnet's N pole and into its S pole", () => {
    // The line along the axis, left of an N pole on the left: its head points away, to the left.
    expect(drawn(magnet)).toContain(
      'x1="128" y1="160" x2="70" y2="160" marker-end="url(#qf-head)"',
    );
    // On the right, into the S pole: also to the left.
    expect(drawn(magnet)).toContain(
      'x1="348" y1="160" x2="290" y2="160" marker-end="url(#qf-head)"',
    );
    const flipped = { ...magnet, poles: { left: "S", right: "N" } } as FieldBrief;
    expect(drawn(flipped)).toContain(
      'x1="232" y1="160" x2="290" y2="160" marker-end="url(#qf-head)"',
    );
  });
});

describe("a field pattern is held to the physics and its brief", () => {
  test("an arrow reversed between the plates", () => {
    const reversed = swap(
      drawn(plates),
      'x1="80" y1="62" x2="80" y2="140"',
      'x1="80" y1="140" x2="80" y2="62"',
    );
    const problems = checkFigure(reversed, plates).problems;
    expect(problems).toContain("The arrow ending at (80, 62) points against the field there");
    expect(problems).toContain(
      "The field line at x = 80 (pointing from + to −) must point to (80, 140), with its one head there",
    );
  });

  test("an arrow going the wrong way round the wire", () => {
    const reversed = swap(
      drawn(wire),
      'x1="202.93" y1="127.22" x2="212.78" y2="137.07"',
      'x1="212.78" y1="137.07" x2="202.93" y2="127.22"',
    );
    expect(checkFigure(reversed, wire).problems).toContain(
      "The arrow ending at (202.93, 127.22) points against the field there",
    );
  });

  test("a magnet drawn with N on the left, checked against a brief with N on the right", () => {
    const flipped = { ...magnet, poles: { left: "S", right: "N" } } as FieldBrief;
    const problems = checkFigure(drawn(magnet), flipped).problems;
    expect(problems).toContain("The arrow ending at (70, 160) points against the field there");
    expect(problems).toContain('The left pole\'s letter, "S", is not written at (148, 165.5)');
  });

  test("the charge's sign changed, which reverses the answer", () => {
    const sign = swap(drawn(charge), 'text-anchor="middle">+<', 'text-anchor="middle">−<');
    const problems = checkFigure(sign, charge).problems;
    expect(problems).toContain('The charge\'s sign, "+", is not written at (180, 165.5)');
    expect(problems).toContain('Text "−" at (180, 165.5) is not part of the figure');
  });

  test("letters swapped between spots", () => {
    const swapped = drawn(plates)
      .replace('middle">A<', 'middle">X<')
      .replace('middle">C<', 'middle">A<')
      .replace('middle">X<', 'middle">C<');
    const problems = checkFigure(swapped, plates).problems;
    expect(problems).toContain(
      'The letter at the top left spot, "A", is not written at (100, 97.5)',
    );
    expect(problems).toContain(
      'The letter at the bottom right spot, "C", is not written at (260, 193.5)',
    );
  });

  test("an extra field line, or a caption", () => {
    const extra = swap(
      drawn(plates),
      "</svg>",
      '<line class="qf-line" x1="100" y1="62" x2="100" y2="218"/></svg>',
    );
    expect(checkFigure(extra, plates).problems).toContain(
      "The qf-line line from (100, 62) to (100, 218) is not part of the figure",
    );
    const caption = swap(
      drawn(plates),
      "</svg>",
      '<text class="qf-text" x="180" y="260" text-anchor="middle">uniform field</text></svg>',
    );
    expect(checkFigure(caption, plates).problems).toContain(
      'Text "uniform field" at (180, 260) is not part of the figure',
    );
  });

  test("a ring of the wire's field moved off the wire", () => {
    const moved = swap(drawn(wire), 'cx="180" cy="160" r="80"', 'cx="190" cy="160" r="80"');
    const problems = checkFigure(moved, wire).problems;
    expect(problems).toContain(
      "The field ring of radius 80 is not drawn at (180, 160) with radius 80",
    );
  });
});

describe("every letter spot is clear of every line and arrowhead", () => {
  const distance = (p: Pt, a: Pt, b: Pt) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const s = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    return Math.hypot(p[0] - a[0] - s * dx, p[1] - a[1] - s * dy);
  };
  const briefs: FieldBrief[] = [
    charge,
    { ...charge, charge: "−" },
    plates,
    wire,
    { ...wire, current: "out of the page", labelled: true },
    magnet,
    { ...magnet, poles: { left: "S", right: "N" } },
  ];
  for (const b of briefs)
    test(`${b.field}, ${b.charge ?? b.current ?? b.plates?.top ?? b.poles?.left}`, () => {
      const parts = fieldLayout({ ...b, points: [] });
      for (const [name, [x, y]] of Object.entries(SPOTS[b.field])) {
        // The widest capital's box, as the checker measures it, centred on the spot.
        const box: Pt[] = [];
        for (let i = 0; i <= 8; i++)
          box.push(
            [x - 8.3 + (16.6 * i) / 8, y - 7.3],
            [x - 8.3 + (16.6 * i) / 8, y + 6.3],
            [x - 8.3, y - 7.3 + (13.6 * i) / 8],
            [x + 8.3, y - 7.3 + (13.6 * i) / 8],
          );
        let clear = Infinity;
        for (const p of parts) {
          if (p.el === "circle")
            for (const q of box)
              clear = Math.min(
                clear,
                Math.abs(Math.hypot(q[0] - p.pts[0][0], q[1] - p.pts[0][1]) - p.r),
              );
          if (p.el === "line" || p.el === "polyline" || p.el === "rect") {
            const pts: Pt[] =
              p.el === "rect"
                ? [
                    p.pts[0],
                    [p.pts[1][0], p.pts[0][1]],
                    p.pts[1],
                    [p.pts[0][0], p.pts[1][1]],
                    p.pts[0],
                  ]
                : p.pts;
            const strokes: [Pt, Pt][] = pts.slice(1).map((q, i) => [pts[i], q]);
            if ("heads" in p && p.heads) {
              // The arrowhead: 9 back from the tip and 4.5 either side.
              const [tip, prev] = [pts[pts.length - 1], pts[pts.length - 2]];
              const l = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]);
              const [ux, uy] = [(tip[0] - prev[0]) / l, (tip[1] - prev[1]) / l];
              const [bx, by] = [tip[0] - 9 * ux, tip[1] - 9 * uy];
              const sides: Pt[] = [
                [bx - 4.5 * uy, by + 4.5 * ux],
                [bx + 4.5 * uy, by - 4.5 * ux],
              ];
              strokes.push([tip, sides[0]], [tip, sides[1]], [sides[0], sides[1]]);
            }
            for (const q of box)
              for (const [a, c] of strokes) clear = Math.min(clear, distance(q, a, c));
          }
        }
        if (clear < 5) throw new Error(`The ${name} spot is ${clear.toFixed(1)} from a line`);
      }
    });
});

describe("a field brief must be physically possible", () => {
  test("two plates of the same sign, or a magnet with two N poles", () => {
    expect(problem({ ...plates, plates: { top: "+", bottom: "+" } })).toBe(
      "has both plates the same sign: one plate is + and the other −",
    );
    expect(problem({ ...magnet, poles: { left: "N", right: "N" } })).toBe(
      "has two N poles: a bar magnet has one N pole and one S pole",
    );
  });

  test("a charge with no sign, a current with no direction", () => {
    expect(problem({ ...charge, charge: "neutral" })).toBe('needs charge "+" or "−"');
    expect(problem({ ...wire, current: "clockwise" })).toBe(
      'needs current "into the page" or "out of the page"',
    );
  });

  test("a letter at a spot the field doesn't have, or two letters at one spot", () => {
    expect(problem({ ...plates, points: [{ letter: "A", spot: "far left" }] })).toBe(
      "has a point whose spot is not one of the parallel-plates's spots",
    );
    expect(
      problem({
        ...charge,
        points: [
          { letter: "A", spot: "near left" },
          { letter: "B", spot: "near left" },
        ],
      }),
    ).toBe("puts two letters at the same spot");
    expect(problem({ ...charge, points: [{ letter: "a", spot: "near left" }] })).toBe(
      "needs one capital letter for each point",
    );
  });

  test('"-" is read as a minus sign', () => {
    const read = readBrief({ ...charge, charge: "-" });
    expect("brief" in read && (read.brief as unknown as FieldBrief).charge).toBe("−");
  });
});
