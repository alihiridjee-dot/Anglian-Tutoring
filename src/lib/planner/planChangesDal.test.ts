import { describe, expect, test } from "bun:test";
import type { PlanOverride } from "./overrides";
import {
  changesFrom,
  changesFromLog,
  describeChange,
  mergeChanges,
  type LogRow,
} from "./planChangesDal";

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

describe("the database's own log", () => {
  const row = (id: string, kind: string, values: Partial<LogRow> = {}): LogRow => ({
    id,
    kind,
    actor_id: "nadia",
    actor_role: "tutor",
    spec_point_id: "p1",
    week_start: "2026-11-23",
    detail: {},
    created_at: "2026-11-21T10:00:00Z",
    ...values,
  });

  test("every kind reads as a sentence, with who did it", () => {
    const changes = changesFromLog([
      row("1", "moved", { detail: { to_week: "2026-12-07" } }),
      row("2", "restored"),
      row("3", "unskipped", { week_start: null }),
      row("4", "exam-date", {
        spec_point_id: null,
        week_start: null,
        detail: { from: "2027-06-21", to: "2027-06-28" },
      }),
      row("5", "topic-order", {
        spec_point_id: null,
        week_start: null,
        detail: {
          before: ["Cells", "Genetics", "Ecology"],
          after: ["Genetics", "Ecology", "Cells"],
        },
      }),
      row("6", "topic-order", {
        spec_point_id: null,
        week_start: null,
        actor_id: null,
        actor_role: "system",
        detail: {
          before: ["Cells", "Genetics", "Ecology"],
          after: ["Ecology", "Genetics", "Cells"],
        },
      }),
      row("7", "added", { actor_id: "student", actor_role: "student" }),
      row("8", "break-booked", {
        spec_point_id: null,
        week_start: "2027-01-04",
        actor_id: null,
        actor_role: "system",
        detail: { ends_on: "2027-01-10" },
      }),
      row("9", "plan-started", { spec_point_id: null, actor_role: "student", actor_id: "student" }),
      // A kind a later version of the log may add: left out, not guessed at.
      row("10", "something-new"),
    ]);
    expect(changes.map((c) => describeChange(c, names))).toEqual([
      "Nadia moved EDEX 2.17B Reflex actions from 23–29 Nov 2026 to 7–13 Dec 2026.",
      "Nadia put EDEX 2.17B Reflex actions back into 23–29 Nov 2026.",
      "Nadia brought EDEX 2.17B Reflex actions back into the programme.",
      "Nadia changed the exam date from 21 Jun 2027 to 28 Jun 2027.",
      // One topic moved: say which, and which way.
      "Nadia moved Cells later in the topic order.",
      // More than one moved, and by a nightly job.
      "The planner changed the topic order.",
      "Sam added EDEX 2.17B Reflex actions to 23–29 Nov 2026.",
      "A break was booked: 4 Jan – 10 Jan.",
      "The plan started, from the week of 23–29 Nov 2026.",
    ]);
  });

  test("the log speaks from the day it began; older rows fill in before it, and a move stays one change", () => {
    const log = changesFromLog([
      row("m", "moved", { created_at: "2026-11-22T09:00:00Z", detail: { to_week: "2026-12-07" } }),
      // The other half of that move, logged a second later.
      row("a", "added", { created_at: "2026-11-22T09:00:01Z", week_start: "2026-12-07" }),
      row("first", "removed", { created_at: "2026-11-21T13:00:00Z" }),
    ]);
    const older = changesFrom({
      overrides: [
        // The same removal, seen from the row it left: the log already has it.
        override("o-new", { createdAt: "2026-11-21T13:00:00Z" }),
        override("o-old", { createdAt: "2026-11-10T10:00:00Z" }),
      ],
      plans: [],
      breaks: [],
    });
    expect(mergeChanges(log, older).map((c) => c.id)).toEqual([
      "log:m",
      "log:first",
      "override:o-old",
    ]);
    // With no log yet, everything the older rows show is shown.
    expect(mergeChanges([], older).map((c) => c.id)).toEqual(["override:o-new", "override:o-old"]);
  });
});
