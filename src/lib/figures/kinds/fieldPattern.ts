/**
 * A field pattern, as a textbook draws it: the electric field round a point
 * charge (radial lines) or between two parallel plates (straight, evenly
 * spaced lines from + to −), the magnetic field round a straight wire seen
 * end-on (rings, the current a dot or a cross), or round a bar magnet (lines
 * traced through the field of its two poles, from N round to S). Every arrow
 * points the way the physics makes it, worked out here from the charge's
 * sign, the plates' signs, the current or the poles, and the checker works
 * each one out again from the field itself. Letters stand only at fixed
 * spots, each clear of every line, so the question can ask where the field
 * is strongest or which way it points.
 */
import type { Pt } from "../figureCheck";
import { and } from "../figureSvg";
import type { FigureKind } from "./kind";
import { drawParts, headDirection, partProblems, type Part } from "./parts";

export const FIELDS = ["point-charge", "parallel-plates", "wire", "bar-magnet"] as const;
type Field = (typeof FIELDS)[number];
type Sign = "+" | "−";
type Pole = "N" | "S";

export type FieldBrief = {
  kind: "field-pattern";
  field: Field;
  /** point-charge: its sign. */
  charge?: Sign;
  /** parallel-plates: each plate's sign. */
  plates?: { top: Sign; bottom: Sign };
  /** wire: which way the current flows. */
  current?: "into the page" | "out of the page";
  /** bar-magnet: which pole is at each end. */
  poles?: { left: Pole; right: Pole };
  /** Whether the sign, current or poles are shown: false when the question asks for them. */
  labelled: boolean;
  /** Letters at fixed spots, for questions about where the field is strongest or which way it points. */
  points: { letter: string; spot: string }[];
};

/** The middle of the charge, wire or magnet. */
const C: Pt = [180, 160];
const HEIGHT: Record<Field, number> = {
  "point-charge": 320,
  "parallel-plates": 280,
  wire: 320,
  "bar-magnet": 320,
};
const deg = Math.PI / 180;
/** A point at a distance and an angle (anticlockwise from the right, as the page shows it) from the middle. */
const polar = (r: number, a: number): Pt => [C[0] + r * Math.cos(a), C[1] - r * Math.sin(a)];

const CHARGE = { r: 18, from: 24, head: 82, to: 140 } as const;
const WIRE = { r: 12, rings: [40, 80, 120], arrowAngles: [45, 225] } as const;
const PLATES = { left: 60, right: 300, top: 60, bottom: 220, lines: [80, 120, 160, 200, 240, 280] };
const MAGNET = { x0: 130, x1: 230, y0: 146, y1: 174, inset: 4 } as const;

/** The sides of a spot round a charge or wire, and the angle each is at. */
const SIDES = { right: 0, above: 90, left: 180, below: 270 } as const;
const DISTANCES = { near: 0, middle: 1, far: 2 } as const;
/** How far each named distance is from the middle: between the charge's lines, or between the wire's rings. */
const RADII: Record<"point-charge" | "wire", number[]> = {
  "point-charge": [48, 88, 128],
  wire: [60, 100, 140],
};

/**
 * Where each letter may stand, by name, for each field: every spot is clear
 * of every line and arrowhead that field draws (the tests hold each to it).
 */
export const SPOTS: Record<Field, Record<string, Pt>> = {
  "point-charge": radialSpots("point-charge"),
  wire: radialSpots("wire"),
  "parallel-plates": Object.fromEntries(
    (["top", "middle", "bottom"] as const).flatMap((row, i) =>
      (["left", "centre", "right"] as const).map((col, j) => [
        row === "middle" && col === "centre" ? "centre" : `${row} ${col}`,
        [100 + 80 * j, 92 + 48 * i] as Pt,
      ]),
    ),
  ),
  "bar-magnet": {},
};
/** The bar magnet's spots, found clear of its lines, and each as the alt text says it. */
const MAGNET_SPOTS: Record<string, [Pt, string]> = {
  "near above": [[180, 100], "just above the middle of the magnet"],
  "far above": [[180, 44], "far above the magnet"],
  "near below": [[180, 220], "just below the middle of the magnet"],
  "far below": [[180, 276], "far below the magnet"],
  "beside the left end": [[82, 140], "beside the magnet's left end"],
  "beside the right end": [[278, 140], "beside the magnet's right end"],
  "far left": [[26, 112], "far out to the left of the magnet"],
  "far right": [[334, 112], "far out to the right of the magnet"],
};
const MAGNET_WORDS = Object.fromEntries(Object.entries(MAGNET_SPOTS).map(([k, v]) => [k, v[1]]));
SPOTS["bar-magnet"] = Object.fromEntries(Object.entries(MAGNET_SPOTS).map(([k, v]) => [k, v[0]]));
function radialSpots(field: "point-charge" | "wire"): Record<string, Pt> {
  return Object.fromEntries(
    Object.entries(DISTANCES).flatMap(([distance, i]) =>
      Object.entries(SIDES).map(([side, a]) => [
        `${distance} ${side}`,
        polar(RADII[field][i], a * deg),
      ]),
    ),
  );
}

