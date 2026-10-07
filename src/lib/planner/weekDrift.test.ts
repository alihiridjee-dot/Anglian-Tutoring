import { describe, expect, test } from "bun:test";
import { mergeWeek, selectWeek, unsupportedReviews, weekDrift } from "./weekCut";
import { buildRoadmap } from "./roadmap";
import type { PacingBand } from "./pacing";
import { addWeeks, toDateKey, weekKeyToDate } from "./week";
import type { PlanOverride } from "./overrides";
import type { ProgressPoint, TopicProgress } from "./scheduleDal";
import type { PlanPoint } from "./weeklyPlanDal";

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
const topic = (topicId: string, points: ProgressPoint[]): TopicProgress => ({
  topicId,
  title: `Topic ${topicId}`,
  points,
  masteryPct: 0,
  settled: false,
  practisedCount: 0,
  assessment: {
    total: points.length,
    assessable: 0,
    assessed: 0,
    state: "unassessable",
    masteryPct: null,
    coveragePct: 0,
  },
});

const LAST_WEEK = "2026-09-28";
const THIS_WEEK = "2026-10-05";
const EXAM = "2027-06-07";
const weekAfter = (key: string, n: number) => toDateKey(addWeeks(weekKeyToDate(key), n));
const band = (topicId: string, startWeek: string, weeks: number): PacingBand => ({
  topicId,
  title: `Topic ${topicId}`,
  kind: "teach",
  startWeek,
  endWeek: weekAfter(startWeek, weeks - 1),
  weeks,
});

const t1 = ["a1", "a2", "a3", "a4", "a5", "a6"];
const progressWith = (values: Record<string, Partial<ProgressPoint>> = {}) => [
  topic(
    "t1",
    t1.map((id) => point(id, values[id])),
  ),
  topic("t2", [point("b1", values.b1), point("b2", values.b2)]),
];

// The exam date as it was: topic 1 taught in this one week.
const tight = [band("t1", THIS_WEEK, 1), band("t2", weekAfter(THIS_WEEK, 1), 1)];
// The new, later date: topic 1 spread over three weeks, two points each.
const stretched = [band("t1", THIS_WEEK, 3), band("t2", weekAfter(THIS_WEEK, 3), 2)];

const roadmapFor = (
  pacing: PacingBand[],
  over: {
    progress?: TopicProgress[];
    done?: string[];
    overrides?: PlanOverride[];
    programStart?: string;
  } = {},
) =>
  buildRoadmap({
    progress: over.progress ?? progressWith(),
    baseline: { program_start: over.programStart ?? THIS_WEEK, exam_date: EXAM, pacing },
    savedWeek: null,
    catchUpWeek: null,
    ledger: { done: new Set(over.done ?? []), outstanding: new Set() },
    thisMonday: weekKeyToDate(THIS_WEEK),
    examMonday: weekKeyToDate(EXAM),
    overrides: over.overrides,
  });

const planPoint = (id: string, values: Partial<PlanPoint> = {}): PlanPoint => ({
  spec_point_id: id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
  description: null,
  topic_id: id.startsWith("a") ? "t1" : "t2",
  topic_title: null,
  origin: "core",
  carried_from: null,
  done_at: null,
  ...values,
});
/** The week as saved by cutting it from `pacing`, every point untouched. */
const savedFrom = (pacing: PacingBand[]) => {
  const cut = selectWeek(roadmapFor(pacing), THIS_WEEK);
  return {
    points: cut.specPointIds.map((id) => planPoint(id, { origin: cut.origins[id] })),
    withheld: [],
  };
};

