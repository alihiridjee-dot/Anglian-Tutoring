import { describe, expect, it } from "bun:test";
import { arrowPath, arrowSides, arrowStartX, packLabels } from "./arrowLayout";

describe("arrowSides", () => {
  it("points at a small low number from below and a small high one from above", () => {
    expect(
      arrowSides([
        { start: 1, script: "sub" },
        { start: 3, script: "sup" },
      ]),
    ).toEqual(["below", "above"]);
  });

  it("shares the rest out, left to right, above first", () => {
    expect(
      arrowSides([
        { start: 8, script: "plain" },
        { start: 0, script: "plain" },
        { start: 4, script: "plain" },
      ]),
    ).toEqual(["above", "above", "below"]);
  });

  it("on a wrapped formula, points at the first line from above and the last from below", () => {
    expect(
      arrowSides(
        [
          { start: 0, script: "plain", line: 0 },
          { start: 19, script: "plain", line: 0 },
          { start: 21, script: "sub", line: 1 },
        ],
        2,
      ),
    ).toEqual(["above", "above", "below"]);
  });

  it("gives up on a part on a middle line, which no arrow can reach without crossing text", () => {
    expect(arrowSides([{ start: 0, script: "plain", line: 1 }], 3)).toBeNull();
  });

  it("balances against parts whose side is fixed", () => {
    // 2H₂O: the 2 in front goes above, because the small 2 already sits below.
    expect(
      arrowSides([
        { start: 2, script: "sub" },
        { start: 0, script: "plain" },
      ]),
    ).toEqual(["below", "above"]);
  });
});

describe("packLabels", () => {
  it("centres a label on its part", () => {
    expect(packLabels(300, [{ cx: 150, w: 100 }])).toEqual([{ x: 100, line: 0 }]);
  });

  it("keeps a label inside the box at either edge", () => {
    expect(
      packLabels(300, [
        { cx: 10, w: 100 },
        { cx: 295, w: 80 },
      ]),
    ).toEqual([
      { x: 0, line: 0 },
      { x: 220, line: 0 },
    ]);
  });

  it("pushes a crowding label right, past the one before it", () => {
    const [a, b] = packLabels(400, [
      { cx: 100, w: 100 },
      { cx: 120, w: 100 },
    ]);
    expect(a).toEqual({ x: 50, line: 0 });
    expect(b).toEqual({ x: 162, line: 0 });
  });

  it("drops a label to the next line out when the line is full", () => {
    const out = packLabels(220, [
      { cx: 60, w: 120 },
      { cx: 160, w: 120 },
    ]);
    expect(out[0]).toEqual({ x: 0, line: 0 });
    expect(out[1].line).toBe(1);
    expect(out[1].x).toBe(100);
  });

  it("never lets two labels on a line overlap", () => {
    const labels = [30, 60, 90, 120].map((cx) => ({ cx, w: 70 }));
    const out = packLabels(320, labels);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        if (out[i].line === out[j].line)
          expect(out[i].x + 70 <= out[j].x || out[j].x + 70 <= out[i].x).toBe(true);
    for (const p of out) expect(p.x + 70).toBeLessThanOrEqual(320);
  });
});

describe("arrowPath", () => {
  it("is a straight line when the label sits over its part", () => {
    expect(arrowPath({ x: 50.2, y: 10 }, { x: 51, y: 40 })).toBe("M51 10V40");
  });

  it("curves in to arrive head-on", () => {
    expect(arrowPath({ x: 10, y: 0 }, { x: 50, y: 40 })).toBe("M10 0C10 20 50 20 50 40");
  });
});

describe("arrowStartX", () => {
  it("leaves from right over the part when the label spans it", () => {
    expect(arrowStartX({ x: 0, w: 100 }, 40)).toBe(40);
  });

  it("leaves from near the end nearest the part otherwise", () => {
    expect(arrowStartX({ x: 0, w: 100 }, 300)).toBe(90);
    expect(arrowStartX({ x: 200, w: 100 }, 0)).toBe(210);
  });
});
