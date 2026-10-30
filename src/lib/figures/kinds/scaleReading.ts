/**
 * An instrument's scale with a reading on it, as an exam paper draws one to
 * be read: a thermometer, a measuring cylinder, a burette, a ruler with an
 * object along it, a newton-meter, a protractor, or an ammeter or voltmeter
 * dial. The brief gives the range, the numbered step, the small divisions
 * between numbers, the reading and the unit; every tick, number and level
 * follows from those. The checker holds the drawing to that layout, then
 * reads the instrument as a student would: the numbers as drawn, evenly
 * spaced, and the level, pointer, arm or object's ends read against them.
 */
import type { CheckTools, Drawing } from "../figureCheck";
import { label, svgOf } from "../figureSvg";
import type { FigureKind } from "./kind";
import { boxOf, heldToLayout, markSvg, wordSvg, type Mark, type Pt, type Word } from "./marks";

const INSTRUMENTS = [
  "thermometer",
  "measuring-cylinder",
  "burette",
  "ruler",
  "newton-meter",
  "protractor",
  "ammeter",
  "voltmeter",
] as const;
type Instrument = (typeof INSTRUMENTS)[number];
/** The units each instrument reads in: a newton-meter never reads in grams. */
const UNITS: Record<Instrument, string[]> = {
  thermometer: ["°C"],
  "measuring-cylinder": ["cm³", "ml"],
  burette: ["cm³"],
  ruler: ["cm", "mm"],
  "newton-meter": ["N"],
  protractor: ["°"],
  ammeter: ["A", "mA"],
  voltmeter: ["V", "mV"],
};
/** Small divisions between two numbered marks, as instruments are made. */
const MINORS = [1, 2, 4, 5, 10];

export type ScaleBrief = {
  kind: "scale-reading";
  instrument: Instrument;
  min: number;
  max: number;
  /** The value between two neighbouring numbered marks. */
  step: number;
  /** Small divisions from one numbered mark to the next. */
  minor: number;
  /** One reading; a ruler's two, the object's left end then its right. */
  readings: number[];
  unit: string;
};

// ── The scale ───────────────────────────────────────────────────────────────

/** Every tick's value, in order, and how long its tick is: a numbered (major) one, a half-way one, or a small one. */
function tickValues(b: ScaleBrief) {
  const n = Math.round((b.max - b.min) / b.step) * b.minor;
  return Array.from({ length: n + 1 }, (_, k) => ({
    v: Number((b.min + (k * b.step) / b.minor).toFixed(6)),
    size:
      k % b.minor === 0
        ? ("major" as const)
        : b.minor % 2 === 0 && k % (b.minor / 2) === 0
          ? ("half" as const)
          : ("minor" as const),
    major: k / b.minor,
  }));
}
/** A value's share of the way along the scale, from 0 at min to 1 at max. */
const share = (b: ScaleBrief, v: number) => (v - b.min) / (b.max - b.min);

/** A straight scale: where a value is along it, and which way its ticks run from it. */
type Line = {
  kind: "line";
  at: (v: number) => Pt;
  tick: Pt;
  lengths: { major: number; half: number; minor: number };
  /** Where a value's number is written. */
  number: (v: number) => { x: number; y: number; anchor: "start" | "middle" | "end" };
  /** Which way a number's position runs: along x or y. */
  axis: 0 | 1;
  /** The x range its numbers stay within: inside a ruler or a casing. */
  room: [number, number];
};
/** A curved scale: a value's angle about the centre, in degrees anticlockwise from the right. */
type Arc = {
  kind: "arc";
  centre: Pt;
  radius: number;
  angle: (v: number) => number;
  lengths: { major: number; half: number; minor: number };
  /** The radius numbers are centred at. */
  numbers: number;
  room: [number, number];
};
type Scale = Line | Arc;

const polar = (c: Pt, r: number, deg: number): Pt => [
  c[0] + r * Math.cos((deg * Math.PI) / 180),
  c[1] - r * Math.sin((deg * Math.PI) / 180),
];

/** Where a value is on the scale, and where its tick ends. */
function tickAt(s: Scale, v: number, size: "major" | "half" | "minor"): [Pt, Pt] {
  if (s.kind === "line") {
    const p = s.at(v);
    const len = s.lengths[size];
    return [p, [p[0] + s.tick[0] * len, p[1] + s.tick[1] * len]];
  }
  const a = s.angle(v);
  return [polar(s.centre, s.radius, a), polar(s.centre, s.radius - s.lengths[size], a)];
}
function numberAt(s: Scale, v: number): Word {
  const text = label(v);
  if (s.kind === "line") return { text, cls: "qf-small", ...s.number(v) };
  const [x, y] = polar(s.centre, s.numbers, s.angle(v));
  return { text, cls: "qf-small", x, y: y + 5, anchor: "middle" };
}

