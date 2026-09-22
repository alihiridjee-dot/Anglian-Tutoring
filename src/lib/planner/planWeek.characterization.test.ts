import { afterEach, beforeEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { ProgramDAL } from "./programDal";
import { buildRoadmap, type RoadmapResult } from "./roadmap";
import { type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { WeeklyPlanDAL, type PlanPoint, type PlanPointOrigin } from "./weeklyPlanDal";
import { WeeklyActivityDAL } from "./weeklyActivityDal";
import { computePacing } from "./pacing";
import { type PointCoverage } from "./coverage";
import { type RejectionReason } from "./admissibility";
import { reorderTopics } from "./topicOrder";
import { weekKeyToDate } from "./week";

/**
 * Pins what `ProgramDAL.planForWeek` and `ProgramDAL.refreshWeek` do today.
 *
 * `planForWeek` decides which spec points go into a student's week, and
 * `refreshWeek` decides which of a saved week's points survive a re-cut. The
 * existing tests stub `planForWeek` whenever they exercise `refreshWeek`, so the
 * two had never run together. Here only the database edges are faked, and the
 * roadmaps are real ones from `buildRoadmap`.
 *
 * Characterisation, not specification: a change to a snapshot should be a change
 * someone meant to make.
 */

// A Wednesday, so "this Monday" is 2026-09-21 and the exam year is 2027.
const NOW = new Date("2026-09-23T10:00:00Z");
const THIS_MONDAY = "2026-09-21";
const EXAM = "2027-06-07";
const course = { subject: "biology", board: "aqa", level: "gcse" } as const;
const student = { studentId: "student", ...course };

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
  topic("t1", [
    reviewed("a1", "2026-09-01T09:00:00Z", "2026-09-15T09:00:00Z"),
    reviewed("a2", "2026-09-08T09:00:00Z", "2026-09-21T09:00:00Z", 2),
    point("a3"),
    point("a4", { weight: 2 }),
  ]),
  topic("t2", [
    reviewed("b1", "2026-09-10T09:00:00Z", "2026-10-12T09:00:00Z"),
    point("b2"),
    point("b3"),
  ]),
  topic("t3", [point("c1", { weight: 3 }), point("c2"), point("c3")]),
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

/** A real roadmap, built by the engine from a baseline seeded on `start`. */
function roadmapFrom(start: string, options: { done?: string[]; custom?: boolean } = {}) {
  const seeded = computePacing(pacingInputs, weekKeyToDate(start), weekKeyToDate(EXAM));
  const pacing = options.custom
    ? reorderTopics({
        bands: seeded,
        topics: orderTopics,
        order: ["t3", "t2"],
        from: "2026-10-05",
        examDate: EXAM,
        today: THIS_MONDAY,
      })
    : seeded;
  return buildRoadmap({
    progress,
    baseline: { program_start: start, exam_date: EXAM, pacing },
    savedWeek: null,
    catchUpWeek: null,
    ledger: { done: new Set(options.done ?? []), outstanding: new Set() },
    thisMonday: weekKeyToDate(THIS_MONDAY),
    examMonday: weekKeyToDate(EXAM),
  });
}

beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

describe("planForWeek", () => {
  const plan = (weekStart: string, roadmap: RoadmapResult | null) =>
    ProgramDAL.planForWeek({ ...student, weekStart, roadmap });

  test("no curriculum: an empty week", async () => {
    expect(await plan(THIS_MONDAY, null)).toMatchSnapshot();
  });

  test("the exam week and after: an empty week", async () => {
    const roadmap = roadmapFrom("2026-09-07");
    expect([await plan(EXAM, roadmap), await plan("2027-06-14", roadmap)]).toMatchSnapshot();
  });

  test("an ordinary week: this week's teaching plus the reviews that are due", async () => {
    expect(await plan(THIS_MONDAY, roadmapFrom("2026-09-07"))).toMatchSnapshot();
  });

  test("a programme that began months ago: catch-up is trickled in and the rest is named", async () => {
    expect(await plan(THIS_MONDAY, roadmapFrom("2026-06-01"))).toMatchSnapshot();
  });

  test("delivered work is not chased again", async () => {
    const roadmap = roadmapFrom("2026-06-01", { done: ["a3", "a4", "b2"] });
    expect(await plan(THIS_MONDAY, roadmap)).toMatchSnapshot();
  });

  test("next week: its own review and catch-up slice; a teaching week months on: teaching alone", async () => {
    const roadmap = roadmapFrom("2026-06-01");
    expect([
      await plan("2026-09-28", roadmap),
      await plan("2026-11-16", roadmap),
    ]).toMatchSnapshot();
  });

  test("a week the spine leaves empty stays empty", async () => {
    expect(await plan("2026-10-05", roadmapFrom("2026-06-01"))).toMatchSnapshot();
  });

  test("a handed-in roadmap with no catch-up schedule falls back to the trickle", async () => {
    const { catchUpSchedule: _omitted, ...partial } = roadmapFrom("2026-06-01");
    expect(await plan(THIS_MONDAY, partial as RoadmapResult)).toMatchSnapshot();
  });

  test("a custom topic order: a completed point's week vs an untouched point's week", async () => {
    const roadmap = roadmapFrom("2026-09-07", { custom: true, done: ["c1"] });
    expect([
      await plan("2026-10-05", roadmap),
      await plan("2026-10-12", roadmap),
    ]).toMatchSnapshot();
  });

  test("with no roadmap handed in, it loads one for projection only", async () => {
    const load = spyOn(ProgramDAL, "loadRoadmap").mockResolvedValue(roadmapFrom("2026-09-07"));
    try {
      const { roadmap: _none, ...params } = { ...student, weekStart: THIS_MONDAY, roadmap: null };
      const result = await ProgramDAL.planForWeek(params);
      expect({ result, loadedWith: load.mock.calls }).toMatchSnapshot();
    } finally {
      load.mockRestore();
    }
  });
});

describe("refreshWeek", () => {
  const planPoint = (
    id: string,
    topicId: string,
    origin: PlanPointOrigin,
    extra: Partial<PlanPoint> = {},
  ): PlanPoint => ({
    spec_point_id: id,
    code: id.toUpperCase(),
    title: `Point ${id}`,
    description: null,
    topic_id: topicId,
    topic_title: `Topic ${topicId}`,
    origin,
    carried_from: null,
    done_at: null,
    ...extra,
  });

  type SavedWeek = NonNullable<Awaited<ReturnType<typeof WeeklyPlanDAL.getPlan>>>;
  const saved = (
    points: PlanPoint[],
    withheld: { point: PlanPoint; reason: RejectionReason }[] = [],
  ): SavedWeek => ({
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
  let spies: { mockRestore: () => void }[];

  function arrange(world: { saved: SavedWeek | null; attempted?: string[] }) {
    io = [];
    spies = [
      spyOn(WeeklyPlanDAL, "getPlan").mockImplementation(async (...args) => {
        io.push(["getPlan", args]);
        return world.saved;
      }),
      spyOn(WeeklyActivityDAL, "getCoverage").mockImplementation(async (...args) => {
        io.push(["getCoverage", args]);
        return new Map(
          (world.attempted ?? []).map((id) => [id, { attempted: true } as PointCoverage]),
        );
      }),
      spyOn(WeeklyPlanDAL, "savePlan").mockImplementation(async (args) => {
        io.push(["savePlan", args]);
        return "plan";
      }),
    ];
  }
  afterEach(() => {
    for (const s of spies ?? []) s.mockRestore();
  });

  const refresh = (extra: Partial<Parameters<typeof ProgramDAL.refreshWeek>[0]> = {}) =>
    ProgramDAL.refreshWeek({ ...student, weekStart: THIS_MONDAY, ...extra });

  test("nothing saved yet: leaves the week to the build path", async () => {
    arrange({ saved: null });
    expect({
      changed: await refresh({ roadmap: roadmapFrom("2026-09-07") }),
      io,
    }).toMatchSnapshot();
  });

  test("repairing with no curriculum: a saved week is not judged invalid", async () => {
    arrange({ saved: saved([planPoint("zz", "t1", "focus")]) });
    expect({
      changed: await refresh({ roadmap: null, repairUnsupportedReviews: true }),
      io,
    }).toMatchSnapshot();
  });

  test("repairing a week with nothing unsupported: no re-plan, no write", async () => {
    arrange({ saved: saved([planPoint("a1", "t1", "focus"), planPoint("a3", "t1", "core")]) });
    expect({
      changed: await refresh({
        roadmap: roadmapFrom("2026-09-07"),
        repairUnsupportedReviews: true,
      }),
      io,
    }).toMatchSnapshot();
  });

  test("a re-cut keeps what a person chose or the student touched, and drops stale automatic work", async () => {
    arrange({
      saved: saved([
        planPoint("zz-stale", "t3", "focus"),
        planPoint("c2", "t3", "tutor"),
        planPoint("c3", "t3", "student"),
        planPoint("b2", "t2", "core", { done_at: "2026-09-22" }),
        planPoint("b3", "t2", "core", { carried_from: "2026-09-14" }),
        planPoint("c1", "t3", "ai"),
      ]),
      attempted: ["c1"],
    });
    expect({
      changed: await refresh({ roadmap: roadmapFrom("2026-09-07") }),
      io,
    }).toMatchSnapshot();
  });

  test("a week that already matches the fresh cut is not rewritten", async () => {
    const roadmap = roadmapFrom("2026-09-07");
    const fresh = await ProgramDAL.planForWeek({ ...student, weekStart: THIS_MONDAY, roadmap });
    const topicOf = (id: string) =>
      progress.find((t) => t.points.some((p) => p.id === id))!.topicId;
    arrange({
      saved: saved(fresh.specPointIds.map((id) => planPoint(id, topicOf(id), fresh.origins[id]))),
    });
    expect({ changed: await refresh({ roadmap }), io }).toMatchSnapshot();
  });

  test("the same set is still rewritten when withheld rows need clearing", async () => {
    const roadmap = roadmapFrom("2026-09-07");
    const fresh = await ProgramDAL.planForWeek({ ...student, weekStart: THIS_MONDAY, roadmap });
    const topicOf = (id: string) =>
      progress.find((t) => t.points.some((p) => p.id === id))!.topicId;
    arrange({
      saved: saved(
        fresh.specPointIds.map((id) => planPoint(id, topicOf(id), fresh.origins[id])),
        [{ point: planPoint("c3", "t3", "focus"), reason: "ahead-of-spine" }],
      ),
    });
    expect({ changed: await refresh({ roadmap }), io }).toMatchSnapshot();
  });

  test("repair turns a quarantined no-evidence review into teaching, and leaves other withheld rows out", async () => {
    arrange({
      saved: saved(
        [planPoint("a3", "t1", "core")],
        [
          { point: planPoint("b2", "t2", "focus"), reason: "no-evidence" },
          { point: planPoint("c3", "t3", "focus"), reason: "ahead-of-spine" },
        ],
      ),
    });
    expect({
      changed: await refresh({
        roadmap: roadmapFrom("2026-09-07"),
        repairUnsupportedReviews: true,
      }),
      io,
    }).toMatchSnapshot();
  });

  test("a preview that no longer matches is refused before anything is written", async () => {
    arrange({ saved: saved([planPoint("c2", "t3", "tutor")]) });
    await expect(
      refresh({ roadmap: roadmapFrom("2026-09-07"), expectedPointIds: ["c2"] }),
    ).rejects.toThrow("Preview the updated week again");
    expect(io).toMatchSnapshot();
  });

  test("a preview that still matches is applied", async () => {
    const roadmap = roadmapFrom("2026-09-07");
    arrange({ saved: saved([planPoint("c2", "t3", "tutor")]) });
    const fresh = await ProgramDAL.planForWeek({ ...student, weekStart: THIS_MONDAY, roadmap });
    const expectedPointIds = [...new Set(["c2", ...fresh.specPointIds])];
    expect({ changed: await refresh({ roadmap, expectedPointIds }), io }).toMatchSnapshot();
  });

  test("with no roadmap handed in, it loads one for projection only", async () => {
    arrange({ saved: saved([planPoint("c2", "t3", "tutor")]) });
    const load = spyOn(ProgramDAL, "loadRoadmap").mockResolvedValue(roadmapFrom("2026-09-07"));
    spies.push(load);
    const changed = await refresh();
    expect({ changed, loadedWith: load.mock.calls, io }).toMatchSnapshot();
  });
});
