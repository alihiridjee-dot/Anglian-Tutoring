/**
 * A timeline: a scale across the page, in years or in millions of years ago
 * (counting back, so the past is on the left either way), with events as
 * dots on the scale and periods as bars beneath it. Each event's name stands
 * above its dot on a short line up from it, in the lowest of three rows where
 * it meets no other name or line; each period's name is written in its bar,
 * or beside it when the bar is too short, in the lowest of three rows of
 * bars with room. The checker holds every dot and bar end to its value, and
 * reads each name back to the mark it stands by.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Box, Pt } from "../figureCheck";
import { and, every, label, line, num, svgOf, text, ticks } from "../figureSvg";
import type { FigureKind } from "./kind";
import { canvasHeight, sameSeg, type Seg } from "./linework";

export type TimelineBrief = {
  kind: "timeline";
  /** ago: the values count back from now (millions of years ago), so the largest is on the left. */
  scale: { title: string; min: number; max: number; step: number; ago: boolean };
  events: { at: number; name: string }[];
  periods: { from: number; to: number; name: string }[];
};

/** The scale's two ends. */
const L = 28;
const R = 332;
const DOT = 5;
/** An event's name: its first row's baseline above the scale, and the step up to the next row. */
const ABOVE = 26;
const LANE = 24;
/** A period's bar: its first row's top below the scale, its height, and the step down. */
const BELOW = 34;
const BAR = 24;
const BAR_STEP = 32;
const ROWS = 3;
/** Extra room past a name written beside its bar, before another bar in its row. */
const CLEAR = 16;
const TEXT = TEXT_SIZE["qf-text"]!;
const SMALL = TEXT_SIZE["qf-small"]!;
const DESCENDS = /[gjpqy,;()₂₃₄]/;

const xOf = (v: number, s: TimelineBrief["scale"]) => {
  const k = (v - s.min) / (s.max - s.min);
  return s.ago ? R - k * (R - L) : L + k * (R - L);
};
/** A name's box, written with this anchor at x and baseline y. */
const boxOf = (name: string, x: number, y: number, anchor: "start" | "middle" | "end"): Box => {
  const w = textWidth(name, TEXT);
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return { x0, y0: y - 0.8 * TEXT, x1: x0 + w, y1: y + (DESCENDS.test(name) ? 4 : 0.8) };
};
const apart = (a: Box, b: Box, gap: number) => a.x1 + gap <= b.x0 || b.x1 + gap <= a.x0;

type EventAt = { name: string; x: number; lane: number; nameX: number };
type PeriodAt = {
  name: string;
  x0: number;
  x1: number;
  lane: number;
  nameAt: [number, "start" | "middle" | "end"];
  /** How far across its row the bar and its name reach. */
  span: { x0: number; x1: number };
};

/**
 * Each event's row and where its name goes, and each period's; or why they
 * can't all be placed. Events are placed left to right, each in the lowest
 * row whose names it clears, whose names its line up clears, and whose lines
 * up from higher rows its name clears.
 */
