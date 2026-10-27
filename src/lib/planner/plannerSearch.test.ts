import { describe, expect, test } from "bun:test";
import { validatePlannerSearch } from "./plannerSearch";

describe("validatePlannerSearch: week", () => {
  test("a Monday key is kept as it is", () => {
    expect(validatePlannerSearch({ week: "2026-10-05" }).week).toBe("2026-10-05");
  });

  test("a mid-week date snaps to its Monday, so a week lookup keyed by Mondays finds it", () => {
    expect(validatePlannerSearch({ week: "2026-10-07" }).week).toBe("2026-10-05");
    expect(validatePlannerSearch({ week: "2026-10-11" }).week).toBe("2026-10-05");
  });

  test("a well-shaped but impossible date is dropped rather than thrown on", () => {
    expect(validatePlannerSearch({ week: "2026-13-45" }).week).toBeUndefined();
    expect(validatePlannerSearch({ week: "2026-02-30" }).week).toBeUndefined();
  });

  test("anything that is not a date key is ignored", () => {
    expect(validatePlannerSearch({ week: "next-week" }).week).toBeUndefined();
    expect(validatePlannerSearch({ week: 20261005 }).week).toBeUndefined();
    expect(validatePlannerSearch({}).week).toBeUndefined();
  });
});
