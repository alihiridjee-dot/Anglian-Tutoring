/**
 * An agar plate: a 90 mm Petri dish seen from above, with 2 to 5 paper discs
 * (6 mm across) at fixed places on a ring round its middle, each labelled
 * outside the dish in line with it, and round each disc its clear zone drawn
 * to scale, with a 10 mm scale bar so the diameters can be measured. The
 * checker holds each zone's middle to its disc and its diameter to the
 * brief, and reads each label back to the disc nearest it.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Box, Pt } from "../figureCheck";
import { and, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";
import { sameSeg, toBox, type Seg } from "./linework";

export type AgarBrief = {
  kind: "agar-plate";
  /** Clockwise from the top (from the top left with four); zone: the clear zone's diameter in mm, 0 for none. */
  discs: { label: string; zone: number }[];
};

/** Units per millimetre: the 90 mm dish is drawn 216 units across. */
const MM = 2.4;
const DISH = 45 * MM;
const DISC = 3 * MM;
/** How far each disc's middle is from the dish's, in mm, and the gap a zone keeps from another or the rim. */
const RING = 22;
const CLEAR = 2;
const SMALLEST = 8;
const CX = 180;
const CY = 136;
const H = 300;
/** A label's anchor, out from the rim along its disc's direction. */
const OUT = 12;
/** The scale bar: 10 mm long, in the bottom right corner, with its words under it. */
const BAR = { x: 310, y: 270, mm: 10, words: "10 mm" } as const;
const TEXT = TEXT_SIZE["qf-text"]!;
const DESCENDS = /[gjpqy,;()₂₃₄]/;

/** Each disc's direction, in degrees clockwise from 12 o'clock. */
const ANGLES: Record<number, number[]> = {
  2: [0, 180],
  3: [0, 120, 240],
  4: [315, 45, 135, 225],
  5: [0, 72, 144, 216, 288],
};
const unit = (deg: number): Pt => [
  Math.sin((deg * Math.PI) / 180),
  -Math.cos((deg * Math.PI) / 180),
];
const discAt = (i: number, n: number): Pt => {
  const [ux, uy] = unit(ANGLES[n][i]);
  return [CX + ux * RING * MM, CY + uy * RING * MM];
};

/** Where a disc's label is written: x, baseline and anchor, and the box its letters fill. */
function labelAt(
  name: string,
  i: number,
  n: number,
): { at: [number, number, "start" | "middle" | "end"]; box: Box } {
  const [ux, uy] = unit(ANGLES[n][i]);
  const [px, py] = [CX + ux * (DISH + OUT), CY + uy * (DISH + OUT)];
  const w = textWidth(name, TEXT);
  const below = DESCENDS.test(name) ? 4 : 0.8;
  const anchor = Math.abs(ux) < 0.3 ? "middle" : ux > 0 ? "start" : "end";
  // Above the dish the label sits on its point; below, it hangs from it; at the sides, it is centred on it.
  const y = anchor === "middle" ? (uy < 0 ? py : py + 0.8 * TEXT) : py + 5.5;
  const x0 = anchor === "middle" ? px - w / 2 : anchor === "end" ? px - w : px;
  return { at: [px, y, anchor], box: { x0, y0: y - 0.8 * TEXT, x1: x0 + w, y1: y + below } };
}

const barLines: Seg[] = [
  [
    [BAR.x, BAR.y],
    [BAR.x + BAR.mm * MM, BAR.y],
  ],
  [
    [BAR.x, BAR.y - 6],
    [BAR.x, BAR.y + 6],
  ],
  [
    [BAR.x + BAR.mm * MM, BAR.y - 6],
    [BAR.x + BAR.mm * MM, BAR.y + 6],
  ],
];
const barWords: Pt = [BAR.x + (BAR.mm * MM) / 2, BAR.y + 22];

const circle = (cls: string, [cx, cy]: Pt, r: number) =>
  `<circle class="${cls}" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"/>`;

