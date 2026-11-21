import { describe, expect, test } from "bun:test";
import type { PlanOverride } from "./overrides";
import { changesFrom, describeChange } from "./planChangesDal";

// The module builds the real client on import, which needs these to exist.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

const override = (id: string, values: Partial<PlanOverride>): PlanOverride => ({
  id,
  specPointId: "p1",
  kind: "remove",
  weekStart: "2026-11-16",
  note: null,
  createdBy: "nadia",
  createdAt: "2026-11-18T10:00:00Z",
  ...values,
});
const plan = (week_start: string, points: [string, string, string, string?][]) => ({
  week_start,
  student_weekly_plan_points: points.map(([spec_point_id, origin, created_at, carried]) => ({
    spec_point_id,
    origin,
    created_at,
    carried_from: carried ?? null,
  })),
});
const names = {
  point: (id: string) => (id === "p1" ? "EDEX 2.17B Reflex actions" : null),
  staff: (id: string) => (id === "nadia" ? "Nadia" : null),
  student: "Sam",
};

describe("the plan's changes, pieced together", () => {
  test("a move is one change: its addition in the target week is folded into it", () => {
    const changes = changesFrom({
      overrides: [override("o1", { note: "Moved to the week of 2026-11-23" })],
      plans: [
        plan("2026-11-23", [
          ["p1", "tutor", "2026-11-18T10:00:02Z"],
          // Added by hand on another day: its own change.
          ["p2", "tutor", "2026-11-19T09:00:00Z"],
          // Set by the programme: not a change anyone made.
          ["p3", "core", "2026-11-16T08:00:00Z"],
        ]),
      ],
      breaks: [],
    });
    expect(changes.map((c) => [c.kind, c.specPointId, c.week, c.other])).toEqual([
      ["added", "p2", "2026-11-23", undefined],
      ["moved", "p1", "2026-11-16", "2026-11-23"],
    ]);
    expect(describeChange(changes[1], names)).toBe(
      "Nadia moved EDEX 2.17B Reflex actions from 16–22 Nov 2026 to 23–29 Nov 2026.",
    );
  });

  test("removed, skipped, added by the student, carried, and a break booked then cancelled", () => {
    const changes = changesFrom({
      overrides: [
        override("o1", { createdAt: "2026-11-18T10:00:00Z" }),
        override("o2", {
          kind: "skip",
          weekStart: null,
          createdBy: "gone",
          createdAt: "2026-11-17T10:00:00Z",
        }),
      ],
      plans: [
        plan("2026-11-16", [
          ["p1", "student", "2026-11-16T12:00:00Z"],
          ["p1b", "core", "2026-11-15T12:00:00Z", "2026-11-09"],
        ]),
      ],
      breaks: [
        {
          id: "b",
          starts_on: "2026-11-30",
          ends_on: "2026-12-06",
          booked_by: null,
          booked_at: "2026-11-14T09:00:00Z",
          cancelled_at: "2026-11-14T18:00:00Z",
        },
      ],
    });
    expect(changes.map((c) => describeChange(c, names))).toEqual([
      "Nadia removed EDEX 2.17B Reflex actions from 16–22 Nov 2026.",
      // A member of staff the directory no longer lists.
      "A tutor skipped EDEX 2.17B Reflex actions for good.",
      "Sam added EDEX 2.17B Reflex actions to 16–22 Nov 2026.",
      // A point the course no longer has, and nobody's name on the carry.
      "a spec point was carried from 9–15 Nov 2026 into 16–22 Nov 2026.",
      "The break starting Mon 30 Nov was cancelled.",
      "A break was booked: 30 Nov – 6 Dec.",
    ]);
  });
});
