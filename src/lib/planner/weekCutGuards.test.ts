import { describe, expect, spyOn, test } from "bun:test";
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
  test("a first cut never holds more than the cap: catch-up waits, teaching stays", () => {
    const week = spine[1].startWeek;
    const owed = Array.from({ length: MAX_WEEK_POINTS + 20 }, (_, i) => ({
      specPointId: `owed${i}`,
      topicId: "t1",
      topicTitle: "Topic t1",
      code: `O${i}`,
      title: `Owed ${i}`,
      weight: 1,
      plannedWeek: spine[0].startWeek,
    }));
    const roadmap = roadmapFor();
    const cut = selectWeek(
      { ...roadmap, backlog: owed, catchUpSchedule: { weeks: { [week]: owed }, held: [] } },
      week,
    );
    expect(cut.specPointIds).toHaveLength(MAX_WEEK_POINTS);
    expect(cut.specPointIds).toContain("b1");
    expect(cut.rationale).toContain("more missed points are queued");
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

describe("buildRoadmap after the exam date moves on a curriculum-order spine", () => {
  // Topic t1 ran 7–21 Sep and the student did both its points.
  const doneT1 = { ...ledger, done: new Set(["a1", "a2"]) };
  // The date is saved, the re-flowed spine is accepted (applyPending), and the
  // planner is opened again on it.
  const movedAndAccepted = (examDate: string) => {
    const at = {
      examMonday: weekKeyToDate(examDate),
      thisMonday: weekKeyToDate("2026-09-28"),
      ledger: doneT1,
    };
    const proposed = roadmapFor({
      ...at,
      baseline: { program_start: "2026-09-07", exam_date: examDate, pacing: spine },
    });
    expect(proposed.needsAck).toBe(true);
    const accepted = proposed.bands.filter((b) => !b.kind || b.kind === "teach");
    return roadmapFor({
      ...at,
      baseline: { program_start: "2026-09-07", exam_date: examDate, pacing: accepted },
    });
  };
  test("an earlier exam doesn't turn weeks already gone into missed work", () => {
    const result = movedAndAccepted("2026-10-12");
    expect(result.needsAck).toBe(false);
    expect(result.backlog).toEqual([]);
    expect(selectWeek(result, "2026-09-28").specPointIds.some((id) => id.startsWith("b"))).toBe(
      true,
    );
  });
  test("a later exam doesn't hand back a week of points already covered", () => {
    const result = movedAndAccepted("2026-12-07");
    expect(result.backlog).toEqual([]);
    expect(selectWeek(result, "2026-09-28").specPointIds.length).toBeGreaterThan(0);
  });
  test("a date the plan can't follow, then put back, leaves nothing owed", () => {
    const at = { thisMonday: weekKeyToDate("2026-09-28"), ledger: doneT1 };
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A week away: t2 and t3 can't be spread over one week. Re-dealt from
      // the programme start instead, every topic was crammed into weeks
      // already gone, and accepting that made those weeks promises.
      const tooSoon = roadmapFor({
        ...at,
        examMonday: weekKeyToDate("2026-10-05"),
        baseline: { program_start: "2026-09-07", exam_date: "2026-10-05", pacing: spine },
      });
      expect(tooSoon.needsAck).toBe(false);
      const kept = tooSoon.needsAck
        ? tooSoon.bands.filter((b) => !b.kind || b.kind === "teach")
        : spine;
      // The date goes back to 9 Nov.
      const back = roadmapFor({
        ...at,
        baseline: { program_start: "2026-09-07", exam_date: "2026-11-09", pacing: kept },
      });
      expect(back.needsAck).toBe(false);
      expect(back.backlog).toEqual([]);
    } finally {
      warn.mockRestore();
    }
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
