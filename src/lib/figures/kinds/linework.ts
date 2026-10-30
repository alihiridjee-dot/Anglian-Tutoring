/**
 * Lines read back as a reader sees them: what a segment passes through, where
 * two segments cross, and which segments join into one piece of linework. The
 * family tree, the flow diagram and the evolutionary tree each read what
 * joins what with these, beyond the tools the checker hands every kind.
 */
import type { Box, Pt } from "../figureCheck";

export type Seg = [Pt, Pt];

/** Two points within `by` of each other on both axes. */
export const same = (a: Pt, b: Pt, by = 0.75) =>
  Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by;

/** The same segment, either way round. */
export const sameSeg = (s: Seg, t: Seg, by = 0.6) =>
  (same(s[0], t[0], by) && same(s[1], t[1], by)) || (same(s[0], t[1], by) && same(s[1], t[0], by));

/** How far a point is from a segment. */
export function toSegment(p: Pt, [a, b]: Seg): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** How far a point is from a box: 0 inside it. */
export const toBox = ([x, y]: Pt, b: Box) =>
  Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

export const grow = (b: Box, by: number): Box => ({
  x0: b.x0 - by,
  y0: b.y0 - by,
  x1: b.x1 + by,
  y1: b.y1 + by,
});

/** Whether a segment passes through a box (Liang–Barsky). */
export function crossesBox([a, b]: Seg, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - box.x0],
    [dx, box.x1 - a[0]],
    [-dy, a[1] - box.y0],
    [dy, box.y1 - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * Where two segments cross through each other: a point inside both, away
 * from both their ends. A T, where one ends on the other, is a join, not a
 * crossing; so is a shared end.
 */
export function crossing(s: Seg, t: Seg): Pt | null {
  const [[ax, ay], [bx, by]] = s;
  const [[cx, cy], [dx, dy]] = t;
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < 1e-9) return null;
  const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  if (u <= 0 || u >= 1 || v <= 0 || v >= 1) return null;
  const p: Pt = [ax + u * (bx - ax), ay + u * (by - ay)];
  return [...s, ...t].some((e) => same(e, p, 1)) ? null : p;
}

/**
 * The segments in joined pieces: two join when an end of one lies on the
 * other. Each piece is a list of indices into `segs`.
 */
export function pieces(segs: Seg[], by = 0.75): number[][] {
  const parent = segs.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  segs.forEach((s, i) =>
    segs.forEach((t, j) => {
      if (i !== j && s.some((e) => toSegment(e, t) <= by)) parent[root(i)] = root(j);
    }),
  );
  const groups = new Map<number, number[]>();
  segs.forEach((_, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), i]));
  return [...groups.values()];
}

/** Whether a segment runs straight across or straight up and down. */
export const square = ([a, b]: Seg) => Math.abs(a[0] - b[0]) <= 0.5 || Math.abs(a[1] - b[1]) <= 0.5;

/** Rounds up to the next canvas height: a multiple of 20 from 200 to 480. */
export const canvasHeight = (needed: number) => Math.max(200, Math.ceil(needed / 20) * 20);
