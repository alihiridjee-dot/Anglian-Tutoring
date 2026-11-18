import { readSourceRows, type SourceRows } from "./readModels";

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

  return sourcesFromRows(await readSourceRows(specPointIds));
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

/**
 * Every spec point with any assessment material behind it — a homework resource
 * or an MCQ set that could produce a mark.
 *
 * The denominator for {@link assessTopic}. Without it the engine cannot tell a
 * point nobody has written a question for from one the student skipped, and
 * grades both as zero. `setScope` is deliberately not consulted: it carries the
 * `__unattributed__` placeholder for untagged questions, which is a reason
 * *not* to attribute a mark, not evidence that practice exists on a point.
 */
export function assessablePoints(sources: AttemptSources): Set<string> {
  const out = new Set<string>();
  for (const points of sources.resourceToPoints.values()) for (const p of points) out.add(p);
  for (const points of sources.setToPoints.values()) for (const p of points) out.add(p);
  return out;
}
