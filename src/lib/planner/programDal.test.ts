import { describe, expect, test, spyOn } from "bun:test";
import { handPicked, ProgramDAL } from "./programDal";
import { focusInputs, type RoadmapResult } from "./roadmap";
import { MAX_WEEK_POINTS, WeeklyPlanDAL, type PlanPoint } from "./weeklyPlanDal";
import { WeeklyActivityDAL } from "./weeklyActivityDal";
import { SubjectPauseDAL } from "./pausesDal";
import { BreakDAL } from "./breaksDal";
import { currentWeekKey } from "./week";
import { type RejectionReason } from "./admissibility";
import type { ProgressPoint, TopicProgress } from "./scheduleDal";

const point = (id: string, values: Partial<ProgressPoint> = {}): ProgressPoint => ({
  id,
  code: id,
  title: id,
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
const topic = (points: ProgressPoint[]): TopicProgress => ({
  topicId: "t",
  title: "T",
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

describe("saved review repair", () => {
  test("rebuilds stale automatic work, preserves protected work, and does not repeat writes", async () => {
    const savedPoint = (id: string, extra: Partial<PlanPoint> = {}): PlanPoint => ({
      spec_point_id: id,
      code: id,
      title: id,
      description: null,
      topic_id: "t",
      topic_title: "T",
      origin: "focus",
      done_at: null,
      carried_from: null,
      ...extra,
    });
    let points = [
      savedPoint("stale"),
      savedPoint("started"),
      savedPoint("done", { done_at: "2026-09-07" }),
      savedPoint("carried", { carried_from: "2026-08-31" }),
      savedPoint("manual", { origin: "tutor" }),
    ];
    // `getPlan` splits a saved week into admissible points and withheld ones.
    let withheld: { point: PlanPoint; reason: RejectionReason }[] = [];
    const read = spyOn(WeeklyPlanDAL, "getPlan").mockImplementation(async () => ({
      plan: { id: "plan" } as never,
      points,
      withheld,
    }));
    const coverage = spyOn(WeeklyActivityDAL, "getCoverage").mockResolvedValue(
      new Map([["started", { attempted: true } as never]]),
    );
    const select = spyOn(ProgramDAL, "planForWeek").mockResolvedValue({
      specPointIds: ["new-core"],
      origins: { "new-core": "core" },
      rationale: "Updated",
    });
    const save = spyOn(WeeklyPlanDAL, "savePlan").mockImplementation(async (p) => {
      points = p.specPointIds.map((id) =>
        savedPoint(id, {
          origin: p.origins![id],
          carried_from: p.carriedFroms?.[id] ?? null,
        }),
      );
      withheld = []; // a re-save clears the quarantine
      return "plan";
    });
    const params = {
      studentId: "student",
      subject: "biology",
      board: "edexcel",
      level: "gcse",
      weekStart: "2026-09-07",
      repairUnsupportedReviews: true,
      roadmap: { progress: [topic([point("stale")])] } as RoadmapResult,
    } as const;
    try {
      expect(await ProgramDAL.refreshWeek(params)).toBe(true);
      expect(points.map((p) => p.spec_point_id)).toEqual([
        "started",
        "done",
        "carried",
        "manual",
        "new-core",
      ]);
      expect(points.filter((p) => p.origin === "focus")).toEqual([]);
      expect(points.find((p) => p.spec_point_id === "manual")?.origin).toBe("tutor");
      expect(points.find((p) => p.spec_point_id === "carried")?.carried_from).toBe("2026-08-31");
      expect(await ProgramDAL.refreshWeek(params)).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
      // A protected point still needs its lane repaired when its ID is unchanged.
      points = [savedPoint("started")];
      withheld = [];
      select.mockResolvedValue({ specPointIds: [], origins: {}, rationale: "" });
      expect(await ProgramDAL.refreshWeek(params)).toBe(true);
      expect(points[0].origin).toBe("core");
      // Unavailable curriculum must never wipe or relabel existing work.
      points = [savedPoint("stale")];
      withheld = [];
      expect(await ProgramDAL.refreshWeek({ ...params, roadmap: null })).toBe(false);
      expect(points[0].origin).toBe("focus");
      // A genuine assessed review is stable even when the fresh selection differs.
      const validRoadmap = {
        progress: [
          topic([
            point("stale", {
              reps: 1,
              dueAt: "2026-09-07T00:00:00Z",
              eligibleAt: "2026-09-07T00:00:00Z",
              lastReviewedAt: "2026-08-24T00:00:00Z",
              quizScore: 80,
            }),
          ]),
        ],
      } as RoadmapResult;
      expect(await ProgramDAL.refreshWeek({ ...params, roadmap: validRoadmap })).toBe(false);
      expect(points[0].origin).toBe("focus");
      // The case the two features collide on: admissibility quarantines a
      // review with no evidence, so it is NOT in `points` at all. Scanning
      // `points` alone would find nothing and the repair would silently no-op.
      points = [];
      withheld = [{ point: savedPoint("quarantined"), reason: "no-evidence" }];
      select.mockResolvedValue({ specPointIds: [], origins: {}, rationale: "" });
      expect(await ProgramDAL.refreshWeek(params)).toBe(true);
      expect(points.map((p) => p.spec_point_id)).toEqual(["quarantined"]);
      expect(points[0].origin).toBe("core");
      // A point withheld for any other reason keeps its own problem — its lane
      // is not what is wrong with it, so the repair must leave it alone.
      points = [];
      withheld = [{ point: savedPoint("ahead"), reason: "ahead-of-spine" }];
      expect(await ProgramDAL.refreshWeek(params)).toBe(false);
    } finally {
      read.mockRestore();
      coverage.mockRestore();
      select.mockRestore();
      save.mockRestore();
    }
  });
});
describe("applying a new exam date", () => {
  const course = {
    studentId: "student",
    subject: "biology",
    board: "cambridge",
    level: "igcse",
  } as const;
  const teach = { topicId: "t", title: "T", startWeek: "2026-10-05", endWeek: "2026-10-19" };
  const reflowed = (bands: object[], needsAck = true) =>
    ({ needsAck, bands, programStart: "2026-10-05", examDate: "2028-06-30" }) as RoadmapResult;

  test("re-cuts this week too, not just the full plan", async () => {
    // The bug: the full plan moved to the new date, and this week kept the 15
    // points the old date gave it.
    const load = spyOn(ProgramDAL, "loadRoadmap");
    const ack = spyOn(ProgramDAL, "acknowledge").mockResolvedValue();
    const recut = spyOn(ProgramDAL, "refreshWeek").mockResolvedValue(true);
    const pause = spyOn(SubjectPauseDAL, "open").mockResolvedValue(null);
    const breaks = spyOn(BreakDAL, "list").mockResolvedValue([]);
    try {
      load.mockResolvedValue(reflowed([teach]));
      await ProgramDAL.applyPending(course);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(recut).toHaveBeenCalledWith({ ...course, weekStart: currentWeekKey() });

      // Nothing re-flowed: nothing is written.
      load.mockResolvedValue(reflowed([teach], false));
      await ProgramDAL.applyPending(course);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(recut).toHaveBeenCalledTimes(1);

      // A custom order's weeks are re-cut by reorder_student_topics instead.
      const schedule = { version: 1, from: "2026-10-05", examDate: "2028-06-30" };
      load.mockResolvedValue(reflowed([{ ...teach, schedule }]));
      await ProgramDAL.applyPending(course);
      expect(recut).toHaveBeenCalledTimes(1);

      // A paused subject or a break week is never planned.
      load.mockResolvedValue(reflowed([teach]));
      pause.mockResolvedValueOnce({ reason: "paused", startedAt: "2026-10-01T00:00:00Z" });
      await ProgramDAL.applyPending(course);
      breaks.mockResolvedValueOnce([
        { startsOn: currentWeekKey(), endsOn: currentWeekKey() } as never,
      ]);
      await ProgramDAL.applyPending(course);
      expect(recut).toHaveBeenCalledTimes(1);

      // The plan is saved even when the week can't follow it just now.
      recut.mockRejectedValueOnce(new Error("offline"));
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await ProgramDAL.applyPending(course)).toEqual(reflowed([teach]));
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    } finally {
      load.mockRestore();
      ack.mockRestore();
      recut.mockRestore();
      pause.mockRestore();
      breaks.mockRestore();
    }
  });
});
describe("assessment-backed focus inputs", () => {
  test("confidence alone cannot admit a point", () => {
    expect(focusInputs([topic([point("a", { confidence: 10 })])]).candidates).toEqual([]);
  });
  test("strong confidence cannot hide an assessed review", () => {
    const p = point("a", {
      confidence: 100,
      reps: 1,
      dueAt: "2026-09-14T00:00:00Z",
      eligibleAt: "2026-09-14T00:00:00Z",
      lastReviewedAt: "2026-09-01T00:00:00Z",
    });
    const result = focusInputs([topic([p])]);
    expect(result.candidates.map((c) => c.specPointId)).toEqual(["a"]);
    expect(result.candidates[0].dueAt).toBe(p.dueAt!);
  });
});
describe("what survives a re-cut of the week", () => {
  test("a point a person put in by hand is kept, whoever that person was", () => {
    // The bug: only `student` was listed, so a tutor's hand-added point vanished
    // from the week the next time anything re-cut it — a rating on the confidence
    // board silently undoing the tutor's assignment.
    expect(handPicked("student")).toBe(true);
    expect(handPicked("tutor")).toBe(true);
  });

  test("points the programme chose are not pinned by origin", () => {
    // They are replaced by what the programme now says; the in-flight and
    // carried-over rules are what hold anything of theirs in place.
    expect(handPicked("ai")).toBe(false);
    expect(handPicked("core")).toBe(false);
    expect(handPicked("focus")).toBe(false);
    expect(handPicked("carried_over")).toBe(false);
  });
});

describe("saved-week catch-up", () => {
  test("appends missing core work, preserves existing points, and is idempotent", async () => {
    const catchUp = {
      specPointId: "old",
      topicId: "old-topic",
      topicTitle: "Old topic",
      code: "1.1",
      title: "Missed point",
      weight: 1,
      plannedWeek: "2026-07-13",
    };
    const roadmap = {
      catchUpSchedule: {
        weeks: { "2026-09-07": [catchUp] },
        assignedIds: [],
        held: [],
      },
    } as unknown as RoadmapResult;
    const points = [
      { spec_point_id: "manual", origin: "student", done_at: "2026-09-07" },
    ] as PlanPoint[];
    const add = spyOn(WeeklyPlanDAL, "addPoints").mockResolvedValue(1);
    try {
      expect(
        await ProgramDAL.ensureCatchUp({
          planId: "saved",
          weekStart: "2026-09-07",
          points,
          roadmap,
        }),
      ).toBe(true);
      expect(add).toHaveBeenCalledWith("saved", ["old"], "core");
      expect(
        await ProgramDAL.ensureCatchUp({
          planId: "saved",
          weekStart: "2026-09-07",
          points: [...points, { spec_point_id: "old", origin: "core" } as PlanPoint],
          roadmap,
        }),
      ).toBe(false);
      expect(add).toHaveBeenCalledTimes(1);
      expect(points[0].origin).toBe("student");
      expect(points[0].done_at).toBe("2026-09-07");

      // Every point refused by admissibility: nothing changed, so say so — a
      // `true` here re-reads the week and invalidates the roadmap for nothing.
      add.mockResolvedValueOnce(0);
      expect(
        await ProgramDAL.ensureCatchUp({
          planId: "saved",
          weekStart: "2026-09-07",
          points,
          roadmap,
        }),
      ).toBe(false);
    } finally {
      add.mockRestore();
    }
  });

  test("tops a nearly full week up only to the cap, and leaves a full one alone", async () => {
    // `addPoints` throws past the cap, and the week loader runs this on every
    // visit: one refusal here put an error on the week for the rest of it.
    const owed = (id: string) => ({
      specPointId: id,
      topicId: "old-topic",
      topicTitle: "Old topic",
      code: id,
      title: id,
      weight: 1,
      plannedWeek: "2026-07-13",
    });
    const roadmap = {
      catchUpSchedule: {
        weeks: { "2026-09-07": [owed("old1"), owed("old2")] },
        assignedIds: [],
        held: [],
      },
    } as unknown as RoadmapResult;
    const held = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => ({ spec_point_id: `p${i}`, origin: "core" }) as PlanPoint,
      );
    const week = { planId: "saved", weekStart: "2026-09-07", roadmap };
    const add = spyOn(WeeklyPlanDAL, "addPoints").mockResolvedValue(1);
    try {
      expect(await ProgramDAL.ensureCatchUp({ ...week, points: held(MAX_WEEK_POINTS - 1) })).toBe(
        true,
      );
      expect(add).toHaveBeenCalledWith("saved", ["old1"], "core");
      expect(await ProgramDAL.ensureCatchUp({ ...week, points: held(MAX_WEEK_POINTS) })).toBe(
        false,
      );
      expect(add).toHaveBeenCalledTimes(1);
    } finally {
      add.mockRestore();
    }
  });
});
