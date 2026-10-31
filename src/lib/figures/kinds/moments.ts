/**
 * A beam on a pivot, for moments: the beam drawn to scale across the canvas,
 * the pivot a triangle under it at its distance, and each force a vertical
 * arrow above the beam at its own distance (a downward force ends on the
 * beam, an upward one starts there), labelled above its tail or head. A force
 * may have its distance from the pivot marked under the beam: a dimension
 * line from the pivot to the force, the nearest on each side on the first
 * row, so no dimension's extension line crosses another's label.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import { label } from "../figureSvg";
import type { FigureKind } from "./kind";
import { drawParts, partProblems, type Part } from "./parts";

export type MomentsBrief = {
  kind: "moments";
  /** The beam's length, in `unit`. */
  length: number;
  unit: "m" | "cm";
  /** The pivot's distance from the beam's left end. */
  pivot: number;
  forces: {
    /** Its distance from the beam's left end. */
    at: number;
    direction: "up" | "down";
    /** What it is ("weight", "F"), or "" for its size alone. */
    name: string;
    /** In newtons, or null for the one the question asks for: its name is then written in bold. */
    size: number | null;
    /** Its distance from the pivot marked under the beam: null for none, "value" for its length, or a letter the question asks for. */
    distance: null | "value" | string;
  }[];
};
type Force = MomentsBrief["forces"][number];

const BEAM = { left: 40, right: 320, thick: 10 } as const;
/** Every force arrow's length: the arrows show where and which way, not how big. */
const ARROW = 48;
const PIVOT = { half: 12, tall: 22 } as const;
/** Gap between dimension rows: a row's label, under its line, clears the next row's line. */
const ROW = 34;
const TEXT = TEXT_SIZE["qf-text"]!;

/** A size in newtons as an exam paper writes it: 400 N, 13 800 N. */
const newtons = (v: number) => {
  const [whole, part] = label(v).split(".");
  return `${whole.length > 4 ? whole.replace(/\B(?=(\d{3})+$)/g, " ") : whole}${part ? `.${part}` : ""} N`;
};
/** A force's label, line by line: its name over its size, or its name alone (in bold) when the size is asked for. */
const forceLabel = (f: Force) =>
  f.size === null ? [f.name] : f.name ? [f.name, newtons(f.size)] : [newtons(f.size)];
const labelWidth = (lines: string[]) => Math.max(...lines.map((l) => textWidth(l, TEXT)));
/** Decimal places of a value, up to 2; more is NaN. */
const places = (v: number) =>
  [0, 1, 2].find((p) => Math.abs(v * 10 ** p - Math.round(v * 10 ** p)) < 1e-6) ?? NaN;
/** Every marked distance is written with as many decimal places as the most precise of them: 1.5 m and 2.0 m. */
const distanceText = (b: MomentsBrief, f: Force) => {
  if (f.distance !== "value") return f.distance ?? "";
  const shown = b.forces.filter((g) => g.distance === "value");
  const dp = Math.max(...shown.map((g) => places(Math.abs(g.at - b.pivot))));
  return `${Math.abs(f.at - b.pivot).toFixed(dp)} ${b.unit}`;
};

/** x of a distance along the beam from its left end. */
const xOf = (b: MomentsBrief, v: number) => BEAM.left + (v / b.length) * (BEAM.right - BEAM.left);

/** Each force with a marked distance: its row under the beam, nearest the pivot first on its own side. */
function dimensionRows(b: MomentsBrief) {
  const marked = b.forces.filter((f) => f.distance !== null);
  return marked.map((f) => ({
    f,
    row: marked.filter(
      (g) =>
        g !== f &&
        Math.sign(g.at - b.pivot) === Math.sign(f.at - b.pivot) &&
        Math.abs(g.at - b.pivot) < Math.abs(f.at - b.pivot),
    ).length,
  }));
}