// ── The bar magnet's field ──────────────────────────────────────────────────

/** Where the poles sit, a little inside each end: the left one, then the right one. */
const POLES: [Pt, Pt] = [
  [MAGNET.x0 + MAGNET.inset, C[1]],
  [MAGNET.x1 - MAGNET.inset, C[1]],
];
/** The field of the magnet's two poles at a point, with N at `north`: away from N, into S, falling off as the square of distance. */
export function magnetField(p: Pt, north: Pt, south: Pt): Pt {
  const [nx, ny] = [p[0] - north[0], p[1] - north[1]];
  const [sx, sy] = [p[0] - south[0], p[1] - south[1]];
  const n3 = Math.hypot(nx, ny) ** 3;
  const s3 = Math.hypot(sx, sy) ** 3;
  return [nx / n3 - sx / s3, ny / n3 - sy / s3];
}
/** The angles the drawn lines leave the N pole at, from the line towards S, on the upper side. */
const LAUNCH = [50, 90, 118, 142];
const FRAME = { x0: 12, x1: 348, y0: 12, y1: 308 } as const;
const outside = ([x, y]: Pt) =>
  !(x > MAGNET.x0 - 1 && x < MAGNET.x1 + 1 && y > MAGNET.y0 - 1 && y < MAGNET.y1 + 1);
const inFrame = ([x, y]: Pt) => x > FRAME.x0 && x < FRAME.x1 && y > FRAME.y0 && y < FRAME.y1;

/**
 * The field lines above a magnet with N on the left, each traced from N
 * along the field (half-unit midpoint steps) until it reaches S, kept where
 * it is outside the magnet and inside the frame: a line that leaves the
 * frame comes back as a second piece. Every eighth point is kept (4 units
 * apart). Worked out once.
 */
const UPPER_LINES: Pt[][] = (() => {
  const [north, south] = POLES;
  const pieces: Pt[][] = [];
  for (const a of LAUNCH) {
    let p: Pt = [north[0] + Math.cos(a * deg), north[1] - Math.sin(a * deg)];
    let piece: Pt[] = [];
    for (let step = 0; step < 20000; step++) {
      if (Math.hypot(p[0] - south[0], p[1] - south[1]) < 1.5) break;
      const unit = (q: Pt): Pt => {
        const f = magnetField(q, north, south);
        const m = Math.hypot(f[0], f[1]);
        return [f[0] / m, f[1] / m];
      };
      const half = unit(p);
      const mid = unit([p[0] + half[0] * 0.25, p[1] + half[1] * 0.25]);
      p = [p[0] + mid[0] * 0.5, p[1] + mid[1] * 0.5];
      if (outside(p) && inFrame(p)) piece.push(p);
      else if (piece.length) {
        pieces.push(piece);
        piece = [];
      }
    }
    if (piece.length) pieces.push(piece);
  }
  return pieces.map((q) => q.filter((_, i) => i % 8 === 0 || i === q.length - 1));
})();
/** The two straight lines along the axis: out of N to the frame, and in from the frame to S. */
const AXIS_LINES: Pt[][] = [
  [
    [MAGNET.x0 - 2, C[1]],
    [FRAME.x0, C[1]],
  ],
  [
    [FRAME.x1, C[1]],
    [MAGNET.x1 + 2, C[1]],
  ],
];

/**
 * A line cut about half way along, where the first half ends in its
 * arrowhead: a straight line at its middle, a traced one at the point nearest
 * half its length, so the head lies along a whole 4-unit step.
 */
