/**
 * The electromagnetic spectrum as an exam paper prints it: a strip of seven
 * boxes in order from radio waves to gamma rays (or the reverse), each named,
 * or lettered when the question asks for it, with an optional arrow under
 * the strip labelled "increasing frequency" or the like. The order and the
 * arrow's direction are physics, so a brief that gets either wrong is
 * refused, and the checker holds the drawing to both.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import { and } from "../figureSvg";
import type { FigureKind } from "./kind";
import { drawParts, partProblems, type Part } from "./parts";

/** The regions from the longest wavelength (lowest frequency) to the shortest. */
export const REGIONS = [
  "radio waves",
  "microwaves",
  "infrared",
  "visible light",
  "ultraviolet",
  "X-rays",
  "gamma rays",
] as const;
type Region = (typeof REGIONS)[number];

/** Each region's name in its box, broken where it fits. */
const NAME_LINES: Record<Region, string[]> = {
  "radio waves": ["radio", "waves"],
  microwaves: ["micro-", "waves"],
  infrared: ["infra-", "red"],
  "visible light": ["visible", "light"],
  ultraviolet: ["ultra-", "violet"],
  "X-rays": ["X-", "rays"],
  "gamma rays": ["gamma", "rays"],
};
/** The ways a writer might name each region, reduced to letters only. */
const ALIASES: Record<string, Region> = {
  radiowaves: "radio waves",
  radio: "radio waves",
  microwaves: "microwaves",
  microwave: "microwaves",
  infrared: "infrared",
  ir: "infrared",
  visiblelight: "visible light",
  visible: "visible light",
  light: "visible light",
  ultraviolet: "ultraviolet",
  uv: "ultraviolet",
  xrays: "X-rays",
  xray: "X-rays",
  gammarays: "gamma rays",
  gammaray: "gamma rays",
  gamma: "gamma rays",
};
const regionOf = (v: unknown): Region | null =>
  typeof v === "string" ? (ALIASES[v.toLowerCase().replace(/[^a-z]/g, "")] ?? null) : null;

/** What the arrow may say, and whether it points towards gamma rays. */
const ARROW_LABELS: Record<string, boolean> = {
  "increasing frequency": true,
  "increasing energy": true,
  "decreasing wavelength": true,
  "increasing wavelength": false,
  "decreasing frequency": false,
  "decreasing energy": false,
};

export type SpectrumBrief = {
  kind: "em-spectrum";
  /** The seven regions, left to right: radio waves first or gamma rays first. */
  regions: Region[];
  /** Boxes whose name is replaced by a letter. */
  blanks: { region: Region; letter: string }[];
  arrow: null | { label: string; points: "left" | "right" };
};

const H = 200;
const STRIP = { left: 8, right: 352, tall: 56 } as const;
const SMALL = TEXT_SIZE["qf-small"]!;

/**
 * Each region's box width: its name's widest line and 6 units of room, the
 * strip's spare width shared evenly. The same whichever boxes are lettered,
 * so a box's width never hints at what it holds.
 */
const WIDTH: Record<Region, number> = (() => {
  const need = REGIONS.map((r) => Math.max(...NAME_LINES[r].map((l) => textWidth(l, SMALL))) + 6);
  const spare = (STRIP.right - STRIP.left - need.reduce((s, w) => s + w, 0)) / REGIONS.length;
  return Object.fromEntries(REGIONS.map((r, i) => [r, need[i] + spare])) as Record<Region, number>;
})();

/** Each box's left and right edge, in the brief's order. */
function boxes(b: SpectrumBrief) {
  let x = STRIP.left;
  return b.regions.map((r) => {
    const box = { region: r, x0: x, x1: x + WIDTH[r] };
    x += WIDTH[r];
    return box;
  });
}
/** The strip's top, its arrow's height and its label's baseline: the whole centred on the canvas. */
const heights = (b: SpectrumBrief) => {
  const top = b.arrow ? 40 : (H - STRIP.tall) / 2;
  const bottom = top + STRIP.tall;
  return { top, bottom, middle: top + STRIP.tall / 2, arrow: bottom + 28, label: bottom + 54 };
};
const towardsGamma = (b: SpectrumBrief) =>
  (b.regions[0] === "gamma rays") === (b.arrow?.points === "left");

