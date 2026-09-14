import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Database, type Json } from "@/integrations/supabase/types";
import {
  type PointCoverage,
  type PointActivity,
  type PointWork,
  type PointWorkItem,
  noWork,
  practiceInWeek,
} from "./planner/coverage";
import { mapAttemptSources } from "./planner/attemptSources";
import {
  describeReason,
  isHandPicked,
  partition,
  spineReach,
  type Rejection,
  type Partitioned,
} from "./planner/admissibility";
import { ScheduleDAL } from "./scheduleDal";
import { type PacingBand } from "./planner/pacing";
import { selectIn, selectInSafe, selectInHistory } from "./db/chunked";
import { getSessionUserId } from "@/lib/auth/session";

/** A stored end-of-week check-in row. */
export interface WeeklyCheckin {
  id: string;
  plan_id: string;
  covered_ok: boolean | null;
  reflection: string | null;
  coverage: Record<string, unknown>;
}

/** The tutor's "Ali's take" on a week + the spec points they line up for next. */
export interface TutorNote {
  plan_id: string;
  note: string | null;
  next_points: string[];
}

/** A spec point's display label. */
export interface SpecPointLabel {
  id: string;
  code: string;
  title: string;
}

/** One student as seen from the tutor's planner picker. */
export interface PlannerStudent {
  id: string;
  name: string | null;
  level: LevelV | null;
  enrolments: { subject: SubjectV; board: BoardV }[];
}

export type PlanSource = Database["public"]["Enums"]["plan_source"];
export type PlanPointOrigin = Database["public"]["Enums"]["plan_point_origin"];

export type WeeklyPlan = {
  id: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  week_start: string;
  source: PlanSource;
  note: string | null;
  ai_rationale: string | null;
};

export type PlanPoint = {
  spec_point_id: string;
  code: string;
  title: string;
  description: string | null;
  topic_id: string;
  topic_title: string | null;
  /** The lane this point sits in — kept intact when a point is carried. */
  origin: PlanPointOrigin;
  /** Monday of the week it was carried from, or null if planned for this week. */
  carried_from: string | null;
  /** When the student ticked this point off their week, or null. */
  done_at: string | null;
};

type PointRow = {
  origin: PlanPointOrigin;
  carried_from: string | null;
  done_at: string | null;
  spec_points: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    topic_id: string;
    sort_order: number;
    topics: { title: string | null; sort_order: number } | null;
  } | null;
};

/** One point on its way into a plan, as both write paths shape it. */
export type WithheldPlanPoint = Rejection<PlanPoint>;

type IncomingPoint = {
  spec_point_id: string;
  origin: PlanPointOrigin;
  carried_from: string | null;
};

/**
 * Data Access Layer for the per-student weekly plan — the editable set of spec
 * points a student commits to for one Mon–Sun week. A plan is unique per
 * (student, subject, week_start); its points drive which homework/MCQs surface.
 * All writes bind to the caller via RLS (`auth.uid() = student_id`).
 */
