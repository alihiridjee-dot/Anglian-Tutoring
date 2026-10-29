/**
 * A figure drawn from fixed layout rules, as one list its drawer and its
 * checker both read: every line, polyline, polygon, dashed line and circle
 * with the name a problem calls it, and every text where it is written. The
 * drawer writes the list out; the checker holds the drawing to the same list
 * both ways: each mark drawn exactly where the list puts it, and nothing drawn
 * that the list doesn't hold. A kind adds its own checks for what an answer
 * hangs on, read off the drawing itself.
 */
import { TEXT_SIZE, textWidth, type FigureClass } from "../figure";
import type { CheckTools, Drawing, Pt } from "../figureCheck";
import { num, text } from "../figureSvg";

export type { Pt };

/** One element of the drawing, and what a problem calls it. */
export type Mark = {
  /** "the reflected ray", "the tick at 40". */
  name: string;
  tag: "line" | "polyline" | "polygon" | "path" | "circle";
  cls: FigureClass;
  /**
   * A line's two ends; a polyline's or polygon's points; a dashed line's
   * dashes, each a start and an end in turn; a circle's centre.
   */
  pts: Pt[];
  /** An arrowhead at the last point, or at both ends. */
  head?: "end" | "both";
  r?: number;
};

/** A line of text, written at its baseline with its anchor. */
export type Word = {
  text: string;
  cls: FigureClass;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** What a problem calls it, when the text itself doesn't say: "the letter for the angle of incidence". */
  name?: string;
};

export const HEAD = ' marker-end="url(#qf-head)"';
const BOTH = ' marker-start="url(#qf-head)" marker-end="url(#qf-head)"';
const points = (pts: Pt[]) => pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ");

/** A mark written as SVG, the way the checker reads it back. */
export function markSvg(m: Mark): string {
  const head = m.head === "both" ? BOTH : m.head ? HEAD : "";
  const [a, b] = m.pts;
  switch (m.tag) {
    case "line":
      return `<line class="${m.cls}" x1="${num(a[0])}" y1="${num(a[1])}" x2="${num(b[0])}" y2="${num(b[1])}"${head}/>`;
    case "polyline":
      return `<polyline class="${m.cls}" points="${points(m.pts)}"${head}/>`;
    case "polygon":
      return `<polygon class="${m.cls}" points="${points(m.pts)}"/>`;
    case "path": {
      const d = [];
      for (let i = 0; i < m.pts.length; i += 2)
        d.push(
          `M${num(m.pts[i][0])} ${num(m.pts[i][1])} L${num(m.pts[i + 1][0])} ${num(m.pts[i + 1][1])}`,
        );
      return `<path class="${m.cls}" d="${d.join(" ")}"${head}/>`;
    }
    case "circle":
      return `<circle class="${m.cls}" cx="${num(a[0])}" cy="${num(a[1])}" r="${num(m.r ?? 0)}"/>`;
  }
}
export const wordSvg = (w: Word) => text(w.cls, w.x, w.y, w.anchor, [w.text]);

/** The straight pieces a mark is drawn as. */
export function segmentsOf(m: Mark): [Pt, Pt][] {
  const p = m.pts;
  if (m.tag === "circle") return [];
  if (m.tag === "path")
    return Array.from({ length: p.length / 2 }, (_, i) => [p[2 * i], p[2 * i + 1]]);
  const out = p.slice(1).map((q, i) => [p[i], q] as [Pt, Pt]);
  if (m.tag === "polygon") out.push([p[p.length - 1], p[0]]);
  return out;
}

/** A dashed line from a to b: 8-unit dashes with 6-unit gaps, the last cut short at b. */
export function dashes(a: Pt, b: Pt, dash = 8, gap = 6): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const at = (s: number): Pt => [
    a[0] + ((b[0] - a[0]) * s) / len,
    a[1] + ((b[1] - a[1]) * s) / len,
  ];
  const out: Pt[] = [];
  for (let s = 0; s < len - 1; s += dash + gap) out.push(at(s), at(Math.min(s + dash, len)));
  return out;
}

/** Where a mark is, as a problem says it. */
const where = (m: Mark, t: CheckTools) =>
  m.tag === "line"
    ? `from ${t.at(m.pts[0])} to ${t.at(m.pts[1])}`
    : m.tag === "path"
      ? `from ${t.at(m.pts[0])} to ${t.at(m.pts[m.pts.length - 1])}`
      : `at ${t.at(m.pts[0])}`;