/** The whole figure as parts, every position from the brief. */
function layout(b: SpectrumBrief): Part[] {
  const h = heights(b);
  const parts: Part[] = [
    {
      what: "strip",
      el: "rect",
      cls: "qf-line",
      pts: [
        [STRIP.left, h.top],
        [STRIP.right, h.bottom],
      ],
    },
  ];
  boxes(b).forEach(({ region, x0, x1 }, i) => {
    if (i > 0)
      parts.push({
        what: `line between box ${i} and box ${i + 1}`,
        el: "line",
        cls: "qf-line",
        pts: [
          [x0, h.top],
          [x0, h.bottom],
        ],
      });
    const blank = b.blanks.find((k) => k.region === region);
    const x = (x0 + x1) / 2;
    const lines = blank ? [blank.letter] : NAME_LINES[region];
    parts.push({
      what: blank ? `letter in box ${i + 1} (for ${region})` : `name in box ${i + 1}`,
      el: "text",
      cls: blank ? "qf-strong" : "qf-small",
      pts: [[x, blank ? h.middle + 5.5 : h.middle + 5 - 9 * (lines.length - 1)]],
      anchor: "middle",
      lines,
    });
  });
  if (b.arrow) {
    const [from, to] = b.arrow.points === "right" ? [48, 312] : [312, 48];
    parts.push(
      {
        what: `arrow labelled ${b.arrow.label} (pointing ${b.arrow.points})`,
        el: "line",
        cls: "qf-line",
        pts: [
          [from, h.arrow],
          [to, h.arrow],
        ],
        heads: "end",
      },
      {
        what: "arrow's label",
        el: "text",
        cls: "qf-text",
        pts: [[180, h.label]],
        anchor: "middle",
        lines: [b.arrow.label],
      },
    );
  }
  return parts;
}

const LETTER = /^[A-Z]$/;