/**
 * Which numbered marks carry their number: every one, or every 2nd, 3rd…,
 * the fewest left out that keeps neighbouring numbers 2 apart (and, round an
 * arc, clear of the arc). Null when none will do.
 */
function numberedEvery(b: ScaleBrief, s: Scale): number | null {
  const majors = tickValues(b).filter((t) => t.size === "major");
  const steps = majors.length - 1;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    if (steps % k) continue;
    const boxes = majors.filter((t) => t.major % k === 0).map((t) => boxOf(numberAt(s, t.v)));
    const apart = boxes.every(
      (q, i) =>
        i === 0 ||
        !(
          q.x0 - 2 < boxes[i - 1].x1 &&
          boxes[i - 1].x0 - 2 < q.x1 &&
          q.y0 - 2 < boxes[i - 1].y1 &&
          boxes[i - 1].y0 - 2 < q.y1
        ),
    );
    const clear =
      s.kind === "line" ||
      boxes.every(
        (q) =>
          Math.hypot(
            Math.max(q.x0 - s.centre[0], 0, s.centre[0] - q.x1),
            Math.max(q.y0 - s.centre[1], 0, s.centre[1] - q.y1),
          ) >=
          s.radius + 3,
      );
    const inside = boxes.every((q) => q.x0 >= s.room[0] && q.x1 <= s.room[1]);
    if (apart && clear && inside) return k;
  }
  return null;
}

/** The scale's ticks and numbers, as marks and words. */
function scaleParts(b: ScaleBrief, s: Scale, k: number) {
  const marks: Mark[] = [];
  const words: Word[] = [];
  for (const t of tickValues(b)) {
    marks.push({
      name: `${t.size === "major" ? "numbered" : "small"} tick for ${label(t.v)}`,
      tag: "line",
      cls: "qf-line",
      pts: tickAt(s, t.v, t.size),
    });
    if (t.size === "major" && t.major % k === 0)
      words.push({ ...numberAt(s, t.v), name: `number "${label(t.v)}" at its tick` });
  }
  return { marks, words };
}

// ── The instruments ─────────────────────────────────────────────────────────

/** A fill's outline: a rectangle as a polygon. */
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** A meniscus across a tube from x0 to x1, its lowest point at y in the middle, 6 higher at the walls. */
const meniscus = (x0: number, x1: number, y: number): Pt[] =>
  Array.from({ length: 11 }, (_, k) => {
    const t = k / 5 - 1;
    return [x0 + ((x1 - x0) * k) / 10, y - 6 * t * t] as Pt;
  });

type Layout = {
  H: number;
  scale: Scale;
  /** Everything but the ticks and numbers. */
  marks: Mark[];
  words: Word[];
  /** The tube a meniscus sits in, for the check that its lowest point is in the middle. */
  tube?: [number, number];
};

/**
 * A thermometer standing upright: the bulb at the bottom, the tube above it,
 * the scale on its right from y = 340 (min) up to y = 50 (max), and the
 * liquid filling the bulb and rising up the tube to the reading.
 */
function thermometer(b: ScaleBrief): Layout {
  const y = (v: number) => 340 - share(b, v) * 290;
  const join = 368 - Math.sqrt(14 ** 2 - 8 ** 2);
  return {
    H: 400,
    scale: {
      kind: "line",
      at: (v) => [170, y(v)],
      tick: [1, 0],
      lengths: { major: 16, half: 11, minor: 7 },
      number: (v) => ({ x: 192, y: y(v) + 5, anchor: "start" }),
      axis: 1,
      room: [4, 356],
    },
    marks: [
      { name: "liquid in the bulb", tag: "circle", cls: "qf-bar", pts: [[160, 368]], r: 10 },
      {
        name: "liquid column",
        tag: "polygon",
        cls: "qf-bar",
        pts: rect(156, y(b.readings[0]), 164, 362),
      },
      {
        name: "tube",
        tag: "polyline",
        cls: "qf-line",
        pts: [
          [152, join],
          [152, 36],
          [168, 36],
          [168, join],
        ],
      },
      { name: "bulb", tag: "circle", cls: "qf-line", pts: [[160, 368]], r: 14 },
    ],
    words: [{ text: b.unit, cls: "qf-text", x: 192, y: 32, anchor: "start" }],
  };
}

