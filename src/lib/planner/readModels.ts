import { supabase } from "@/integrations/supabase/client";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

export interface SourceRows {
  resourceLinks: { resource_id: string; spec_point_id: string }[];
  setLinks: { set_id: string; spec_point_id: string }[];
  setScope: { set_id: string; spec_point_id: string }[];
}
export interface HomeworkEvidenceRow {
  id: string; resource_id: string; score_pct: number | null;
  graded_at: string | null; submitted_at: string;
}
export interface QuizEvidenceRow {
  id: string; set_id: string; score: number | null; total: number | null;
  created_at: string; point_scores?: unknown;
}
export interface CourseSnapshot {
  topics: { id: string; title: string; sort_order: number | null }[];
  points: { id: string; code: string; title: string; sort_order: number | null;
    topic_id: string; weight: number | null }[];
  sources: SourceRows;
  submissions: HomeworkEvidenceRow[];
  attempts: QuizEvidenceRow[];
}

/** Only an absent migration permits the compatibility read path. RLS/network
 * errors must propagate rather than silently changing the source of truth. */
export function missingPlannerRpc(error: { code?: string; message: string }): boolean {
  return error.code === "PGRST202" ||
    (error.code === "42883" && /planner_(course_snapshot|attempt_sources)/.test(error.message));
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
export const readCourseSnapshot = (p: { studentId: string; subject: SubjectV; board: BoardV; level: LevelV }) =>
  readRpc<CourseSnapshot>("planner_course_snapshot", {
    _student: p.studentId, _subject: p.subject, _board: p.board, _level: p.level,
  });
export const readSourceRows = (ids: string[]) =>
  readRpc<SourceRows>("planner_attempt_sources", { _ids: [...new Set(ids)] });
