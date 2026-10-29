/**
 * A pyramid of numbers or of biomass: 2 to 5 levels stacked as centred bars,
 * the producers at the bottom, each bar as wide as its value makes it beside
 * the widest, with each level's name written to the right of its row and,
 * when shown, its value to the left. The checker holds each bar's width to
 * its value and each row's name and value to its level, and refuses a brief
 * that breaks the rules of a food chain: producers anywhere but the bottom,
 * consumers out of order, or biomass growing up the pyramid.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { and, label, num, svgOf, text, wrap } from "../figureSvg";
import type { FigureKind } from "./kind";
import { canvasHeight, sameSeg, type Seg } from "./linework";

export type PyramidBrief = {
  kind: "pyramid";
  of: "numbers" | "biomass";
  /** From the producers at the bottom up. */
  levels: { name: string; value: number }[];
  /** Each level's value written beside it; false when the question asks for one. */
  showValues: boolean;
};

const ROW = 44;
/** The bars' room: from LEFT (or VALUES_LEFT with values beside them) to RIGHT. */
const LEFT = 16;
const VALUES_LEFT = 80;
const RIGHT = 228;
/** A value's right edge, and a name's left edge. */
const VALUE_X = 72;
const NAME_X = 236;
/** The smallest value as a share of the largest: any less and its bar is a sliver. */
const THINNEST = 1 / 40;
const TEXT = TEXT_SIZE["qf-text"]!;

/** A value as an exam paper writes it: 1500, 12 000. */
const written = (v: number) => {
  const [whole, part] = label(v).split(".");
  return `${whole.length > 4 ? whole.replace(/\B(?=(\d{3})+$)/g, " ") : whole}${part ? `.${part}` : ""}`;
};

/** Where each level's bar, name and value go, bottom level first. */
function layout(b: PyramidBrief) {
  const n = b.levels.length;
  const H = canvasHeight(ROW * n + 40);
  const top = (H - ROW * n) / 2;
  const left = b.showValues ? VALUES_LEFT : LEFT;
  const centre = (left + RIGHT) / 2;
  const largest = Math.max(...b.levels.map((l) => l.value));
  return {
    H,
    rows: b.levels.map((level, i) => {
      const y0 = top + ROW * (n - 1 - i);
      const w = ((RIGHT - left) * level.value) / largest;
      const lines = wrap(level.name, 358 - NAME_X, TEXT) ?? [level.name];
      return {
        level,
        x0: centre - w / 2,
        x1: centre + w / 2,
        y0,
        y1: y0 + ROW,
        lines,
        /** The name's first baseline: its lines centred on the row. */
        nameY: y0 + ROW / 2 + 5.5 - 9 * (lines.length - 1),
        valueY: y0 + ROW / 2 + 5.5,
      };
    }),
  };
}

const edges = (x0: number, y0: number, x1: number, y1: number): Seg[] => [
  [
    [x0, y0],
    [x1, y0],
  ],
  [
    [x1, y0],
    [x1, y1],
  ],
  [
    [x1, y1],
    [x0, y1],
  ],
  [
    [x0, y1],
    [x0, y0],
  ],
];

/** The level a trophic name belongs at, as a rule a food chain can't break. */
const TROPHIC: [RegExp, (level: number) => boolean, string][] = [
  [/\bproducers?\b/i, (l) => l === 1, "at the bottom"],
  [/\bprimary consumers?\b|\bherbivores?\b/i, (l) => l === 2, "second from the bottom"],
  [/\bsecondary consumers?\b/i, (l) => l === 3, "third from the bottom"],
  [/\btertiary consumers?\b/i, (l) => l === 4, "fourth from the bottom"],
  [/\bquaternary consumers?\b/i, (l) => l === 5, "fifth from the bottom"],
  [/\bcarnivores?\b/i, (l) => l >= 3, "above the herbivores"],
];

