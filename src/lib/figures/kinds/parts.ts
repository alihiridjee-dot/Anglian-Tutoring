/**
 * A figure laid out as parts, drawn and checked from the same list. A kind
 * lays its brief out once, every position by formula; `drawParts` writes the
 * SVG from that layout, and `partProblems` holds a drawing to the very same
 * parts: each one where the layout puts it, each arrowhead at its own end,
 * and nothing drawn or written that no part names, since a stray mark can
 * change an answer or give one away.
 */
import { ARROW_DEFS, type FigureClass } from "../figure";
import type { CheckTools, Drawing, Pt } from "../figureCheck";
import { num, svgOf, text } from "../figureSvg";

/** One thing the figure draws: what it is (as a problem names it), its style and its points. */
export type Part = { what: string; cls: FigureClass } & (
  | { el: "line"; pts: [Pt, Pt]; heads?: "end" | "both" }
  | { el: "polyline"; pts: Pt[]; heads?: "end" | "both" }
  | { el: "polygon"; pts: Pt[] }
  /** Its top-left and bottom-right corners. */
  | { el: "rect"; pts: [Pt, Pt] }
  /** Its centre. */
  | { el: "circle"; pts: [Pt]; r: number }
  /** Its start, then three points (two controls and an end) for each cubic curve. */
  | { el: "path"; pts: Pt[] }
  /** Where its first line is written. */
  | { el: "text"; pts: [Pt]; anchor: "start" | "middle" | "end"; lines: string[] }
);

const pair = ([x, y]: Pt) => `${num(x)},${num(y)}`;
const HEADS = {
  end: ' marker-end="url(#qf-head)"',
  both: ' marker-start="url(#qf-head)" marker-end="url(#qf-head)"',
};

/** One part as SVG. */
function svgOfPart(p: Part): string {
  switch (p.el) {
    case "line": {
      const [[x1, y1], [x2, y2]] = p.pts;
      return `<line class="${p.cls}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${p.heads ? HEADS[p.heads] : ""}/>`;
    }
    case "polyline":
      return `<polyline class="${p.cls}" points="${p.pts.map(pair).join(" ")}"${p.heads ? HEADS[p.heads] : ""}/>`;
    case "polygon":
      return `<polygon class="${p.cls}" points="${p.pts.map(pair).join(" ")}"/>`;
    case "rect": {
      const [[x0, y0], [x1, y1]] = p.pts;
      return `<rect class="${p.cls}" x="${num(x0)}" y="${num(y0)}" width="${num(x1 - x0)}" height="${num(y1 - y0)}"/>`;
    }
    case "circle":
      return `<circle class="${p.cls}" cx="${num(p.pts[0][0])}" cy="${num(p.pts[0][1])}" r="${num(p.r)}"/>`;
    case "path": {
      const curves = [];
      for (let i = 1; i + 2 < p.pts.length; i += 3)
        curves.push(
          `C ${p.pts
            .slice(i, i + 3)
            .map(pair)
            .join(" ")
            .replace(/,/g, " ")}`,
        );
      return `<path class="${p.cls}" d="M ${pair(p.pts[0]).replace(",", " ")} ${curves.join(" ")}"/>`;
    }
    case "text":
      return text(p.cls, p.pts[0][0], p.pts[0][1], p.anchor, p.lines);
  }
}

/** The figure's SVG: the arrowhead block when any part has a head, then every part in order. */
export const drawParts = (H: number, parts: Part[]) =>
  svgOf(H, [
    ...(parts.some((p) => "heads" in p && p.heads) ? [ARROW_DEFS] : []),
    ...parts.map(svgOfPart),
  ]);

/** A value as the SVG writes it, so the checker's own sampling of a curve is matched point for point. */
const written = (v: number) => Number(num(v));