function place(b: TimelineBrief): { events: EventAt[]; periods: PeriodAt[] } | string {
  const events: EventAt[] = [];
  const order = b.events.map((e, i) => ({ e, i, x: xOf(e.at, b.scale) })).sort((p, q) => p.x - q.x);
  for (const [k, { e, x }] of order.entries()) {
    if (k > 0 && x - order[k - 1].x < 12) return "has two events too close together to tell apart";
    const w = textWidth(e.name, TEXT);
    const nameX = Math.min(Math.max(x, 4 + w / 2), 356 - w / 2);
    const lane = [...Array(ROWS).keys()].find((j) => {
      const box = boxOf(e.name, nameX, -LANE * j, "middle");
      return events.every((o) => {
        const other = boxOf(o.name, o.nameX, -LANE * o.lane, "middle");
        if (o.lane === j) return apart(box, other, 8);
        if (o.lane < j) return x < other.x0 - 4 || x > other.x1 + 4;
        return o.x < box.x0 - 4 || o.x > box.x1 + 4;
      });
    });
    if (lane === undefined)
      return "has events too close together to name: at most three rows of names";
    events.push({ name: e.name, x, lane, nameX });
  }
  const periods: PeriodAt[] = [];
  for (const p of b.periods) {
    const [x0, x1] = [xOf(p.from, b.scale), xOf(p.to, b.scale)].sort((u, v) => u - v);
    const w = textWidth(p.name, TEXT);
    const options: PeriodAt["nameAt"][] = [
      ...(w <= x1 - x0 - 12 ? [[(x0 + x1) / 2, "middle"] as PeriodAt["nameAt"]] : []),
      ...(x1 + 6 + w <= 356 ? [[x1 + 6, "start"] as PeriodAt["nameAt"]] : []),
      ...(x0 - 6 - w >= 4 ? [[x0 - 6, "end"] as PeriodAt["nameAt"]] : []),
    ];
    // A name beside its bar keeps well clear of any other bar, so it reads as its own bar's.
    const extent = ([nx, anchor]: PeriodAt["nameAt"]) => ({
      x0: Math.min(x0, anchor === "end" ? nx - w - CLEAR : x0),
      x1: Math.max(x1, anchor === "start" ? nx + w + CLEAR : x1),
    });
    let placed: PeriodAt | null = null;
    for (let lane = 0; lane < ROWS && !placed; lane++)
      for (const o of options) {
        const e = extent(o);
        if (
          periods.every((q) => q.lane !== lane || e.x1 + 8 <= q.span.x0 || q.span.x1 + 8 <= e.x0)
        ) {
          placed = { name: p.name, x0, x1, lane, nameAt: o, span: e };
          break;
        }
      }
    if (!placed) return "has periods that don't fit in three rows of bars";
    periods.push(placed);
  }
  return { events, periods };
}

/** The scale's height, and everything's height from it. */
function layout(b: TimelineBrief) {
  const p = place(b) as Exclude<ReturnType<typeof place>, string>;
  const eventRows = p.events.length ? Math.max(...p.events.map((e) => e.lane)) + 1 : 0;
  const periodRows = p.periods.length ? Math.max(...p.periods.map((q) => q.lane)) + 1 : 0;
  const axis = eventRows ? 44 + LANE * (eventRows - 1) : 22;
  const title = axis + 46 + BAR_STEP * periodRows;
  const vs = ticks({ ...b.scale });
  const widest = Math.max(...vs.map((v) => textWidth(label(v), SMALL)));
  const k = every((R - L) / (vs.length - 1), widest + 6);
  return {
    ...p,
    axis,
    title,
    H: canvasHeight(title + 8),
    ticks: vs.map((v, i) => ({ v, x: xOf(v, b.scale), numbered: i % k === 0 })),
    baseline: (lane: number) => axis - ABOVE - LANE * lane,
    barTop: (lane: number) => axis + BELOW + BAR_STEP * lane,
  };
}
type Layout = ReturnType<typeof layout>;

/** An event's line up from its dot to just under its name. */
const stalk = (e: EventAt, l: Layout): Seg => [
  [e.x, l.axis - DOT - 2],
  [e.x, l.baseline(e.lane) + 6],
];
/** Where a period's name is written: its x, baseline and anchor. */
const periodName = (p: PeriodAt, l: Layout): [number, number, "start" | "middle" | "end"] => [
  p.nameAt[0],
  l.barTop(p.lane) + BAR / 2 + 5.5,
  p.nameAt[1],
];

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isName = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && [...v.trim()].length <= 28;