export class WeeklyPlanDAL {
  /** Shared read/write classification. Unknown pacing never bypasses course checks. */
  private static async classify<T extends { spec_point_id: string; origin: PlanPointOrigin }>(
    studentId: string,
    course: { subject: SubjectV; board: BoardV; level: LevelV },
    weekStart: string,
    points: T[],
  ): Promise<Partitioned<T>> {
    if (!points.length) return { admitted: [], rejected: [] };
    const [baselineResult, enrolmentResult, profileResult, topicOf, progress] = await Promise.all([
      supabase
        .from("student_program_plan")
        .select("pacing, exam_date")
        .eq("student_id", studentId)
        .eq("subject", course.subject)
        .maybeSingle(),
      supabase
        .from("student_enrolments")
        .select("board")
        .eq("student_id", studentId)
        .eq("subject", course.subject),
      supabase.from("profiles").select("level").eq("id", studentId).maybeSingle(),
      selectIn<{
        id: string;
        topic_id: string | null;
        topics: { subject: string; board: string; level: string } | null;
      }>(
        points.map((p) => p.spec_point_id),
        (batch) =>
          supabase
            .from("spec_points")
            .select("id, topic_id, topics(subject, board, level)")
            .in("id", batch),
      ),
      points.some((p) => p.origin === "focus")
        ? ScheduleDAL.getTopicProgress({ studentId, ...course })
        : Promise.resolve([]),
    ]);
    for (const result of [baselineResult, enrolmentResult, profileResult])
      if (result.error) throw new Error(result.error.message);
    const baseline = baselineResult.data;
    const enrolments = enrolmentResult.data ?? [];
    const level = profileResult.data?.level;
    const planOnCourse =
      (!enrolments.length || enrolments.some((e) => e.board === course.board)) &&
      (!level || level === course.level);
    const topics = new Map(topicOf.map((p) => [p.id, p]));
    const evidenced = new Set(
      progress.flatMap((t) => t.points.filter((p) => p.reps > 0).map((p) => p.id)),
    );
    return partition(
      points,
      (p) => {
        const row = topics.get(p.spec_point_id);
        const topic = row?.topics;
        return {
          specPointId: p.spec_point_id,
          topicId: topic ? row!.topic_id : null,
          origin: p.origin,
          hasEvidence: evidenced.has(p.spec_point_id),
          onCourse:
            planOnCourse &&
            !!topic &&
            topic.subject === course.subject &&
            topic.board === course.board &&
            topic.level === course.level,
        };
      },
      {
        reach: spineReach((baseline?.pacing ?? []) as unknown as PacingBand[]),
        weekStart,
        examDate: baseline?.exam_date,
      },
    );
  }

  private static async screen(
    studentId: string,
    course: { subject: SubjectV; board: BoardV; level: LevelV },
    weekStart: string,
    points: IncomingPoint[],
  ): Promise<IncomingPoint[]> {
    const { admitted, rejected } = await this.classify(studentId, course, weekStart, points);
    const refused = rejected.find((r) => isHandPicked(r.point.origin));
    if (refused)
      throw new Error(`That spec point can't be assigned — ${describeReason(refused.reason)}.`);
    if (rejected.length)
      console.warn(
        `[planner] withheld ${rejected.length} point(s) from ${weekStart}:`,
        rejected.map((r) => `${r.point.spec_point_id} (${r.reason})`),
      );
    return admitted;
  }

  /** The plan (and its points, in curriculum order) for a given week, or null. */
  static async getPlan(
    studentId: string,
    subject: SubjectV,
    weekStart: string,
  ): Promise<{ plan: WeeklyPlan; points: PlanPoint[]; withheld: WithheldPlanPoint[] } | null> {
    const { data: plan, error } = await supabase
      .from("student_weekly_plans")
      .select("id, subject, board, level, week_start, source, note, ai_rationale")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (error) {
      throw new Error(error.message);
    }
    if (!plan) return null;

    const { data: rows, error: pointsError } = await supabase
      .from("student_weekly_plan_points")
      .select(
        "origin, carried_from, done_at, spec_points!inner(id, code, title, description, topic_id, sort_order, topics(title, sort_order))",
      )
      .eq("plan_id", plan.id);

    if (pointsError) throw new Error(pointsError.message);

    const points: PlanPoint[] = ((rows ?? []) as unknown as PointRow[])
      .filter((r) => !!r.spec_points)
      .map((r) => ({
        spec_point_id: r.spec_points!.id,
        code: r.spec_points!.code,
        title: r.spec_points!.title,
        description: r.spec_points!.description,
        topic_id: r.spec_points!.topic_id,
        topic_title: r.spec_points!.topics?.title ?? null,
        origin: r.origin,
        carried_from: r.carried_from,
        done_at: r.done_at,
        _ts: r.spec_points!.topics?.sort_order ?? 0,
        _ps: r.spec_points!.sort_order ?? 0,
      }))
      .sort((a, b) => a._ts - b._ts || a._ps - b._ps || a.code.localeCompare(b.code))
      .map(({ _ts, _ps, ...p }) => p);

    const { admitted, rejected } = await this.classify(
      studentId,
      plan as WeeklyPlan,
      weekStart,
      points,
    );
    return { plan: plan as WeeklyPlan, points: admitted, withheld: rejected };
  }