/**
 * A measuring cylinder: its scale up the left wall from y = 340 (min) to
 * y = 70 (max), numbered outside it, and the liquid inside, its meniscus's
 * lowest point at the reading. A scale from 0 stands on its base; one that
 * starts higher is a part of the cylinder, open below.
 */
function cylinder(b: ScaleBrief): Layout {
  const [CL, CR] = [150, 230];
  const y = (v: number) => 340 - share(b, v) * 270;
  const bottom = b.min === 0 ? 340 : 364;
  const level = y(b.readings[0]);
  const marks: Mark[] = [
    {
      name: "liquid",
      tag: "polygon",
      cls: "qf-box",
      pts: [...meniscus(CL + 1, CR - 1, level), [CR - 1, bottom], [CL + 1, bottom]],
    },
    { name: "meniscus", tag: "polyline", cls: "qf-data", pts: meniscus(CL, CR, level) },
    {
      name: "left wall",
      tag: "line",
      cls: "qf-line",
      pts: [
        [CL, bottom],
        [CL, 46],
      ],
    },
    {
      name: "right wall",
      tag: "line",
      cls: "qf-line",
      pts: [
        [CR, bottom],
        [CR, 46],
      ],
    },
  ];
  if (b.min === 0)
    marks.push({
      name: "base",
      tag: "polygon",
      cls: "qf-line",
      pts: rect(CL - 6, 340, CR + 6, 348),
    });
  return {
    H: 400,
    scale: {
      kind: "line",
      at: (v) => [CL, y(v)],
      tick: [1, 0],
      lengths: { major: 20, half: 14, minor: 8 },
      number: (v) => ({ x: CL - 8, y: y(v) + 5, anchor: "end" }),
      axis: 1,
      room: [4, 356],
    },
    marks,
    words: [{ text: b.unit, cls: "qf-text", x: CL - 8, y: 50, anchor: "end" }],
    tube: [CL, CR],
  };
}

/**
 * Part of a burette: an open length of tube, its scale running down the
 * left wall from y = 60 (min) to y = 340 (max), and the liquid below its
 * meniscus, whose lowest point is at the reading.
 */
function burette(b: ScaleBrief): Layout {
  const [CL, CR] = [160, 200];
  const y = (v: number) => 60 + share(b, v) * 280;
  const level = y(b.readings[0]);
  return {
    H: 400,
    scale: {
      kind: "line",
      at: (v) => [CL, y(v)],
      tick: [1, 0],
      lengths: { major: 18, half: 12, minor: 7 },
      number: (v) => ({ x: CL - 8, y: y(v) + 5, anchor: "end" }),
      axis: 1,
      room: [4, 356],
    },
    marks: [
      {
        name: "liquid",
        tag: "polygon",
        cls: "qf-box",
        pts: [...meniscus(CL + 1, CR - 1, level), [CR - 1, 364], [CL + 1, 364]],
      },
      { name: "meniscus", tag: "polyline", cls: "qf-data", pts: meniscus(CL, CR, level) },
      {
        name: "left wall",
        tag: "line",
        cls: "qf-line",
        pts: [
          [CL, 36],
          [CL, 364],
        ],
      },
      {
        name: "right wall",
        tag: "line",
        cls: "qf-line",
        pts: [
          [CR, 36],
          [CR, 364],
        ],
      },
    ],
    words: [{ text: b.unit, cls: "qf-text", x: CL - 8, y: 38, anchor: "end" }],
    tube: [CL, CR],
  };
}

/**
 * A ruler lying across the canvas, its scale along its top edge from x = 36
 * (min) to x = 324 (max), and an object lying along it from one reading to
 * the other.
 */
function ruler(b: ScaleBrief): Layout {
  const x = (v: number) => 36 + share(b, v) * 288;
  const [from, to] = b.readings.map(x);
  return {
    H: 200,
    scale: {
      kind: "line",
      at: (v) => [x(v), 110],
      tick: [0, 1],
      lengths: { major: 18, half: 12, minor: 7 },
      number: (v) => ({ x: x(v), y: 143, anchor: "middle" }),
      axis: 0,
      room: [18, 342],
    },
    marks: [
      { name: "ruler", tag: "polygon", cls: "qf-box", pts: rect(16, 110, 344, 170) },
      { name: "object", tag: "polygon", cls: "qf-bar", pts: rect(from, 80, to, 108) },
    ],
    words: [{ text: b.unit, cls: "qf-small", x: 180, y: 162, anchor: "middle" }],
  };
}

