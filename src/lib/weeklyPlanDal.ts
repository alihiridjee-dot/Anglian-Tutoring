import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Database, type Json } from "@/integrations/supabase/types";
import { type PointCoverage } from "./planner/coverage";
import { mapAttemptSources } from "./planner/attemptSources";
import { selectInSafe } from "./db/chunked";
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
};

type PointRow = {
  origin: PlanPointOrigin;
  carried_from: string | null;
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

/**
 * Data Access Layer for the per-student weekly plan — the editable set of spec
 * points a student commits to for one Mon–Sun week. A plan is unique per
 * (student, subject, week_start); its points drive which homework/MCQs surface.
 * All writes bind to the caller via RLS (`auth.uid() = student_id`).
 */
export class WeeklyPlanDAL {
  /** The plan (and its points, in curriculum order) for a given week, or null. */
  static async getPlan(
    studentId: string,
    subject: SubjectV,
    weekStart: string,
  ): Promise<{ plan: WeeklyPlan; points: PlanPoint[] } | null> {
    const { data: plan, error } = await supabase
      .from("student_weekly_plans")
      .select("id, subject, board, level, week_start, source, note, ai_rationale")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (error) {
      console.error("Error loading weekly plan:", error);
      return null;
    }
    if (!plan) return null;

    const { data: rows } = await supabase
      .from("student_weekly_plan_points")
      .select(
        "origin, carried_from, spec_points!inner(id, code, title, description, topic_id, sort_order, topics!inner(title, sort_order))",
      )
      .eq("plan_id", plan.id);

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
        _ts: r.spec_points!.topics?.sort_order ?? 0,
        _ps: r.spec_points!.sort_order ?? 0,
      }))
      .sort((a, b) => a._ts - b._ts || a._ps - b._ps || a.code.localeCompare(b.code))
      .map(({ _ts, _ps, ...p }) => p);

    return { plan: plan as WeeklyPlan, points };
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
      _points: params.specPointIds.map((spec_point_id) => ({
        spec_point_id,
        origin: params.origins?.[spec_point_id] ?? params.origin ?? "ai",
        carried_from: params.carriedFroms?.[spec_point_id] ?? params.carriedFrom ?? null,
      })) as unknown as Json,
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
    const { error } = await supabase.from("student_weekly_plan_points").upsert(
      specPointIds.map((spec_point_id) => ({
        plan_id: planId,
        spec_point_id,
        origin: opts.origins?.[spec_point_id] ?? origin,
        carried_from: opts.carriedFrom ?? null,
      })),
      { onConflict: "plan_id,spec_point_id", ignoreDuplicates: true },
    );
    if (error) throw error;
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
   * For a set of spec points, whether each has homework and/or a published quiz
   * — so the weekly plan can show, per point, that practice is waiting. Batched
   * into three `in` queries rather than N per-point lookups.
   */
  static async getActivity(
    specPointIds: string[],
  ): Promise<Map<string, { hasHomework: boolean; hasQuiz: boolean }>> {
    const out = new Map<string, { hasHomework: boolean; hasQuiz: boolean }>();
    if (specPointIds.length === 0) return out;
    for (const id of specPointIds) out.set(id, { hasHomework: false, hasQuiz: false });

    const [res, directRes, taggedQ, directSets] = await Promise.all([
      selectInSafe<{ spec_point_id: string; resources: { kind: string } | null }>(
        specPointIds,
        (batch) =>
          supabase
            .from("resource_spec_points")
            .select("spec_point_id, resources!inner(kind)")
            .in("spec_point_id", batch),
      ),
      // Homework linked straight off the resource rather than through the join
      // table. `mapAttemptSources` counts both, so this must too — a homework
      // visible to coverage but invisible here would let the review's lock open
      // on work it can't see.
      selectInSafe<{ spec_point_id: string | null; kind: string }>(specPointIds, (batch) =>
        supabase.from("resources").select("spec_point_id, kind").in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null }>(specPointIds, (batch) =>
        supabase.from("mcq_questions").select("spec_point_id").in("spec_point_id", batch),
      ),
      selectInSafe<{ spec_point_id: string | null }>(specPointIds, (batch) =>
        supabase.from("mcq_sets").select("spec_point_id").in("spec_point_id", batch),
      ),
    ]);

    for (const r of res) {
      if (r.resources?.kind === "homework") {
        const e = out.get(r.spec_point_id);
        if (e) e.hasHomework = true;
      }
    }
    for (const r of directRes) {
      if (r.kind !== "homework" || !r.spec_point_id) continue;
      const e = out.get(r.spec_point_id);
      if (e) e.hasHomework = true;
    }
    for (const r of taggedQ) {
      if (r.spec_point_id && out.has(r.spec_point_id)) out.get(r.spec_point_id)!.hasQuiz = true;
    }
    for (const r of directSets) {
      if (r.spec_point_id && out.has(r.spec_point_id)) out.get(r.spec_point_id)!.hasQuiz = true;
    }
    return out;
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
      selectInSafe<{ resource_id: string; score_pct: number | null }>(resourceIds, (batch) =>
        supabase
          .from("homework_submissions")
          .select("resource_id, score_pct")
          .eq("student_id", studentId)
          .in("resource_id", batch),
      ),
      selectInSafe<{ set_id: string; score: number | null; total: number | null }>(
        setIds,
        (batch) =>
          supabase
            .from("mcq_attempts")
            .select("set_id, score, total")
            .eq("user_id", studentId)
            .in("set_id", batch),
      ),
    ]);

    const merge = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);

    for (const sub of subs) {
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
    // Both bounded. The enrolments read had no limit at all, so it grew with
    // the roster and relied on whatever server-side cap happened to apply.
    const [{ data: profiles }, { data: enrols }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, level, role").limit(1000),
      supabase.from("student_enrolments").select("student_id, subject, board").limit(5000),
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
