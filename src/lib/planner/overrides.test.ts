import { describe, expect, test } from "bun:test";
import {
  applyOverrides,
  blockedBy,
  indexOverrides,
  overridesForWeek,
  programmeMayAssign,
  type PlanOverride,
} from "./overrides";
import { projectReviews, type FocusCandidate } from "./pacing";
import { projectCatchUp, type BacklogPoint } from "./backlog";
import { selectWeek } from "./weekCut";
import { buildRoadmap, type RoadmapResult } from "./roadmap";
import { computePacing } from "./pacing";
import { weekKeyToDate } from "./week";
import type { ProgressPoint, TopicProgress } from "./scheduleDal";

const override = (
  specPointId: string,
  kind: PlanOverride["kind"],
  weekStart: string | null = null,
): PlanOverride => ({
  id: `${kind}:${specPointId}:${weekStart ?? "all"}`,
  specPointId,
  kind,
  weekStart,
  note: null,
  createdBy: "tutor",
  createdAt: "2026-09-22T10:00:00Z",
});

describe("the rule", () => {
  const index = indexOverrides([
    override("a", "remove", "2026-09-21"),
    override("b", "skip"),
    override("c", "remove", "2026-09-28"),
    override("c", "skip"),
  ]);

  test("a removal binds one week; a skip binds every week", () => {
    expect(programmeMayAssign(index, { specPointId: "a", origin: "core" }, "2026-09-21")).toBe(
      false,
    );
    expect(programmeMayAssign(index, { specPointId: "a", origin: "core" }, "2026-09-28")).toBe(
      true,
    );
    expect(programmeMayAssign(index, { specPointId: "b", origin: "core" }, "2026-09-21")).toBe(
      false,
    );
    expect(programmeMayAssign(index, { specPointId: "b", origin: "focus" }, "2027-01-04")).toBe(
      false,
    );
    expect(programmeMayAssign(index, { specPointId: "z", origin: "core" }, "2026-09-21")).toBe(
      true,
    );
  });

  test("a pin outranks both", () => {
    expect(programmeMayAssign(index, { specPointId: "a", origin: "tutor" }, "2026-09-21")).toBe(
      true,
    );
    expect(programmeMayAssign(index, { specPointId: "b", origin: "student" }, "2026-09-21")).toBe(
      true,
    );
  });

  test("an origin left unsaid is automatic, not exempt", () => {
    expect(programmeMayAssign(index, { specPointId: "b" }, "2026-09-21")).toBe(false);
    expect(
      programmeMayAssign(index, { specPointId: "a", origin: "carried_over" }, "2026-09-21"),
    ).toBe(false);
  });

  test("the week-level removal is the reason reported when both apply", () => {
    expect(index.blocking("c", "2026-09-28")?.kind).toBe("remove");
    expect(index.blocking("c", "2026-10-05")?.kind).toBe("skip");
    expect(index.blocking("a", "2026-10-05")).toBeNull();
  });

  test("no overrides means nothing is blocked", () => {
    const none = indexOverrides([]);
    expect(none.blocking("a", "2026-09-21")).toBeNull();
    expect(indexOverrides(undefined).skipped.size).toBe(0);
  });

  test("applyOverrides keeps the selection's shape and reports what came out", () => {
    const { selection, suppressed } = applyOverrides(
      {
        specPointIds: ["a", "b", "d", "e"],
        origins: { a: "core", b: "focus", d: "core", e: "tutor" },
        rationale: "as cut",
      },
      index,
      "2026-09-21",
    );
    expect(selection.specPointIds).toEqual(["d", "e"]);
    expect(selection.origins as Record<string, string>).toEqual({ d: "core", e: "tutor" });
    expect(selection.rationale).toBe("as cut");
    expect(suppressed.map((s) => [s.specPointId, s.override.kind])).toEqual([
      ["a", "remove"],
      ["b", "skip"],
    ]);
  });

  test("applyOverrides returns the same object when nothing applies", () => {
    const selection = { specPointIds: ["d"], origins: { d: "core" as const } };
    expect(applyOverrides(selection, index, "2026-09-21").selection).toBe(selection);
  });

  test("overridesForWeek splits what a week's screen should show", () => {
    const all = [override("a", "remove", "2026-09-21"), override("b", "skip")];
    const { removed, skipped } = overridesForWeek(all, "2026-09-21");
    expect(removed.map((o) => o.specPointId)).toEqual(["a"]);
    expect(skipped.map((o) => o.specPointId)).toEqual(["b"]);
    expect(overridesForWeek(all, "2026-09-28").removed).toEqual([]);
  });
});