  /**
   * Create or replace this week's plan with an exact set of spec points.
   * Upserts the plan row (keyed by student+subject+week) and swaps its points.
   */
  static async savePlan(params: {
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
    specPointIds: string[];
    source: PlanSource;
    rationale?: string | null;
    origin?: PlanPointOrigin;
    /**
     * Per-point override of `origin`, keyed by spec-point id — how a generated
     * week records which lane each point came from (`core` vs `focus`).
     */
    origins?: Record<string, PlanPointOrigin>;
    /** Monday of the week these points were carried from, if they all were. */
    carriedFrom?: string | null;
    /**
     * Per-point override of `carriedFrom`. A plan that is being re-cut rather
     * than created has to hand its existing carry markers back, or rewriting the
     * week would quietly turn carried points into freshly-planned ones.
     */
    carriedFroms?: Record<string, string | null>;
    /** Whose plan — omit for the signed-in student; a tutor passes the target. */
    studentId?: string;
  }): Promise<string> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;

    // One transaction, server-side (`save_weekly_plan`). This used to be an
    // upsert followed by a separate delete and insert, which left the plan
    // holding zero points in between — a window another tab could both observe
    // and collide with. See the migration for the full account.
    const points = await this.screen(
      studentId,
      params,
      params.weekStart,
      params.specPointIds.map((spec_point_id) => ({
        spec_point_id,
        origin: params.origins?.[spec_point_id] ?? params.origin ?? "ai",
        carried_from: params.carriedFroms?.[spec_point_id] ?? params.carriedFrom ?? null,
      })),
    );

    const { data: version, error: versionError } = await supabase.rpc(
      "assessment_scheduler_version" as never,
    );
    if (versionError || !Number.isFinite(Number(version)) || Number(version) < 4)
      throw new Error(
        "The planner history protection update must be installed before saving a week.",
      );

