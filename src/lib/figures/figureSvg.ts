/**
 * What every figure drawn by code is made of: numbers written plainly, lines,
 * text and the canvas, plus a graph's axes. The figure kinds (figureDraw and
 * kinds/) draw with these, so each writes its SVG the way the checker reads it.
 */
import { CANVAS_WIDTH, PLOT, TEXT_SIZE, plotX, plotY, textWidth, type Axis } from "./figure";

/** Canvas height of every graph and bar chart: a plot area 184 units high. */
export const GRAPH_HEIGHT = 280;

export const num = (v: number) => String(Number(v.toFixed(2)));
/** A value as a label: a true minus sign, at most two decimal places. */
export const label = (v: number) => num(v).replace(/^-/, "−");
export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const line = (cls: string, x1: number, y1: number, x2: number, y2: number, extra = "") =>
  `<line class="${cls}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"${extra}/>`;
export const text = (cls: string, x: number, y: number, anchor: string, lines: string[]) =>
  `<text class="${cls}" x="${num(x)}" y="${num(y)}" text-anchor="${anchor}">${esc(lines[0])}${lines
    .slice(1)
    .map((l) => `<tspan x="${num(x)}" dy="18">${esc(l)}</tspan>`)
    .join("")}</text>`;
export const svgOf = (H: number, body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} ${H}" class="qf" role="img">${body.join("")}</svg>`;

/** An axis's tick values, from min to max in steps. */
export function ticks(a: Axis): number[] {
  const count = Math.round((a.max - a.min) / a.step);
  return Array.from({ length: count + 1 }, (_, i) => Number((a.min + i * a.step).toFixed(6)));
}

/**
 * Number every `k`-th tick, the smallest k that keeps neighbouring numbers
 * apart: `room` is the gap one number needs from the next.
 */
export function every(spacing: number, room: number): number {
  for (const k of [1, 2, 4, 5, 10]) if (k * spacing >= room) return k;
  return Infinity;
}

/**
 * Words over lines no wider than `width` at `size`; null when a single word
 * is wider, which no line break can fix.
 */
export function wrap(name: string, width: number, size: number): string[] | null {
  const lines: string[] = [];
  for (const word of name.trim().split(/\s+/)) {
    if (textWidth(word, size) > width) return null;
    const last = lines[lines.length - 1];
    if (last !== undefined && textWidth(`${last} ${word}`, size) <= width)
      lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** The plot area's axes, grid, tick numbers and titles. */
export function frame(H: number, x: Axis | null, y: Axis, xTitle: string): string[] {
  const bottom = H - PLOT.bottomGap;
  const out: string[] = [];
  if (x)
    for (const v of ticks(x)) out.push(line("qf-thin", plotX(v, x), PLOT.top, plotX(v, x), bottom));
  for (const v of ticks(y))
    out.push(line("qf-thin", PLOT.left, plotY(v, y, H), PLOT.right, plotY(v, y, H)));
  out.push(line("qf-line", PLOT.left, bottom, PLOT.right, bottom));
  out.push(line("qf-line", PLOT.left, PLOT.top, PLOT.left, bottom));
  const small = TEXT_SIZE["qf-small"]!;
  // The corner is numbered once: an x axis whose first number is wider than
  // a digit or two would crowd the y axis's lowest number, so that one goes.
  let corner = false;
  if (x) {
    const xs = ticks(x);
    const widest = Math.max(...xs.map((v) => textWidth(label(v), small)));
    const k = every((PLOT.right - PLOT.left) / (xs.length - 1), Math.max(28, widest + 6));
    xs.forEach((v, i) => {
      if (i % k === 0) out.push(text("qf-small", plotX(v, x), H - 38, "middle", [label(v)]));
    });
    corner = textWidth(label(xs[0]), small) > 12;
  }
  const ys = ticks(y);
  const k = every((bottom - PLOT.top) / (ys.length - 1), 18);
  ys.forEach((v, i) => {
    if (i % k === 0 && !(i === 0 && corner))
      out.push(text("qf-small", PLOT.left - 8, plotY(v, y, H) + 5, "end", [label(v)]));
  });
  out.push(text("qf-text", 204, H - 14, "middle", [xTitle]));
  out.push(text("qf-text", 16, 22, "start", [y.title]));
  return out;
}

/** A list of values as words: "2.4, 5.2 and 7.9". */
export const and = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0];

export const polyline = (cls: string, pts: [number, number][]) =>
  `<polyline class="${cls}" points="${pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}"/>`;