describe("weekDrift", () => {
  test("a week saved before the exam date moved names the points the plan now teaches later", () => {
    // Ali's Biology, 7 Oct: the full plan spread topic 1 over three weeks and
    // the dashboard still listed all of it.
    expect(savedFrom(tight).points.map((p) => p.spec_point_id)).toEqual(t1);
    expect(weekDrift(savedFrom(tight), roadmapFor(stretched), THIS_WEEK)).toEqual({
      missing: [],
      stale: ["a3", "a4", "a5", "a6"],
    });
  });

  test("an earlier exam date names the teaching the week now lacks", () => {
    expect(weekDrift(savedFrom(stretched), roadmapFor(tight), THIS_WEEK)).toEqual({
      missing: ["a3", "a4", "a5", "a6"],
      stale: [],
    });
  });

  test("a week cut from the plan it is checked against is in step", () => {
    expect(weekDrift(savedFrom(stretched), roadmapFor(stretched), THIS_WEEK)).toBeNull();
    expect(weekDrift(savedFrom(tight), roadmapFor(tight), THIS_WEEK)).toBeNull();
  });

  test("the usual re-cut brings the week back in step, so a heal never repeats itself", () => {
    const existing = savedFrom(tight);
    const roadmap = roadmapFor(stretched);
    const merged = mergeWeek({
      existing,
      fresh: selectWeek(roadmap, THIS_WEEK),
      coverage: new Map(),
      roadmap,
      repair: unsupportedReviews(existing, roadmap),
    })!;
    expect(merged.specPointIds).toEqual(["a1", "a2"]);
    const healed = {
      points: merged.specPointIds.map((id) => planPoint(id, { origin: merged.origins[id] })),
      withheld: [],
    };
    expect(weekDrift(healed, roadmap, THIS_WEEK)).toBeNull();
  });

  test("work the student or a person touched is never stale", () => {
    const touched = {
      points: [
        planPoint("a1"),
        planPoint("a2"),
        planPoint("a3", { done_at: "2026-10-06T10:00:00Z" }),
        planPoint("a4", { carried_from: LAST_WEEK }),
        planPoint("a5", { origin: "student" }),
        planPoint("a6", { origin: "tutor" }),
        planPoint("b1"),
        planPoint("b2"),
      ],
      withheld: [],
    };
    // b1 was practised (an assessed card) and b2 ticked off in another week.
    const roadmap = roadmapFor(stretched, {
      progress: progressWith({ b1: { reps: 1 } }),
      done: ["b2"],
    });
    expect(weekDrift(touched, roadmap, THIS_WEEK)).toBeNull();
  });

  test("reviews and catch-up are not the plan's teaching, so they never count", () => {
    // Topic 1 was last week's and none of it was done: a1 is owed, back as
    // catch-up. a2 sits in the week as a review the plan would not set now.
    const roadmap = roadmapFor([band("t1", LAST_WEEK, 1), band("t2", THIS_WEEK, 1)], {
      programStart: LAST_WEEK,
    });
    const week = {
      points: [
        planPoint("a1"),
        planPoint("a2", { origin: "focus" }),
        planPoint("b1"),
        planPoint("b2"),
      ],
      withheld: [],
    };
    expect(weekDrift(week, roadmap, THIS_WEEK)).toBeNull();
    // Without this week's teaching, the drift names only that.
    const short = { points: week.points.slice(0, 2), withheld: [] };
    expect(weekDrift(short, roadmap, THIS_WEEK)).toEqual({ missing: ["b1", "b2"], stale: [] });
    // Catch-up the week hasn't been topped up with yet is the top-up's job
    // (ensureCatchUp), not a reason to re-cut the week.
    const owed = selectWeek(roadmap, THIS_WEEK).specPointIds.filter((id) => id.startsWith("a"));
    expect(owed.length).toBeGreaterThan(0);
    const teachingOnly = { points: [planPoint("b1"), planPoint("b2")], withheld: [] };
    expect(weekDrift(teachingOnly, roadmap, THIS_WEEK)).toBeNull();
  });

  test("a point the tutor took out of this week or skipped is not missing", () => {
    const override = (specPointId: string, kind: "remove" | "skip"): PlanOverride => ({
      id: `${kind}-${specPointId}`,
      specPointId,
      kind,
      weekStart: kind === "remove" ? THIS_WEEK : null,
      note: null,
      createdBy: null,
      createdAt: "2026-10-05T09:00:00Z",
    });
    const week = { points: [planPoint("a1"), planPoint("a2")], withheld: [] };
    const roadmap = roadmapFor(tight, {
      overrides: [
        override("a3", "remove"),
        override("a4", "skip"),
        override("a5", "remove"),
        override("a6", "skip"),
      ],
    });
    expect(weekDrift(week, roadmap, THIS_WEEK)).toBeNull();
  });

  test("a point the week holds but withholds is held, not missing", () => {
    const week = {
      points: [planPoint("a1"), planPoint("a2")],
      withheld: ["a3", "a4", "a5", "a6"].map((id) => ({
        point: planPoint(id),
        reason: "ahead-of-spine" as const,
      })),
    };
    expect(weekDrift(week, roadmapFor(tight), THIS_WEEK)).toBeNull();
  });

  test("nothing is compared at or after the exam, or without a plan", () => {
    expect(weekDrift(savedFrom(tight), roadmapFor(stretched), EXAM)).toBeNull();
    expect(weekDrift(savedFrom(tight), null, THIS_WEEK)).toBeNull();
  });
});