    const { data: planId, error } = await supabase.rpc("save_weekly_plan", {
      _student_id: studentId,
      _subject: params.subject,
      _board: params.board,
      _level: params.level,
      _week_start: params.weekStart,
      _source: params.source,
      // The generated signature types every text parameter as non-null; both
      // the column and the function accept null here.
      _rationale: (params.rationale ?? null) as string,
      _points: points as unknown as Json,
    });
    if (error) throw error;
    return planId;
  }

  /**
   * Add spec points to an existing plan (ignores ones already present).
   *
   * `origins` overrides `origin` per point — how a carry-forward keeps each
   * point in the lane it was already in instead of dropping them all into one.
   */
  static async addPoints(
    planId: string,
    specPointIds: string[],
    origin: PlanPointOrigin = "student",
    opts: { origins?: Record<string, PlanPointOrigin>; carriedFrom?: string | null } = {},
  ): Promise<void> {
    if (specPointIds.length === 0) return;

    // The plan's own row says whose week this is and which week it is — the two
    // facts the admissibility rule needs and a bare plan id does not carry.
    const { data: plan, error: planError } = await supabase
      .from("student_weekly_plans")
      .select("student_id, subject, board, level, week_start")
      .eq("id", planId)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) throw new Error("That weekly plan no longer exists.");

    const points = await this.screen(
      plan.student_id,
      plan as { subject: SubjectV; board: BoardV; level: LevelV },
      plan.week_start,
      specPointIds.map((spec_point_id) => ({
        spec_point_id,
        origin: opts.origins?.[spec_point_id] ?? origin,
        carried_from: opts.carriedFrom ?? null,
      })),
    );
    if (points.length === 0) return;

    const { error } = await supabase.from("student_weekly_plan_points").upsert(
      points.map((p) => ({ plan_id: planId, ...p })),
      { onConflict: "plan_id,spec_point_id", ignoreDuplicates: true },
    );
    if (error) throw error;
  }

  /**
   * What the programme can account for, across every week it has ever cut.
   *
   * The catch-up rule needs to know which of the spine's past promises were
   * kept ([[backlog]]), and "kept" is not a fact any single week holds: a point
   * promised in July may have been ticked off in August, or may be sitting in
   * next week's plan already. Both are answers, and both live in other rows.
   *
   * Deliberately does not treat mere presence in a plan as delivery — a point
   * the student was offered and never touched is exactly what the backlog is
   * for, and that holds for the week now being cut as much as for a past one.
   * Only weeks *after* it count as outstanding: a point sitting undone in the
   * current week must stay in the backlog, or re-cutting that week would drop
   * it (nothing else re-selects a catch-up point) and the next cut would put it
   * back, flip-flopping the plan week on week.
   *
   * Evidence is the third route and is not read here; it comes from the graded
   * sources ([[scheduleDal]]), which this DAL must not duplicate.
   */
  static async getDeliveryLedger(
    studentId: string,
    subject: SubjectV,
    /** Monday of the week being planned — only later weeks are outstanding. */
    fromWeek: string,
  ): Promise<{ done: Set<string>; outstanding: Set<string> }> {
    const done = new Set<string>();
    const outstanding = new Set<string>();
    const { data, error } = await supabase
      .from("student_weekly_plans")
      .select("week_start, student_weekly_plan_points(spec_point_id, done_at)")
      .eq("student_id", studentId)
      .eq("subject", subject);
    if (error) throw new Error(error.message);

    for (const plan of (data ?? []) as unknown as {
      week_start: string;
      student_weekly_plan_points: { spec_point_id: string; done_at: string | null }[] | null;
    }[]) {
      // Date-keys are YYYY-MM-DD, so a lexical compare is a chronological one.
      const pending = plan.week_start > fromWeek;
      for (const point of plan.student_weekly_plan_points ?? []) {
        if (point.done_at) done.add(point.spec_point_id);
        else if (pending) outstanding.add(point.spec_point_id);
      }
    }
    return { done, outstanding };
  }

  /**
   * Put spec points into a week, creating that week's plan if it has none.
   *
   * The catch-up controls act on a week the caller is not holding open — the
   * roadmap offers "practise this topic" from a table of the whole year, and a
   * student whose current week was never generated (an empty past week, a
   * subject they have not opened) has no plan row to add to. Both write paths
   * screen through {@link screen}, so this is a convenience over the two, not a
   * way around admissibility.
   */
  static async addToWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
    specPointIds: string[];
    origin: PlanPointOrigin;
  }): Promise<void> {
    if (params.specPointIds.length === 0) return;
    const existing = await this.getPlan(params.studentId, params.subject, params.weekStart);
    if (existing) {
      await this.addPoints(existing.plan.id, params.specPointIds, params.origin);
      return;
    }
    await this.savePlan({
      studentId: params.studentId,
      subject: params.subject,
      board: params.board,
      level: params.level,
      weekStart: params.weekStart,
      specPointIds: params.specPointIds,
      source: params.origin === "tutor" ? "tutor" : "student",
      origin: params.origin,
    });
  }

  /** Remove one spec point from a plan. */
  static async removePoint(planId: string, specPointId: string): Promise<void> {
    const { error } = await supabase
      .from("student_weekly_plan_points")
      .delete()
      .eq("plan_id", planId)
      .eq("spec_point_id", specPointId);
    if (error) throw error;
  }

  /**
   * For a set of spec points, the work attached to each — the videos,
   * homework and quizzes themselves, not just a count of them.
   *
   * This used to return two booleans, which is all a "practice waiting" chip
   * needs; the checklist has to open the thing, so it needs its id and title.
   * The rows were already coming back — the resource join has always fetched
   * every kind and then kept only homework — so naming them costs one extra
   * lookup (quiz titles) rather than a new pass over the library.
   *
   * `hasHomework`/`hasQuiz` keep their old meaning exactly, unpublished quizzes
   * included: they gate the week's review lock, and narrowing them here would
   * quietly change when a student is allowed to close a week. Only `quizzes`
   * filters to published sets, because only those have somewhere to link to.
   */
  static async getActivity(
    specPointIds: string[],
  ): Promise<Map<string, PointActivity & PointWork>> {
    const out = new Map<string, PointActivity & PointWork>();
    if (specPointIds.length === 0) return out;
    for (const id of specPointIds) out.set(id, { hasHomework: false, hasQuiz: false, ...noWork() });

    type ResRow = {
      id: string;
      kind: string;
      title: string;
      video_url: string | null;
      due_at: string | null;
    };
    const RES_COLS = "id, kind, title, video_url, due_at";

    const [joined, directRes, taggedQ, directSets] = await Promise.all([
      selectInSafe<{ spec_point_id: string; resources: ResRow | null }>(specPointIds, (batch) =>
        supabase
          .from("resource_spec_points")
          .select(`spec_point_id, resources!inner(${RES_COLS})`)
          .in("spec_point_id", batch),
      ),
      // Homework linked straight off the resource rather than through the join
      // table. `mapAttemptSources` counts both, so this must too — a homework
      // visible to coverage but invisible here would let the review's lock open
      // on work it can't see.
      selectInSafe<ResRow & { spec_point_id: string | null }>(specPointIds, (batch) =>
        supabase.from("resources").select(`spec_point_id, ${RES_COLS}`).in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null; set_id: string }>(specPointIds, (batch) =>
        supabase.from("mcq_questions").select("spec_point_id, set_id").in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null; id: string; title: string; published: boolean }>(
        specPointIds,
        (batch) =>
          supabase
            .from("mcq_sets")
            .select("spec_point_id, id, title, published")
            .in("spec_point_id", batch),
      ),
    ]);

    /** File a resource under the list its kind belongs in, de-duplicated by id. */
    const addResource = (specPointId: string | null, r: ResRow | null) => {
      if (!specPointId || !r) return;
      const e = out.get(specPointId);
      if (!e) return;
      const item: PointWorkItem = {
        id: r.id,
        title: r.title,
        videoUrl: r.video_url,
        dueAt: r.due_at,
      };
      const list = r.kind === "homework" ? e.homework : r.kind === "video" ? e.videos : null;
      // `live_session` resources belong to the live banner, not the checklist.
      if (!list || list.some((x) => x.id === item.id)) return;
      list.push(item);
      if (r.kind === "homework") e.hasHomework = true;
    };

    for (const r of joined) addResource(r.spec_point_id, r.resources);
    for (const r of directRes) addResource(r.spec_point_id, r);

    // Both routes to a quiz: a set tagged to the point, and a set holding a
    // question tagged to it. The first names itself; the second needs a lookup.
    const setsForPoint = new Map<string, Set<string>>();
    const known = new Map<string, { title: string; published: boolean }>();
    const note = (specPointId: string | null, setId: string) => {
      if (!specPointId || !out.has(specPointId)) return;
      out.get(specPointId)!.hasQuiz = true;
      const s = setsForPoint.get(specPointId) ?? new Set<string>();
      s.add(setId);
      setsForPoint.set(specPointId, s);
    };
    for (const r of directSets) {
      known.set(r.id, { title: r.title, published: r.published });
      note(r.spec_point_id, r.id);
    }
    for (const r of taggedQ) note(r.spec_point_id, r.set_id);

    const missing = [...new Set([...setsForPoint.values()].flatMap((s) => [...s]))].filter(
      (id) => !known.has(id),
    );
    if (missing.length) {
      const rows = await selectInSafe<{ id: string; title: string; published: boolean }>(
        missing,
        (batch) => supabase.from("mcq_sets").select("id, title, published").in("id", batch),
      );
      for (const r of rows) known.set(r.id, { title: r.title, published: r.published });
    }

    for (const [specPointId, ids] of setsForPoint) {
      const e = out.get(specPointId)!;
      for (const id of ids) {
        const meta = known.get(id);
        if (!meta?.published) continue;
        if (e.quizzes.some((q) => q.id === id)) continue;
        e.quizzes.push({ id, title: meta.title });
      }
    }

    return out;
  }

  /**
   * Tick a spec point off (or back onto) the week.
   *
   * The point must already be in the plan — the checklist only offers a box on
   * points that are, so an unplanned point can't be marked done and then vanish
   * on the next re-cut with nothing to show for it.
   */
  static async setPointDone(planId: string, specPointId: string, done: boolean): Promise<void> {
    const { error } = await supabase
      .from("student_weekly_plan_points")
      .update({ done_at: done ? new Date().toISOString() : null })
      .eq("plan_id", planId)
      .eq("spec_point_id", specPointId);
    if (error) throw error;
  }

  /** Persist the student's free-text note on the plan. */
  static async setNote(planId: string, note: string): Promise<void> {
    const { error } = await supabase
      .from("student_weekly_plans")
      .update({ note, updated_at: new Date().toISOString() })
      .eq("id", planId);
    if (error) throw error;
  }

  /**
   * What the student actually did on each spec point — homework submissions and
   * MCQ attempts, both already spec-point-linked. Returns a per-point best score
   * so the check-in can grade coverage. Reads the given student's rows, so it
   * works both for the student themselves and for a tutor viewing them (RLS on
   * homework_submissions / mcq_attempts already allows tutor reads).
   */
  static async getCoverage(
    studentId: string,
    specPointIds: string[],
    weekStart?: string,
  ): Promise<Map<string, PointCoverage>> {
    const out = new Map<string, PointCoverage>();
    for (const id of specPointIds) {
      out.set(id, {
        attempted: false,
        homeworkDone: false,
        quizDone: false,
        bestScore: null,
        homeworkScore: null,
        quizScore: null,
      });
    }
    if (specPointIds.length === 0) return out;

    // spec point → homework resource ids, and → mcq set ids.
    const { resourceToPoints, setToPoints } = await mapAttemptSources(specPointIds);

    const resourceIds = [...resourceToPoints.keys()];
    const setIds = [...setToPoints.keys()];

    const [subs, attempts] = await Promise.all([
      selectIn<{ resource_id: string; score_pct: number | null; submitted_at: string }>(
        resourceIds,
        (batch) =>
          supabase
            .from("homework_submissions")
            .select("resource_id, score_pct, submitted_at")
            .eq("student_id", studentId)
            .in("resource_id", batch),
      ),
      selectIn<{
        set_id: string;
        score: number | null;
        total: number | null;
        created_at: string;
      }>(setIds, (batch) =>
        supabase
          .from("mcq_attempts")
          .select("set_id, score, total, created_at")
          .eq("user_id", studentId)
          .in("set_id", batch),
      ),
    ]);

    const merge = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);

    for (const sub of subs) {
      if (!practiceInWeek(sub.submitted_at, weekStart)) continue;
      const pct = sub.score_pct == null ? null : Math.round(Number(sub.score_pct));
      for (const p of resourceToPoints.get(sub.resource_id) ?? []) {
        const e = out.get(p);
        if (!e) continue;
        e.attempted = true;
        e.homeworkDone = true;
        e.bestScore = merge(e.bestScore, pct);
        e.homeworkScore = merge(e.homeworkScore, pct);
      }
    }
    for (const a of attempts) {
      if (!practiceInWeek(a.created_at, weekStart)) continue;
      const pct = a.total ? Math.round(((a.score ?? 0) / a.total) * 100) : null;
      for (const p of setToPoints.get(a.set_id) ?? []) {
        const e = out.get(p);
        if (!e) continue;
        e.attempted = true;
        e.quizDone = true;
        e.bestScore = merge(e.bestScore, pct);
        e.quizScore = merge(e.quizScore, pct);
      }
    }
    return out;
  }

  /** The stored check-in for a plan, or null if the student hasn't done one. */
  static async getCheckin(planId: string): Promise<WeeklyCheckin | null> {
    const { data } = await supabase
      .from("student_weekly_checkins")
      .select("id, plan_id, covered_ok, reflection, coverage")
      .eq("plan_id", planId)
      .maybeSingle();
    return (data as WeeklyCheckin | null) ?? null;
  }

  /** Record (or update) the student's end-of-week reflection for a plan. */
  static async saveCheckin(params: {
    planId: string;
    coveredOk: boolean | null;
    reflection?: string | null;
    coverage?: Record<string, unknown>;
    studentId?: string;
  }): Promise<void> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const { error } = await supabase.from("student_weekly_checkins").upsert(
      {
        plan_id: params.planId,
        student_id: params.studentId ?? uid,
        covered_ok: params.coveredOk,
        reflection: params.reflection ?? null,
        coverage: (params.coverage ?? {}) as Json,
      },
      { onConflict: "plan_id" },
    );
    if (error) throw error;
  }

  /** The tutor's "Ali's take" note for a plan, or null if none written yet. */
  static async getTutorNote(planId: string): Promise<TutorNote | null> {
    const { data } = await supabase
      .from("student_weekly_tutor_notes")
      .select("plan_id, note, next_points")
      .eq("plan_id", planId)
      .maybeSingle();
    if (!data) return null;
    return { plan_id: data.plan_id, note: data.note, next_points: data.next_points ?? [] };
  }

  /**
   * Save the tutor's take on a week (note + the spec points they line up for
   * next week). Tutor-only via RLS; `studentId` names whose week it is so the
   * student can read their own note back.
   */
  static async saveTutorNote(params: {
    planId: string;
    studentId: string;
    note: string | null;
    nextPoints: string[];
  }): Promise<void> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const { error } = await supabase.from("student_weekly_tutor_notes").upsert(
      {
        plan_id: params.planId,
        student_id: params.studentId,
        author_id: uid,
        note: params.note,
        next_points: params.nextPoints,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_id" },
    );
    if (error) throw error;
  }

  /** Display labels (code + title) for a set of spec points, in curriculum order. */
  static async getSpecPointLabels(specPointIds: string[]): Promise<SpecPointLabel[]> {
    if (specPointIds.length === 0) return [];
    const data = await selectInSafe<{
      id: string;
      code: string;
      title: string;
      sort_order: number | null;
      topics: { sort_order: number | null } | null;
    }>(specPointIds, (batch) =>
      supabase
        .from("spec_points")
        .select("id, code, title, sort_order, topics!inner(sort_order)")
        .in("id", batch),
    );
    return data
      .map((p) => ({
        id: p.id,
        code: p.code,
        title: p.title,
        _ts: p.topics?.sort_order ?? 0,
        _ps: p.sort_order ?? 0,
      }))
      .sort((a, b) => a._ts - b._ts || a._ps - b._ps || a.code.localeCompare(b.code))
      .map(({ _ts, _ps, ...p }) => p);
  }

  /**
   * Students (with their level + enrolments) for the tutor's planner picker.
   * Tutors can read all profiles and enrolments, so this is a plain roster —
   * anyone with at least one subject enrolment is plannable.
   */
  static async listStudents(): Promise<PlannerStudent[]> {
    // Keyset pagination reads the complete roster even when the API caps rows.
    const [profiles, enrols] = await Promise.all([
      selectInHistory<{
        id: string;
        display_name: string | null;
        level: LevelV | null;
        role: string | null;
      }>(["roster"], (_batch, after) => {
        const query = supabase
          .from("profiles")
          .select("id, display_name, level, role")
          .order("id")
          .limit(500);
        return after ? query.gt("id", after) : query;
      }),
      selectInHistory<{
        id: string;
        student_id: string;
        subject: string;
        board: string;
      }>(["enrolments"], (_batch, after) => {
        const query = supabase
          .from("student_enrolments")
          .select("id, student_id, subject, board")
          .order("id")
          .limit(500);
        return after ? query.gt("id", after) : query;
      }),
    ]);
    const byStudent = new Map<string, { subject: SubjectV; board: BoardV }[]>();
    for (const e of (enrols ?? []) as Array<{
      student_id: string;
      subject: string;
      board: string;
    }>) {
      const list = byStudent.get(e.student_id) ?? [];
      list.push({ subject: e.subject as SubjectV, board: e.board as BoardV });
      byStudent.set(e.student_id, list);
    }
    return (
      (profiles ?? []) as Array<{
        id: string;
        display_name: string | null;
        level: LevelV | null;
        role: string | null;
      }>
    )
      .filter((p) => (p.role ?? "student") === "student")
      .map((p) => ({
        id: p.id,
        name: p.display_name,
        level: p.level,
        enrolments: byStudent.get(p.id) ?? [],
      }))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }
}
