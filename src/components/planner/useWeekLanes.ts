import { useMemo } from "react";
import { currentWeekKey } from "@/lib/planner/week";
import { type PlanPoint, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import { type PointCoverage, laneOf } from "@/lib/planner/coverage";
import { type Activity } from "./useWeekPlan";

/** Is this point core curriculum? See {@link laneOf} for what `ai` means. */
function isCoreLane(p: PlanPoint): boolean {
  return laneOf(p.origin) === "core";
}

/** One topic's share of a lane. */
export type TopicGroup = { topicId: string; title: string; points: PlanPoint[] };

/**
 * Sorts a saved week into the lanes "This week" shows: new learning, missed
 * work returning, revision, and anything the student added. Also works out how
 * much of the assigned practice is done and what to do next.
 *
 * Derivation only: nothing here reads or writes.
 */
export function useWeekLanes({
  plan,
  points,
  activity,
  coverage,
  roadmap,
  weekStart,
}: {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  weekStart: string;
}) {
  // The spine band this week sits in — the core topic, whether or not it still
  // has points outstanding.
  const band: PacingBand | null = useMemo(() => {
    const bands = roadmap?.baselineBands ?? [];
    return (
      bands.find((b) => isTeachBand(b) && b.startWeek <= weekStart && b.endWeek >= weekStart) ??
      null
    );
  }, [roadmap, weekStart]);

  const covered = !!band && (roadmap?.coveredTopicIds ?? []).includes(band.topicId);

  const returningIds = useMemo(
    () =>
      new Set([
        ...(roadmap?.catchUpSchedule?.weeks[weekStart] ?? []).map((p) => p.specPointId),
        ...(roadmap?.backlog ?? [])
          .filter((p) => p.plannedWeek < weekStart)
          .map((p) => p.specPointId),
      ]),
    [roadmap, weekStart],
  );

  // The saved assignment is authoritative; roadmap points are never added here.
  const coreThisWeek = useMemo(
    () =>
      points.filter(
        (p) => isCoreLane(p) && p.topic_id === band?.topicId && !returningIds.has(p.spec_point_id),
      ),
    [points, band, returningIds],
  );

  // Split the plan by the lane each point was saved with. Plans written before
  // lanes existed carry `ai`; they join the core column rather than being hidden
  // in a nameless third list.
  const { focus, yours, extraCore, returning } = useMemo(() => {
    const titleOf = new Map((roadmap?.progress ?? []).map((t) => [t.topicId, t.title]));
    const group = (list: PlanPoint[]) => {
      const m = new Map<string, { topicId: string; title: string; points: PlanPoint[] }>();
      for (const p of list) {
        const g = m.get(p.topic_id) ?? {
          topicId: p.topic_id,
          // The plan's own title first, then the programme's — a point whose
          // topic row didn't come back should still be filed under a name.
          title: p.topic_title ?? titleOf.get(p.topic_id) ?? "—",
          points: [],
        };
        g.points.push(p);
        m.set(p.topic_id, g);
      }
      return [...m.values()];
    };
    return {
      focus: group(points.filter((p) => laneOf(p.origin) === "focus")),
      yours: group(points.filter((p) => laneOf(p.origin) === "yours")),
      // Core-lane work outside this week's band — a week planned without a
      // programme (no band at all), or a point carried in from another topic.
      // Rendered under its own topic, and never dropped: it used to vanish from
      // the panel entirely whenever there was no band to hang it on.
      returning: group(points.filter((p) => isCoreLane(p) && returningIds.has(p.spec_point_id))),
      extraCore: group(
        points.filter(
          (p) =>
            isCoreLane(p) &&
            !returningIds.has(p.spec_point_id) &&
            (!band || p.topic_id !== band.topicId),
        ),
      ),
    };
  }, [points, roadmap, band, returningIds]);

  const focusPointCount = focus.reduce((n, g) => n + g.points.length, 0);
  const upcomingCatchUp =
    !plan && weekStart > currentWeekKey() && !!roadmap?.catchUpSchedule?.weeks[weekStart]?.length;

  const assigned = points.filter((p) => {
    const a = activity.get(p.spec_point_id);
    return a?.hasHomework || a?.hasQuiz;
  });
  const completed = assigned.filter((p) => {
    const a = activity.get(p.spec_point_id);
    const c = coverage.get(p.spec_point_id);
    return (!a?.hasHomework || c?.homeworkDone) && (!a?.hasQuiz || c?.quizDone);
  }).length;
  const next = assigned.find((p) => {
    const a = activity.get(p.spec_point_id);
    const c = coverage.get(p.spec_point_id);
    return (a?.hasHomework && !c?.homeworkDone) || (a?.hasQuiz && !c?.quizDone);
  });

  return {
    band,
    covered,
    coreThisWeek,
    focus,
    yours,
    extraCore,
    returning,
    focusPointCount,
    upcomingCatchUp,
    assigned,
    completed,
    next,
  };
}
