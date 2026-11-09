/**
 * Where an equation's arrow labels sit: above or below the formula, and how
 * far along, so no two labels overlap and each sits as near its part as it can.
 * Pure numbers in, numbers out; LabelledFormula measures the page and draws.
 */

export type ArrowSide = "above" | "below";

/** How a part of a formula is written: small and low (₂), small and high (²⁺), or neither. */
export type PartScript = "sub" | "sup" | "plain";

/**
 * Each arrow's side. A small low number is pointed at from below and a small
 * high one from above, so the arrow never crosses the letter beside it. The
 * rest go to whichever side has fewer so far, left to right, above first.
 *
 * A formula that wraps (a long word equation on a phone) points at its first
 * line from above and its last from below, so no arrow crosses a line of
 * text. A part on a line in between can't be reached that way: null.
 */
export function arrowSides(
  parts: { start: number; script: PartScript; line?: number }[],
  lines = 1,
): ArrowSide[] | null {
  if (lines > 1) {
    if (parts.some((p) => (p.line ?? 0) > 0 && (p.line ?? 0) < lines - 1)) return null;
    return parts.map((p) => ((p.line ?? 0) === 0 ? "above" : "below"));
  }
  const sides: (ArrowSide | null)[] = parts.map((p) =>
    p.script === "sub" ? "below" : p.script === "sup" ? "above" : null,
  );
  const count = (s: ArrowSide) => sides.filter((x) => x === s).length;
  const order = parts.map((_, i) => i).sort((a, b) => parts[a].start - parts[b].start);
  for (const i of order)
    if (sides[i] == null) sides[i] = count("below") < count("above") ? "below" : "above";
  return sides as ArrowSide[];
}

/**
 * Labels on one side, packed into lines left to right: each sits centred on
 * its part where it can, is pushed right past the label before it, and drops
 * to the next line out when it would run off the edge. `x` is the label's
 * left edge; line 0 is nearest the formula.
 */
export function packLabels(
  width: number,
  labels: { cx: number; w: number }[],
  gap = 12,
): { x: number; line: number }[] {
  const order = labels.map((_, i) => i).sort((a, b) => labels[a].cx - labels[b].cx);
  const rightEdge: number[] = [];
  const out: { x: number; line: number }[] = new Array(labels.length);
  for (const i of order) {
    const { cx, w } = labels[i];
    const want = Math.min(Math.max(cx - w / 2, 0), Math.max(width - w, 0));
    for (let line = 0; ; line++) {
      const edge = rightEdge[line];
      const x = edge == null ? want : Math.max(want, edge + gap);
      if (edge == null || x + w <= width) {
        out[i] = { x, line };
        rightEdge[line] = x + w;
        break;
      }
    }
  }
  return out;
}

/**
 * An arrow from a label's edge to its part: straight down (or up) when the
 * label sits over the part, otherwise an S-curve that leaves the label and
 * arrives at the part head-on, so the arrowhead always points straight at it.
 */
export function arrowPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const r = (n: number) => Math.round(n * 2) / 2;
  if (Math.abs(from.x - to.x) < 2) return `M${r(to.x)} ${r(from.y)}V${r(to.y)}`;
  const mid = (from.y + to.y) / 2;
  return `M${r(from.x)} ${r(from.y)}C${r(from.x)} ${r(mid)} ${r(to.x)} ${r(mid)} ${r(to.x)} ${r(to.y)}`;
}

/** Where a label's arrow leaves it: under its part if the label spans it, else the nearest point in from its end. */
export function arrowStartX(label: { x: number; w: number }, partCx: number, inset = 10): number {
  const lo = label.x + Math.min(inset, label.w / 2);
  const hi = label.x + label.w - Math.min(inset, label.w / 2);
  return Math.min(Math.max(partCx, lo), hi);
}
