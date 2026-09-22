import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { ProgramDAL } from "./programDal";
import { ScheduleDAL, type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { WeeklyPlanDAL, type PlanPoint, type PlanPointOrigin } from "./weeklyPlanDal";
import { WeeklyActivityDAL } from "./weeklyActivityDal";
import { computePacing, type PacingBand } from "./pacing";
import { reorderTopics } from "./topicOrder";
import { weekKeyToDate } from "./week";
import * as session from "../auth/session";

/**
 * Pins what `ProgramDAL.loadRoadmap` does today.
 *
 * Every other test replaces `loadRoadmap` with a stub, so nothing ran the real
 * thing. These are characterisation tests: they do not say the answers are
 * right, only that a change to them is a change someone meant to make. Each one
 * snapshots the roadmap *and* the ordered log of reads and writes, because the
 * order and arguments of the I/O are behaviour too.
 */

// A Wednesday, so "this Monday" is 2026-09-21 and the exam year is 2027.
const NOW = new Date("2026-09-23T10:00:00Z");
const THIS_MONDAY = "2026-09-21";
const course = { subject: "biology", board: "aqa", level: "gcse" } as const;

const point = (id: string, values: Partial<ProgressPoint> = {}): ProgressPoint => ({
  id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
  confidence: null,
  homeworkScore: null,
  quizScore: null,
  status: "new",
  mastery: 0,
  stability: null,
  weight: 1,
  card: null,
  dueAt: null,
  eligibleAt: null,
  lastReviewedAt: null,
  reps: 0,
  retention: null,
  assessability: "unassessable",
  ...values,
});

/** A point with graded evidence behind it, which is what makes a review candidate. */
const reviewed = (id: string, lastReviewedAt: string, dueAt: string, weight = 1) =>
  point(id, {
    reps: 2,
    weight,
    status: "learning",
    lastReviewedAt,
    eligibleAt: dueAt,
    dueAt,
    retention: 0.8,
    assessability: "assessed",
  });

const topic = (topicId: string, points: ProgressPoint[], settled = false): TopicProgress => ({
  topicId,
  title: `Topic ${topicId}`,
  points,
  masteryPct: 0,
  settled,
  practisedCount: points.filter((p) => p.reps > 0).length,
  assessment: { total: points.length, assessable: 0, assessed: 0, state: "unassessable" },
});

const progress: TopicProgress[] = [
  topic(
    "t1",
    [
      reviewed("a1", "2026-09-01T09:00:00Z", "2026-09-15T09:00:00Z"),
      reviewed("a2", "2026-09-22T09:00:00Z", "2026-10-06T09:00:00Z", 2),
      point("a3"),
    ],
    true,
  ),
  topic("t2", [reviewed("b1", "2026-09-10T09:00:00Z", "2026-09-28T09:00:00Z"), point("b2")]),
  topic("t3", [point("c1", { weight: 3 }), point("c2")]),
];

const pacingInputs = progress.map((t) => ({
  topicId: t.topicId,
  title: t.title,
  weight: t.points.reduce((sum, p) => sum + p.weight, 0) || 1,
}));
const orderTopics = progress.map((t) => ({
  topicId: t.topicId,
  title: t.title,
  points: t.points.map((p) => ({
    specPointId: p.id,
    code: p.code,
    title: p.title,
    weight: p.weight,
  })),
}));

/** The spine exactly as a first visit on `start` would have seeded it. */
const seeded = (start: string, examDate: string): PacingBand[] =>
  computePacing(pacingInputs, weekKeyToDate(start), weekKeyToDate(examDate));

const planPoint = (
  id: string,
  topicId: string,
  origin: PlanPointOrigin,
  done_at: string | null = null,
): PlanPoint => ({
  spec_point_id: id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
  description: null,
  topic_id: topicId,
  topic_title: `Topic ${topicId}`,
  origin,
  carried_from: null,
  done_at,
});

type SavedWeek = NonNullable<Awaited<ReturnType<typeof WeeklyPlanDAL.getPlan>>>;
const savedWeek = (points: PlanPoint[], withheld: SavedWeek["withheld"] = []): SavedWeek => ({
  plan: {
    id: "plan",
    ...course,
    week_start: THIS_MONDAY,
    source: "ai",
    note: null,
    ai_rationale: null,
  },
  points,
  withheld,
});

let io: unknown[];
let baseline: Record<string, unknown> | null;
let baselineFails: boolean;
let spies: { mockRestore: () => void }[];

function arrange(world: {
  progress?: TopicProgress[];
  saved?: SavedWeek | null;
  ledger?: { done: string[]; outstanding: string[] };
  viewer?: string;
  /** Rows of `student_plan_overrides`, as the API would return them. */
  overrides?: Record<string, unknown>[];
}) {
  spies = [
    spyOn(ScheduleDAL, "getTopicProgress").mockImplementation(async (args) => {
      io.push(["getTopicProgress", args]);
      return world.progress ?? progress;
    }),
    spyOn(WeeklyPlanDAL, "getPlan").mockImplementation(async (...args) => {
      io.push(["getPlan", args]);
      return world.saved ?? null;
    }),
    spyOn(WeeklyActivityDAL, "getDeliveryLedger").mockImplementation(async (...args) => {
      io.push(["getDeliveryLedger", args]);
      return {
        done: new Set(world.ledger?.done ?? []),
        outstanding: new Set(world.ledger?.outstanding ?? []),
      };
    }),
    spyOn(session, "getSessionUserId").mockImplementation(async () => {
      io.push(["getSessionUserId"]);
      return world.viewer ?? "student";
    }),
    spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const table = url.pathname.split("/").at(-1)!;
      const method = init?.method ?? "GET";
      io.push([
        "db",
        method,
        table,
        method === "GET" ? url.search : JSON.parse(String(init?.body ?? "null")),
      ]);
      // The tutor's overrides are read alongside the baseline; these worlds have none.
      if (table === "student_plan_overrides" && method === "GET")
        return new Response(JSON.stringify(world.overrides ?? []), {
          headers: { "Content-Type": "application/json" },
        });
      if (table !== "student_program_plan") throw new Error(`Unexpected request: ${url.pathname}`);
      if (method === "GET") {
        if (baselineFails)
          return new Response(JSON.stringify({ message: "permission denied", code: "42501" }), {
            status: 403,
          });
        return new Response(JSON.stringify(baseline ? [baseline] : []), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 201 });
    }),
  ];
}

