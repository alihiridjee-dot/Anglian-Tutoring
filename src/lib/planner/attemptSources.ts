import { supabase } from "@/integrations/supabase/client";
import { selectInSafe } from "@/lib/db/chunked";

/**
 * Where practice on a spec point can come from: homework resources (linked via
 * resource_spec_points or a direct resources.spec_point_id) and MCQ sets
 * (linked via mcq_sets.spec_point_id or per-question tags). Both the FSRS
 * review sync ([[scheduleDal]]) and the weekly coverage check
 * ([[weeklyPlanDal]]) need the same source → spec-points mapping, so it lives
 * here once.
 */
export interface AttemptSources {
  /** Homework resource id → the spec points it practises. */
  resourceToPoints: Map<string, Set<string>>;
  /** MCQ set id → the spec points it practises. */
  setToPoints: Map<string, Set<string>>;
}

export async function mapAttemptSources(specPointIds: string[]): Promise<AttemptSources> {
  const resourceToPoints = new Map<string, Set<string>>();
  const setToPoints = new Map<string, Set<string>>();
  if (specPointIds.length === 0) return { resourceToPoints, setToPoints };

  const [rsp, directRes, setsDirect, qTagged] = await Promise.all([
    selectInSafe<{
      resource_id: string;
      spec_point_id: string;
      resources: { kind: string } | null;
    }>(specPointIds, (batch) =>
      supabase
        .from("resource_spec_points")
        .select("resource_id, spec_point_id, resources!inner(kind)")
        .in("spec_point_id", batch),
    ),
    selectInSafe<{ id: string; spec_point_id: string | null; kind: string }>(
      specPointIds,
      (batch) =>
        supabase.from("resources").select("id, spec_point_id, kind").in("spec_point_id", batch),
    ),
    selectInSafe<{ id: string; spec_point_id: string | null }>(specPointIds, (batch) =>
      supabase.from("mcq_sets").select("id, spec_point_id").in("spec_point_id", batch),
    ),
    selectInSafe<{ set_id: string; spec_point_id: string | null }>(specPointIds, (batch) =>
      supabase.from("mcq_questions").select("set_id, spec_point_id").in("spec_point_id", batch),
    ),
  ]);

  const push = (m: Map<string, Set<string>>, key: string, point: string) => {
    const s = m.get(key) ?? new Set<string>();
    s.add(point);
    m.set(key, s);
  };
  for (const r of rsp) {
    if (r.resources?.kind === "homework") push(resourceToPoints, r.resource_id, r.spec_point_id);
  }
  for (const r of directRes) {
    if (r.kind === "homework" && r.spec_point_id) push(resourceToPoints, r.id, r.spec_point_id);
  }
  for (const r of setsDirect) {
    if (r.spec_point_id) push(setToPoints, r.id, r.spec_point_id);
  }
  for (const r of qTagged) {
    if (r.spec_point_id) push(setToPoints, r.set_id, r.spec_point_id);
  }
  return { resourceToPoints, setToPoints };
}
