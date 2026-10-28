import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { courseStateFrom } from "./courseState";
import { ScheduleDAL } from "./scheduleDal";
import type { PlannerStateRows, WeekPointRow } from "./readModels";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

// A Wednesday: this Monday is 12 Oct.
const NOW = new Date("2026-10-14T10:00:00Z");
const WEEK = "2026-10-12";
const course = { studentId: "student", subject: "biology", board: "aqa", level: "gcse" } as const;

const weekPoint = (
  id: string,
  topicId: string,
  origin: WeekPointRow["origin"],
  on: Partial<{ board: "aqa" | "edexcel" }> = {},
): WeekPointRow => ({
  origin,
  carried_from: null,
  done_at: null,
  spec_points: {
    id,
    code: id.toUpperCase(),
    title: `Point ${id}`,
    description: null,
    topic_id: topicId,
    sort_order: 1,
    topics: {
      title: `Topic ${topicId}`,
      sort_order: topicId === "t1" ? 1 : 2,
      subject: "biology",
      board: on.board ?? "aqa",
      level: "gcse",
    },
  },
});

/** Topic 1 taught from September, topic 2 from December; p1 has a graded task behind it. */
const rows = (): PlannerStateRows => ({
  course: {
    topics: [
      { id: "t1", title: "Topic t1", sort_order: 1 },
      { id: "t2", title: "Topic t2", sort_order: 2 },
    ],
    points: [
      { id: "p1", code: "P1", title: "Point p1", sort_order: 1, topic_id: "t1", weight: 1 },
      { id: "p2", code: "P2", title: "Point p2", sort_order: 2, topic_id: "t1", weight: 1 },
      { id: "p3", code: "P3", title: "Point p3", sort_order: 1, topic_id: "t2", weight: 1 },
    ],
    sources: {
      resourceLinks: [{ resource_id: "r1", spec_point_id: "p1" }],
      setLinks: [],
      setScope: [],
    },
    submissions: [
      {
        id: "s1",
        resource_id: "r1",
        score_pct: 80,
        graded_at: "2026-10-01T10:00:00Z",
        submitted_at: "2026-10-01T09:00:00Z",
      },
    ],
    attempts: [],
  },
  programme: {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: [
      {
        topicId: "t1",
        title: "Topic t1",
        startWeek: "2026-09-07",
        endWeek: "2026-11-30",
        weeks: 13,
      },
      {
        topicId: "t2",
        title: "Topic t2",
        startWeek: "2026-12-07",
        endWeek: "2027-05-31",
        weeks: 26,
      },
    ],
  },
  profile: { level: "gcse", exam_year: 2027 },
  boards: ["aqa"],
  pauses: [
    {
      id: "old",
      reason: "payment",
      started_at: "2026-09-01T00:00:00Z",
      ended_at: "2026-09-03T00:00:00Z",
      programme_resumed_at: "2026-09-03T00:00:00Z",
    },
  ],
  breaks: [
    {
      id: "b1",
      starts_on: "2026-12-21",
      ends_on: "2027-01-03",
      reason: "holiday",
      recorded_at: null,
    },
  ],
  overrides: [
    {
      id: "o1",
      spec_point_id: "p2",
      kind: "skip",
      week_start: null,
      note: null,
      created_by: "tutor",
      created_at: "2026-10-01T00:00:00Z",
    },
  ],
  ledger: [
    {
      week_start: "2026-10-05",
      student_weekly_plan_points: [{ spec_point_id: "p1", done_at: "2026-10-06" }],
    },
    {
      week_start: "2026-10-19",
      student_weekly_plan_points: [{ spec_point_id: "p2", done_at: null }],
    },
  ],
  week: {
    plan: {
      id: "plan",
      subject: "biology",
      board: "aqa",
      level: "gcse",
      week_start: WEEK,
      source: "ai",
      note: null,
      ai_rationale: null,
    },
    points: [weekPoint("p1", "t1", "focus"), weekPoint("p3", "t2", "core")],
  },
  scheduler_version: 5,
});

let network: { mockRestore: () => void; mock: { calls: unknown[] } };
beforeEach(() => {
  setSystemTime(NOW);
  // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
  network = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    throw new Error(`Unexpected request: ${String(input)}`);
  }) as unknown as typeof fetch);
});
afterEach(() => {
  network.mockRestore();
  setSystemTime();
});

test("one answer is the whole course: nothing more is read", async () => {
  const state = await courseStateFrom(rows(), course, WEEK, NOW);
  expect(network.mock.calls).toEqual([]);

  expect(state.progress.map((t) => [t.topicId, t.points.map((p) => [p.id, p.reps])])).toEqual([
    [
      "t1",
      [
        ["p1", 1],
        ["p2", 0],
      ],
    ],
    ["t2", [["p3", 0]]],
  ]);
  expect(state.baseline?.exam_date).toBe("2027-06-07");
  expect(state.examYear).toBe(2027);
  expect(state.pause).toBeNull();
  expect(state.pauses.map((p) => [p.id, p.programmeResumedAt])).toEqual([
    ["old", "2026-09-03T00:00:00Z"],
  ]);
  expect(state.breaks).toEqual([
    { id: "b1", startsOn: "2026-12-21", endsOn: "2027-01-03", reason: "holiday", recordedAt: null },
  ]);
  expect(state.overrides.map((o) => [o.specPointId, o.kind])).toEqual([["p2", "skip"]]);
  // Done anywhere counts; undone counts as owed only in a later week.
  expect([...state.ledger.done]).toEqual(["p1"]);
  expect([...state.ledger.outstanding]).toEqual(["p2"]);

  // The week is split as getPlan splits it: the review stands on p1's mark,
  // and topic 2 is not taught until December.
  expect(state.week?.points.map((p) => p.spec_point_id)).toEqual(["p1"]);
  expect(state.week?.withheld.map((w) => [w.point.spec_point_id, w.reason])).toEqual([
    ["p3", "ahead-of-spine"],
  ]);
  expect([...(state.facts.evidenced ?? [])]).toEqual(["p1"]);
  expect(state.facts.topics?.get("p3")).toEqual({
    topicId: "t2",
    subject: "biology",
    board: "aqa",
    level: "gcse",
  });
  expect(state.facts.schedulerVersion).toBe(5);
});

test("the stop in force is the one with no end", async () => {
  const answer = rows();
  answer.pauses.push({
    id: "now",
    reason: "paused",
    started_at: "2026-10-13T00:00:00Z",
    ended_at: null,
    programme_resumed_at: null,
  });
  const state = await courseStateFrom(answer, course, WEEK, NOW);
  expect(state.pause).toEqual({ reason: "paused", startedAt: "2026-10-13T00:00:00Z" });
});

test("a week saved for another course judges its reviews on that course's evidence", async () => {
  const answer = rows();
  answer.week!.plan.board = "edexcel";
  answer.week!.points = [weekPoint("x1", "e1", "focus", { board: "edexcel" })];
  answer.boards = ["aqa", "edexcel"];
  const evidence = spyOn(ScheduleDAL, "getTopicProgress").mockResolvedValue([]);
  try {
    const state = await courseStateFrom(answer, course, WEEK, NOW);
    expect(evidence.mock.calls.map(([c]) => c.board)).toEqual(["edexcel"]);
    expect(state.week?.withheld.map((w) => w.reason)).toEqual(["no-evidence"]);
  } finally {
    evidence.mockRestore();
  }
});
