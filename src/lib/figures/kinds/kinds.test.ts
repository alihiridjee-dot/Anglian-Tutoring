import { describe, expect, test } from "bun:test";
import { FIGURE_GUIDE, readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode, drawnByCode } from "../figureDraw";
import { KINDS } from ".";

/** A small seeded generator, so each sweep is the same every run. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("every figure kind in kinds/ is wired in, and holds to its own promise", () => {
  for (const kind of KINDS) {
    test(`${kind.kind}: its samples read, draw and pass the checker`, () => {
      expect(kind.samples.length).toBeGreaterThan(0);
      for (const sample of kind.samples) {
        const read = readBrief(sample.brief);
        if ("problem" in read) throw new Error(`${kind.kind} sample: ${read.problem}`);
        expect(drawnByCode(read.brief)).toBe(true);
        const figure = drawWithCode(read.brief);
        expect(figure).not.toBeNull();
        expect(checkFigure(figure!.svg, read.brief).problems).toEqual([]);
        expect(figure!.alt.length).toBeLessThan(1000);
      }
      expect(FIGURE_GUIDE).toContain(`- "${kind.kind}": ${kind.guide}`);
    });

    test(`${kind.kind}: any random brief it accepts draws so the checker passes it`, () => {
      const r = seeded(kind.kind.length * 7919);
      let accepted = 0;
      for (let i = 0; i < 300; i++) {
        const brief = kind.random(r);
        const read = readBrief(brief);
        if ("problem" in read) continue;
        accepted++;
        const figure = drawWithCode(read.brief)!;
        const problems = checkFigure(figure.svg, read.brief).problems;
        if (problems.length) throw new Error(`${JSON.stringify(brief)}\n${problems.join("\n")}`);
      }
      // A sweep that accepts almost nothing tests almost nothing.
      expect(accepted).toBeGreaterThan(100);
    });
  }
});