function halves(pts: Pt[]): [Pt[], Pt[]] {
  if (pts.length === 2) {
    const mid: Pt = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    return [
      [pts[0], mid],
      [mid, pts[1]],
    ];
  }
  const run = [0];
  for (let i = 1; i < pts.length; i++)
    run.push(run[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const half = run[run.length - 1] / 2;
  let cut = 1;
  for (let i = 1; i < pts.length - 1; i++)
    if (Math.abs(run[i] - half) < Math.abs(run[cut] - half)) cut = i;
  return [pts.slice(0, cut + 1), pts.slice(cut)];
}

// ── Layout ──────────────────────────────────────────────────────────────────

const isOut = (b: FieldBrief) => b.current === "out of the page";
/** A point as a part's name gives it, to the nearest unit. */
const near = (p: Pt) => `(${Math.round(p[0])}, ${Math.round(p[1])})`;

/** The whole figure as parts, every position and direction from the brief. */
export function fieldLayout(b: FieldBrief): Part[] {
  const parts: Part[] = [];
  const arrow = (what: string, pts: Pt[]): Part =>
    pts.length === 2
      ? { what, el: "line", cls: "qf-line", pts: [pts[0], pts[1]], heads: "end" }
      : { what, el: "polyline", cls: "qf-line", pts, heads: "end" };
  const plain = (what: string, pts: Pt[]): Part =>
    pts.length === 2
      ? { what, el: "line", cls: "qf-line", pts: [pts[0], pts[1]] }
      : { what, el: "polyline", cls: "qf-line", pts };
  const sign = (what: string, at: Pt, s: string): Part => ({
    what,
    el: "text",
    cls: "qf-strong",
    pts: [[at[0], at[1] + 5.5]],
    anchor: "middle",
    lines: [s],
  });
  switch (b.field) {
    case "point-charge": {
      parts.push({ what: "charge", el: "circle", cls: "qf-line", pts: [C], r: CHARGE.r });
      if (b.labelled) parts.push(sign("charge's sign", C, b.charge!));
      for (let k = 0; k < 8; k++) {
        const a = (22.5 + 45 * k) * deg;
        const [inner, head, outer] = [CHARGE.from, CHARGE.head, CHARGE.to].map((r) => polar(r, a));
        const what = `field line at ${22.5 + 45 * k}°`;
        if (b.charge === "+")
          parts.push(arrow(`${what} (pointing out)`, [inner, head]), plain(what, [head, outer]));
        else parts.push(arrow(`${what} (pointing in)`, [outer, head]), plain(what, [head, inner]));
      }
      break;
    }
    case "parallel-plates": {
      const { left, right, top, bottom } = PLATES;
      const plus = b.plates!.top === "+" ? top : bottom;
      const minus = plus === top ? bottom : top;
      parts.push(
        {
          what: "top plate",
          el: "line",
          cls: "qf-thick",
          pts: [
            [left, top],
            [right, top],
          ],
        },
        {
          what: "bottom plate",
          el: "line",
          cls: "qf-thick",
          pts: [
            [left, bottom],
            [right, bottom],
          ],
        },
      );
      if (b.labelled)
        parts.push(
          sign("top plate's sign", [left - 16, top], b.plates!.top),
          sign("bottom plate's sign", [left - 16, bottom], b.plates!.bottom),
        );
      const middle = (top + bottom) / 2;
      // From the + plate to the − plate, each starting and ending on a plate's stroke.
      const edge = (y: number) => y + (y === top ? 2 : -2);
      for (const x of PLATES.lines)
        parts.push(
          arrow(`field line at x = ${x} (pointing from + to −)`, [
            [x, edge(plus)],
            [x, middle],
          ]),
          plain(`field line at x = ${x}`, [
            [x, middle],
            [x, edge(minus)],
          ]),
        );
      break;
    }
    case "wire": {
      parts.push({ what: "wire", el: "circle", cls: "qf-line", pts: [C], r: WIRE.r });
      if (b.labelled) {
        if (isOut(b))
          parts.push({
            what: "dot for a current out of the page",
            el: "circle",
            cls: "qf-ink",
            pts: [C],
            r: 4,
          });
        else
          parts.push(
            {
              what: "cross for a current into the page",
              el: "line",
              cls: "qf-line",
              pts: [
                [C[0] - 6, C[1] - 6],
                [C[0] + 6, C[1] + 6],
              ],
            },
            {
              what: "cross for a current into the page",
              el: "line",
              cls: "qf-line",
              pts: [
                [C[0] - 6, C[1] + 6],
                [C[0] + 6, C[1] - 6],
              ],
            },
          );
      }
      // Out of the page, the field goes anticlockwise as the page shows it; into the page, clockwise.
      const turn = isOut(b) ? 1 : -1;
      for (const r of WIRE.rings) {
        parts.push({
          what: `field ring of radius ${r}`,
          el: "circle",
          cls: "qf-line",
          pts: [C],
          r,
        });
        for (const a of WIRE.arrowAngles) {
          const swing = 7 / r;
          parts.push(
            arrow(
              `arrow on the ring of radius ${r} at ${a}° (going ${turn > 0 ? "anticlockwise" : "clockwise"})`,
              [polar(r, a * deg - turn * swing), polar(r, a * deg + turn * swing)],
            ),
          );
        }
      }
      break;
    }
    case "bar-magnet": {
      const { x0, x1, y0, y1 } = MAGNET;
      parts.push({
        what: "magnet",
        el: "rect",
        cls: "qf-line",
        pts: [
          [x0, y0],
          [x1, y1],
        ],
      });
      if (b.labelled)
        parts.push(
          sign("left pole's letter", [x0 + 18, C[1]], b.poles!.left),
          sign("right pole's letter", [x1 - 18, C[1]], b.poles!.right),
        );
      // Worked out with N on the left; with N on the right, the same lines mirrored.
      const flip = b.poles!.left === "S";
      const lines = [
        ...UPPER_LINES.flatMap((l) => [l, l.map(([x, y]) => [x, 2 * C[1] - y] as Pt)]),
        ...AXIS_LINES,
      ];
      for (const line of lines) {
        const pts = line.map(([x, y]) => [flip ? 2 * C[0] - x : x, y] as Pt);
        const [first, second] = halves(pts);
        const what = `field line from ${near(pts[0])}`;
        parts.push(arrow(`${what} (pointing from N towards S)`, first), plain(what, second));
      }
      break;
    }
  }
  for (const p of b.points)
    parts.push({
      what: `letter at the ${p.spot} spot`,
      el: "text",
      cls: "qf-strong",
      pts: [[SPOTS[b.field][p.spot][0], SPOTS[b.field][p.spot][1] + 5.5]],
      anchor: "middle",
      lines: [p.letter],
    });
  return parts;
}

/**
 * Which way the field points at a point, worked out from the field itself
 * rather than the layout: out from a + charge, from the + plate to the −,
 * round a wire by the right-hand grip rule, from N round to S.
 */
function fieldAt(b: FieldBrief, p: Pt): Pt {
  const [dx, dy] = [p[0] - C[0], p[1] - C[1]];
  const r = Math.hypot(dx, dy) || 1;
  switch (b.field) {
    case "point-charge":
      return b.charge === "+" ? [dx / r, dy / r] : [-dx / r, -dy / r];
    case "parallel-plates":
      return b.plates!.top === "+" ? [0, 1] : [0, -1];
    case "wire":
      // Anticlockwise as the page shows it (y runs down): on the right, upwards.
      return isOut(b) ? [dy / r, -dx / r] : [-dy / r, dx / r];
    case "bar-magnet": {
      const [left, right] = POLES;
      const [north, south] = b.poles!.left === "N" ? [left, right] : [right, left];
      const f = magnetField(p, north, south);
      const m = Math.hypot(f[0], f[1]);
      return [f[0] / m, f[1] / m];
    }
  }
}

/** A spot as the alt text says it: "close to the charge, to its left". */
function spotWords(b: FieldBrief, spot: string): string {
  if (b.field === "parallel-plates")
    return spot === "centre" ? "midway between the plates" : `between the plates, ${spot}`;
  if (b.field === "bar-magnet") return MAGNET_WORDS[spot];
  const [distance, side] = spot.split(" ");
  const how = { near: "close to", middle: "a little further from", far: "far from" }[distance];
  const where = side === "above" || side === "below" ? `${side} it` : `to its ${side}`;
  return `${how} the ${b.field === "wire" ? "wire" : "charge"}, ${where}`;
}

const LETTER = /^[A-Z]$/;

export const fieldPattern: FigureKind<FieldBrief> = {
  kind: "field-pattern",
  name: "a field pattern",
  guide: `field: "point-charge" (the electric field round a charge, with charge "+" or "−"), "parallel-plates" (the uniform electric field between two plates, with plates {top: "+" or "−", bottom: the other sign}), "wire" (the magnetic field round a straight wire seen end-on, with current "into the page" or "out of the page") or "bar-magnet" (with poles {left: "N" or "S", right: the other pole}). The website draws every field line and points its arrows the way the physics makes them. labelled: true to show the sign, the current (a dot or a cross) or the poles; false when the question asks the student to work them out from the arrows. points: 0 to 4 {letter: one capital letter; spot: where it stands}, each spot once. Spots for "point-charge" and "wire": "near", "middle" or "far", then a side, "left", "right", "above" or "below" ("near left", "far above"). For "parallel-plates", all between the plates: "top left", "top centre", "top right", "middle left", "centre", "middle right", "bottom left", "bottom centre", "bottom right". For "bar-magnet": ${Object.keys(
    MAGNET_WORDS,
  )
    .map((s) => `"${s}" (${MAGNET_WORDS[s]})`)
    .join(
      ", ",
    )}; its field is strongest beside the ends, weaker at "near above" and "near below", and weakest at the "far" spots.`,
  read(b) {
    if (!FIELDS.includes(b.field as Field))
      return { problem: `needs field ${FIELDS.map((f) => `"${f}"`).join(", ")}` };
    const field = b.field as Field;
    if (typeof b.labelled !== "boolean") return { problem: "labelled must be true or false" };
    const sign = (v: unknown): Sign | null =>
      v === "+" ? "+" : v === "−" || v === "-" ? "−" : null;
    const read: FieldBrief = { kind: "field-pattern", field, labelled: b.labelled, points: [] };
    if (field === "point-charge") {
      const charge = sign(b.charge);
      if (!charge) return { problem: 'needs charge "+" or "−"' };
      read.charge = charge;
    } else if (field === "parallel-plates") {
      const plates = b.plates as Record<string, unknown> | null;
      const [top, bottom] = [sign(plates?.top), sign(plates?.bottom)];
      if (!top || !bottom) return { problem: 'needs plates {top, bottom}, each "+" or "−"' };
      if (top === bottom)
        return { problem: "has both plates the same sign: one plate is + and the other −" };
      read.plates = { top, bottom };
    } else if (field === "wire") {
      if (b.current !== "into the page" && b.current !== "out of the page")
        return { problem: 'needs current "into the page" or "out of the page"' };
      read.current = b.current;
    } else {
      const poles = b.poles as Record<string, unknown> | null;
      const pole = (v: unknown): v is Pole => v === "N" || v === "S";
      if (!pole(poles?.left) || !pole(poles?.right))
        return { problem: 'needs poles {left, right}, each "N" or "S"' };
      if (poles.left === poles.right)
        return {
          problem: `has two ${poles.left} poles: a bar magnet has one N pole and one S pole`,
        };
      read.poles = { left: poles.left, right: poles.right };
    }
    const points = (b.points ?? []) as { letter: unknown; spot: unknown }[];
    if (!Array.isArray(points) || points.length > 4) return { problem: "needs 0 to 4 points" };
    for (const p of points) {
      const letter = typeof p?.letter === "string" ? p.letter.trim() : "";
      if (!LETTER.test(letter)) return { problem: "needs one capital letter for each point" };
      if (typeof p.spot !== "string" || !Object.hasOwn(SPOTS[field], p.spot))
        return { problem: `has a point whose spot is not one of the ${field}'s spots` };
      read.points.push({ letter, spot: p.spot });
    }
    if (new Set(read.points.map((p) => p.letter)).size !== read.points.length)
      return { problem: "uses a letter twice" };
    if (new Set(read.points.map((p) => p.spot)).size !== read.points.length)
      return { problem: "puts two letters at the same spot" };
    return { brief: read };
  },
  draw(b) {
    const letters = b.points.length
      ? ` Letters mark points: ${and(b.points.map((p) => `${p.letter} ${spotWords(b, p.spot)}`))}.`
      : "";
    const shows = {
      "point-charge": () =>
        `A point charge drawn as a small circle${b.labelled ? ` marked ${b.charge}` : ""}, with 8 straight field lines spreading out from it in every direction, their arrows pointing ${b.charge === "+" ? "away from" : "towards"} the charge.`,
      "parallel-plates": () =>
        `Two parallel plates, one above the other${b.labelled ? `, the top one marked ${b.plates!.top} and the bottom one ${b.plates!.bottom}` : ""}, with 6 straight, evenly spaced field lines running between them, their arrows pointing ${b.plates!.top === "+" ? "down" : "up"}.`,
      wire: () =>
        `A straight wire seen end-on, drawn as a small circle${b.labelled ? ` with a ${isOut(b) ? "dot" : "cross"} in it` : ""}, with 3 circular field lines round it, their arrows going ${isOut(b) ? "anticlockwise" : "clockwise"}.`,
      "bar-magnet": () => {
        const [from, to] = b.poles!.left === "N" ? ["left", "right"] : ["right", "left"];
        return `A bar magnet${b.labelled ? ` with ${b.poles!.left} at its left end and ${b.poles!.right} at its right end` : " with its ends unlabelled"}, and field lines looping round it from one end to the other, their arrows pointing away from the ${from} end and towards the ${to} end.`;
      },
    }[b.field]();
    // The arrows are described as drawn: when the sign, current or poles are hidden, working them out is the question.
    return { svg: drawParts(HEIGHT[b.field], fieldLayout(b)), alt: shows + letters };
  },
  check(b, d, t) {
    const out: string[] = [];
    if (d.H !== HEIGHT[b.field])
      out.push(`The canvas is ${d.H} high; the ${b.field} figure is ${HEIGHT[b.field]}`);
    // Each arrowhead along the field where it stands, from the physics rather than the layout.
    for (const a of d.arrows) {
      const head = headDirection(d, a.to);
      if (!head || a.start) continue;
      const f = fieldAt(b, a.to);
      if (head[0] * f[0] + head[1] * f[1] < 0.5)
        out.push(`The arrow ending at ${t.at(a.to)} points against the field there`);
    }
    out.push(...partProblems(fieldLayout(b), d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The diagram shows the electric field between two parallel metal plates connected to a power supply. Points A, B and C are between the plates. How does the strength of the electric field compare at A, B and C?",
      options: [
        "It is strongest at A",
        "It is strongest at B",
        "It is strongest at C",
        "It is the same at A, B and C",
      ],
      brief: {
        kind: "field-pattern",
        field: "parallel-plates",
        plates: { top: "+", bottom: "−" },
        labelled: true,
        points: [
          { letter: "A", spot: "top left" },
          { letter: "B", spot: "centre" },
          { letter: "C", spot: "bottom right" },
        ],
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows the magnetic field around a long straight wire that carries a current. The wire is at right angles to the page. Is the current flowing into the page or out of the page? Explain how you know.",
      brief: {
        kind: "field-pattern",
        field: "wire",
        current: "into the page",
        labelled: false,
        points: [],
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows the magnetic field pattern around a bar magnet. At which point is the magnetic field strongest?",
      options: ["A", "B", "C"],
      brief: {
        kind: "field-pattern",
        field: "bar-magnet",
        poles: { left: "N", right: "S" },
        labelled: true,
        points: [
          { letter: "A", spot: "far above" },
          { letter: "B", spot: "beside the right end" },
          { letter: "C", spot: "far left" },
        ],
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const field = pick(FIELDS);
    const spots = Object.keys(SPOTS[field]);
    const chosen: string[] = [];
    for (let n = Math.floor(r() * 5); chosen.length < n;) {
      const s = pick(spots);
      if (!chosen.includes(s) || r() < 0.05) chosen.push(s);
    }
    const sign = () => pick(["+", "−"] as const);
    const pole = () => pick(["N", "S"] as const);
    const [top, left] = [sign(), pole()];
    return {
      kind: "field-pattern",
      field,
      charge: sign(),
      // Now and then two plates or poles alike, which read refuses.
      plates: { top, bottom: r() < 0.1 ? top : top === "+" ? "−" : "+" },
      current: pick(["into the page", "out of the page"]),
      poles: { left, right: r() < 0.1 ? left : left === "N" ? "S" : "N" },
      labelled: r() < 0.6,
      points: chosen.map((spot, i) => ({ letter: "ABCD"[i], spot })),
    };
  },
};
