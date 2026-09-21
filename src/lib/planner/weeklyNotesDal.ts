import { supabase } from "@/integrations/supabase/client";
import { type Json } from "@/integrations/supabase/types";
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

/**
 * The words around a week: the student's end-of-week check-in and the tutor's
 * note on it. Both hang off a plan id from [[weeklyPlanDal]].
 */
export class WeeklyNotesDAL {
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
}
