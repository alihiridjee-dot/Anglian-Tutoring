import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Database, type Json } from "@/integrations/supabase/types";
import { type PointCoverage } from "./planner/coverage";

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
  origin: PlanPointOrigin;
};

type PointRow = {
  origin: PlanPointOrigin;
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
        "origin, spec_points!inner(id, code, title, description, topic_id, sort_order, topics!inner(title, sort_order))",
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
    /** Whose plan — omit for the signed-in student; a tutor passes the target. */
    studentId?: string;
  }): Promise<string> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;

    const { data: plan, error } = await supabase
      .from("student_weekly_plans")
      .upsert(
        {
          student_id: studentId,
          subject: params.subject,
          board: params.board,
          level: params.level,
          week_start: params.weekStart,
          source: params.source,
          ai_rationale: params.rationale ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,subject,week_start" },
      )
      .select("id")
      .single();
    if (error) throw error;

    const planId = plan.id;
    // Swap the point set wholesale — simplest correct semantics for "this is the
    // plan now", and the table is tiny (a handful of rows per plan).
    await supabase.from("student_weekly_plan_points").delete().eq("plan_id", planId);
    if (params.specPointIds.length > 0) {
      const { error: insErr } = await supabase.from("student_weekly_plan_points").insert(
        params.specPointIds.map((spec_point_id) => ({
          plan_id: planId,
          spec_point_id,
          origin: params.origin ?? "ai",
        })),
      );
      if (insErr) throw insErr;
    }
    return planId;
  }

  /** Add spec points to an existing plan (ignores ones already present). */
  static async addPoints(
    planId: string,
    specPointIds: string[],
    origin: PlanPointOrigin = "student",
  ): Promise<void> {
    if (specPointIds.length === 0) return;
    const { error } = await supabase.from("student_weekly_plan_points").upsert(
      specPointIds.map((spec_point_id) => ({ plan_id: planId, spec_point_id, origin })),
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

    const [res, taggedQ, directSets] = await Promise.all([
      supabase
        .from("resource_spec_points")
        .select("spec_point_id, resources!inner(kind)")
        .in("spec_point_id", specPointIds),
      supabase.from("mcq_questions").select("spec_point_id").in("spec_point_id", specPointIds),
      supabase.from("mcq_sets").select("spec_point_id").in("spec_point_id", specPointIds),
    ]);

    for (const r of (res.data ?? []) as unknown as Array<{
      spec_point_id: string;
      resources: { kind: string } | null;
    }>) {
      if (r.resources?.kind === "homework") {
        const e = out.get(r.spec_point_id);
        if (e) e.hasHomework = true;
      }
    }
    for (const r of (taggedQ.data ?? []) as Array<{ spec_point_id: string | null }>) {
      if (r.spec_point_id && out.has(r.spec_point_id)) out.get(r.spec_point_id)!.hasQuiz = true;
    }
    for (const r of (directSets.data ?? []) as Array<{ spec_point_id: string | null }>) {
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
    const [rsp, directRes, setsDirect, qTagged] = await Promise.all([
      supabase
        .from("resource_spec_points")
        .select("resource_id, spec_point_id, resources!inner(kind)")
        .in("spec_point_id", specPointIds),
      supabase
        .from("resources")
        .select("id, spec_point_id, kind")
        .in("spec_point_id", specPointIds),
      supabase.from("mcq_sets").select("id, spec_point_id").in("spec_point_id", specPointIds),
      supabase
        .from("mcq_questions")
        .select("set_id, spec_point_id")
        .in("spec_point_id", specPointIds),
    ]);

    const push = (m: Map<string, Set<string>>, key: string, point: string) => {
      const s = m.get(key) ?? new Set<string>();
      s.add(point);
      m.set(key, s);
    };
    const resourceToPoints = new Map<string, Set<string>>();
    for (const r of (rsp.data ?? []) as unknown as Array<{
      resource_id: string;
      spec_point_id: string;
      resources: { kind: string } | null;
    }>) {
      if (r.resources?.kind === "homework") push(resourceToPoints, r.resource_id, r.spec_point_id);
    }
    for (const r of (directRes.data ?? []) as Array<{
      id: string;
      spec_point_id: string | null;
      kind: string;
    }>) {
      if (r.kind === "homework" && r.spec_point_id) push(resourceToPoints, r.id, r.spec_point_id);
    }

    const setToPoints = new Map<string, Set<string>>();
    for (const r of (setsDirect.data ?? []) as Array<{
      id: string;
      spec_point_id: string | null;
    }>) {
      if (r.spec_point_id) push(setToPoints, r.id, r.spec_point_id);
    }
    for (const r of (qTagged.data ?? []) as Array<{
      set_id: string;
      spec_point_id: string | null;
    }>) {
      if (r.spec_point_id) push(setToPoints, r.set_id, r.spec_point_id);
    }

    const resourceIds = [...resourceToPoints.keys()];
    const setIds = [...setToPoints.keys()];

    const [subs, attempts] = await Promise.all([
      resourceIds.length
        ? supabase
            .from("homework_submissions")
            .select("resource_id, score_pct")
            .eq("student_id", studentId)
            .in("resource_id", resourceIds)
        : Promise.resolve({ data: [] as Array<{ resource_id: string; score_pct: number | null }> }),
      setIds.length
        ? supabase
            .from("mcq_attempts")
            .select("set_id, score, total")
            .eq("user_id", studentId)
            .in("set_id", setIds)
        : Promise.resolve({
            data: [] as Array<{ set_id: string; score: number | null; total: number | null }>,
          }),
    ]);

    const merge = (a: number | null, b: number | null) =>
      b == null ? a : a == null ? b : Math.max(a, b);

    for (const sub of (subs.data ?? []) as Array<{
      resource_id: string;
      score_pct: number | null;
    }>) {
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
    for (const a of (attempts.data ?? []) as Array<{
      set_id: string;
      score: number | null;
      total: number | null;
    }>) {
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
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
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
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
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
    const { data } = await supabase
      .from("spec_points")
      .select("id, code, title, sort_order, topics!inner(sort_order)")
      .in("id", specPointIds);
    return ((data ?? []) as unknown as Array<{
      id: string;
      code: string;
      title: string;
      sort_order: number | null;
      topics: { sort_order: number | null } | null;
    }>)
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
    const [{ data: profiles }, { data: enrols }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, level, role").limit(1000),
      supabase.from("student_enrolments").select("student_id, subject, board"),
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
