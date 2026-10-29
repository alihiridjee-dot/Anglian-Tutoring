/**
 * A pie chart: a circle cut into slices from 12 o'clock going clockwise, each
 * slice lettered inside, with a key beside it naming each letter (and its
 * percentage, unless the question asks the student to read it off). Every
 * cut is where its percentage puts it, so the checker can hold each slice's
 * size to the brief.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import { label, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type PieBrief = {
  kind: "pie-chart";
  /** In order clockwise from 12 o'clock. */
  slices: { name: string; percent: number }[];
  /** The key gives each percentage; false when the question asks for one. */
  showValues: boolean;
};

const H = 240;
const CX = 112;
const CY = 124;
const R = 96;
const KEY = { letter: 228, name: 248, top: 44, row: 26 } as const;
const LETTERS = "ABCDEF";

/** Where a share of the circle (0 to 100) meets its edge, going clockwise from 12 o'clock. */
const edge = (percent: number, r = R): [number, number] => {
  const a = (percent / 100) * 2 * Math.PI;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
};
/** Each slice's start and end, as shares of the circle. */
const spans = (b: PieBrief) => {
  let from = 0;
  return b.slices.map((s) => {
    const span = [from, from + s.percent] as const;
    from += s.percent;
    return span;
  });
};
const keyText = (b: PieBrief, i: number) =>
  b.showValues ? `${b.slices[i].name} ${label(b.slices[i].percent)}%` : b.slices[i].name;

export const pieChart: FigureKind<PieBrief> = {
  kind: "pie-chart",
  name: "a pie chart",
  guide:
    "slices: 2 to 6 {name, percent} in order clockwise from 12 o'clock, percents adding up to 100, each at least 6; names short enough for the key beside the chart (at most 11 characters, or 14 without values); showValues: true to write each percent in the key, false when the question asks the student to read a share off the chart. The website letters each slice A, B, C… and names the letters in the key.",
  read(b) {
    const slices = b.slices as { name: unknown; percent: unknown }[];
    if (!Array.isArray(slices) || slices.length < 2 || slices.length > 6)
      return { problem: "needs 2 to 6 slices" };
    if (typeof b.showValues !== "boolean") return { problem: "showValues must be true or false" };
    const read: PieBrief = { kind: "pie-chart", slices: [], showValues: b.showValues };
    for (const s of slices) {
      if (typeof s?.name !== "string" || !s.name.trim())
        return { problem: "needs a name for each slice" };
      if (typeof s.percent !== "number" || !Number.isFinite(s.percent) || s.percent < 6)
        return { problem: "has a slice under 6 percent, too thin to letter" };
      read.slices.push({ name: s.name.trim(), percent: s.percent });
    }
    const total = read.slices.reduce((sum, s) => sum + s.percent, 0);
    if (Math.abs(total - 100) > 0.5) return { problem: "has percents that don't add up to 100" };
    if (new Set(read.slices.map((s) => s.name)).size !== read.slices.length)
      return { problem: "names a slice twice" };
    const room = 358 - KEY.name;
    if (read.slices.some((_, i) => textWidth(keyText(read, i), TEXT_SIZE["qf-text"]!) > room))
      return { problem: "has a name too long for the key" };
    return { brief: read };
  },
  draw(b) {
    const body = [`<circle class="qf-line" cx="${CX}" cy="${CY}" r="${R}"/>`];
    const parts = spans(b);
    for (const [from] of parts) body.push(line("qf-line", CX, CY, ...edge(from)));
    parts.forEach(([from, to], i) => {
      const [x, y] = edge((from + to) / 2, R * 0.62);
      body.push(text("qf-strong", x, y + 5.5, "middle", [LETTERS[i]]));
      const row = KEY.top + KEY.row * i;
      body.push(text("qf-strong", KEY.letter, row, "start", [LETTERS[i]]));
      body.push(text("qf-text", KEY.name, row, "start", [keyText(b, i)]));
    });
    const key = b.slices.map((s, i) => `${LETTERS[i]} ${keyText(b, i)}`).join(", ");
    return {
      svg: svgOf(H, body),
      // The shares only when the key shows them: otherwise reading them is the question.
      alt: `A pie chart in ${b.slices.length} slices, lettered clockwise from the top, with a key: ${key}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    if (
      !d.shapes.some(
        (s) =>
          s.name === "circle" &&
          s.cls === "qf-line" &&
          t.near(s.r, R) &&
          t.near(s.at[0], CX) &&
          t.near(s.at[1], CY),
      )
    )
      out.push(`The chart's circle is not drawn at (${CX}, ${CY}) with radius ${R}`);
    const parts = spans(b);
    for (const [from] of parts)
      if (!t.hasLine([CX, CY], edge(from)))
        out.push(`The cut at ${num(from)}% is not drawn from the centre to ${t.at(edge(from))}`);
    const cuts = d.segments.filter((s) => s.cls === "qf-line").length;
    if (cuts !== parts.length)
      out.push(`The chart has ${cuts} cuts; its ${parts.length} slices need ${parts.length}`);
    parts.forEach(([from, to], i) => {
      const [x, y] = edge((from + to) / 2, R * 0.62);
      if (!t.writtenAt(LETTERS[i], x, y + 5.5, "middle", "qf-strong"))
        out.push(`The letter ${LETTERS[i]} is not in the middle of its slice`);
      const row = KEY.top + KEY.row * i;
      if (
        !t.writtenAt(LETTERS[i], KEY.letter, row, "start", "qf-strong") ||
        !t.writtenAt(keyText(b, i), KEY.name, row, "start", "qf-text")
      )
        out.push(`The key's row for ${LETTERS[i]} is not "${LETTERS[i]} ${keyText(b, i)}"`);
    });
    for (const s of d.shapes)
      if (
        !(s.name === "line" && s.cls === "qf-line" && !s.marked) &&
        !(s.name === "circle" && s.cls === "qf-line")
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the pie chart`);
    const allowed = new Set([
      ...LETTERS.slice(0, b.slices.length),
      ...b.slices.map((_, i) => keyText(b, i)),
    ]);
    for (const p of t.pieces())
      if (!allowed.has(p.text)) out.push(`Text "${p.text}" is not a slice's letter or the key`);
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The pie chart shows the energy resources used to generate the UK's electricity in one year. What percentage of the electricity was generated from renewable resources?",
      options: ["22%", "35%", "43%", "57%"],
      brief: {
        kind: "pie-chart",
        slices: [
          { name: "gas", percent: 38 },
          { name: "wind", percent: 26 },
          { name: "nuclear", percent: 15 },
          { name: "solar", percent: 9 },
          { name: "coal", percent: 6 },
          { name: "other", percent: 6 },
        ],
        showValues: true,
      },
    },
  ],
  random(r) {
    const n = 2 + Math.floor(r() * 5);
    const cuts = Array.from({ length: n - 1 }, () => 6 + Math.floor(r() * (100 - 6 * n)));
    let left = 100 - 6 * n;
    const extra = cuts.map((c) => {
      const e = Math.min(left, Math.floor((c / 100) * left));
      left -= e;
      return e;
    });
    const percents = [...extra.map((e) => 6 + e), 6 + left];
    const names = ["gas", "wind", "nuclear", "solar", "coal", "oil", "hydroelectric", "biofuel"];
    return {
      kind: "pie-chart",
      slices: percents.map((percent, i) => ({
        name: names[(i * 3) % names.length] + (i > 4 ? i : ""),
        percent,
      })),
      showValues: r() < 0.5,
    };
  },
};