/** Every height in the figure, and the canvas: the labels, arrows, beam and pivot from the top, then the dimension rows. */
function heights(b: MomentsBrief) {
  const lines = Math.max(...b.forces.map((f) => forceLabel(f).length));
  const rows = Math.max(0, ...dimensionRows(b).map((d) => d.row + 1));
  const lastBaseline = 24 + 18 * (lines - 1);
  const arrowTop = lastBaseline + 10;
  const beamTop = arrowTop + ARROW;
  const pivotBase = beamTop + BEAM.thick + PIVOT.tall;
  const bottom = rows ? pivotBase + 16 + ROW * (rows - 1) + 25 : pivotBase;
  const H = Math.max(200, Math.ceil((bottom + 10) / 20) * 20);
  // Centred top to bottom: the figure runs from the labels' tops, 11 down, to `bottom`.
  const dy = Math.max(0, Math.floor((H - bottom - 11) / 2));
  return {
    H,
    lastBaseline: lastBaseline + dy,
    arrowTop: arrowTop + dy,
    beamTop: beamTop + dy,
    beamBottom: beamTop + BEAM.thick + dy,
    pivotBase: pivotBase + dy,
    rowY: (row: number) => pivotBase + 16 + ROW * row + dy,
  };
}

const sideOf = (b: MomentsBrief, f: Force) =>
  f.at === b.pivot
    ? "above the pivot"
    : f.at < b.pivot
      ? "left of the pivot"
      : "right of the pivot";
const named = (f: Force) => forceLabel(f).join(" ");