/** A path's curves sampled as the checker samples them: 16 straight steps each. */
function curvePoints(p: Part): Pt[] {
  const pts = p.pts.map(([x, y]) => [written(x), written(y)] as Pt);
  const out: Pt[] = [pts[0]];
  for (let i = 1; i + 2 < pts.length; i += 3) {
    const c = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
    for (let k = 1; k <= 16; k++) {
      const s = k / 16;
      out.push(
        [0, 1].map(
          (j) =>
            (1 - s) ** 3 * c[0][j] +
            3 * (1 - s) ** 2 * s * c[1][j] +
            3 * (1 - s) * s ** 2 * c[2][j] +
            s ** 3 * c[3][j],
        ) as Pt,
      );
    }
  }
  return out;
}

/** The straight pieces a part is drawn with, as the checker reads them. */
function piecesOf(p: Part): [Pt, Pt][] {
  const joined = (pts: Pt[]) => pts.slice(1).map((q, i) => [pts[i], q] as [Pt, Pt]);
  switch (p.el) {
    case "line":
    case "polyline":
      return joined(p.pts);
    case "polygon":
      return joined([...p.pts, p.pts[0]]);
    case "rect": {
      const [[x0, y0], [x1, y1]] = p.pts;
      return joined([
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ]);
    }
    case "path":
      return joined(curvePoints(p));
    default:
      return [];
  }
}

/**
 * Straight pieces of line found by either end, to within `by`: a piece's ends
 * are filed under the whole-unit cells they round to, and a lookup searches
 * the cells around one end.
 */
function pieceIndex(list: { seg: [Pt, Pt]; cls: string }[], by: number) {
  const cells = new Map<string, { seg: [Pt, Pt]; cls: string }[]>();
  const key = (x: number, y: number) => `${x}:${y}`;
  for (const item of list)
    for (const [x, y] of item.seg) {
      const k = key(Math.round(x), Math.round(y));
      cells.set(k, [...(cells.get(k) ?? []), item]);
    }
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by;
  return (seg: [Pt, Pt], cls: string) => {
    const [x, y] = [Math.round(seg[0][0]), Math.round(seg[0][1])];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const item of cells.get(key(x + dx, y + dy)) ?? [])
          if (
            item.cls === cls &&
            ((same(item.seg[0], seg[0]) && same(item.seg[1], seg[1])) ||
              (same(item.seg[0], seg[1]) && same(item.seg[1], seg[0])))
          )
            return true;
    return false;
  };
}

/** The element a part is drawn as, as the checker names it. */
const ELEMENT: Record<Part["el"], string> = {
  line: "line",
  polyline: "polyline",
  polygon: "polygon",
  rect: "rect",
  circle: "circle",
  path: "path",
  text: "text",
};

/**
 * What the drawing gets wrong against its parts: any part missing or moved,
 * an arrowhead at the wrong end, and anything drawn or written that no part
 * names. `what` names each part in the problem, so a moved arrow reads as
 * "The 400 N arrow is not drawn from … to …".
 */
