import { describe, expect, test } from "bun:test";
import { pastWeekGap, pauseCovering } from "./pastWeek";
import type { PauseRecord } from "./pausesDal";
import type { StudentBreak } from "./breaks";
import type { PlanPoint } from "./weeklyPlanDal";

const point = (id: string, extra: Partial<PlanPoint> = {}): PlanPoint => ({
  spec_point_id: id,
  code: id,
  title: id,
  description: null,
  topic_id: "t",
  topic_title: "T",
  origin: "core",
  carried_from: null,
  done_at: null,
  ...extra,
});
const pause = (startedAt: string, endedAt: string | null): PauseRecord => ({
  id: startedAt,
  reason: "paused",
  startedAt,
  endedAt,
  programmeResumedAt: null,
});
const brk: StudentBreak = {
  id: "b",
  startsOn: "2026-09-07",
  endsOn: "2026-09-13",
  reason: "holiday",
  recordedAt: "2026-09-14T00:05:00Z",
};
const course = { board: "edexcel", level: "gcse" };
const empty = {
  weekStart: "2026-09-07",
  plan: null,
  points: [],
  withheld: [],
  course,
  onBreak: null,
  pauses: [],
};

describe("pauseCovering", () => {
  // The week of Monday 7 Sept 2026, London time (BST, so it starts at 23:00 UTC on the 6th).
  const week = "2026-09-07";

  test("a stop overlapping any part of the week covers it", () => {
    expect(
      pauseCovering([pause("2026-09-01T09:00:00Z", "2026-09-30T09:00:00Z")], week),
    ).not.toBeNull();
    // Began on the Thursday.
    expect(pauseCovering([pause("2026-09-10T12:00:00Z", null)], week)).not.toBeNull();
    // Ended on the Tuesday.
    expect(
      pauseCovering([pause("2026-08-01T09:00:00Z", "2026-09-08T12:00:00Z")], week),
    ).not.toBeNull();
    // Still in force.
    expect(pauseCovering([pause("2026-08-01T09:00:00Z", null)], week)).not.toBeNull();
  });

  test("one that ended before the week, or began after it, does not", () => {
    expect(pauseCovering([pause("2026-08-01T09:00:00Z", "2026-09-06T22:00:00Z")], week)).toBeNull();
    // 00:30 on Monday 14 Sept, London: the next week.
    expect(pauseCovering([pause("2026-09-13T23:30:00Z", null)], week)).toBeNull();
    expect(pauseCovering([], week)).toBeNull();
  });
});

describe("pastWeekGap", () => {
  test("a week with work in it shows the work", () => {
    expect(
      pastWeekGap({
        ...empty,
        points: [point("a")],
        onBreak: brk,
        pauses: [pause("2026-09-01T09:00:00Z", null)],
      }),
    ).toBeNull();
  });

  test("nothing recorded: no plan was set", () => {
    expect(pastWeekGap(empty)).toBeNull();
  });

  test("a break week is a break, even though it is also recorded as a stop", () => {
    expect(
      pastWeekGap({
        ...empty,
        onBreak: brk,
        pauses: [{ ...pause("2026-09-06T23:00:00Z", "2026-09-13T23:00:00Z"), reason: "break" }],
      }),
    ).toEqual({ kind: "break", brk });
  });

  test("a stopped subject's week says so", () => {
    const stop = pause("2026-09-01T09:00:00Z", "2026-09-30T09:00:00Z");
    expect(pastWeekGap({ ...empty, pauses: [stop] })).toEqual({ kind: "paused", pause: stop });
  });

  test("a week saved for another course shows that course's points", () => {
    const old = [
      { point: point("a", { done_at: "2026-09-08T10:00:00Z" }), reason: "off-course" as const },
      { point: point("b"), reason: "off-course" as const },
    ];
    expect(pastWeekGap({ ...empty, plan: { board: "aqa", level: "gcse" }, withheld: old })).toEqual(
      {
        kind: "old-course",
        board: "aqa",
        level: "gcse",
        points: old.map((w) => w.point),
      },
    );
    // A level change is another course too.
    expect(
      pastWeekGap({ ...empty, plan: { board: "edexcel", level: "igcse" }, withheld: old })?.kind,
    ).toBe("old-course");
    // The same course with points kept aside for another reason is not.
    expect(
      pastWeekGap({
        ...empty,
        plan: course,
        withheld: [{ point: point("c", { origin: "focus" }), reason: "no-evidence" }],
      }),
    ).toBeNull();
  });
});