export const timeline: FigureKind<TimelineBrief> = {
  kind: "timeline",
  name: "a timeline",
  guide:
    'scale: {title: what the numbers are, "year" or "millions of years ago"; min, max, step: 2 to 12 whole steps; ago: true when the values count back from now, so the largest is drawn on the left}; events: 0 to 6 {at: a value on the scale, name: at most 28 characters}, at least a 25th of the scale (max − min) apart; periods: 0 to 4 {from, to: values on the scale, name: at most 28 characters}, each at least a 38th of the scale long; at least two events and periods in all; names all different. The website draws each event as a dot on the scale with its name above, and each period as a bar beneath with its name in or beside it; names that would meet move up or down a row, up to three rows, so keep them short and spread out. Write a value in a name ("germ theory (1861)") only when the question doesn\'t ask the student to read it off.',
  read(b) {
    const s = b.scale as Record<string, unknown> | null;
    if (!s || !isName(s.title)) return { problem: "scale needs a title of at most 28 characters" };
    const { min, max, step, ago } = s;
    if (!isNum(min) || !isNum(max) || !isNum(step) || max <= min || step <= 0)
      return { problem: "scale needs min < max and a positive step" };
    const steps = (max - min) / step;
    if (
      Math.abs(steps - Math.round(steps)) > 1e-6 ||
      Math.round(steps) < 2 ||
      Math.round(steps) > 12
    )
      return { problem: "scale must run from min to max in 2 to 12 whole steps" };
    if (typeof ago !== "boolean") return { problem: "scale's ago must be true or false" };
    const scale = { title: s.title.trim(), min, max, step, ago };
    const vs = ticks(scale);
    if (Math.max(...vs.map((v) => textWidth(label(v), SMALL))) > 48)
      return { problem: "scale numbers are too long to fit" };
    const within = (v: unknown) => isNum(v) && v >= min - 1e-9 && v <= max + 1e-9;
    const events = (b.events ?? []) as { at: unknown; name: unknown }[];
    const periods = (b.periods ?? []) as { from: unknown; to: unknown; name: unknown }[];
    if (!Array.isArray(events) || events.length > 6) return { problem: "needs 0 to 6 events" };
    if (!Array.isArray(periods) || periods.length > 4) return { problem: "needs 0 to 4 periods" };
    if (events.length + periods.length < 2)
      return { problem: "needs at least two events and periods" };
    const read: TimelineBrief = { kind: "timeline", scale, events: [], periods: [] };
    for (const e of events) {
      if (!isName(e?.name))
        return { problem: "has an event without a name of at most 28 characters" };
      if (!within(e.at)) return { problem: "has an event that is not a value on the scale" };
      read.events.push({ at: e.at as number, name: e.name.trim() });
    }
    for (const p of periods) {
      if (!isName(p?.name))
        return { problem: "has a period without a name of at most 28 characters" };
      if (!within(p.from) || !within(p.to))
        return { problem: "has a period that doesn't start and end on the scale" };
      // Shorter, a bar is a sliver its ends can't be read from.
      if (Math.abs(xOf(p.from as number, scale) - xOf(p.to as number, scale)) < 8)
        return { problem: "has a period too short to draw as a bar" };
      read.periods.push({ from: p.from as number, to: p.to as number, name: p.name.trim() });
    }
    const names = [...read.events, ...read.periods].map((m) => m.name);
    if (new Set(names).size !== names.length) return { problem: "names two marks the same" };
    const placed = place(read);
    if (typeof placed === "string") return { problem: placed };
    return { brief: read };
  },
  draw(b) {
    const l = layout(b);
    const body = [line("qf-line", L, l.axis, R, l.axis)];
    for (const tk of l.ticks) {
      body.push(line("qf-line", tk.x, l.axis, tk.x, l.axis + 6));
      if (tk.numbered) body.push(text("qf-small", tk.x, l.axis + 22, "middle", [label(tk.v)]));
    }
    for (const e of l.events) {
      const [a, c] = stalk(e, l);
      body.push(`<circle class="qf-dot" cx="${num(e.x)}" cy="${num(l.axis)}" r="${DOT}"/>`);
      body.push(line("qf-line", a[0], a[1], c[0], c[1]));
      body.push(text("qf-text", e.nameX, l.baseline(e.lane), "middle", [e.name]));
    }
    for (const p of l.periods) {
      body.push(
        `<rect class="qf-box" x="${num(p.x0)}" y="${num(l.barTop(p.lane))}" width="${num(p.x1 - p.x0)}" height="${BAR}" rx="4"/>`,
      );
      const [x, y, anchor] = periodName(p, l);
      body.push(text("qf-text", x, y, anchor, [p.name]));
    }
    body.push(text("qf-text", 180, l.title, "middle", [b.scale.title]));
    const marks = [
      ...(b.events.length ? [`events marked ${and(b.events.map((e) => e.name))}`] : []),
      ...(b.periods.length ? [`periods drawn as bars: ${and(b.periods.map((p) => p.name))}`] : []),
    ];
    return {
      svg: svgOf(l.H, body),
      // Not the values: reading them off the scale is the question.
      alt: `A timeline with a scale of ${b.scale.title} from ${label(b.scale.ago ? b.scale.max : b.scale.min)} on the left to ${label(b.scale.ago ? b.scale.min : b.scale.max)} on the right, with ${and(marks)}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const l = layout(b);
    const lines = d.segments.filter((s) => s.cls === "qf-line").map((s) => s.seg);
    const take = (want: Seg) => {
      const i = lines.findIndex((s) => sameSeg(s, want));
      if (i >= 0) lines.splice(i, 1);
      return i >= 0;
    };
    if (
      !take([
        [L, l.axis],
        [R, l.axis],
      ])
    )
      out.push(`The scale's line is not drawn from (${L}, ${l.axis}) to (${R}, ${l.axis})`);
    for (const tk of l.ticks) {
      if (
        !take([
          [tk.x, l.axis],
          [tk.x, l.axis + 6],
        ])
      )
        out.push(`The scale has no tick at ${label(tk.v)} (x = ${t.fmt(tk.x)})`);
      if (tk.numbered && !t.writtenAt(label(tk.v), tk.x, l.axis + 22, "middle", "qf-small"))
        out.push(`The scale's number ${label(tk.v)} is not under its tick`);
    }
    if (!t.writtenAt(b.scale.title, 180, l.title, "middle", "qf-text"))
      out.push(`The scale is not titled "${b.scale.title}" beneath it`);

    // Each event: its dot at its value, its line up, and its own name at the top of that line.
    const pieces = t.pieces();
    const dots = d.shapes.filter((s) => s.name === "circle" && s.cls === "qf-dot");
    for (const e of l.events) {
      const v = b.events.find((x) => x.name === e.name)!.at;
      if (!dots.some((s) => t.near(s.at[0], e.x) && t.near(s.at[1], l.axis) && t.near(s.r, DOT)))
        out.push(`The dot for "${e.name}" is not on the scale at ${label(v)} (x = ${t.fmt(e.x)})`);
      const [a, c] = stalk(e, l);
      if (!take([a, c])) out.push(`The line up from the dot for "${e.name}" is missing`);
      const atTop = pieces.filter(
        (p) => p.box.x0 - 1 <= e.x && e.x <= p.box.x1 + 1 && Math.abs(p.box.y1 - c[1]) <= 8,
      );
      if (atTop.length !== 1 || atTop[0].text !== e.name)
        out.push(
          `The name at the top of the line up from ${label(v)} is ${atTop.length ? `"${atTop.map((p) => p.text).join('", "')}"` : "missing"}; the brief names it "${e.name}"`,
        );
      else if (!t.writtenAt(e.name, e.nameX, l.baseline(e.lane), "middle", "qf-text"))
        out.push(`The name "${e.name}" is not centred over its line`);
    }
    if (dots.length !== b.events.length)
      out.push(`The timeline has ${dots.length} dots; the brief has ${b.events.length} events`);

    // Each period: its bar from its start to its end, and its own name in it or beside it.
    const bars = d.segments.filter((s) => s.cls === "qf-box").map((s) => s.seg);
    for (const p of l.periods) {
      const q = b.periods.find((x) => x.name === p.name)!;
      const [y0, y1] = [l.barTop(p.lane), l.barTop(p.lane) + BAR];
      const edges: Seg[] = [
        [
          [p.x0, y0],
          [p.x1, y0],
        ],
        [
          [p.x1, y0],
          [p.x1, y1],
        ],
        [
          [p.x1, y1],
          [p.x0, y1],
        ],
        [
          [p.x0, y1],
          [p.x0, y0],
        ],
      ];
      if (!edges.every((e) => bars.some((s) => sameSeg(s, e))))
        out.push(
          `The bar for "${p.name}" does not run from ${label(q.from)} to ${label(q.to)} (x = ${t.fmt(p.x0)} to ${t.fmt(p.x1)})`,
        );
      const [x, y, anchor] = periodName(p, l);
      const named = pieces.find((n) => n.text === p.name);
      const inside = (n: Box) => n.x0 >= p.x0 && n.x1 <= p.x1 && n.y0 >= y0 && n.y1 <= y1;
      const beside = (n: Box) =>
        n.y0 >= y0 - 2 &&
        n.y1 <= y1 + 2 &&
        (Math.abs(n.x0 - p.x1 - 6) <= 1 || Math.abs(p.x0 - n.x1 - 6) <= 1);
      if (
        !named ||
        !(inside(named.box) || beside(named.box)) ||
        !t.writtenAt(p.name, x, y, anchor, "qf-text")
      )
        out.push(`The name "${p.name}" is not written in or beside its own bar`);
    }

    // Nothing else.
    for (const s of lines)
      out.push(`The line from ${t.at(s[0])} to ${t.at(s[1])} is not part of the timeline`);
    for (const s of d.shapes) {
      const ok =
        (s.name === "line" && s.cls === "qf-line" && !s.marked) ||
        (s.name === "circle" && s.cls === "qf-dot") ||
        (s.name === "rect" &&
          s.cls === "qf-box" &&
          l.periods.some((p) => t.near(s.at[0], p.x0) && t.near(s.at[1], l.barTop(p.lane))));
      if (!ok) out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the timeline`);
    }
    const words: { text: string; at: Pt }[] = [
      { text: b.scale.title, at: [180, l.title] },
      ...l.ticks
        .filter((k) => k.numbered)
        .map((k) => ({ text: label(k.v), at: [k.x, l.axis + 22] as Pt })),
      ...l.events.map((e) => ({ text: e.name, at: [e.nameX, l.baseline(e.lane)] as Pt })),
      ...l.periods.map((p) => ({ text: p.name, at: periodName(p, l).slice(0, 2) as Pt })),
    ];
    for (const p of pieces)
      if (
        !words.some((w) => w.text === p.text && t.near(p.x, w.at[0], 1) && t.near(p.y, w.at[1], 1))
      )
        out.push(`Text "${p.text}" is not an event's or period's name or part of the scale`);
    return out;
  },
  samples: [
    {
      subject: "biology",
      question:
        "The timeline shows three eras of the Earth's history and some events in the evolution of life. For about how many million years did the Mesozoic era last?",
      options: ["about 70", "about 190", "about 250", "about 320"],
      brief: {
        kind: "timeline",
        scale: { title: "millions of years ago", min: 0, max: 600, step: 100, ago: true },
        events: [
          { at: 470, name: "first land plants" },
          { at: 200, name: "first mammals" },
          { at: 66, name: "dinosaurs die out" },
        ],
        periods: [
          { from: 541, to: 252, name: "Palaeozoic" },
          { from: 252, to: 66, name: "Mesozoic" },
          { from: 66, to: 0, name: "Cenozoic" },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The timeline shows when three species of human ancestor lived, and when three famous fossils were formed. Which species existed for the longest time?",
      options: [
        "Homo habilis",
        "Homo erectus",
        "Homo sapiens",
        "They all existed for the same time",
      ],
      brief: {
        kind: "timeline",
        scale: { title: "millions of years ago", min: 0, max: 5, step: 0.5, ago: true },
        events: [
          { at: 4.4, name: "Ardi" },
          { at: 3.2, name: "Lucy" },
          { at: 1.6, name: "Turkana Boy" },
        ],
        periods: [
          { from: 2.4, to: 1.4, name: "Homo habilis" },
          { from: 1.9, to: 0.1, name: "Homo erectus" },
          { from: 0.3, to: 0, name: "Homo sapiens" },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The timeline shows some discoveries about infectious disease. How many years after the first vaccine was penicillin discovered?",
      options: ["67", "132", "167", "232"],
      brief: {
        kind: "timeline",
        scale: { title: "year", min: 1750, max: 2000, step: 50, ago: false },
        events: [
          { at: 1796, name: "first vaccine (1796)" },
          { at: 1861, name: "germ theory (1861)" },
          { at: 1928, name: "penicillin (1928)" },
        ],
        periods: [],
      },
    },
  ],
  random(r) {
    const ago = r() < 0.5;
    const [min, max, step] = ago
      ? [
          [0, 600, 100],
          [0, 5, 1],
          [0, 4000, 500],
        ][Math.floor(r() * 3)]
      : [
          [1750, 2000, 50],
          [1800, 1950, 25],
          [1900, 2020, 20],
        ][Math.floor(r() * 3)];
    const names = [
      "first cells",
      "first fish",
      "first plants",
      "first insects",
      "first mammals",
      "first birds",
      "vaccine",
      "germ theory",
      "penicillin",
      "DNA",
      "cloning",
    ];
    const value = () => Number((min + r() * (max - min)).toFixed(1));
    const events = Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({
      at: value(),
      name: names[(i * 3 + Math.floor(r() * 3)) % names.length],
    }));
    const eras = ["era A", "era B", "Mesozoic", "Cenozoic"];
    const periods = Array.from({ length: Math.floor(r() * 3) }, (_, i) => {
      const [a, c] = [value(), value()];
      return { from: a, to: c, name: eras[i] };
    });
    return {
      kind: "timeline",
      scale: { title: ago ? "millions of years ago" : "year", min, max, step, ago },
      events,
      periods,
    };
  },
};