beforeEach(() => {
  setSystemTime(NOW);
  io = [];
  baseline = null;
  baselineFails = false;
  spies = [];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  setSystemTime();
});

const load = (extra: { projectOnly?: boolean; progress?: TopicProgress[] } = {}) =>
  ProgramDAL.loadRoadmap({ studentId: "student", ...course, ...extra });

test("no curriculum: answers null and reads nothing else", async () => {
  arrange({ progress: [] });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("first view by the student: seeds the baseline", async () => {
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("first view by someone else: answers the same but leaves no mark", async () => {
  arrange({ viewer: "tutor" });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("acknowledged baseline, nothing saved this week", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({ ledger: { done: ["a3"], outstanding: ["b2"] } });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("saved week: owns its reviews, reports withheld points, narrows the backlog", async () => {
  baseline = {
    program_start: "2026-06-01",
    exam_date: "2027-06-07",
    pacing: seeded("2026-06-01", "2027-06-07"),
  };
  arrange({
    saved: savedWeek(
      [
        planPoint("a1", "t1", "focus"),
        planPoint("b1", "t2", "focus", "2026-09-22"),
        planPoint("a3", "t1", "core"),
        planPoint("c2", "t3", "tutor"),
      ],
      [{ point: planPoint("c1", "t3", "focus"), reason: "ahead-of-spine" }],
    ),
    ledger: { done: [], outstanding: ["a3"] },
  });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("projectOnly: skips the saved-week read but still reserves its catch-up", async () => {
  baseline = {
    program_start: "2026-06-01",
    exam_date: "2027-06-07",
    pacing: seeded("2026-06-01", "2027-06-07"),
  };
  arrange({
    saved: savedWeek([planPoint("a3", "t1", "core"), planPoint("a1", "t1", "focus")]),
  });
  expect({ result: await load({ projectOnly: true }), io }).toMatchSnapshot();
});

test("exam date moved: proposes changes and asks for acknowledgement", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-05-10",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

const customOrder = (examDate: string) =>
  reorderTopics({
    bands: seeded("2026-09-07", "2027-06-07"),
    topics: orderTopics,
    order: ["t3", "t2"],
    from: "2026-10-05",
    examDate,
    today: THIS_MONDAY,
  });

test("custom topic order is kept as stored", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: customOrder("2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("custom topic order is re-spread when the exam date has moved", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-05-10",
    pacing: customOrder("2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("caller-supplied progress is used instead of reading it", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({});
  expect({ result: await load({ progress: progress.slice(0, 2) }), io }).toMatchSnapshot();
});

test("a failed baseline read throws rather than posing as a first view", async () => {
  baselineFails = true;
  arrange({});
  await expect(load()).rejects.toMatchObject({ code: "42501" });
  expect(io).toMatchSnapshot();
});