export const pyramid: FigureKind<PyramidBrief> = {
  kind: "pyramid",
  name: "a pyramid of numbers or biomass",
  guide:
    'of: "numbers" or "biomass"; levels: 2 to 5 {name: the organism or trophic level, at most 28 characters, fitting two lines of about 13 characters; value: the number of organisms or the biomass, above 0}, from the producers at the bottom up, so a level named "producers" comes first and "primary consumers" second; the smallest value at least a fortieth of the largest, so its bar can be seen, and biomass less at each level up; showValues: true to write each value beside its level, false when the question asks the student to work one out. The website draws each level as a centred bar as wide as its value makes it beside the widest.',
  read(b) {
    if (b.of !== "numbers" && b.of !== "biomass")
      return { problem: 'of must be "numbers" or "biomass"' };
    if (typeof b.showValues !== "boolean") return { problem: "showValues must be true or false" };
    const levels = b.levels as { name: unknown; value: unknown }[];
    if (!Array.isArray(levels) || levels.length < 2 || levels.length > 5)
      return { problem: "needs 2 to 5 levels" };
    const read: PyramidBrief = { kind: "pyramid", of: b.of, levels: [], showValues: b.showValues };
    for (const [i, l] of levels.entries()) {
      const name = typeof l?.name === "string" ? l.name.trim() : "";
      if (!name || [...name].length > 28)
        return { problem: "needs a name of at most 28 characters for each level" };
      const lines = wrap(name, 358 - NAME_X, TEXT);
      if (!lines || lines.length > 2)
        return { problem: `has a level name too long to fit beside its bar: "${name}"` };
      if (typeof l.value !== "number" || !Number.isFinite(l.value) || l.value <= 0)
        return { problem: "has a level whose value is not a number above 0" };
      for (const [rule, fits, where] of TROPHIC)
        if (rule.test(name) && !fits(i + 1))
          return {
            problem: `has "${name}" as level ${i + 1}: it belongs ${where}, with the producers at the bottom`,
          };
      read.levels.push({ name, value: l.value });
    }
    if (new Set(read.levels.map((l) => l.name)).size !== read.levels.length)
      return { problem: "names two levels the same" };
    const values = read.levels.map((l) => l.value);
    if (Math.min(...values) < Math.max(...values) * THINNEST)
      return { problem: "has a value under a fortieth of the largest, too thin to draw" };
    if (read.of === "biomass" && values.some((v, i) => i > 0 && v >= values[i - 1]))
      return { problem: "has biomass that doesn't fall at each level up the pyramid" };
    if (read.showValues && values.some((v) => textWidth(written(v), TEXT) > VALUE_X - 4))
      return { problem: "has a value too long to write beside its level" };
    return { brief: read };
  },
  draw(b) {
    const l = layout(b);
    const body: string[] = [];
    for (const r of l.rows) {
      body.push(
        `<rect class="qf-line" x="${num(r.x0)}" y="${num(r.y0)}" width="${num(r.x1 - r.x0)}" height="${ROW}"/>`,
      );
      body.push(text("qf-text", NAME_X, r.nameY, "start", r.lines));
      if (b.showValues)
        body.push(text("qf-text", VALUE_X, r.valueY, "end", [written(r.level.value)]));
    }
    const named = b.levels.map((x) => (b.showValues ? `${x.name} (${written(x.value)})` : x.name));
    return {
      svg: svgOf(l.H, body),
      alt: `A pyramid of ${b.of} with ${b.levels.length} levels drawn as bars, each as wide as its ${b.of === "numbers" ? "number" : "biomass"}. From the bottom: ${and(named)}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const l = layout(b);
    const outlines = d.segments.filter((s) => s.cls === "qf-line").map((s) => s.seg);
    const pieces = t.pieces();
    for (const [i, r] of l.rows.entries()) {
      const level = `level ${i + 1} (${r.level.name})`;
      if (!edges(r.x0, r.y0, r.x1, r.y1).every((e) => outlines.some((s) => sameSeg(s, e))))
        out.push(
          `The bar for ${level} is not ${t.fmt(r.x1 - r.x0)} units wide, centred, in row ${i + 1} from the bottom: its width must be in proportion to its value`,
        );
      // The name read back by its row: the one text to the right of the bar in that row.
      const beside = pieces.filter(
        (p) => p.x >= RIGHT && (p.box.y0 + p.box.y1) / 2 > r.y0 && (p.box.y0 + p.box.y1) / 2 < r.y1,
      );
      if (
        beside.length !== 1 ||
        beside[0].text !== r.lines.join(" ") ||
        !t.writtenAt(r.lines.join(" "), NAME_X, r.nameY, "start", "qf-text")
      )
        out.push(
          `The name "${r.level.name}" is not written beside its bar, ${i === 0 ? "at the bottom" : `in row ${i + 1} from the bottom`}`,
        );
      const value = written(r.level.value);
      if (b.showValues && !t.writtenAt(value, VALUE_X, r.valueY, "end", "qf-text"))
        out.push(`The value ${value} is not written beside the bar for ${level}`);
    }
    for (const s of d.shapes)
      if (!(
        s.name === "rect" &&
        s.cls === "qf-line" &&
        l.rows.some((r) => t.near(s.at[0], r.x0) && t.near(s.at[1], r.y0))
      ))
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not one of the pyramid's bars`);
    const words: { text: string; at: Pt }[] = l.rows.flatMap((r) => [
      { text: r.lines.join(" "), at: [NAME_X, r.nameY] as Pt },
      ...(b.showValues ? [{ text: written(r.level.value), at: [VALUE_X, r.valueY] as Pt }] : []),
    ]);
    for (const p of pieces)
      if (
        !words.some((w) => w.text === p.text && t.near(p.x, w.at[0], 1) && t.near(p.y, w.at[1], 1))
      )
        out.push(`Text "${p.text}" is not a level's name${b.showValues ? " or value" : ""}`);
    return out;
  },
  samples: [
    {
      subject: "biology",
      question:
        "The pyramid of biomass shows the biomass at each trophic level in an ecosystem, in g/m². Calculate the efficiency of biomass transfer from the primary consumers to the secondary consumers.",
      brief: {
        kind: "pyramid",
        of: "biomass",
        levels: [
          { name: "producers", value: 600 },
          { name: "primary consumers", value: 150 },
          { name: "secondary consumers", value: 30 },
        ],
        showValues: true,
      },
    },
    {
      subject: "biology",
      question:
        "The diagram shows a pyramid of numbers for some organisms in a wood. Why is the pyramid this shape?",
      options: [
        "Each tree is very large and feeds many caterpillars",
        "Caterpillars are producers",
        "Blue tits feed on trees",
        "There is more energy in the caterpillars than in the trees",
      ],
      brief: {
        kind: "pyramid",
        of: "numbers",
        levels: [
          { name: "oak trees", value: 50 },
          { name: "caterpillars", value: 1500 },
          { name: "blue tits", value: 40 },
        ],
        showValues: false,
      },
    },
    {
      subject: "biology",
      question:
        "The diagram shows a pyramid of biomass for a food chain in the sea. Why is there less biomass at each level up the pyramid?",
      options: [
        "Biomass is lost in respiration and waste at each level",
        "The animals higher up are smaller",
        "Producers turn biomass into light energy",
        "Animals higher up the pyramid eat less often",
      ],
      brief: {
        kind: "pyramid",
        of: "biomass",
        levels: [
          { name: "phytoplankton", value: 1000 },
          { name: "zooplankton", value: 200 },
          { name: "small fish", value: 50 },
          { name: "seals", value: 30 },
        ],
        showValues: false,
      },
    },
  ],
  random(r) {
    const n = 2 + Math.floor(r() * 4);
    const of = r() < 0.5 ? "numbers" : "biomass";
    const names = ["grass", "rabbits", "foxes", "eagles", "fleas"];
    let v = Math.round(200 + r() * 5000);
    const levels = Array.from({ length: n }, (_, i) => {
      const level = { name: names[i], value: v };
      v =
        of === "biomass"
          ? Math.max(1, Math.round(v * (0.15 + r() * 0.6)))
          : Math.round(v * (0.1 + r() * 3));
      return level;
    });
    return { kind: "pyramid", of, levels, showValues: r() < 0.5 };
  },
};
