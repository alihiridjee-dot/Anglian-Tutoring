import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PointMark } from "./questionIdeas";

// A student's recent marks, point by point. Read through whichever client the
// caller holds (the server's for tutor-question ideas, the browser's for the
// help box), so RLS decides what comes back either way.

/** How far back to look: their newest quizzes and marked tasks. */
const RECENT = 100;

type Supabase = SupabaseClient<Database>;

/**
 * Every recent mark the student has on a spec point. A quiz attempt carries
 * its own per-point scores; an older one without them counts against its set's
 * point. A task's mark counts against every point the task practises.
 */
export async function recentMarks(supabase: Supabase, userId: string): Promise<PointMark[]> {
  const [attempts, subs] = await Promise.all([
    supabase
      .from("mcq_attempts")
      .select("set_id, score, total, point_scores, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(RECENT),
    supabase
      .from("homework_submissions")
      .select("resource_id, score_pct, graded_at, submitted_at")
      .eq("student_id", userId)
      .not("score_pct", "is", null)
      .order("submitted_at", { ascending: false })
      .limit(RECENT),
  ]);
  if (attempts.error) throw attempts.error;
  if (subs.error) throw subs.error;

  const marks: PointMark[] = [];
  const unpointed: typeof attempts.data = [];
  for (const a of attempts.data ?? []) {
    const scores = a.point_scores;
    if (scores && typeof scores === "object" && !Array.isArray(scores)) {
      const entries = Object.entries(scores).filter(
        (e): e is [string, number] => typeof e[1] === "number",
      );
      if (entries.length > 0) {
        for (const [specPointId, pct] of entries)
          marks.push({ specPointId, pct, at: a.created_at });
        continue;
      }
    }
    unpointed.push(a);
  }

  const setIds = [...new Set(unpointed.filter((a) => a.total > 0).map((a) => a.set_id))];
  const resourceIds = [...new Set((subs.data ?? []).map((s) => s.resource_id))];
  const [sets, direct, linked] = await Promise.all([
    setIds.length
      ? supabase.from("mcq_sets").select("id, spec_point_id").in("id", setIds)
      : { data: [], error: null },
    resourceIds.length
      ? supabase.from("resources").select("id, spec_point_id").in("id", resourceIds)
      : { data: [], error: null },
    resourceIds.length
      ? supabase
          .from("resource_spec_points")
          .select("resource_id, spec_point_id")
          .in("resource_id", resourceIds)
      : { data: [], error: null },
  ]);
  if (sets.error) throw sets.error;
  if (direct.error) throw direct.error;
  if (linked.error) throw linked.error;

  const pointOfSet = new Map((sets.data ?? []).map((s) => [s.id, s.spec_point_id]));
  for (const a of unpointed) {
    const point = pointOfSet.get(a.set_id);
    if (point && a.total > 0)
      marks.push({ specPointId: point, pct: (a.score * 100) / a.total, at: a.created_at });
  }

  const pointsOf = new Map<string, Set<string>>();
  const add = (resourceId: string, point: string | null) => {
    if (!point) return;
    const s = pointsOf.get(resourceId) ?? new Set<string>();
    s.add(point);
    pointsOf.set(resourceId, s);
  };
  for (const r of direct.data ?? []) add(r.id, r.spec_point_id);
  for (const r of linked.data ?? []) add(r.resource_id, r.spec_point_id);
  for (const s of subs.data ?? []) {
    if (s.score_pct == null) continue;
    for (const specPointId of pointsOf.get(s.resource_id) ?? [])
      marks.push({
        specPointId,
        pct: Number(s.score_pct),
        at: s.graded_at ?? s.submitted_at,
      });
  }
  return marks;
}