/**
 * A newton-meter hanging from its ring: the casing, its scale running down
 * from y = 70 (min) to y = 330 (max) with numbers to its left, the hook
 * below, and the pointer's tip on the scale at the reading.
 */
function newtonMeter(b: ScaleBrief): Layout {
  const y = (v: number) => 70 + share(b, v) * 260;
  const at = y(b.readings[0]);
  return {
    H: 400,
    scale: {
      kind: "line",
      at: (v) => [196, y(v)],
      tick: [-1, 0],
      lengths: { major: 16, half: 11, minor: 7 },
      number: (v) => ({ x: 172, y: y(v) + 5, anchor: "end" }),
      axis: 1,
      room: [122, 238],
    },
    marks: [
      { name: "casing", tag: "polygon", cls: "qf-box", pts: rect(120, 44, 240, 356) },
      { name: "ring", tag: "circle", cls: "qf-line", pts: [[180, 26]], r: 9 },
      {
        name: "ring's stem",
        tag: "line",
        cls: "qf-line",
        pts: [
          [180, 35],
          [180, 44],
        ],
      },
      {
        name: "hook",
        tag: "polyline",
        cls: "qf-line",
        pts: [
          [180, 356],
          [180, 378],
          [176, 384],
          [169, 384],
          [165, 379],
        ],
      },
      {
        name: "scale's line",
        tag: "line",
        cls: "qf-line",
        pts: [
          [196, y(b.min)],
          [196, y(b.max)],
        ],
      },
      {
        name: "pointer",
        tag: "polygon",
        cls: "qf-ink",
        pts: [
          [198, at],
          [212, at - 6],
          [212, at + 6],
        ],
      },
    ],
    words: [{ text: b.unit, cls: "qf-text", x: 172, y: 60, anchor: "end" }],
  };
}

/**
 * A protractor, its straight edge along the bottom, numbered from 0 on the
 * right to 180 on the left outside its curved edge, with two arms from its
 * centre: one along 0 and one at the reading.
 */
function protractor(b: ScaleBrief): Layout {
  const C: Pt = [180, 196];
  const R = 140;
  const edge = Array.from({ length: 61 }, (_, k) => polar(C, R, k * 3));
  return {
    H: 220,
    scale: {
      kind: "arc",
      centre: C,
      radius: R,
      angle: (v) => v,
      lengths: { major: 14, half: 10, minor: 6 },
      numbers: 160,
      room: [4, 356],
    },
    marks: [
      { name: "protractor", tag: "polygon", cls: "qf-box", pts: edge },
      { name: "arm along 0", tag: "line", cls: "qf-data", pts: [C, polar(C, R, 0)] },
      {
        name: "arm at the reading",
        tag: "line",
        cls: "qf-data",
        pts: [C, polar(C, R, b.readings[0])],
      },
    ],
    words: [],
  };
}

/**
 * An ammeter or voltmeter: its case, the scale on an arc from 150° (min) to
 * 30° (max) about the needle's pivot, numbered outside the arc, the needle at
 * the reading, and the meter's unit under the pivot.
 */
function dial(b: ScaleBrief): Layout {
  const C: Pt = [180, 222];
  const R = 130;
  const angle = (v: number) => 150 - share(b, v) * 120;
  return {
    H: 280,
    scale: {
      kind: "arc",
      centre: C,
      radius: R,
      angle,
      lengths: { major: 14, half: 10, minor: 6 },
      numbers: 150,
      room: [30, 330],
    },
    marks: [
      { name: "case", tag: "polygon", cls: "qf-box", pts: rect(28, 40, 332, 268) },
      {
        name: "scale's arc",
        tag: "polyline",
        cls: "qf-line",
        pts: Array.from({ length: 41 }, (_, k) => polar(C, R, 150 - k * 3)),
      },
      {
        name: "needle",
        tag: "line",
        cls: "qf-data",
        pts: [C, polar(C, R - 8, angle(b.readings[0]))],
      },
      { name: "pivot", tag: "circle", cls: "qf-ink", pts: [C], r: 5 },
    ],
    words: [{ text: b.unit, cls: "qf-strong", x: 180, y: 256, anchor: "middle" }],
  };
}

const LAYOUTS: Record<Instrument, (b: ScaleBrief) => Layout> = {
  thermometer,
  "measuring-cylinder": cylinder,
  burette,
  ruler,
  "newton-meter": newtonMeter,
  protractor,
  ammeter: dial,
  voltmeter: dial,
};

