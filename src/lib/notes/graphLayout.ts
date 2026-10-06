/**
 * Geometry for the note line graph: the curve itself, and where its labels can
 * go without sitting on a line or on each other. Pure, so it can be tested
 * without drawing anything. All coordinates are SVG pixels (y grows down).
 */

export type Pt = [number, number];
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Tangents for a monotone cubic (Steffen). The curve never overshoots its
 * points, so a flat run stays flat and a peak stays where it was put.
 */
export function monotoneTangents(p: Pt[]): number[] {
  const n = p.length;
  const secant = (i: number) => {
    const h = p[i + 1][0] - p[i][0];
    return h ? (p[i + 1][1] - p[i][1]) / h : 0;
  };
  const t = p.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    const h0 = p[i][0] - p[i - 1][0],
      h1 = p[i + 1][0] - p[i][0],
      s0 = secant(i - 1),
      s1 = secant(i),
      mean = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    return (
      (Math.sign(s0) + Math.sign(s1)) *
        Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(mean)) || 0
    );
  });
  if (n === 2) t[0] = t[1] = secant(0);
  else if (n > 2) {
    t[0] = (3 * secant(0) - t[1]) / 2;
    t[n - 1] = (3 * secant(n - 2) - t[n - 2]) / 2;
  }
  return t;
}

/** The SVG path for the monotone curve through `p`. */
export function monotonePath(p: Pt[]): string {
  const t = monotoneTangents(p);
  let s = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const dx = (p[i + 1][0] - p[i][0]) / 3;
    s += ` C ${p[i][0] + dx} ${p[i][1] + dx * t[i]}, ${p[i + 1][0] - dx} ${p[i + 1][1] - dx * t[i + 1]}, ${p[i + 1][0]} ${p[i + 1][1]}`;
  }
  return s;
}

/**
 * Points along the drawn curve, about `step` px apart. The path's control
 * points sit a third of the way along each segment, so x moves evenly and y
 * is the Hermite cubic: these points lie exactly on the line that is drawn.
 */
export function sampleCurve(p: Pt[], step = 4): Pt[] {
  const t = monotoneTangents(p);
  const out: Pt[] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i],
      [x1, y1] = p[i + 1],
      h = x1 - x0,
      k = Math.max(1, Math.ceil(Math.abs(h) / step));
    for (let j = 1; j <= k; j++) {
      const u = j / k,
        u2 = u * u,
        u3 = u2 * u;
      out.push([
        x0 + h * u,
        (2 * u3 - 3 * u2 + 1) * y0 +
          (u3 - 2 * u2 + u) * h * t[i] +
          (-2 * u3 + 3 * u2) * y1 +
          (u3 - u2) * h * t[i + 1],
      ]);
    }
  }
  return out;
}

/** A safe over-estimate of a bold label's width. */
export const textWidth = (s: string, size: number) => s.length * size * 0.62;

const overlaps = (a: Box, b: Box, pad = 0) =>
  a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

const distance = (b: Box, [x, y]: Pt) =>
  Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

/** The box a centred label covers, given its baseline. */
export function labelBox(x: number, baseline: number, text: string, size: number): Box {
  const w = textWidth(text, size) / 2;
  return { x0: x - w, y0: baseline - size * 0.8, x1: x + w, y1: baseline + size * 0.25 };
}

/**
 * A spot for each line's name, just above or below its own line, clear of
 * every line and every other label. A line with no clear spot gets null: the
 * key under the graph names it instead.
 */
export function placeLabels(
  curves: Pt[][],
  names: string[],
  opts: { bounds: Box; avoid: Box[]; size: number },
): ({ x: number; y: number } | null)[] {
  const taken = [...opts.avoid];
  const { size, bounds } = opts;
  return curves.map((own, i) => {
    const name = names[i];
    const peak = own.reduce((m, q) => (q[1] < m[1] ? q : m));
    const side = textWidth(name, size) / 2 + 8;
    // Above the line, below it, or level with it on either side.
    const spots: Pt[] = [
      [0, -8],
      [0, size + 6],
      [-side, size * 0.3],
      [side, size * 0.3],
    ];
    let best: { x: number; y: number; box: Box; score: number } | null = null;
    for (let k = 0; k < own.length; k += 3) {
      const [px, py] = own[k];
      for (const [dx, dy] of spots) {
        const cx = px + dx,
          baseline = py + dy;
        const box = labelBox(cx, baseline, name, size);
        if (box.x0 < bounds.x0 || box.x1 > bounds.x1 || box.y0 < bounds.y0 || box.y1 > bounds.y1)
          continue;
        if (taken.some((b) => overlaps(box, b, 3))) continue;
        let clear = Infinity;
        let hit = false;
        for (let j = 0; j < curves.length && !hit; j++)
          for (const q of curves[j]) {
            const dist = distance(box, q);
            if (dist < (j === i ? 3 : 5)) {
              hit = true;
              break;
            }
            if (j !== i) clear = Math.min(clear, dist);
          }
        if (hit) continue;
        // Any spot well clear of other lines will do; then the nearer its line's peak, the better.
        const score = Math.min(clear, 10) * 10 - Math.abs(px - peak[0]) * 0.3;
        if (!best || score > best.score) best = { x: cx, y: baseline, box, score };
      }
    }
    if (!best) return null;
    taken.push(best.box);
    return { x: best.x, y: best.y };
  });
}

/**
 * Splits an axis label into lines that each fit `max` px, breaking at spaces.
 * Never more than two lines: a longer label is shrunk instead (see `fitSize`).
 */
export function wrapLabel(text: string, size: number, max: number): string[] {
  if (textWidth(text, size) <= max) return [text];
  const words = text.split(" ");
  let bestSplit = 1,
    bestWidest = Infinity;
  for (let k = 1; k < words.length; k++) {
    const widest = Math.max(
      textWidth(words.slice(0, k).join(" "), size),
      textWidth(words.slice(k).join(" "), size),
    );
    if (widest < bestWidest) {
      bestWidest = widest;
      bestSplit = k;
    }
  }
  return words.length < 2
    ? [text]
    : [words.slice(0, bestSplit).join(" "), words.slice(bestSplit).join(" ")];
}

/** The largest font size, up to `size`, at which every line fits `max` px. */
export const fitSize = (lines: string[], size: number, max: number) =>
  Math.min(size, ...lines.map((l) => (max / textWidth(l, size)) * size));