export function partProblems(parts: Part[], d: Drawing, t: CheckTools): string[] {
  const out: string[] = [];
  const same = (a: Pt, b: Pt, by = 0.6) => t.near(a[0], b[0], by) && t.near(a[1], b[1], by);
  const drawn = pieceIndex(d.segments, 0.6);
  const wanted = pieceIndex(
    parts.flatMap((p) => piecesOf(p).map((seg) => ({ seg, cls: p.cls }))),
    0.6,
  );

  for (const p of parts) {
    const first = p.pts[0];
    const last = p.pts[p.pts.length - 1];
    switch (p.el) {
      case "text":
        if (!t.writtenAt(p.lines.join(" "), first[0], first[1], p.anchor, p.cls))
          out.push(`The ${p.what}, "${p.lines.join(" ")}", is not written at ${t.at(first)}`);
        break;
      case "circle":
        if (
          !d.shapes.some(
            (s) => s.name === "circle" && s.cls === p.cls && same(s.at, first) && t.near(s.r, p.r),
          )
        )
          out.push(`The ${p.what} is not drawn at ${t.at(first)} with radius ${t.fmt(p.r)}`);
        break;
      default: {
        const missing = piecesOf(p).find((seg) => !drawn(seg, p.cls));
        if (missing)
          out.push(
            p.el === "line"
              ? `The ${p.what} is not drawn from ${t.at(first)} to ${t.at(last)}`
              : `The ${p.what} is not drawn where it belongs: nothing runs from ${t.at(missing[0])} to ${t.at(missing[1])}`,
          );
        else if ((p.el === "line" || p.el === "polyline") && p.heads) {
          const both = p.heads === "both";
          const headed = d.arrows.some(
            (a) =>
              a.end &&
              a.start === both &&
              ((same(a.from, first) && same(a.to, last)) ||
                (both && same(a.from, last) && same(a.to, first))),
          );
          if (!headed)
            out.push(
              both
                ? `The ${p.what} needs a head at each end`
                : `The ${p.what} must point to ${t.at(last)}, with its one head there`,
            );
        }
      }
    }
  }

  // Anything drawn that no part names.
  const extra = d.segments.filter((s) => !wanted(s.seg, s.cls));
  for (const s of extra.slice(0, 4))
    out.push(
      `The ${s.cls} line from ${t.at(s.seg[0])} to ${t.at(s.seg[1])} is not part of the figure`,
    );
  if (extra.length > 4)
    out.push(`${extra.length - 4} more pieces of line are not part of the figure`);
  for (const a of d.arrows) {
    const meant = parts.some((p) => {
      if ((p.el !== "line" && p.el !== "polyline") || !p.heads) return false;
      const [first, last] = [p.pts[0], p.pts[p.pts.length - 1]];
      const both = p.heads === "both";
      return (
        a.end &&
        a.start === both &&
        ((same(a.from, first) && same(a.to, last)) ||
          (both && same(a.from, last) && same(a.to, first)))
      );
    });
    if (!meant)
      out.push(`The arrow from ${t.at(a.from)} to ${t.at(a.to)} is not part of the figure`);
  }
  for (const s of d.shapes) {
    const meant = parts.some((p) => {
      if (ELEMENT[p.el] !== s.name || p.cls !== s.cls) return false;
      if (s.marked !== ("heads" in p && !!p.heads)) return false;
      if (p.el === "circle") return same(s.at, p.pts[0]) && t.near(s.r, p.r);
      // A line or polyline without heads looks the same drawn either way round.
      const either = (p.el === "line" || p.el === "polyline") && !p.heads;
      const ends = either ? [p.pts[0], p.pts[p.pts.length - 1]] : [p.pts[0]];
      return ends.some((e) => same(s.at, e));
    });
    if (!meant) out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the figure`);
  }
  const texts = parts.filter((p) => p.el === "text");
  for (const piece of t.pieces())
    if (
      !texts.some(
        (p) =>
          p.lines.join(" ") === piece.text &&
          p.cls === piece.cls &&
          p.anchor === piece.anchor &&
          t.near(piece.x, p.pts[0][0], 1) &&
          t.near(piece.y, p.pts[0][1], 1),
      )
    )
      out.push(`Text "${piece.text}" at ${t.at([piece.x, piece.y])} is not part of the figure`);
  return out;
}

/** The direction an arrow's head points: along the drawn piece that ends at its tip. */
export function headDirection(d: Drawing, tip: Pt): Pt | null {
  const piece = d.segments.find(
    (s) =>
      s.cls === "qf-line" &&
      Math.hypot(s.seg[1][0] - tip[0], s.seg[1][1] - tip[1]) <= 0.6 &&
      Math.hypot(s.seg[1][0] - s.seg[0][0], s.seg[1][1] - s.seg[0][1]) > 0.1,
  );
  if (!piece) return null;
  const [dx, dy] = [piece.seg[1][0] - piece.seg[0][0], piece.seg[1][1] - piece.seg[0][1]];
  const length = Math.hypot(dx, dy);
  return [dx / length, dy / length];
}