/** The whole drawing's marks and words; null when its numbers can't fit. */
function partsOf(b: ScaleBrief) {
  const L = LAYOUTS[b.instrument](b);
  const k = numberedEvery(b, L.scale);
  if (k === null) return null;
  const scale = scaleParts(b, L.scale, k);
  return { ...L, k, marks: [...L.marks, ...scale.marks], words: [...L.words, ...scale.words] };
}

// ── The kind ────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Whole in hundredths: every value the scale writes has at most two decimal places. */
const hundredths = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
/** The smallest gap between neighbouring ticks: closer, a phone can't show them apart. */
const GAP = 4.8;
const article = (i: Instrument) => (i === "ammeter" ? "an" : "a");
const WORDS: Record<Instrument, string> = {
  thermometer: "thermometer",
  "measuring-cylinder": "measuring cylinder",
  burette: "burette",
  ruler: "ruler",
  "newton-meter": "newton-meter",
  protractor: "protractor",
  ammeter: "ammeter",
  voltmeter: "voltmeter",
};

/** The value with its unit, as the alt text and problems write it: "24 °C", "45°". */
const valued = (v: number, unit: string) => (unit === "°" ? `${label(v)}°` : `${label(v)} ${unit}`);

export const scaleReading: FigureKind<ScaleBrief> = {
  kind: "scale-reading",
  name: "an instrument's scale to read",
  guide:
    'instrument: "thermometer", "measuring-cylinder", "burette", "ruler", "newton-meter", "protractor", "ammeter" or "voltmeter"; unit: "°C" (thermometer), "cm³" or "ml" (measuring cylinder), "cm³" (burette), "cm" or "mm" (ruler), "N" (newton-meter), "°" (protractor), "A" or "mA" (ammeter), "V" or "mV" (voltmeter); min and max: the range the picture shows (a burette or measuring cylinder may show just the part the reading is in), max − min a whole number of steps, 2 to 12 of them; step: the value between two numbered marks; minor: the small divisions from one numbered mark to the next, 1, 2, 4, 5 or 10, each at most two decimal places; readings: the value shown, on a small division or exactly half way between two (a ruler: two, where the object\'s left and right ends lie, at least two small divisions apart). Limits: a newton-meter, ammeter or voltmeter starts at 0; a burette reads from 0 to 50 and its scale runs downwards; a measuring cylinder whose scale starts at 0 has a reading above 0; a protractor runs 0 to 180 with a step of 10, 20 or 30 and a reading above 0; a thermometer from −50 to 400 °C. At most 50 small divisions in all (a protractor: one every 2° at the finest), and numbers of at most 4 characters on a ruler or a meter. The website draws the instrument, numbers its marks and puts the level, meniscus, pointer, arm or object exactly at the readings.',
  read(b) {
    const instrument = b.instrument as Instrument;
    if (!INSTRUMENTS.includes(instrument))
      return { problem: `instrument must be one of ${INSTRUMENTS.join(", ")}` };
    const unit = typeof b.unit === "string" ? b.unit.trim() : "";
    if (!UNITS[instrument].includes(unit))
      return {
        problem: `has unit "${unit}", but ${article(instrument)} ${WORDS[instrument]} reads in ${UNITS[instrument].join(" or ")}`,
      };
    const { min, max, step, minor } = b;
    if (
      ![min, max, step].every(isNum) ||
      (max as number) <= (min as number) ||
      (step as number) <= 0
    )
      return { problem: "needs min < max and a step above 0" };
    const brief = { min, max, step } as { min: number; max: number; step: number };
    const steps = (brief.max - brief.min) / brief.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-6)
      return { problem: "must run from min to max in whole steps" };
    if (!MINORS.includes(minor as number)) return { problem: "minor must be 1, 2, 4, 5 or 10" };
    if (![brief.min, brief.step, brief.step / (minor as number)].every(hundredths))
      return { problem: "has a scale value with more than two decimal places" };
    if (instrument === "protractor") {
      if (brief.min !== 0 || brief.max !== 180 || ![10, 20, 30].includes(brief.step))
        return { problem: "a protractor runs from 0 to 180 with a step of 10, 20 or 30" };
    } else if (Math.round(steps) < 2 || Math.round(steps) > 12)
      return { problem: "must run from min to max in 2 to 12 steps" };
    if (["newton-meter", "ammeter", "voltmeter"].includes(instrument) && brief.min !== 0)
      return { problem: `${article(instrument)} ${WORDS[instrument]}'s scale starts at 0` };
    if (instrument === "burette" && (brief.min < 0 || brief.max > 50))
      return { problem: "a burette reads from 0 to 50 cm³" };
    if ((instrument === "measuring-cylinder" || instrument === "ruler") && brief.min < 0)
      return { problem: `a ${WORDS[instrument]}'s scale starts at 0 or above` };
    if (instrument === "thermometer" && (brief.min < -50 || brief.max > 400))
      return { problem: "a thermometer reads from −50 to 400 °C" };
    // The gap between neighbouring ticks, measured on the instrument's own layout.
    const division = brief.step / (minor as number);
    const { scale } = LAYOUTS[instrument]({
      kind: "scale-reading",
      instrument,
      ...brief,
      minor: minor as number,
      readings: [brief.min, brief.max],
      unit,
    });
    const [p] = tickAt(scale, brief.min, "minor");
    const [q] = tickAt(scale, brief.min + division, "minor");
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) < GAP)
      return {
        problem: "has too many small divisions to show apart: use fewer, or a smaller range",
      };

    const readings = b.readings as unknown[];
    const count = instrument === "ruler" ? 2 : 1;
    if (!Array.isArray(readings) || readings.length !== count || !readings.every(isNum))
      return {
        problem:
          instrument === "ruler"
            ? "needs two readings, the object's two ends"
            : "needs one reading",
      };
    for (const v of readings as number[]) {
      if (v < brief.min - 1e-9 || v > brief.max + 1e-9)
        return { problem: `has a reading, ${label(v)}, outside the scale` };
      const halves = ((v - brief.min) / division) * 2;
      if (Math.abs(halves - Math.round(halves)) > 1e-6)
        return {
          problem: `has a reading, ${label(v)}, that is not on a small division or half way between two`,
        };
    }
    const [first, second] = readings as number[];
    if (instrument === "ruler" && second - first < 2 * division - 1e-9)
      return { problem: "needs the object's right end at least two small divisions past its left" };
    if (instrument === "protractor" && first <= 0)
      return { problem: "needs a protractor reading above 0: at 0 its arms lie on each other" };
    if (instrument === "measuring-cylinder" && brief.min === 0 && first <= 0)
      return { problem: "needs a measuring cylinder reading above 0" };
    const read: ScaleBrief = {
      kind: "scale-reading",
      instrument,
      min: brief.min,
      max: brief.max,
      step: brief.step,
      minor: minor as number,
      readings: readings as number[],
      unit,
    };
    if (!partsOf(read))
      return { problem: "has numbers too long to fit beside its scale: use shorter numbers" };
    return { brief: read };
  },
  draw(b) {
    const P = partsOf(b)!;
    // The ticks go over a liquid or a casing, so the scale shows through.
    return {
      svg: svgOf(P.H, [
        ...P.marks.filter((m) => m.cls === "qf-box" || m.cls === "qf-bar").map(markSvg),
        ...P.marks.filter((m) => m.cls !== "qf-box" && m.cls !== "qf-bar").map(markSvg),
        ...P.words.map(wordSvg),
      ]),
      alt: altOf(b, P.k),
    };
  },
  check(b, d, t) {
    const P = partsOf(b);
    if (!P) return ["The scale's numbers don't fit"];
    const out = heldToLayout(P.marks, P.words, d, t, WORDS[b.instrument]);
    if (d.H !== P.H) out.push(`The canvas is not ${P.H} high`);
    out.push(...readingProblems(b, P, d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "A student measures the volume of a small stone. The measuring cylinder held 30 cm³ of water before the stone was lowered in; the diagram shows the water level afterwards. What is the volume of the stone?",
      options: ["14 cm³", "16 cm³", "23 cm³", "46 cm³"],
      brief: {
        kind: "scale-reading",
        instrument: "measuring-cylinder",
        min: 0,
        max: 100,
        step: 10,
        minor: 5,
        readings: [46],
        unit: "cm³",
      },
    },
    {
      subject: "chemistry",
      question:
        "In a titration, the burette reading at the start was 0.50 cm³. The diagram shows part of the burette at the end point. What volume of acid was added?",
      options: ["22.95 cm³", "23.45 cm³", "23.55 cm³", "23.95 cm³"],
      brief: {
        kind: "scale-reading",
        instrument: "burette",
        min: 21,
        max: 25,
        step: 1,
        minor: 10,
        readings: [23.45],
        unit: "cm³",
      },
    },
    {
      subject: "physics",
      question:
        "A rock hangs from a newton-meter. The diagram shows the newton-meter. What is the weight of the rock?",
      options: ["6.2 N", "6.4 N", "6.8 N", "7.2 N"],
      brief: {
        kind: "scale-reading",
        instrument: "newton-meter",
        min: 0,
        max: 10,
        step: 1,
        minor: 5,
        readings: [6.4],
        unit: "N",
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const instrument = pick(INSTRUMENTS);
    const unit = r() < 0.05 ? "kg" : pick(UNITS[instrument]);
    const minor = r() < 0.05 ? 3 : pick(MINORS);
    let [min, step, steps] = [0, 1, 10];
    if (instrument === "protractor") [min, step, steps] = [0, pick([10, 20, 30]), 0];
    else if (instrument === "thermometer")
      [min, step, steps] = [pick([-20, -10, 0, 20]), pick([5, 10, 20]), pick([4, 6, 8, 10, 12])];
    else if (instrument === "burette")
      [min, step, steps] = [pick([0, 10, 21, 30, 44]), 1, pick([2, 4, 5, 6])];
    else if (instrument === "measuring-cylinder")
      [min, step, steps] = [pick([0, 0, 40]), pick([2, 5, 10, 20]), pick([5, 8, 10])];
    else if (instrument === "ruler")
      [min, step, steps] = [pick([0, 2, 5]), pick([0.5, 1, 2]), pick([4, 6, 8, 10])];
    else [min, step, steps] = [0, pick([0.1, 0.2, 0.5, 1, 2, 5]), pick([4, 5, 6, 8, 10])];
    const max = instrument === "protractor" ? 180 : Number((min + step * steps).toFixed(6));
    const division = step / minor;
    const total = Math.round((max - min) / division);
    const at = (k: number) => Number((min + (k * division) / 2).toFixed(6));
    // Mostly on a division or half way; now and then a quarter, which is refused.
    const reading = () => at(Math.floor(r() * 2 * total) + (r() < 0.08 ? 0.5 : 0));
    const readings =
      instrument === "ruler"
        ? [at(Math.floor(r() * total)), at(total + Math.floor(r() * total))].sort((p, q) => p - q)
        : [reading()];
    return { kind: "scale-reading", instrument, min, max, step, minor, readings, unit };
  },
};

/** The alt text: the instrument and its scale as drawn, never the reading. */
function altOf(b: ScaleBrief, k: number): string {
  const numbered = `numbered every ${valued(b.step * k, b.unit)}`;
  const divisions =
    b.minor > 1 ? `, with ${b.minor} small divisions from one numbered mark to the next` : "";
  const range = `from ${valued(b.min, b.unit)} to ${valued(b.max, b.unit)}`;
  switch (b.instrument) {
    case "thermometer":
      return `A thermometer with a scale ${range}, ${numbered}${divisions}. The liquid has risen up the tube from the bulb.`;
    case "measuring-cylinder":
      return `A measuring cylinder with a scale ${range}, ${numbered}${divisions}, holding a liquid whose curved surface (meniscus) is shown.`;
    case "burette":
      return `Part of a burette, its scale running down ${range}, ${numbered}${divisions}, holding a liquid whose curved surface (meniscus) is shown.`;
    case "ruler":
      return `A ruler marked ${range}, ${numbered}${divisions}, with a bar lying along it above the scale.`;
    case "newton-meter":
      return `A newton-meter with a scale running down ${range}, ${numbered}${divisions}, and a pointer beside the scale.`;
    case "protractor":
      return `A protractor numbered from 0° on the right to 180° on the left, every ${b.step * k}°${divisions}. Two arms are drawn from its centre: one along 0° and one across the scale.`;
    default:
      return `${article(b.instrument) === "an" ? "An" : "A"} ${WORDS[b.instrument]} with a scale on an arc ${range}, ${numbered}${divisions}, and a needle.`;
  }
}

// ── Reading the drawing as a student would ──────────────────────────────────

/** A number as the checker finds it written: its value, and where on the scale it stands. */
type Found = { v: number; at: number };

/**
 * The scale's numbers as drawn: each number written in the scale's style,
 * and where it stands along the scale (a position along x or y, or an angle
 * round an arc). They must run evenly, so a reading between them is a
 * straight share of the way.
 */
function drawnNumbers(s: Scale, t: CheckTools): Found[] {
  return t
    .pieces()
    .filter((p) => p.cls === "qf-small" && /^−?\d+(\.\d+)?$/.test(p.text))
    .map((p) => {
      const v = Number(p.text.replace("−", "-"));
      if (s.kind === "line") return { v, at: s.axis === 0 ? p.x : p.y - 5 };
      const [dx, dy] = [p.x - s.centre[0], s.centre[1] - (p.y - 5)];
      return { v, at: (Math.atan2(dy, dx) * 180) / Math.PI };
    })
    .sort((a, b) => a.v - b.v);
}

/** The value a position reads, between the drawn numbers. */
const readAt = (nums: Found[], at: number) => {
  const [a, b] = [nums[0], nums[nums.length - 1]];
  return a.v + ((at - a.at) / (b.at - a.at)) * (b.v - a.v);
};

/**
 * The instrument read off the drawing: the numbers evenly spaced, then the
 * level, meniscus, pointer, arm or object's ends read against them and held
 * to the brief's readings, to within a sixth of a small division.
 */
function readingProblems(
  b: ScaleBrief,
  P: NonNullable<ReturnType<typeof partsOf>>,
  d: Drawing,
  t: CheckTools,
): string[] {
  const out: string[] = [];
  const nums = drawnNumbers(P.scale, t);
  if (nums.length < 2) return ["The scale needs at least two numbers to be read"];
  for (const n of nums.slice(1, -1))
    if (Math.abs(readAt(nums, n.at) - n.v) > (b.max - b.min) / 1000)
      out.push(`The scale's number "${label(n.v)}" is out of step with the others`);
  const tolerance = b.step / b.minor / 6;
  const held = (what: string, at: number | undefined, want: number) => {
    if (at === undefined) return out.push(`The ${what} is missing`);
    const got = readAt(nums, at);
    if (Math.abs(got - want) > tolerance)
      out.push(
        `The ${what} reads ${valued(Number(got.toFixed(3)), b.unit)} on the scale drawn; the brief's reading is ${valued(want, b.unit)}`,
      );
  };
  const segs = (cls: string) => d.segments.filter((s) => s.cls === cls).map((s) => s.seg);
  const [want] = b.readings;
  switch (b.instrument) {
    case "thermometer": {
      const ys = segs("qf-bar").flatMap(([p, q]) => [p[1], q[1]]);
      held("liquid's top", ys.length ? Math.min(...ys) : undefined, want);
      break;
    }
    case "measuring-cylinder":
    case "burette": {
      const curves = d.dataLines.filter((l) => l.cls === "qf-data");
      if (curves.length !== 1) return [...out, "There must be one meniscus (a qf-data polyline)"];
      const lowest = curves[0].pts.reduce((p, q) => (q[1] > p[1] ? q : p));
      held("bottom of the meniscus", lowest[1], want);
      const [x0, x1] = P.tube!;
      if (!t.near(lowest[0], (x0 + x1) / 2, 1))
        out.push("The meniscus's lowest point is not in the middle of the tube");
      break;
    }
    case "newton-meter": {
      const pointer = d.shapes.filter((s) => s.name === "polygon" && s.cls === "qf-ink");
      if (pointer.length !== 1) return [...out, "There must be one pointer"];
      held("pointer", pointer[0].at[1], want);
      break;
    }
    case "ruler": {
      const xs = segs("qf-bar").flatMap(([p, q]) => [p[0], q[0]]);
      held("object's left end", xs.length ? Math.min(...xs) : undefined, b.readings[0]);
      held("object's right end", xs.length ? Math.max(...xs) : undefined, b.readings[1]);
      break;
    }
    default: {
      // An arm or needle: a qf-data line from the centre, read by its angle.
      const s = P.scale as Arc;
      const arms = segs("qf-data")
        .filter(([p]) => t.near(p[0], s.centre[0]) && t.near(p[1], s.centre[1]))
        .map(([, q]) => (Math.atan2(s.centre[1] - q[1], q[0] - s.centre[0]) * 180) / Math.PI);
      if (b.instrument === "protractor") {
        if (!arms.some((a) => Math.abs(a) < 0.3))
          out.push("The protractor's arm along 0 is missing");
        const other = arms.filter((a) => Math.abs(a) >= 0.3);
        if (other.length !== 1)
          return [...out, "There must be one arm across the protractor's scale"];
        held("arm", (other[0] + 360) % 360, want);
      } else {
        if (arms.length !== 1)
          return [...out, `There must be one needle from the ${WORDS[b.instrument]}'s pivot`];
        held("needle", arms[0], want);
      }
    }
  }
  return out;
}
