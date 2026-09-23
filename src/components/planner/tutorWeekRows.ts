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
 * and needs each row filed under the reason it is there, because "why is this
 * here" is the question a tutor asks before "should it be".
 */
export type WeekLane = "course" | "catchup" | "revision" | "pinned" | "student";

export interface TutorWeekRow {
  specPointId: string;
  code: string;
  title: string;
  topicId: string;
  topicTitle: string;
  /** Written to the student's plan, or only what the programme would write. */
  state: "saved" | "projected";
  origin: PlanPointOrigin;
  lane: WeekLane;
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

/** One lane of the week, with its rows grouped by topic. */
export interface TutorWeekLane {
  key: WeekLane;
  title: string;
  hint: string;
  groups: TutorWeekGroup[];
  count: number;
}

export const LANE_META: Record<WeekLane, { title: string; hint: string }> = {
  course: { title: "Course this week", hint: "New learning, in curriculum order" },
  catchup: { title: "Catching up", hint: "Promised in an earlier week and not yet covered" },
  revision: { title: "Revision", hint: "Coming back until it sticks" },
  pinned: { title: "Set by you", hint: "Kept through every re-plan" },
  student: { title: "Added by the student", hint: "Their own choice, also kept" },
};

const LANE_ORDER: WeekLane[] = ["course", "catchup", "revision", "pinned", "student"];

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

/** Which lane a point is in, from its origin and whether it is catch-up work. */
function laneOf(origin: PlanPointOrigin, catchUp: boolean): WeekLane {
  if (origin === "tutor") return "pinned";
  if (origin === "student") return "student";
  if (origin === "focus") return "revision";
  return catchUp ? "catchup" : "course";
}

/**
 * Merge the saved week with the programme's projection into one list in
 * curriculum order. Saved rows win over projected ones for the same point, and
 * a projected point the tutor has already removed or skipped is not shown as
 * coming — it is in the overrides list instead.
 */
export function tutorWeekRows(params: {
  saved: PlanPoint[];
  projection: WeekSelection | null;
  roadmap: RoadmapResult | null;
  overrides: PlanOverride[];
  weekStart: string;
}): TutorWeekRow[] {
  const index = pointIndex(params.roadmap);
  const { removed, skipped } = overridesForWeek(params.overrides, params.weekStart);
  const blocked = new Set([...removed, ...skipped].map((o) => o.specPointId));
  // Catch-up is first teaching arriving late: promised before this week, or
  // scheduled into this week by the catch-up trickle.
  const catchUp = new Set([
    ...(params.roadmap?.catchUpSchedule?.weeks[params.weekStart] ?? []).map((p) => p.specPointId),
    ...(params.roadmap?.backlog ?? [])
      .filter((p) => p.plannedWeek < params.weekStart)
      .map((p) => p.specPointId),
  ]);
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
      lane: laneOf(p.origin, catchUp.has(p.spec_point_id)),
      pinned: isHandPicked(p.origin),
      carriedFrom: p.carried_from,
      doneAt: p.done_at,
    });
  }
  for (const id of params.projection?.specPointIds ?? []) {
    if (rows.has(id) || blocked.has(id)) continue;
    const meta = index.get(id);
    if (!meta) continue; // a point the curriculum no longer has is not offered
    const origin = params.projection?.origins[id] ?? "ai";
    rows.set(id, {
      specPointId: id,
      code: meta.code,
      title: meta.title,
      topicId: meta.topicId,
      topicTitle: meta.topicTitle,
      state: "projected",
      origin,
      lane: laneOf(origin, catchUp.has(id)),
      pinned: false,
      carriedFrom: null,
      doneAt: null,
    });
  }
  const order = (id: string) => index.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  return [...rows.values()].sort((a, b) => order(a.specPointId) - order(b.specPointId));
}

/** The week's rows filed under their lanes, each lane grouped by topic. Empty lanes are left out. */
export function laneSections(rows: TutorWeekRow[]): TutorWeekLane[] {
  const lanes: TutorWeekLane[] = [];
  for (const key of LANE_ORDER) {
    const mine = rows.filter((r) => r.lane === key);
    if (mine.length === 0) continue;
    const groups = new Map<string, TutorWeekGroup>();
    for (const row of mine) {
      const g = groups.get(row.topicId) ?? {
        topicId: row.topicId,
        title: row.topicTitle,
        rows: [],
      };
      g.rows.push(row);
      groups.set(row.topicId, g);
    }
    lanes.push({ key, ...LANE_META[key], groups: [...groups.values()], count: mine.length });
  }
  return lanes;
}

/** What the tutor is told before assigning a point the student may not need. */
export interface AssignmentWarning {
  specPointId: string;
  code: string;
  title: string;
  reason:
    /** Assessed at the strong threshold or better already. */
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
    else if (bestScore >= STRONG_THRESHOLD)
      out.push({ specPointId: id, code, title, reason: "covered", bestScore });
    else if (done.has(id))
      out.push({ specPointId: id, code, title, reason: "done", bestScore: null });
  }
  return out;
}
