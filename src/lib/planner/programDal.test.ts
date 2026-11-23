import { describe, expect, test, spyOn } from "bun:test";
import { handPicked, ProgramDAL } from "./programDal";
import { focusInputs, type RoadmapResult } from "./roadmap";
import { MAX_WEEK_POINTS, WeeklyPlanDAL, type PlanPoint } from "./weeklyPlanDal";
import { WeeklyActivityDAL } from "./weeklyActivityDal";
import { SubjectPauseDAL } from "./pausesDal";
import { BreakDAL } from "./breaksDal";
import { currentWeekKey, toDateKey, weekKeyToDate } from "./week";
import { computePacing, examMondayFor, examMondayIn } from "./pacing";
import { type RejectionReason } from "./admissibility";
import { ScheduleDAL, type ProgressPoint, type TopicProgress } from "./scheduleDal";
import type { CourseState } from "./courseState";
import * as session from "../auth/session";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

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
describe("moving every subject to one exam year", () => {
  // Relative to the real clock: the planner only plans to the next three summers.
  const year = examMondayFor().getUTCFullYear() + 1;
  const june = toDateKey(examMondayIn(year));
  const course = (subject: string) => ({ subject, board: "aqa" }) as never;

  /** The write and the read `setExamYear` makes itself; the rest is spied on. */
  function fakeDb(plans: { subject: string; exam_date: string }[]) {
    const updates: { table: string; values: unknown }[] = [];
    const db = {
      from: (table: string) => ({
        update: (values: unknown) => ({
          eq: async () => {
            updates.push({ table, values });
            return { error: null };
          },
        }),
        select: () => ({ eq: async () => ({ data: plans, error: null }) }),
      }),
    } as never;
    return { updates, db };
  }

  test("saves the year, then moves each planned subject to that June", async () => {
    const { updates, db } = fakeDb([
      { subject: "biology", exam_date: `${year - 1}-06-07` },
      // Set by hand to a May paper in that year: kept.
      { subject: "chemistry", exam_date: `${year}-05-14` },
      { subject: "physics", exam_date: `${year + 1}-06-01` },
    ]);
    const setDate = spyOn(ProgramDAL, "setExamDate").mockImplementation(async ({ subject }) => {
      if (subject === "physics")
        throw new Error(
          "That exam date leaves too few weeks for your remaining topics. Choose a later date.",
        );
    });
    const apply = spyOn(ProgramDAL, "applyPending").mockResolvedValue(null);
    try {
      const result = await ProgramDAL.setExamYear(
        {
          studentId: "student",
          year,
          level: "gcse",
          courses: ["biology", "chemistry", "physics", "combined"].map(course),
        },
        db,
      );
      // The profile first: a subject added later is planned to it.
      expect(updates).toEqual([{ table: "profiles", values: { exam_year: year } }]);
      expect(setDate.mock.calls.map(([p]) => [p.subject, p.examDate])).toEqual([
        ["biology", june],
        ["physics", june],
      ]);
      // Only a subject that moved is re-flowed, and this week with it.
      expect(apply.mock.calls.map(([p]) => p.subject)).toEqual(["biology"]);
      expect(result).toEqual({
        // "combined" has no plan yet: its first one is cut to the new year.
        moved: ["biology", "combined"],
        kept: ["chemistry"],
        refused: [
          {
            subject: "physics",
            message:
              "That exam date leaves too few weeks for your remaining topics. Choose a later date.",
          },
        ],
      } as never);
    } finally {
      setDate.mockRestore();
      apply.mockRestore();
    }
  });

  test("a year the planner won't plan to is refused before anything is saved", async () => {
    const { updates, db } = fakeDb([]);
    await expect(
      ProgramDAL.setExamYear(
        { studentId: "student", year: year + 5, level: "gcse", courses: [] },
        db,
      ),
    ).rejects.toThrow("Choose one of the exam years shown.");
    expect(updates).toEqual([]);
  });

  test("a re-flow that fails still counts the subject as moved: its date is saved", async () => {
    const { db } = fakeDb([{ subject: "biology", exam_date: `${year - 1}-06-07` }]);
    const setDate = spyOn(ProgramDAL, "setExamDate").mockResolvedValue();
    const apply = spyOn(ProgramDAL, "applyPending").mockRejectedValue(new Error("offline"));
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await ProgramDAL.setExamYear(
        { studentId: "student", year, level: "gcse", courses: [course("biology")] },
        db,
      );
      expect(result.moved).toEqual(["biology"] as never);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      setDate.mockRestore();
      apply.mockRestore();
      warn.mockRestore();
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
describe("the first view's seed", () => {
  const course = { subject: "biology", board: "aqa", level: "gcse" } as const;
  /** The course as its one read hands it over. Only what loadRoadmap reads is filled. */
  const state = (baseline: CourseState["baseline"]): CourseState => ({
    course: { studentId: "student", ...course },
    weekStart: currentWeekKey(),
    progress: [topic([point("a"), point("b")])],
    baseline,
    examYear: null,
    pauses: [],
    pause: null,
    breaks: [],
    overrides: [],
    ledger: { done: new Set(), outstanding: new Set() },
    week: null,
    facts: { pacing: [], examDate: undefined, boards: [], level: null },
  });
  /** The student's own view: the seed's write, its conflict target and how it treats a row already there. */
  async function seedWrites(baseline: CourseState["baseline"]) {
    const writes: { onConflict: string | null; prefer: string | null }[] = [];
    const viewer = spyOn(session, "getSessionUserId").mockResolvedValue("student");
    // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
    const api = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (!url.pathname.endsWith("/student_program_plan") || init?.method !== "POST")
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
      writes.push({
        onConflict: url.searchParams.get("on_conflict"),
        prefer: new Headers(init.headers).get("prefer"),
      });
      return new Response(null, { status: 201 });
    }) as typeof fetch);
    try {
      await ProgramDAL.loadRoadmap({ studentId: "student", ...course, state: state(baseline) });
    } finally {
      viewer.mockRestore();
      api.mockRestore();
    }
    return writes;
  }

  test("a true first view never overwrites a plan saved in the meantime", async () => {
    // The state can be 30 seconds old: another tab may have saved a plan since.
    const writes = await seedWrites(null);
    expect(writes).toHaveLength(1);
    expect(writes[0].onConflict).toBe("student_id,subject");
    expect(writes[0].prefer).toContain("resolution=ignore-duplicates");
  });

  test("a stored plan for another course is still replaced", async () => {
    const start = currentWeekKey();
    const exam = toDateKey(examMondayIn(examMondayFor().getUTCFullYear() + 1));
    const oldCourse = computePacing(
      [{ topicId: "old", title: "Old", weight: 1 }],
      weekKeyToDate(start),
      weekKeyToDate(exam),
    );
    const writes = await seedWrites({
      program_start: start,
      exam_date: exam,
      pacing: oldCourse as never,
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].onConflict).toBe("student_id,subject");
    expect(writes[0].prefer).toContain("resolution=merge-duplicates");
  });
});

describe("a tutor's reorder of a subject the student has never opened", () => {
  const course = { subject: "biology", board: "aqa", level: "gcse" } as const;
  const progress = [
    topic([point("a"), point("b")]),
    { ...topic([point("c"), point("d")]), topicId: "u", title: "U" },
  ];
  const state = (baseline: CourseState["baseline"]): CourseState => ({
    course: { studentId: "student", ...course },
    weekStart: currentWeekKey(),
    progress,
    baseline,
    examYear: null,
    pauses: [],
    pause: null,
    breaks: [],
    overrides: [],
    ledger: { done: new Set(), outstanding: new Set() },
    week: null,
    facts: { pacing: [], examDate: undefined, boards: [], level: null },
  });
  /** The tutor opens the plan, then saves an order: every write that makes, in order. */
  async function reorderWrites(baseline: CourseState["baseline"]) {
    const writes: { path: string; prefer: string | null; body: Record<string, unknown> }[] = [];
    const viewer = spyOn(session, "getSessionUserId").mockResolvedValue("tutor");
    const course$ = spyOn(ScheduleDAL, "getTopicProgress").mockResolvedValue(progress);
    const week = spyOn(WeeklyPlanDAL, "getPlan").mockResolvedValue(null);
    const api = spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (init?.method !== "POST")
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
      writes.push({
        path: url.pathname.replace("/rest/v1/", ""),
        prefer: new Headers(init.headers).get("prefer"),
        body: JSON.parse(String(init.body)),
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    try {
      const data = await ProgramDAL.loadRoadmap({
        studentId: "student",
        ...course,
        state: state(baseline),
      });
      // The tutor's look alone leaves no mark.
      expect(writes).toEqual([]);
      await ProgramDAL.reorder({
        studentId: "student",
        ...course,
        data: data!,
        from: data!.programStart,
        order: ["u", "t"],
      });
      return { data: data!, writes };
    } finally {
      viewer.mockRestore();
      course$.mockRestore();
      week.mockRestore();
      api.mockRestore();
    }
  }

  test("the plan the tutor was shown is saved first, and never over one saved meanwhile", async () => {
    const { data, writes } = await reorderWrites(null);
    expect(writes.map((w) => w.path)).toEqual([
      "student_program_plan",
      "rpc/reorder_student_topics",
    ]);
    const [seed, reorder] = writes;
    expect(seed.prefer).toContain("resolution=ignore-duplicates");
    expect(seed.body).toMatchObject({
      student_id: "student",
      subject: "biology",
      program_start: data.programStart,
      exam_date: data.examDate,
    });
    // The database checks the order against what it holds: the plan just saved.
    expect(reorder.body._expected_pacing).toEqual(seed.body.pacing);
    expect(reorder.body._student_id).toBe("student");
  });

  test("a plan the student already has is only reordered", async () => {
    const start = currentWeekKey();
    const exam = toDateKey(examMondayIn(examMondayFor().getUTCFullYear() + 1));
    const stored = computePacing(
      progress.map((t) => ({ topicId: t.topicId, title: t.title, weight: t.points.length })),
      weekKeyToDate(start),
      weekKeyToDate(exam),
    );
    const { writes } = await reorderWrites({
      program_start: start,
      exam_date: exam,
      pacing: stored as never,
    });
    expect(writes.map((w) => w.path)).toEqual(["rpc/reorder_student_topics"]);
  });
});

describe("picking up two stops, one inside the other", () => {
  const course = { subject: "biology", board: "aqa", level: "gcse" } as const;
  const progress = [
    topic([point("a"), point("b")]),
    { ...topic([point("c"), point("d")]), topicId: "u", title: "U" },
  ];
  const start = "2026-09-07";
  const exam = "2027-05-31";
  const stored = computePacing(
    progress.map((t) => ({ topicId: t.topicId, title: t.title, weight: t.points.length })),
    weekKeyToDate(start),
    weekKeyToDate(exam),
  );
  const lapse = {
    id: "lapse",
    reason: "payment" as const,
    startedAt: "2026-10-05T09:00:00Z",
    endedAt: "2026-11-02T09:00:00Z",
    programmeResumedAt: null as string | null,
  };
  const away = {
    id: "break",
    reason: "break" as const,
    startedAt: "2026-10-12T09:00:00Z",
    endedAt: "2026-10-26T09:00:00Z",
    programmeResumedAt: null,
  };
  /** Every pick-up the planner saves on one load. */
  async function pickUps(pauses: CourseState["pauses"]) {
    const calls: Parameters<typeof SubjectPauseDAL.resumeProgramme>[0][] = [];
    const save = spyOn(SubjectPauseDAL, "resumeProgramme").mockImplementation(async (p) => {
      calls.push(p);
    });
    const api = spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error("No request expected");
    }) as unknown as typeof fetch);
    try {
      await ProgramDAL.loadRoadmap({
        studentId: "student",
        ...course,
        state: {
          course: { studentId: "student", ...course },
          weekStart: currentWeekKey(),
          progress,
          baseline: { program_start: start, exam_date: exam, pacing: stored as never },
          examYear: null,
          pauses,
          pause: null,
          breaks: [],
          overrides: [],
          ledger: { done: new Set(), outstanding: new Set() },
          week: null,
          facts: { pacing: [], examDate: undefined, boards: [], level: null },
        },
      });
    } finally {
      save.mockRestore();
      api.mockRestore();
    }
    return calls;
  }

  test("the outer stop moves the plan; the one inside it is marked picked up with nothing moved", async () => {
    const calls = await pickUps([lapse, away]);
    expect(calls.map((c) => c.pauseId)).toEqual(["lapse", "break"]);
    expect(calls[0].pacing).not.toBeNull();
    expect(calls[1].pacing).toBeNull();
    expect(calls[1].expected).toEqual(calls[0].pacing!);
  });

  test("a stop inside one picked up on an earlier load moves nothing either", async () => {
    const calls = await pickUps([{ ...lapse, programmeResumedAt: "2026-11-02T10:00:00Z" }, away]);
    expect(calls.map((c) => [c.pauseId, c.pacing])).toEqual([["break", null]]);
  });

  test("a break recorded after a lapse that began inside it was picked up starts from the lapse's back-on week", async () => {
    // The break began 5 Oct and ended 26 Oct; the lapse began 12 Oct and was picked up on 2 Nov.
    const late = { ...away, startedAt: "2026-10-05T09:00:00Z" };
    const inside = {
      ...lapse,
      startedAt: "2026-10-12T09:00:00Z",
      programmeResumedAt: "2026-11-02T10:00:00Z",
    };
    const [call] = await pickUps([late, inside]);
    expect(call.pauseId).toBe("break");
    const bands = call.pacing!;
    expect(bands.every((b) => b.schedule?.from === "2026-11-02")).toBe(true);
    expect(bands.some((b) => b.startWeek >= "2026-10-05" && b.startWeek < "2026-11-02")).toBe(
      false,
    );
  });
});