/** The whole figure as parts, every position from the brief. */
function layout(b: MomentsBrief): { H: number; parts: Part[] } {
  const h = heights(b);
  const px = xOf(b, b.pivot);
  const from = (v: number) => `${label(v)} ${b.unit} from the beam's left end`;
  const parts: Part[] = [
    {
      what: "beam",
      el: "rect",
      cls: "qf-line",
      pts: [
        [BEAM.left, h.beamTop],
        [BEAM.right, h.beamBottom],
      ],
    },
    {
      what: `pivot (${from(b.pivot)})`,
      el: "polygon",
      cls: "qf-line",
      pts: [
        [px, h.beamBottom],
        [px + PIVOT.half, h.pivotBase],
        [px - PIVOT.half, h.pivotBase],
      ],
    },
  ];
  for (const f of b.forces) {
    const x = xOf(b, f.at);
    const lines = forceLabel(f);
    const [tail, head]: [number, number] =
      f.direction === "down" ? [h.arrowTop, h.beamTop] : [h.beamTop, h.arrowTop];
    parts.push({
      what: `${named(f)} arrow (pointing ${f.direction}, ${from(f.at)})`,
      el: "line",
      cls: "qf-line",
      pts: [
        [x, tail],
        [x, head],
      ],
      heads: "end",
    });
    parts.push({
      what: `label above the arrow ${from(f.at)}`,
      el: "text",
      cls: f.size === null ? "qf-strong" : "qf-text",
      pts: [[x, h.lastBaseline - 18 * (lines.length - 1)]],
      anchor: "middle",
      lines,
    });
  }
  const dims = dimensionRows(b);
  for (const { f, row } of dims) {
    const x = xOf(b, f.at);
    const y = h.rowY(row);
    parts.push(
      {
        what: `distance from the pivot to the ${named(f)} arrow`,
        el: "line",
        cls: "qf-line",
        pts: [
          [px, y],
          [x, y],
        ],
        heads: "both",
      },
      {
        what: `guide line down from the ${named(f)} arrow`,
        el: "line",
        cls: "qf-thin",
        pts: [
          [x, h.beamBottom + 4],
          [x, y + 6],
        ],
      },
      {
        what: `distance label for the ${named(f)} arrow`,
        el: "text",
        cls: f.distance === "value" ? "qf-text" : "qf-strong",
        pts: [[(px + x) / 2, y + 21]],
        anchor: "middle",
        lines: [distanceText(b, f)],
      },
    );
  }
  if (dims.length)
    parts.push({
      what: "guide line down from the pivot",
      el: "line",
      cls: "qf-thin",
      pts: [
        [px, h.pivotBase + 4],
        [px, h.rowY(Math.max(...dims.map((d) => d.row))) + 6],
      ],
    });
  return { H: h.H, parts };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const LETTER = /^[A-Za-z]$/;

export const moments: FigureKind<MomentsBrief> = {
  kind: "moments",
  name: "a beam balanced on a pivot",
  guide:
    'a beam on a pivot, drawn to scale. length: the beam\'s length; unit: "m" or "cm"; pivot: the pivot\'s distance from the beam\'s left end; forces: 1 to 4 {at: its distance from the beam\'s left end; direction: "up" or "down"; name: what it is, at most 12 characters ("weight", "effort"), or "" to write its size alone; size: in newtons, or null for the force the question asks for, whose name (a letter such as "W") is then written in bold; distance: null, "value" to mark its distance from the pivot under the beam (the website writes it, e.g. "1.5 m"), or one letter ("d") for a distance the question asks for}. Every distance from the left end is from 0 to length, with at most 2 decimal places. A force at the pivot has no distance. Forces sit far enough apart that their labels, written above their arrows, don\'t meet (two "400 N" labels about a fifth of the beam apart), and a marked distance is long enough to write its value under it. Arrows are all one length: they show where each force acts and which way, not its size.',
  read(b) {
    const length = b.length;
    if (!isNum(length) || length <= 0) return { problem: "needs a length above 0" };
    if (b.unit !== "m" && b.unit !== "cm") return { problem: 'needs unit "m" or "cm"' };
    const inBeam = (v: unknown): v is number =>
      isNum(v) && v >= 0 && v <= length && !Number.isNaN(places(v));
    if (!inBeam(b.pivot))
      return { problem: "needs the pivot from 0 to length, with at most 2 decimal places" };
    const forces = b.forces as Record<string, unknown>[];
    if (!Array.isArray(forces) || forces.length < 1 || forces.length > 4)
      return { problem: "needs 1 to 4 forces" };
    const read: MomentsBrief = {
      kind: "moments",
      length,
      unit: b.unit,
      pivot: b.pivot,
      forces: [],
    };
    for (const f of forces) {
      if (!inBeam(f?.at))
        return {
          problem: "has a force whose at is not from 0 to length, with at most 2 decimal places",
        };
      if (f.direction !== "up" && f.direction !== "down")
        return { problem: 'has a force whose direction is not "up" or "down"' };
      const name = typeof f.name === "string" ? f.name.trim() : null;
      if (name === null || [...name].length > 12)
        return { problem: 'needs a name of at most 12 characters, or "", for each force' };
      if (f.size !== null && (!isNum(f.size) || f.size <= 0))
        return { problem: "has a size that is not a number above 0, or null" };
      if (f.size === null && !name)
        return { problem: "needs a name (a letter) for the force whose size is asked for" };
      const distance = typeof f.distance === "string" ? f.distance.trim() : f.distance;
      if (
        distance !== null &&
        distance !== "value" &&
        !(typeof distance === "string" && LETTER.test(distance))
      )
        return { problem: 'has a distance that is not null, "value" or one letter' };
      if (distance !== null && f.at === b.pivot)
        return { problem: "marks a distance for a force at the pivot" };
      read.forces.push({
        at: f.at,
        direction: f.direction,
        name,
        size: f.size as number | null,
        distance: distance as Force["distance"],
      });
    }
    const asked = read.forces.filter((f) => f.size === null).map((f) => f.name);
    if (new Set(asked).size !== asked.length) return { problem: "names two unknown forces alike" };
    const letters = read.forces.flatMap((f) =>
      f.distance && f.distance !== "value" ? [f.distance] : [],
    );
    if (new Set(letters).size !== letters.length)
      return { problem: "gives two distances the same letter" };
    // Every label fits on the canvas and clears its neighbours'.
    const room = read.forces.map((f) => ({ x: xOf(read, f.at), w: labelWidth(forceLabel(f)) }));
    if (room.some((r) => r.w > 120 || r.x - r.w / 2 < 4 || r.x + r.w / 2 > 356))
      return { problem: "has a force label too wide for the canvas at its end of the beam" };
    for (let i = 0; i < room.length; i++)
      for (let j = i + 1; j < room.length; j++)
        if (Math.abs(room[i].x - room[j].x) < (room[i].w + room[j].w) / 2 + 6)
          return { problem: "has two forces too close together for their labels" };
    for (const f of read.forces) {
      if (f.distance === null) continue;
      const span = Math.abs(xOf(read, f.at) - xOf(read, read.pivot));
      if (span < Math.max(30, textWidth(distanceText(read, f), TEXT) + 8))
        return { problem: "marks a distance too short to write its value under it" };
    }
    return { brief: read };
  },
  draw(b) {
    const { H, parts } = layout(b);
    const where =
      b.pivot === 0
        ? " at its left end"
        : b.pivot === b.length
          ? " at its right end"
          : b.pivot * 2 === b.length
            ? " at its middle"
            : "";
    const marked = b.forces.filter((f) => f.distance !== null);
    return {
      svg: drawParts(H, parts),
      // Only what is written: a distance not marked, or a size asked for, may be the answer.
      alt: `A horizontal beam resting on a pivot${where}, with ${b.forces.length === 1 ? "one force arrow" : `${b.forces.length} force arrows`}: ${b.forces.map((f) => `${named(f)} pointing ${f.direction}, ${sideOf(b, f)}`).join("; ")}.${marked.length ? ` Distances from the pivot are marked under the beam: ${marked.map((f) => `${distanceText(b, f)} to ${named(f)}`).join("; ")}.` : ""}`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const h = heights(b);
    // Which way each force points decides the answer: name a reversed arrow as such.
    for (const f of b.forces) {
      const x = xOf(b, f.at);
      for (const a of d.arrows)
        if (a.end && !a.start && t.near(a.from[0], x, 1) && t.near(a.to[0], x, 1)) {
          const down = a.to[1] > a.from[1];
          if (down !== (f.direction === "down") && Math.abs(a.to[1] - a.from[1]) > 1)
            out.push(
              `The ${named(f)} arrow points ${down ? "down" : "up"}; the brief has it pointing ${f.direction}`,
            );
        }
    }
    if (d.H !== h.H) out.push(`The canvas is ${d.H} high; the beam's layout needs ${h.H}`);
    out.push(...partProblems(layout(b).parts, d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "A uniform plank is balanced on a pivot at its centre. A girl sits on one side and her brother sits on the other side, as shown. The plank is balanced. What is the weight W of her brother?",
      options: ["200 N", "300 N", "533 N", "600 N"],
      brief: {
        kind: "moments",
        length: 4,
        unit: "m",
        pivot: 2,
        forces: [
          { at: 0.5, direction: "down", name: "", size: 400, distance: "value" },
          { at: 4, direction: "down", name: "W", size: null, distance: "value" },
        ],
      },
    },
    {
      subject: "physics",
      question:
        "A gardener lifts the handles of a wheelbarrow with an upward force F. The wheel acts as the pivot. The diagram shows the wheelbarrow as a beam, with the weight of the load acting on it. Calculate the force F needed to hold the wheelbarrow still.",
      brief: {
        kind: "moments",
        length: 1.2,
        unit: "m",
        pivot: 0,
        forces: [
          { at: 0.4, direction: "down", name: "load", size: 600, distance: "value" },
          { at: 1.2, direction: "up", name: "F", size: null, distance: "value" },
        ],
      },
    },
    {
      subject: "physics",
      question:
        "A metre rule is balanced at its centre. A 3 N weight hangs from the rule on one side of the pivot, and a 2 N weight is moved along the other side until the rule balances. What is the distance d?",
      options: ["20 cm", "30 cm", "45 cm", "50 cm"],
      brief: {
        kind: "moments",
        length: 100,
        unit: "cm",
        pivot: 50,
        forces: [
          { at: 20, direction: "down", name: "", size: 3, distance: "value" },
          { at: 95, direction: "down", name: "", size: 2, distance: "d" },
        ],
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const [length, unit] = pick([
      [1, "m"],
      [2, "m"],
      [4, "m"],
      [6, "m"],
      [100, "cm"],
    ] as const);
    const tenth = length / 10;
    const at = (i: number) => Number((i * tenth).toFixed(2));
    const pivot = Math.floor(r() * 11);
    // Forces on tenths of the beam, mostly two tenths or more apart.
    const spots: number[] = [];
    const n = 1 + Math.floor(r() * 4);
    for (let tries = 0; spots.length < n && tries < 20; tries++) {
      const i = Math.floor(r() * 11);
      if (spots.every((j) => Math.abs(i - j) >= 2) || r() < 0.1) spots.push(i);
    }
    return {
      kind: "moments",
      length,
      unit,
      pivot: at(pivot),
      forces: spots.map((i, k) => {
        const size = k > 0 && r() < 0.3 ? null : pick([2, 5, 20, 150, 400, 1200]);
        return {
          at: at(i),
          direction: r() < 0.75 ? "down" : "up",
          name: size === null ? "W" : pick(["", "", "load", "weight", "effort"]),
          size,
          distance: i === pivot ? null : pick([null, "value", "value", k === 1 ? "d" : "value"]),
        };
      }),
    };
  },
};
