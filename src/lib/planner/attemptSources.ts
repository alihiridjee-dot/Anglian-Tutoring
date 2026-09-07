import { readSourceRows, type SourceRows } from "./readModels";
import { supabase } from "@/integrations/supabase/client";
import { selectIn } from "@/lib/db/chunked";

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
  /** Complete set scope, even when the caller asks for only one point. */
  setScope: Map<string, Set<string>>;
}

export async function mapAttemptSources(specPointIds: string[]): Promise<AttemptSources> {
  const resourceToPoints = new Map<string, Set<string>>();
  const setToPoints = new Map<string, Set<string>>();
  const setScope = new Map<string, Set<string>>();
  if (specPointIds.length === 0) return { resourceToPoints, setToPoints, setScope };

  const snapshot = await readSourceRows(specPointIds);
  if (snapshot) return sourcesFromRows(snapshot);

  const [rsp, directRes, setsDirect, qTagged] = await Promise.all([
    selectIn<{
      resource_id: string;
      spec_point_id: string;
      resources: { kind: string } | null;
    }>(specPointIds, (batch) =>
      supabase
        .from("resource_spec_points")
        .select("resource_id, spec_point_id, resources!inner(kind)")
        .in("spec_point_id", batch),
    ),
    selectIn<{ id: string; spec_point_id: string | null; kind: string }>(specPointIds, (batch) =>
      supabase.from("resources").select("id, spec_point_id, kind").in("spec_point_id", batch),
    ),
    selectIn<{ id: string; spec_point_id: string | null }>(specPointIds, (batch) =>
      supabase.from("mcq_sets").select("id, spec_point_id").in("spec_point_id", batch),
    ),
    selectIn<{ set_id: string; spec_point_id: string | null }>(specPointIds, (batch) =>
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
  const setIds = [...setToPoints.keys()];
  const [allQuestions, allSets] = await Promise.all([
    selectIn<{ set_id: string; spec_point_id: string | null }>(setIds, (batch) =>
      supabase.from("mcq_questions").select("set_id, spec_point_id").in("set_id", batch),
    ),
    selectIn<{ id: string; spec_point_id: string | null }>(setIds, (batch) =>
      supabase.from("mcq_sets").select("id, spec_point_id").in("id", batch),
    ),
  ]);
  for (const row of allSets) if (row.spec_point_id) push(setScope, row.id, row.spec_point_id);
  const directBySet = new Map(allSets.map((set) => [set.id, set.spec_point_id]));
  for (const row of allQuestions) {
    // Untagged questions without a direct set tag make aggregate attribution unsafe.
    const direct = directBySet.get(row.set_id);
    push(setScope, row.set_id, row.spec_point_id ?? direct ?? "__unattributed__");
  }
  return { resourceToPoints, setToPoints, setScope };
}

/** Hydrate the RPC result once for all evidence and coverage consumers. */
export function sourcesFromRows(rows: SourceRows): AttemptSources {
  const resourceToPoints = new Map<string, Set<string>>();
  const setToPoints = new Map<string, Set<string>>();
  const setScope = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, id: string, point: string) => {
    if (!map.has(id)) map.set(id, new Set());
    map.get(id)!.add(point);
  };
  for (const r of rows.resourceLinks) add(resourceToPoints, r.resource_id, r.spec_point_id);
  for (const r of rows.setLinks) add(setToPoints, r.set_id, r.spec_point_id);
  for (const r of rows.setScope) add(setScope, r.set_id, r.spec_point_id);
  return { resourceToPoints, setToPoints, setScope };
}