export const agarPlate: FigureKind<AgarBrief> = {
  kind: "agar-plate",
  name: "an agar plate with discs",
  guide:
    'discs: 2 to 5 {label: a capital letter, or a short name such as "water" that fits beside the dish (about 7 characters at the sides, more at the top and bottom); zone: the diameter of the clear zone round it in mm, including the 6 mm disc, from 8 to 40, or 0 for no clear zone}, placed clockwise from the top (from the top left with four). Zones must not touch: two neighbouring zones add up to at most 72 mm with 3 discs, 58 with 4 and 47 with 5. The website draws a 90 mm dish with a 10 mm scale bar, each disc 6 mm across.',
  read(b) {
    const discs = b.discs as { label: unknown; zone: unknown }[];
    if (!Array.isArray(discs) || discs.length < 2 || discs.length > 5)
      return { problem: "needs 2 to 5 discs" };
    const n = discs.length;
    const read: AgarBrief = { kind: "agar-plate", discs: [] };
    for (const [i, d] of discs.entries()) {
      const label = typeof d?.label === "string" ? d.label.trim() : "";
      if (!label || [...label].length > 12) return { problem: "needs a short label for each disc" };
      const zone = d.zone;
      if (
        typeof zone !== "number" ||
        !Number.isFinite(zone) ||
        (zone !== 0 && (zone < SMALLEST || zone > 40))
      )
        return { problem: "has a zone that is not 0 or from 8 to 40 mm" };
      if (RING + zone / 2 > 45 - CLEAR)
        return { problem: "has a zone that reaches the edge of the dish" };
      // Clear of the rim, of the canvas's edge and of the scale bar in the corner.
      const { box } = labelAt(label, i, n);
      const clearOfBar = box.x1 < BAR.x - 24 || box.y1 < BAR.y - 10;
      if (toBox([CX, CY], box) < DISH + 3 || box.x0 < 3 || box.x1 > 357 || !clearOfBar)
        return { problem: `has a label "${label}" too long to fit beside the dish` };
      read.discs.push({ label, zone });
    }
    const labels = read.discs.map((d) => d.label);
    if (new Set(labels).size !== labels.length) return { problem: "labels two discs the same" };
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const [p, q] = [discAt(i, n), discAt(j, n)];
        const gap = Math.hypot(p[0] - q[0], p[1] - q[1]) / MM;
        const [zi, zj] = [read.discs[i].zone || 6, read.discs[j].zone || 6];
        if ((zi + zj) / 2 + CLEAR > gap)
          return { problem: `has the zones round ${labels[i]} and ${labels[j]} touching` };
      }
    return { brief: read };
  },
  draw(b) {
    const n = b.discs.length;
    const body = [circle("qf-line", [CX, CY], DISH)];
    b.discs.forEach((d, i) => {
      if (d.zone) body.push(circle("qf-line", discAt(i, n), (d.zone / 2) * MM));
      body.push(circle("qf-ink", discAt(i, n), DISC));
      const { at } = labelAt(d.label, i, n);
      body.push(text("qf-text", at[0], at[1], at[2], [d.label]));
    });
    for (const [a, c] of barLines) body.push(line("qf-line", a[0], a[1], c[0], c[1]));
    body.push(text("qf-text", barWords[0], barWords[1], "middle", [BAR.words]));
    const none = b.discs.filter((d) => !d.zone).length;
    return {
      svg: svgOf(H, body),
      // Not the zones' sizes, nor which is biggest: that is the question.
      alt: `An agar plate seen from above: a Petri dish with ${n} paper discs, labelled ${and(b.discs.map((d) => d.label))} clockwise from the ${n === 4 ? "top left" : "top"}, each with the clear zone round it${none ? ", if any," : ""} drawn to scale. A scale bar shows ${BAR.words}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const n = b.discs.length;
    const circles = d.shapes.filter((s) => s.name === "circle");
    const at = (s: (typeof circles)[number], p: Pt) =>
      t.near(s.at[0], p[0]) && t.near(s.at[1], p[1]);
    if (!circles.some((s) => s.cls === "qf-line" && at(s, [CX, CY]) && t.near(s.r, DISH)))
      out.push(`The dish is not drawn round (${CX}, ${CY}) with radius ${DISH}`);

    // Each zone read back by the disc at its middle: its diameter, in mm.
    const zones = circles.filter(
      (s) => s.cls === "qf-line" && !(at(s, [CX, CY]) && t.near(s.r, DISH)),
    );
    b.discs.forEach((disc, i) => {
      const p = discAt(i, n);
      if (!circles.some((s) => s.cls === "qf-ink" && at(s, p) && t.near(s.r, DISC)))
        out.push(`Disc ${disc.label} is not drawn at ${t.at(p)}`);
      const own = zones.filter((s) => at(s, p));
      if (!disc.zone) {
        if (own.length)
          out.push(`Disc ${disc.label} has a clear zone drawn round it; the brief has none`);
      } else if (own.length !== 1)
        out.push(
          own.length
            ? `Disc ${disc.label} has ${own.length} clear zones drawn round it`
            : `Disc ${disc.label} has no clear zone drawn round it; the brief gives one ${num(disc.zone)} mm across`,
        );
      else if (!t.near(own[0].r, (disc.zone / 2) * MM))
        out.push(
          `The clear zone round disc ${disc.label} is ${num((2 * own[0].r) / MM)} mm across; the brief gives ${num(disc.zone)} mm`,
        );
    });
    for (const s of zones)
      if (!b.discs.some((_, i) => at(s, discAt(i, n))))
        out.push(`The circle at ${t.at(s.at)} is not centred on a disc`);

    // Each label in line with its own disc, and nearer it than any other.
    const pieces = t.pieces();
    b.discs.forEach((disc, i) => {
      const {
        at: [x, y, anchor],
      } = labelAt(disc.label, i, n);
      const p = pieces.find((q) => q.text === disc.label);
      if (!p || !t.writtenAt(disc.label, x, y, anchor, "qf-text"))
        out.push(`The label ${disc.label} is not written beside the dish in line with its disc`);
      else {
        const nearest = b.discs
          .map((_, j) => ({ j, gap: toBox(discAt(j, n), p.box) }))
          .sort((u, v) => u.gap - v.gap)[0].j;
        if (nearest !== i)
          out.push(`The label ${disc.label} is nearer disc ${b.discs[nearest].label} than its own`);
      }
    });

    // The scale bar: 10 mm long, with its words.
    const lines = d.segments.filter((s) => s.cls === "qf-line").map((s) => s.seg);
    for (const want of barLines)
      if (!lines.some((s) => sameSeg(s, want)))
        out.push(
          `The scale bar is not drawn ${BAR.mm} mm (${BAR.mm * MM} units) long from (${BAR.x}, ${BAR.y})`,
        );
    if (!t.writtenAt(BAR.words, barWords[0], barWords[1], "middle", "qf-text"))
      out.push(`The scale bar is not labelled "${BAR.words}" under it`);

    // Nothing else: the dish, discs and zones (each checked above) and the scale bar's lines.
    for (const s of d.shapes) {
      const disc =
        s.cls === "qf-ink" && b.discs.some((_, i) => at(s, discAt(i, n)) && t.near(s.r, DISC));
      const ok =
        (s.name === "circle" && (s.cls === "qf-line" || disc)) ||
        (s.name === "line" && s.cls === "qf-line" && !s.marked);
      if (!ok) out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the agar plate`);
    }
    for (const s of lines)
      if (!barLines.some((w) => sameSeg(s, w)))
        out.push(`The line from ${t.at(s[0])} to ${t.at(s[1])} is not part of the scale bar`);
    const allowed = new Set([...b.discs.map((x) => x.label), BAR.words]);
    for (const p of pieces)
      if (!allowed.has(p.text))
        out.push(`Text "${p.text}" is not a disc's label or the scale bar's`);
    if (pieces.length !== allowed.size)
      out.push(
        `The plate has ${pieces.length} labels; it needs ${allowed.size}: one per disc and the scale bar's`,
      );
    return out;
  },
  samples: [
    {
      subject: "biology",
      question:
        "A student placed paper discs soaked in four different antibiotics, A to D, on an agar plate covered with bacteria. The diagram shows the plate after incubation. Which antibiotic was most effective against these bacteria?",
      options: ["A", "B", "C", "D"],
      brief: {
        kind: "agar-plate",
        discs: [
          { label: "A", zone: 24 },
          { label: "B", zone: 12 },
          { label: "C", zone: 0 },
          { label: "D", zone: 30 },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The diagram shows an agar plate with three antibiotic discs, A, B and C, after incubation. Use the scale bar to find the diameter of the clear zone around disc B. Then calculate the area of this clear zone in mm². Use π = 3.14.",
      brief: {
        kind: "agar-plate",
        discs: [
          { label: "A", zone: 16 },
          { label: "B", zone: 20 },
          { label: "C", zone: 12 },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "Students soaked paper discs in garlic extract, soap solution, water and mint extract, and placed them on agar covered with bacteria. The diagram shows the plate after incubation. Which substance was most effective at killing the bacteria?",
      options: ["garlic", "soap", "water", "mint"],
      brief: {
        kind: "agar-plate",
        discs: [
          { label: "garlic", zone: 22 },
          { label: "soap", zone: 14 },
          { label: "water", zone: 0 },
          { label: "mint", zone: 10 },
        ],
      },
    },
  ],
  random(r) {
    const n = 2 + Math.floor(r() * 4);
    const names = r() < 0.7 ? "ABCDE".split("") : ["water", "soap", "garlic", "mint", "tea"];
    return {
      kind: "agar-plate",
      discs: Array.from({ length: n }, (_, i) => ({
        label: names[i],
        zone: r() < 0.15 ? 0 : Math.round(8 + r() * (n > 3 ? 20 : 30)),
      })),
    };
  },
};
