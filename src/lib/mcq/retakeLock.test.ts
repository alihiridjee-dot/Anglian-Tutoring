import { describe, expect, it } from "bun:test";
import { MIN_INTERVAL_DAYS } from "@/lib/planner/scheduler";
import { RETAKE_LOCK_DAYS, retakeOpensAt, retakeOpensLabel } from "./retakeLock";

describe("retakeLock", () => {
  it("never outlasts the planner's own wait before a point comes back", () => {
    // A longer lock would refuse the very retake the planner schedules.
    expect(RETAKE_LOCK_DAYS).toBeLessThanOrEqual(MIN_INTERVAL_DAYS);
  });

  it("opens a week after the attempt", () => {
    expect(retakeOpensAt("2026-10-05T10:00:00Z").toISOString()).toBe("2026-10-12T10:00:00.000Z");
  });

  it("names the time the quiz opens, in UK time", () => {
    // Filed at 23:17 on 27 Oct: shut until that minute a week later, not all day.
    expect(retakeOpensLabel(retakeOpensAt("2026-10-27T23:17:00Z"))).toBe("Tue 3 Nov at 23:17");
    // Summer time: 23:17 UTC is 00:17 the next day in London.
    expect(retakeOpensLabel(new Date("2026-07-03T23:17:00Z"))).toBe("Sat 4 Jul at 00:17");
  });

  it("never shows a time before the lock has lifted", () => {
    expect(retakeOpensLabel(new Date("2026-11-03T23:17:15Z"))).toBe("Tue 3 Nov at 23:18");
  });
});
