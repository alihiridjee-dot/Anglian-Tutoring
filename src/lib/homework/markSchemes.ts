import { supabase } from "@/integrations/supabase/client";

/**
 * The homework_questions columns a browser may read. `mark_scheme` is not one
 * of them: selecting it is refused, because a student who could read it could
 * read the answers before writing their own. It arrives through
 * {@link withMarkSchemes} instead, once the server agrees to release it.
 */
export const QUESTION_COLUMNS =
  "id, resource_id, position, prompt, marks, answer_type, spec_point_id";

/**
 * Attach each question's mark scheme where `homework_mark_schemes` releases it:
 * always to a tutor, and to a student (or their parent) once that student's
 * submission has been marked. Everyone else gets `null`, which every surface
 * already treats as "no scheme to show".
 */
export async function withMarkSchemes<T extends { id: string; resource_id: string }>(
  rows: T[],
): Promise<(T & { mark_scheme: string | null })[]> {
  if (rows.length === 0) return [];
  const resourceIds = [...new Set(rows.map((q) => q.resource_id))];
  const { data, error } = await supabase.rpc("homework_mark_schemes", {
    _resource_ids: resourceIds,
  });
  if (error) throw error;
  const byId = new Map((data ?? []).map((r) => [r.question_id, r.mark_scheme]));
  return rows.map((q) => ({ ...q, mark_scheme: byId.get(q.id) ?? null }));
}