describe("review projection steps past a closed week", () => {
  const candidate = (specPointId: string): FocusCandidate => ({
    specPointId,
    topicId: "t",
    topicTitle: "Topic",
    code: specPointId.toUpperCase(),
    pointTitle: `Point ${specPointId}`,
    dueAt: "2026-09-22T09:00:00Z",
    eligibleAt: "2026-09-22T09:00:00Z",
    lastReviewedAt: "2026-09-08T09:00:00Z",
  });

  test("a review due in a removed week lands in the next open one", () => {
    const index = indexOverrides([override("a", "remove", "2026-09-28")]);
    const { bands, backlog } = projectReviews({
      candidates: [candidate("a"), candidate("b")],
      currentMonday: weekKeyToDate("2026-09-21"),
      examMonday: weekKeyToDate("2027-06-07"),
      isBlocked: blockedBy(index),
    });
    // Both open on 2026-09-28 (the Monday after eligibility); only `a` is pushed.
    expect(bands.map((b) => [b.startWeek, b.points!.map((p) => p.specPointId)])).toEqual([
      ["2026-09-28", ["b"]],
      ["2026-10-05", ["a"]],
    ]);
    expect(backlog).toEqual([]);
  });

  test("a review blocked up to the exam becomes backlog rather than a review", () => {
    const index = indexOverrides([override("a", "skip")]);
    const { bands, backlog } = projectReviews({
      candidates: [candidate("a")],
      currentMonday: weekKeyToDate("2026-09-21"),
      examMonday: weekKeyToDate("2026-10-12"),
      isBlocked: blockedBy(index),
    });
    expect(bands).toEqual([]);
    expect(backlog.map((c) => c.specPointId)).toEqual(["a"]);
  });
});

describe("catch-up projection", () => {
  const owed = (specPointId: string, plannedWeek: string): BacklogPoint => ({
    specPointId,
    topicId: "t",
    topicTitle: "Topic",
    code: specPointId.toUpperCase(),
    title: `Point ${specPointId}`,
    weight: 1,
    plannedWeek,
  });

  test("a blocked point sits out its week without holding up the queue", () => {
    const index = indexOverrides([override("a", "remove", "2026-09-21")]);
    const schedule = projectCatchUp({
      backlog: [owed("a", "2026-09-07"), owed("b", "2026-09-14")],
      assigned: [],
      weekStart: "2026-09-21",
      examDate: "2026-12-07",
      weeklyWeight: 5, // budget of one point a week
      isBlocked: blockedBy(index),
    });
    expect(schedule.weeks["2026-09-21"].map((p) => p.specPointId)).toEqual(["b"]);
    expect(schedule.weeks["2026-09-28"].map((p) => p.specPointId)).toEqual(["a"]);
    expect(schedule.held).toEqual([]);
  });
});

describe("the week cut", () => {
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
    topic("t1", [point("a1"), point("a2"), point("a3")]),
    topic("t2", [point("b1"), point("b2")]),
  ];
  const start = "2026-09-07";
  const exam = "2026-12-07";
  const pacing = computePacing(
    progress.map((t) => ({ topicId: t.topicId, title: t.title, weight: t.points.length })),
    weekKeyToDate(start),
    weekKeyToDate(exam),
  );
  const roadmapWith = (overrides: PlanOverride[]) =>
    buildRoadmap({
      progress,
      baseline: { program_start: start, exam_date: exam, pacing },
      savedWeek: null,
      catchUpWeek: null,
      ledger: { done: new Set(), outstanding: new Set() },
      thisMonday: weekKeyToDate("2026-09-21"),
      examMonday: weekKeyToDate(exam),
      overrides,
    });

  test("the roadmap carries the overrides it was built around", () => {
    const plain = roadmapWith([]);
    expect(plain.overrides).toEqual([]);
    const skipped = roadmapWith([override("a1", "skip")]);
    expect(skipped.overrides.map((o) => o.specPointId)).toEqual(["a1"]);
  });

  test("a skipped point is neither taught, chased nor reported as owed", () => {
    const plain = roadmapWith([]);
    const skipped = roadmapWith([override("a1", "skip")]);
    // The spine promised a1 in a week that has passed, so without the skip it is owed.
    expect(plain.backlog.map((p) => p.specPointId)).toContain("a1");
    expect(skipped.backlog.map((p) => p.specPointId)).not.toContain("a1");
    expect(skipped.backlogByTopic.flatMap((t) => t.points.map((p) => p.specPointId))).not.toContain(
      "a1",
    );
    const everyCatchUp = Object.values(skipped.catchUpSchedule!.weeks).flat();
    expect(everyCatchUp.map((p) => p.specPointId)).not.toContain("a1");
  });

  test("selectWeek leaves out what the tutor removed from that week, and says so", () => {
    const plain = roadmapWith([]);
    const week = "2026-09-21";
    const before = selectWeek(plain, week);
    expect(before.specPointIds.length).toBeGreaterThan(0);
    const target = before.specPointIds[0];
    const after = selectWeek(roadmapWith([override(target, "remove", week)]), week);
    expect(after.specPointIds).not.toContain(target);
    expect(after.specPointIds.length).toBe(before.specPointIds.length - 1);
    expect(after.origins[target]).toBeUndefined();
    expect(after.rationale).toContain("Your tutor has set 1 point aside.");
    // The removal is for one week only.
    const next = "2026-09-28";
    expect(selectWeek(roadmapWith([override(target, "remove", week)]), next).specPointIds).toEqual(
      selectWeek(plain, next).specPointIds,
    );
  });

  test("selectWeek applies the overrides even on a roadmap built without them", () => {
    const plain = roadmapWith([]);
    const week = "2026-09-21";
    const target = selectWeek(plain, week).specPointIds[0];
    const handedIn: RoadmapResult = { ...plain, overrides: [override(target, "skip")] };
    expect(selectWeek(handedIn, week).specPointIds).not.toContain(target);
  });
});