/**
 * The drawing held to its marks and words, both ways: each mark drawn where
 * the list puts it (its first point, its every piece, its arrowheads), each
 * word written where the list puts it, and no shape, piece, arrow or text the
 * list doesn't hold. `what` names the figure: "ray diagram".
 */
export function heldToLayout(
  marks: Mark[],
  words: Word[],
  d: Drawing,
  t: CheckTools,
  what: string,
): string[] {
  const out: string[] = [];
  const at = (p: Pt, q: Pt) => t.near(p[0], q[0]) && t.near(p[1], q[1]);
  const sameSeg = (s: [Pt, Pt], q: [Pt, Pt]) =>
    (at(s[0], q[0]) && at(s[1], q[1])) || (at(s[0], q[1]) && at(s[1], q[0]));
  const used = new Set<number>();
  for (const m of marks) {
    const i = d.shapes.findIndex(
      (s, i) =>
        !used.has(i) &&
        s.name === m.tag &&
        s.cls === m.cls &&
        s.marked === !!m.head &&
        at(s.at, m.pts[0]) &&
        (m.tag !== "circle" || t.near(s.r, m.r ?? 0)),
    );
    if (i >= 0) used.add(i);
    const whole = segmentsOf(m).every((q) =>
      d.segments.some((s) => s.cls === m.cls && sameSeg(s.seg, q)),
    );
    const headed =
      !m.head ||
      d.arrows.some(
        (a) =>
          at(a.from, m.pts[0]) &&
          at(a.to, m.pts[m.pts.length - 1]) &&
          a.end &&
          a.start === (m.head === "both"),
      );
    if (i < 0 || !whole || !headed) out.push(`The ${m.name} is not drawn ${where(m, t)}`);
  }
  let stray = false;
  d.shapes.forEach((s, i) => {
    if (used.has(i)) return;
    stray = true;
    out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the ${what}`);
  });
  // A shape whose first point is right but whose later points aren't.
  if (!stray) {
    const all = marks.flatMap((m) => segmentsOf(m).map((q) => ({ q, cls: m.cls })));
    for (const s of d.segments)
      if (!all.some((e) => e.cls === s.cls && sameSeg(s.seg, e.q)))
        out.push(
          `A ${s.cls} line from ${t.at(s.seg[0])} to ${t.at(s.seg[1])} is not part of the ${what}`,
        );
  }
  for (const a of d.arrows)
    if (
      !marks.some(
        (m) =>
          m.head &&
          at(a.from, m.pts[0]) &&
          at(a.to, m.pts[m.pts.length - 1]) &&
          a.end &&
          a.start === (m.head === "both"),
      )
    )
      out.push(
        `The arrowhead on the line from ${t.at(a.from)} to ${t.at(a.to)} is not one the ${what} has`,
      );

  for (const w of words)
    if (!t.writtenAt(w.text, w.x, w.y, w.anchor, w.cls))
      out.push(
        `The ${w.name ?? `label "${w.text}"`} is not written at ${t.at([w.x, w.y])} (${w.anchor}, ${w.cls})`,
      );
  for (const p of t.pieces())
    if (
      !words.some(
        (w) =>
          w.text === p.text &&
          w.cls === p.cls &&
          w.anchor === p.anchor &&
          t.near(w.x, p.x, 1) &&
          t.near(w.y, p.y, 1),
      )
    )
      out.push(`Text "${p.text}" is not part of the ${what}`);
  return out;
}

/** Characters that reach below the baseline, as the checker counts them. */
const DESCENDS = /[gjpqy,;()₂₃₄]/;

/** A text's box as the checker draws it round its letters: centred at x, from its baseline y. */
export function boxOf(w: { text: string; cls: FigureClass; x: number; y: number; anchor: string }) {
  const size = TEXT_SIZE[w.cls] ?? 16;
  const width = textWidth(w.text, size);
  const x0 = w.anchor === "middle" ? w.x - width / 2 : w.anchor === "end" ? w.x - width : w.x;
  return {
    x0,
    x1: x0 + width,
    y0: w.y - 0.8 * size,
    y1: w.y + (DESCENDS.test(w.text) ? 0.25 : 0.05) * size,
  };
}

/** The baseline that centres a text's box on y, and its box's half width and half height. */
export function centred(word: string, cls: FigureClass) {
  const size = TEXT_SIZE[cls] ?? 16;
  const below = (DESCENDS.test(word) ? 0.25 : 0.05) * size;
  const halfH = (0.8 * size + below) / 2;
  return { halfW: textWidth(word, size) / 2, halfH, drop: 0.8 * size - halfH };
}
