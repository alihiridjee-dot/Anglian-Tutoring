import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import { type Database, type Json } from "@/integrations/supabase/types";
import {
  describeReason,
  isHandPicked,
  partition,
  spineReach,
  type Rejection,
  type Partitioned,
} from "./admissibility";
import { ScheduleDAL } from "./scheduleDal";
import { type PacingBand } from "./pacing";
import { selectIn } from "../platform/db/chunked";
import { getSessionUserId } from "@/lib/auth/session";

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
        reviewReach: spineReach((baseline?.pacing ?? []) as unknown as PacingBand[], true),
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
   *
   * Returns how many points passed admissibility and were sent to the plan, so a
   * caller can tell "added" from "all refused".
   */
  static async addPoints(
    planId: string,
    specPointIds: string[],
    origin: PlanPointOrigin = "student",
    opts: { origins?: Record<string, PlanPointOrigin>; carriedFrom?: string | null } = {},
  ): Promise<number> {
    if (specPointIds.length === 0) return 0;

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
    if (points.length === 0) return 0;

    const { error } = await supabase.from("student_weekly_plan_points").upsert(
      points.map((p) => ({ plan_id: planId, ...p })),
      { onConflict: "plan_id,spec_point_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    return points.length;
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

  /**
   * "Retake this topic": pull every one of a topic's spec points back into the
   * current week's plan as an explicit practice request. It never changes memory. Used
   * by the "covered so far" ledger. Returns how many points were newly added.
   *
   * Filed as `student` (or `tutor`, when a tutor asks on the student's behalf) —
   * a person's choice. It used to be `carried_over`, which no re-cut protects:
   * neither `refreshWeek` nor `save_weekly_plan` keeps that origin, so the
   * retaken topic vanished the next time the week was re-planned.
   */
  static async resurfaceTopic(params: {
    studentId?: string;
    topicId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
  }): Promise<number> {
    const uid = await getSessionUserId();
    if (!uid) throw new Error("Not signed in");
    const studentId = params.studentId ?? uid;
    const who = studentId === uid ? "student" : "tutor";

    const { data: pts, error } = await supabase
      .from("spec_points")
      .select("id")
      .eq("topic_id", params.topicId);
    if (error) throw error;
    const ids = (pts ?? []).map((p) => p.id);
    if (ids.length === 0) return 0;

    // Add them to this week's plan (create the plan if there isn't one yet).
    const existing = await this.getPlan(studentId, params.subject, params.weekStart);
    if (existing) {
      // Already in the week — active or withheld — is not "added".
      const present = new Set([
        ...existing.points.map((p) => p.spec_point_id),
        ...existing.withheld.map((w) => w.point.spec_point_id),
      ]);
      const fresh = ids.filter((id) => !present.has(id));
      await this.addPoints(existing.plan.id, fresh, who);
      // An explicit practice request changes the assignment, not the memory model.
      return fresh.length;
    }
    await this.savePlan({
      subject: params.subject,
      board: params.board,
      level: params.level,
      weekStart: params.weekStart,
      specPointIds: ids,
      source: who,
      origin: who,
      studentId,
    });
    return ids.length;
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
}
