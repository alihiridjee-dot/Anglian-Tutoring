import { type PlanPoint, type PlanPointOrigin } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type WeekSelection } from "@/lib/planner/weekCut";
import { isHandPicked } from "@/lib/planner/admissibility";
import { type PlanOverride, overridesForWeek } from "@/lib/planner/overrides";
import { STRONG_THRESHOLD } from "@/lib/planner/coverage";

/**
 * What the tutor's week screen shows, per spec point.
 *
 * A saved week is what the student has; a projected one is what the programme
 * will give them when the week is cut. The tutor needs both on one list — the
 * point of editing next week is to change it *before* the student meets it —
 * and needs to be told which is which, because a projected row can still be
 * removed with nothing to delete, and a saved one cannot be un-worked.
 */
export interface TutorWeekRow {
  specPointId: string;
  code: string;
  title: string;
  topicId: string;
  topicTitle: string;
  /** Written to the student's plan, or only what the programme would write. */
  state: "saved" | "projected";
  origin: PlanPointOrigin;
  /** A person put it here: exempt from the programme's re-cuts and overrides. */
  pinned: boolean;
  carriedFrom: string | null;
  doneAt: string | null;
}

/** A topic's rows, in curriculum order. */
export interface TutorWeekGroup {
  topicId: string;
  title: string;
  rows: TutorWeekRow[];
}

/** Ids of every point in a topic, in curriculum order, from the roadmap. */
function pointIndex(roadmap: RoadmapResult | null) {
  const points = new Map<
    string,
    { code: string; title: string; topicId: string; topicTitle: string; order: number }
  >();
  let order = 0;
  for (const t of roadmap?.progress ?? [])
    for (const p of t.points)
      points.set(p.id, {
        code: p.code,
        title: p.title,
        topicId: t.topicId,
        topicTitle: t.title,
        order: order++,
      });
  return points;
}

/**
 * Should the programme's projection be shown beside the saved week?
 *
 * Yes for a week that has not been cut yet: one with no plan row, or one a
 * person created (source `tutor` / `student`) that the automatic lanes will
 * complete when it arrives — see `useWeekPlan`. Never for a week that has
 * gone by: what was not set then is not owed now.
 */
export function showsProjection(params: {
  weekStart: string;
  currentWeek: string;
  plan: { source: string } | null;
}): boolean {
  if (params.weekStart < params.currentWeek) return false;
  return !params.plan || params.plan.source !== "ai";
}

/**
 * Merge the saved week with the programme's projection into one list, grouped
 * by topic. Saved rows win over projected ones for the same point, and a
 * projected point the tutor has already removed or skipped is not shown as
 * coming — it is in the overrides list instead.
 */
export function tutorWeekRows(params: {
  saved: PlanPoint[];
  projection: WeekSelection | null;
  roadmap: RoadmapResult | null;
  overrides: PlanOverride[];
  weekStart: string;
}): TutorWeekGroup[] {
  const index = pointIndex(params.roadmap);
  const { removed, skipped } = overridesForWeek(params.overrides, params.weekStart);
  const blocked = new Set([...removed, ...skipped].map((o) => o.specPointId));
  const rows = new Map<string, TutorWeekRow>();
  for (const p of params.saved) {
    rows.set(p.spec_point_id, {
      specPointId: p.spec_point_id,
      code: p.code,
      title: p.title,
      topicId: p.topic_id,
      topicTitle: p.topic_title ?? index.get(p.spec_point_id)?.topicTitle ?? "—",
      state: "saved",
      origin: p.origin,
      pinned: isHandPicked(p.origin),
      carriedFrom: p.carried_from,
      doneAt: p.done_at,
    });
  }
  for (const id of params.projection?.specPointIds ?? []) {
    if (rows.has(id) || blocked.has(id)) continue;
    const meta = index.get(id);
    if (!meta) continue; // a point the curriculum no longer has is not offered
    rows.set(id, {
      specPointId: id,
      code: meta.code,
      title: meta.title,
      topicId: meta.topicId,
      topicTitle: meta.topicTitle,
      state: "projected",
      origin: params.projection?.origins[id] ?? "ai",
      pinned: false,
      carriedFrom: null,
      doneAt: null,
    });
  }
  const order = (id: string) => index.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  const groups = new Map<string, TutorWeekGroup>();
  for (const row of [...rows.values()].sort(
    (a, b) => order(a.specPointId) - order(b.specPointId),
  )) {
    const g = groups.get(row.topicId) ?? { topicId: row.topicId, title: row.topicTitle, rows: [] };
    g.rows.push(row);
    groups.set(row.topicId, g);
  }
  return [...groups.values()];
}

/** How a row should be labelled: where the point came from. */
export function laneLabel(row: TutorWeekRow): string {
  if (row.origin === "tutor") return "Set by you";
  if (row.origin === "student") return "Added by student";
  if (row.origin === "focus") return "Revision";
  if (row.carriedFrom) return "Carried over";
  return "Course";
}

/** What the tutor is told before assigning a point the student may not need. */
export interface AssignmentWarning {
  specPointId: string;
  code: string;
  title: string;
  reason:
    /** Assessed at 70% or better already. */
    | "covered"
    /** Ticked off by the student in some week. */
    | "done"
    /** Skipped in the programme by the tutor. */
    | "skipped"
    /** Already in this week's saved plan. */
    | "in-week";
  bestScore: number | null;
}

/**
 * Warnings for a set of points about to be pinned into a week: the ones the
 * student has already covered, ticked off, or the tutor has skipped. Nothing
 * here refuses the assignment — revising a covered point can be exactly what
 * the tutor means — it only makes sure they mean it.
 */
export function assignmentWarnings(params: {
  specPointIds: string[];
  roadmap: RoadmapResult | null;
  saved: PlanPoint[];
  overrides: PlanOverride[];
}): AssignmentWarning[] {
  const strong = STRONG_THRESHOLD;
  const saved = new Set(params.saved.map((p) => p.spec_point_id));
  const done = new Set(params.roadmap?.completedPointIds ?? []);
  const skipped = new Set(
    params.overrides.filter((o) => o.kind === "skip").map((o) => o.specPointId),
  );
  const byId = new Map(
    (params.roadmap?.progress ?? []).flatMap((t) => t.points.map((p) => [p.id, p] as const)),
  );
  const out: AssignmentWarning[] = [];
  for (const id of params.specPointIds) {
    const p = byId.get(id);
    const code = p?.code ?? id.slice(0, 8);
    const title = p?.title ?? "Spec point";
    const bestScore = p ? Math.max(p.homeworkScore ?? -1, p.quizScore ?? -1) : -1;
    if (saved.has(id))
      out.push({ specPointId: id, code, title, reason: "in-week", bestScore: null });
    else if (skipped.has(id))
      out.push({ specPointId: id, code, title, reason: "skipped", bestScore: null });
    else if (bestScore >= strong)
      out.push({ specPointId: id, code, title, reason: "covered", bestScore });
    else if (done.has(id))
      out.push({ specPointId: id, code, title, reason: "done", bestScore: null });
  }
  return out;
}
