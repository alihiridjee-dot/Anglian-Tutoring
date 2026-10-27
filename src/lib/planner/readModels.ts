import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SubjectV, BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { dbError } from "@/lib/platform/errors";

export interface SourceRows {
  resourceLinks: { resource_id: string; spec_point_id: string }[];
  setLinks: { set_id: string; spec_point_id: string }[];
  setScope: { set_id: string; spec_point_id: string }[];
}
export interface HomeworkEvidenceRow {
  id: string;
  resource_id: string;
  score_pct: number | null;
  graded_at: string | null;
  submitted_at: string;
}
export interface QuizEvidenceRow {
  id: string;
  set_id: string;
  score: number | null;
  total: number | null;
  created_at: string;
  point_scores?: unknown;
}
/** The work behind a set of spec points and the student's graded attempts at it. */
export interface PointEvidence {
  sources: SourceRows;
  submissions: HomeworkEvidenceRow[];
  attempts: QuizEvidenceRow[];
}
export interface CourseSnapshot extends PointEvidence {
  topics: { id: string; title: string; sort_order: number | null }[];
  points: {
    id: string;
    code: string;
    title: string;
    sort_order: number | null;
    topic_id: string;
    weight: number | null;
  }[];
}

/** One saved week's point, with the spec point and topic behind it. */
export interface WeekPointRow {
  origin: Database["public"]["Enums"]["plan_point_origin"];
  carried_from: string | null;
  done_at: string | null;
  spec_points: {
    id: string;
    code: string;
    title: string;
    description: string | null;
    topic_id: string;
    sort_order: number;
    topics: {
      title: string | null;
      sort_order: number;
      subject: SubjectV;
      board: BoardV;
      level: LevelV;
    } | null;
  } | null;
}

/** `planner_state`: everything one open of one course reads, as the old reads returned it. */
export interface PlannerStateRows {
  course: CourseSnapshot;
  programme: { program_start: string; exam_date: string; pacing: Json } | null;
  profile: { level: LevelV | null; exam_year: number | null } | null;
  boards: BoardV[];
  pauses: {
    id: string;
    reason: string;
    started_at: string;
    ended_at: string | null;
    programme_resumed_at: string | null;
  }[];
  breaks: {
    id: string;
    starts_on: string;
    ends_on: string;
    reason: string;
    recorded_at: string | null;
  }[];
  overrides: {
    id: string;
    spec_point_id: string;
    kind: Database["public"]["Enums"]["plan_override_kind"];
    week_start: string | null;
    note: string | null;
    created_by: string | null;
    created_at: string;
  }[];
  ledger: {
    week_start: string;
    student_weekly_plan_points: { spec_point_id: string; done_at: string | null }[];
  }[];
  week: {
    plan: {
      id: string;
      subject: SubjectV;
      board: BoardV;
      level: LevelV;
      week_start: string;
      source: Database["public"]["Enums"]["plan_source"];
      note: string | null;
      ai_rationale: string | null;
    };
    points: WeekPointRow[];
  } | null;
  scheduler_version: number;
}

/** Only an absent migration permits the compatibility read path. RLS/network
 * errors must propagate rather than silently changing the source of truth. */
export function missingPlannerRpc(error: { code?: string; message: string }): boolean {
  return (
    error.code === "PGRST202" ||
    (error.code === "42883" && /planner_(course_snapshot|attempt_sources)/.test(error.message))
  );
}
async function readRpc<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) {
    if (missingPlannerRpc(error)) return null;
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object") throw new Error(`Invalid ${name} response`);
  return data as unknown as T;
}
export const readCourseSnapshot = (p: {
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
}) =>
  readRpc<CourseSnapshot>("planner_course_snapshot", {
    _student: p.studentId,
    _subject: p.subject,
    _board: p.board,
    _level: p.level,
  });
export const readSourceRows = (ids: string[]) =>
  readRpc<SourceRows>("planner_attempt_sources", { _ids: [...new Set(ids)] });

/** A read with no fallback: the app ships after the migration that adds it. */
async function readRequired<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw dbError(error);
  if (!data || typeof data !== "object") throw new Error(`Invalid ${name} response`);
  return data as unknown as T;
}
/** One course for one week, in one trip ([[courseState]]). */
export const readPlannerState = (
  p: { studentId: string; subject: SubjectV; board: BoardV; level: LevelV },
  weekStart: string,
) =>
  readRequired<PlannerStateRows>("planner_state", {
    _student: p.studentId,
    _subject: p.subject,
    _board: p.board,
    _level: p.level,
    _week: weekStart,
  });
/** What a student attempted on a set of points, in one trip. */
export const readPointEvidence = (studentId: string, ids: string[]) =>
  readRequired<PointEvidence>("planner_point_evidence", {
    _student: studentId,
    _ids: [...new Set(ids)],
  });
