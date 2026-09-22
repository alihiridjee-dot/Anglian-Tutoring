import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import { currentWeekKey } from "./week";
import { WeeklyPlanDAL } from "./weeklyPlanDal";
import { type PlanOverride, type PlanOverrideKind } from "./overrides";

/** What `remove_plan_point` did. */
export interface RemoveResult {
  /** A saved plan row was deleted. */
  removed: boolean;
  /** A `remove` override now stands for the week. */
  blocked: boolean;
  /** `worked` when the student's own work kept the point in place; else null. */
  reason: "worked" | null;
  /** The deleted row's origin, when one was deleted. */
  origin: string | null;
}

/** What `skip_plan_point` did. */
export interface SkipResult {
  /** Plan rows deleted across current and future weeks. */
  removed: number;
  /** Current/future Mondays where a hand-picked row keeps the point. */
  pinnedWeeks: string[];
  /** Current/future Mondays where the student's work kept the point. */
  workedWeeks: string[];
}

type Row = {
  id: string;
  spec_point_id: string;
  kind: PlanOverrideKind;
  week_start: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

const OVERRIDES_TABLE = "student_plan_overrides";
const NOT_INSTALLED =
  "The planner override update is not installed on the database yet. Nothing was changed.";

/** The table or function does not exist: the migration has not been applied. */
function notInstalled(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.code === "42883" ||
    /student_plan_overrides|remove_plan_point|skip_plan_point/.test(error.message ?? "")
  );
}

/**
 * The tutor's overrides on a student's programme ([[overrides]]): reading them,
 * making them, and clearing them. Writes go through the database RPCs so the
 * plan row and the override land in one transaction, with the student's own
 * work protected by the same rule `save_weekly_plan` applies.
 */
export class PlanOverridesDAL {
  /**
   * Every override for one course, oldest first.
   *
   * A database without the override table answers "none" — the scheduler then
   * runs exactly as it did before the feature — but any other failure throws:
   * an override the caller could not read must not be treated as absent, or
   * a re-cut would put back what the tutor took out.
   */
  static async list(studentId: string, subject: SubjectV): Promise<PlanOverride[]> {
    const { data, error } = await supabase
      .from(OVERRIDES_TABLE)
      .select("id, spec_point_id, kind, week_start, note, created_by, created_at")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .order("created_at");
    if (error) {
      if (notInstalled(error)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as Row[]).map((r) => ({
      id: r.id,
      specPointId: r.spec_point_id,
      kind: r.kind,
      weekStart: r.week_start,
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at,
    }));
  }

  /** Whether the database carries the override rule (scheduler version 5 or later). */
  static async available(): Promise<boolean> {
    const { data, error } = await supabase.rpc("assessment_scheduler_version" as never);
    return !error && Number.isFinite(Number(data)) && Number(data) >= 5;
  }

  /** Take a point out of one week, and keep the programme from putting it back. */
  static async remove(params: {
    studentId: string;
    subject: SubjectV;
    specPointId: string;
    weekStart: string;
    note?: string | null;
  }): Promise<RemoveResult> {
    const { data, error } = await supabase.rpc("remove_plan_point", {
      _student_id: params.studentId,
      _subject: params.subject,
      _spec_point_id: params.specPointId,
      _week_start: params.weekStart,
      _note: params.note ?? undefined,
    });
    if (error) throw new Error(notInstalled(error) ? NOT_INSTALLED : error.message);
    const r = data as unknown as RemoveResult;
    return {
      removed: !!r?.removed,
      blocked: !!r?.blocked,
      reason: r?.reason === "worked" ? "worked" : null,
      origin: r?.origin ?? null,
    };
  }

  /** Keep a point out of the programme altogether. */
  static async skip(params: {
    studentId: string;
    subject: SubjectV;
    specPointId: string;
    note?: string | null;
  }): Promise<SkipResult> {
    const { data, error } = await supabase.rpc("skip_plan_point", {
      _student_id: params.studentId,
      _subject: params.subject,
      _spec_point_id: params.specPointId,
      _note: params.note ?? undefined,
    });
    if (error) throw new Error(notInstalled(error) ? NOT_INSTALLED : error.message);
    const r = data as unknown as {
      removed?: number;
      pinned_weeks?: string[];
      worked_weeks?: string[];
    };
    return {
      removed: Number(r?.removed ?? 0),
      pinnedWeeks: r?.pinned_weeks ?? [],
      workedWeeks: r?.worked_weeks ?? [],
    };
  }

  /**
   * Withdraw an override. The point is not put back by this call: a current
   * week is re-cut by the caller, and a future one is cut when it arrives.
   */
  static async clear(overrideId: string): Promise<void> {
    const { error } = await supabase.from(OVERRIDES_TABLE).delete().eq("id", overrideId);
    if (error) throw new Error(notInstalled(error) ? NOT_INSTALLED : error.message);
  }

  /**
   * Pin points into a week as the tutor's choice.
   *
   * A pin outranks an override, so any `remove` the tutor had set on these
   * points for this week is withdrawn first — pinning a point back into the
   * week you removed it from is changing your mind, and the record should say
   * so. A `skip` is left standing: it binds the programme, not the pin, and a
   * tutor who skips a point in general but wants it this one week means both.
   */
  static async pin(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
    specPointIds: string[];
  }): Promise<void> {
    if (params.specPointIds.length === 0) return;
    if (params.weekStart < currentWeekKey())
      throw new Error("Past weeks are history and cannot be changed.");
    const { error } = await supabase
      .from(OVERRIDES_TABLE)
      .delete()
      .eq("student_id", params.studentId)
      .eq("subject", params.subject)
      .eq("kind", "remove")
      .eq("week_start", params.weekStart)
      .in("spec_point_id", params.specPointIds);
    if (error && !notInstalled(error)) throw new Error(error.message);
    await WeeklyPlanDAL.addToWeek({ ...params, origin: "tutor" });
  }

  /**
   * Move a point from one week to another: out of the first as a removal, into
   * the second as a pin. Two statements, in that order, so a failure on the
   * second leaves the point removed rather than duplicated. Returns the removal
   * result so a caller can report a point the student's work kept in place.
   */
  static async move(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    specPointId: string;
    fromWeek: string;
    toWeek: string;
    note?: string | null;
  }): Promise<RemoveResult> {
    if (params.toWeek === params.fromWeek) throw new Error("Choose a different week.");
    if (params.toWeek < currentWeekKey())
      throw new Error("Past weeks are history and cannot be changed.");
    const result = await this.remove({
      studentId: params.studentId,
      subject: params.subject,
      specPointId: params.specPointId,
      weekStart: params.fromWeek,
      note: params.note ?? `Moved to the week of ${params.toWeek}`,
    });
    if (result.reason === "worked") return result;
    await this.pin({
      studentId: params.studentId,
      subject: params.subject,
      board: params.board,
      level: params.level,
      weekStart: params.toWeek,
      specPointIds: [params.specPointId],
    });
    return result;
  }
}
