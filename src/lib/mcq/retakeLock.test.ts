import { describe, expect, it } from "bun:test";
import { MIN_INTERVAL_DAYS } from "@/lib/planner/scheduler";
import { RETAKE_LOCK_DAYS, retakeOpensAt } from "./retakeLock";

describe("retakeLock", () => {
  it("never outlasts the planner's own wait before a point comes back", () => {
    // A longer lock would refuse the very retake the planner schedules.
    expect(RETAKE_LOCK_DAYS).toBeLessThanOrEqual(MIN_INTERVAL_DAYS);
  });

  it("opens a week after the attempt", () => {
    expect(retakeOpensAt("2026-10-05T10:00:00Z").toISOString()).toBe("2026-10-12T10:00:00.000Z");
  });
});
