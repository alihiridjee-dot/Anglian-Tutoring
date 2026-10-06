import { describe, expect, test } from "bun:test";
import { BEST_VALUE_CADENCE, CADENCES, WEEKS_PER_CYCLE, pricePerWeek } from "./entitlements";

/** packages.price_pence as live on 3 Oct 2026 (the iGCSE list is the same). */
const LIVE_PENCE = {
  weekly: { 1: 1999, 2: 2239, 3: 2399 },
  monthly: { 1: 4999, 2: 5599, 3: 5999 },
  termly: { 1: 13999, 2: 15699, 3: 16799 },
} as const;

describe("cadence figures", () => {
  test("a month counts as 4 weeks and a term as 12, the landing page's way", () => {
    expect(WEEKS_PER_CYCLE).toEqual({ weekly: 1, monthly: 4, termly: 12 });
    expect(pricePerWeek("monthly", 4999)).toBeCloseTo(1249.75);
    expect(pricePerWeek("termly", 13999)).toBeCloseTo(1166.58, 1);
  });

  test("the Best value cadence is the cheapest per week at every subject count", () => {
    for (const count of [1, 2, 3] as const) {
      const perWeek = CADENCES.map((c) => ({
        key: c.key,
        each: pricePerWeek(c.key, LIVE_PENCE[c.key][count]),
      }));
      const cheapest = perWeek.reduce((a, b) => (b.each < a.each ? b : a));
      expect(cheapest.key).toBe(BEST_VALUE_CADENCE);
    }
  });
});