export const emSpectrum: FigureKind<SpectrumBrief> = {
  kind: "em-spectrum",
  name: "the electromagnetic spectrum",
  guide: `regions: all seven, left to right, in the spectrum's order: ${REGIONS.map((r) => `"${r}"`).join(", ")}, or the reverse (gamma rays first). blanks: 0 to 4 {region: one of those names; letter: one capital letter written in its box instead of its name}, for a question that asks which waves a box holds. arrow: null, or {label: "increasing frequency", "increasing wavelength", "increasing energy", "decreasing frequency", "decreasing wavelength" or "decreasing energy"; points: "left" or "right"}, drawn under the strip and pointing the way that is true: frequency and energy increase towards gamma rays, wavelength towards radio waves.`,
  read(b) {
    const regions = Array.isArray(b.regions) ? b.regions.map(regionOf) : null;
    if (!regions || regions.length !== 7 || regions.some((r) => r === null))
      return { problem: `needs all seven regions: ${REGIONS.join(", ")}` };
    const forward = REGIONS.every((r, i) => regions[i] === r);
    const backward = REGIONS.every((r, i) => regions[6 - i] === r);
    if (!forward && !backward)
      return {
        problem: `has the regions out of order: the spectrum runs ${REGIONS.join(", ")}, or the reverse`,
      };
    const blanks = (b.blanks ?? []) as { region: unknown; letter: unknown }[];
    if (!Array.isArray(blanks) || blanks.length > 4) return { problem: "needs 0 to 4 blanks" };
    const read: SpectrumBrief = {
      kind: "em-spectrum",
      regions: regions as Region[],
      blanks: [],
      arrow: null,
    };
    for (const k of blanks) {
      const region = regionOf(k?.region);
      const letter = typeof k?.letter === "string" ? k.letter.trim() : "";
      if (!region) return { problem: "has a blank whose region is not one of the seven" };
      if (!LETTER.test(letter)) return { problem: "needs one capital letter for each blank" };
      read.blanks.push({ region, letter });
    }
    if (new Set(read.blanks.map((k) => k.region)).size !== read.blanks.length)
      return { problem: "blanks a region twice" };
    if (new Set(read.blanks.map((k) => k.letter)).size !== read.blanks.length)
      return { problem: "uses a letter twice" };
    if (b.arrow !== null && b.arrow !== undefined) {
      const a = b.arrow as { label: unknown; points: unknown };
      const label = typeof a.label === "string" ? a.label.trim().toLowerCase() : "";
      if (!Object.hasOwn(ARROW_LABELS, label))
        return {
          problem: `has an arrow label that is not one of ${Object.keys(ARROW_LABELS).join(", ")}`,
        };
      if (a.points !== "left" && a.points !== "right")
        return { problem: 'needs the arrow to point "left" or "right"' };
      read.arrow = { label, points: a.points };
      if (towardsGamma(read) !== ARROW_LABELS[label])
        return {
          problem: `has an arrow labelled ${label} pointing towards ${ARROW_LABELS[label] ? "radio waves" : "gamma rays"}: ${label.split(" ")[1]} ${label.startsWith("increasing") ? "increases" : "decreases"} towards ${ARROW_LABELS[label] ? "gamma rays" : "radio waves"}`,
        };
    }
    return { brief: read };
  },
  draw(b) {
    const names = b.regions.map((r) => b.blanks.find((k) => k.region === r)?.letter ?? r);
    return {
      svg: drawParts(H, layout(b)),
      // The boxes as written: a lettered box's region is the question.
      alt: `The electromagnetic spectrum as a row of seven boxes, left to right: ${and(names)}.${b.arrow ? ` Under the boxes, an arrow pointing ${b.arrow.points} is labelled ${b.arrow.label}.` : ""}`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    if (d.H !== H) out.push(`The canvas is ${d.H} high; the spectrum is ${H}`);
    // The arrow's direction is the physics: name it when it points the wrong way.
    const gammaRight = b.regions[6] === "gamma rays";
    for (const a of d.arrows) {
      if (!b.arrow || a.start || Math.abs(a.to[0] - a.from[0]) < 1) continue;
      const right = a.to[0] > a.from[0];
      if ((right === gammaRight) !== ARROW_LABELS[b.arrow.label])
        out.push(
          `The arrow labelled ${b.arrow.label} points towards ${right === gammaRight ? "gamma rays" : "radio waves"}`,
        );
    }
    out.push(...partProblems(layout(b), d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The diagram shows the electromagnetic spectrum. One region is labelled A. Which type of electromagnetic wave is region A?",
      options: ["infrared", "microwaves", "ultraviolet", "X-rays"],
      brief: {
        kind: "em-spectrum",
        regions: [...REGIONS],
        blanks: [{ region: "infrared", letter: "A" }],
        arrow: null,
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows the electromagnetic spectrum, with two regions labelled P and Q. Name the waves in region P and in region Q, and give one use of the waves in region Q.",
      brief: {
        kind: "em-spectrum",
        regions: [...REGIONS].reverse(),
        blanks: [
          { region: "microwaves", letter: "P" },
          { region: "ultraviolet", letter: "Q" },
        ],
        arrow: { label: "increasing wavelength", points: "right" },
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const regions: string[] = r() < 0.5 ? [...REGIONS] : [...REGIONS].reverse();
    // Now and then two regions swapped, which read refuses.
    if (r() < 0.1) [regions[2], regions[3]] = [regions[3], regions[2]];
    const blanked = REGIONS.filter(() => r() < 0.25).slice(0, 4);
    return {
      kind: "em-spectrum",
      regions,
      blanks: blanked.map((region, i) => ({ region, letter: "ABCD"[i] })),
      arrow:
        r() < 0.3
          ? null
          : { label: pick(Object.keys(ARROW_LABELS)), points: pick(["left", "right"]) },
    };
  },
};
