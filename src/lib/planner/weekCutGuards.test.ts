import { describe, expect, test } from "bun:test";
import { MAX_WEEK_POINTS, mergeWeek, selectWeek, unsupportedReviews } from "./weekCut";
import { buildRoadmap, type RoadmapResult } from "./roadmap";
import { computePacing, withWeeklyPoints } from "./pacing";
import { reorderTopics } from "./topicOrder";
import { weekKeyToDate } from "./week";
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
const progress = [
  topic("t1", [point("a1"), point("a2")]),
  topic("t2", [point("b1"), point("b2")]),
  topic("t3", [point("c1"), point("c2")]),
];
const inputs = progress.map((t) => ({ topicId: t.topicId, title: t.title, weight: 2 }));
const start = weekKeyToDate("2026-09-07");
const exam = weekKeyToDate("2026-11-09");
const spine = withWeeklyPoints(
  computePacing(inputs, start, exam),
  new Map(
    progress.map((t) => [
      t.topicId,
      t.points.map((p) => ({ specPointId: p.id, code: p.code, title: p.title })),
    ]),
  ),
);
const ledger = { done: new Set<string>(), outstanding: new Set<string>() };
const roadmapFor = (over: Partial<Parameters<typeof buildRoadmap>[0]> = {}) =>
  buildRoadmap({
    progress,
    baseline: { program_start: "2026-09-07", exam_date: "2026-11-09", pacing: spine },
    savedWeek: null,
    catchUpWeek: null,
    ledger,
    thisMonday: weekKeyToDate("2026-09-07"),
    examMonday: exam,
    ...over,
  });

describe("selectWeek", () => {
  test("a point the student ticked off is not taught again when its spine week arrives", () => {
    const week = spine[0].startWeek;
    const before = selectWeek(roadmapFor(), week);
    expect(before.specPointIds).toContain("a1");
    const after = selectWeek(roadmapFor({ ledger: { ...ledger, done: new Set(["a1"]) } }), week);
    expect(after.specPointIds).not.toContain("a1");
  });
  test("a week with nothing outstanding says so instead of saving a blank reason", () => {
    const week = spine[0].startWeek;
    const cut = selectWeek(
      roadmapFor({ ledger: { ...ledger, done: new Set(["a1", "a2"]) } }),
      week,
    );
    expect(cut.specPointIds).toEqual([]);
    expect(cut.rationale.length).toBeGreaterThan(0);
  });
});

describe("mergeWeek", () => {
  const saved = (id: string, origin: PlanPoint["origin"]): PlanPoint => ({
    spec_point_id: id,
    code: id,
    title: id,
    description: null,
    topic_id: "t1",
    topic_title: null,
    origin,
    carried_from: null,
    done_at: null,
  });
  test("a re-cut never writes more than the cap, and sheds fresh automatic points first", () => {
    const pinned = Array.from({ length: 5 }, (_, i) => saved(`pin${i}`, "tutor"));
    const fresh = Array.from({ length: MAX_WEEK_POINTS }, (_, i) => `auto${i}`);
    const existing = { points: pinned, withheld: [] };
    const merged = mergeWeek({
      existing,
      fresh: {
        specPointIds: fresh,
        origins: Object.fromEntries(fresh.map((id) => [id, "core" as const])),
        rationale: "",
      },
      coverage: new Map(),
      roadmap: null,
      repair: unsupportedReviews(existing, null),
    })!;
    expect(merged.specPointIds).toHaveLength(MAX_WEEK_POINTS);
    for (const p of pinned) expect(merged.specPointIds).toContain(p.spec_point_id);
  });
});

describe("buildRoadmap with a custom order the new exam date cannot hold", () => {
  test("keeps the stored spine instead of throwing the whole planner away", () => {
    const custom = reorderTopics({
      bands: spine,
      topics: progress.map((t) => ({
        topicId: t.topicId,
        title: t.title,
        points: t.points.map((p) => ({ specPointId: p.id, code: p.code, title: p.title })),
      })),
      order: ["t3", "t2", "t1"],
      from: "2026-09-07",
      examDate: "2026-11-09",
      today: "2026-09-07",
    });
    // The exam moved to a fortnight away: three topics cannot be re-spread over two weeks.
    let result: RoadmapResult | null = null;
    expect(() => {
      result = roadmapFor({
        baseline: { program_start: "2026-09-07", exam_date: "2026-09-21", pacing: custom },
        examMonday: weekKeyToDate("2026-09-21"),
      });
    }).not.toThrow();
    expect(result!.baselineBands.map((b) => b.topicId)).toEqual(custom.map((b) => b.topicId));
  });
});
