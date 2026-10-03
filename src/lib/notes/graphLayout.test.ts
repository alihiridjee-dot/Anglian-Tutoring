import { describe, expect, test } from "bun:test";
import {
  fitSize,
  labelBox,
  placeLabels,
  sampleCurve,
  textWidth,
  wrapLabel,
  type Box,
  type Pt,
} from "./graphLayout";

// Pixel coordinates, as the graph draws them: x across, y down.
const toPx = (pts: [number, number][]): Pt[] => pts.map(([x, y]) => [44 + x * 55.6, 200 - y * 170]);

describe("monotone curve", () => {
  test("a heating curve's plateaus stay flat", () => {
    // phys-026 Internal energy, as written: flat while melting (1.5–3) and boiling (6–8.5).
    const p = toPx([
      [0, 0.1],
      [1.5, 0.3],
      [3, 0.3],
      [6, 0.7],
      [8.5, 0.7],
      [10, 0.9],
    ]);
    const melting = sampleCurve(p).filter(([x]) => x >= p[1][0] && x <= p[2][0]);
    const boiling = sampleCurve(p).filter(([x]) => x >= p[3][0] && x <= p[4][0]);
    for (const [, y] of melting) expect(y).toBeCloseTo(p[1][1], 6);
    for (const [, y] of boiling) expect(y).toBeCloseTo(p[3][1], 6);
  });

  test("never goes beyond the points either side of it", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const p: Pt[] = [];
      let x = 0;
      for (let k = 0; k < 3 + Math.floor(rand() * 8); k++) {
        x += 5 + rand() * 60;
        p.push([x, rand() < 0.3 && p.length ? p[p.length - 1][1] : rand() * 170]);
      }
      const s = sampleCurve(p, 1);
      for (let i = 0; i < p.length - 1; i++) {
        const lo = Math.min(p[i][1], p[i + 1][1]) - 1e-9,
          hi = Math.max(p[i][1], p[i + 1][1]) + 1e-9;
        for (const [sx, sy] of s)
          if (sx > p[i][0] && sx < p[i + 1][0]) {
            expect(sy).toBeGreaterThanOrEqual(lo);
            expect(sy).toBeLessThanOrEqual(hi);
          }
      }
    }
  });
});

describe("line labels", () => {
  const bounds: Box = { x0: 48, y0: 4, x1: 636, y1: 226 };
  const near = (b: Box, [x, y]: Pt) =>
    Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

  test("never sit on a line, on each other or on a marker", () => {
    // Two lines that cross, and one flat line between them.
    const curves = [
      toPx([
        [0, 0.1],
        [10, 0.9],
      ]),
      toPx([
        [0, 0.9],
        [10, 0.1],
      ]),
      toPx([
        [0, 0.5],
        [10, 0.5],
      ]),
    ].map((p) => sampleCurve(p));
    const names = ["Rising line", "Falling line", "Flat line"];
    const marker = labelBox(322, 18, "Halfway", 12);
    const placed = placeLabels(curves, names, { bounds, avoid: [marker], size: 13 });
    const boxes = placed.map((p, i) => (p ? labelBox(p.x, p.y, names[i], 13) : null));
    boxes.forEach((b, i) => {
      if (!b) return;
      for (const c of curves) for (const q of c) expect(near(b, q)).toBeGreaterThanOrEqual(3);
      expect(b.x0 >= bounds.x0 && b.x1 <= bounds.x1 && b.y0 >= bounds.y0).toBe(true);
      for (const o of [marker, ...boxes.filter((x, j) => x && j !== i)] as Box[])
        expect(b.x1 <= o.x0 || o.x1 <= b.x0 || b.y1 <= o.y0 || o.y1 <= b.y0).toBe(true);
    });
    expect(placed.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  test("leave a line to the key when it has no clear spot, rather than overlap", () => {
    // Two lines drawn on top of each other: neither can be named without touching the other.
    const a = sampleCurve(
      toPx([
        [0, 0.2],
        [10, 0.8],
      ]),
    );
    const placed = placeLabels([a, a], ["First", "Second"], { bounds, avoid: [], size: 13 });
    expect(placed).toEqual([null, null]);
  });
});

describe("axis labels", () => {
  test("a long label wraps onto two lines that each fit", () => {
    const label = "Angle of refraction (sketch of the shape only)";
    const lines = wrapLabel(label, 12, 194);
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(label);
    for (const l of lines) expect(textWidth(l, fitSize(lines, 12, 194))).toBeLessThanOrEqual(194);
  });

  test("a short label stays on one line at full size", () => {
    expect(wrapLabel("Temperature", 12, 194)).toEqual(["Temperature"]);
    expect(fitSize(["Temperature"], 12, 194)).toBe(12);
  });
});
