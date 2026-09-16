import type { RoadmapResult } from "@/lib/programDal";
import { isTeachBand, withWeeklyPoints, type FocusPointRef } from "./pacing";

/**
 * When a spec point is, or was, due in a student's plan — the same answer the
 * full plan gives, reduced to one fact per point for surfaces like the
 * curriculum that only need "is this done, and if not, when?".
 *
 *  • `covered` — delivered: assessed evidence, or ticked off in some week (with
 *    the week it was taught, when known). The
 *    same test the backlog uses ({@link isDelivered}), so a point never reads as
 *    covered here and missed in the planner.
 *  • `planned` — its first-teaching week, this week or later.
 *  • `catchUp` — missed, and returning in this week's catch-up allocation.
 *  • `missed` — its week has passed and no catch-up week before the exams holds it.
 */
export type PointWhen =
  | { kind: "covered"; week?: string }
  | { kind: "planned"; week: string }
  | { kind: "catchUp"; week: string }
  | { kind: "missed"; week: string };

export interface CourseSchedule {
  byPoint: Map<string, PointWhen>;
  /** Covered and total spec points per topic. */
  byTopic: Map<string, { covered: number; total: number }>;
}

type ScheduleInput = Pick<
  RoadmapResult,
  "bands" | "baselineBands" | "needsAck" | "progress" | "completedPointIds" | "catchUpSchedule"
>;

export function courseSchedule(data: ScheduleInput, now: string): CourseSchedule {
  const covered = new Set([
    ...(data.completedPointIds ?? []),
    ...data.progress.flatMap((topic) =>
      topic.points.filter((p) => p.assessability === "assessed").map((p) => p.id),
    ),
  ]);

  // While a new plan waits for acceptance the student still lives by the old one.
  const reviewing = data.needsAck && data.baselineBands.length > 0;
  const pointsByTopic = new Map<string, FocusPointRef[]>(
    data.progress.map((topic) => [
      topic.topicId,
      topic.points.map((p) => ({
        specPointId: p.id,
        code: p.code,
        title: p.title,
        weight: p.weight,
      })),
    ]),
  );
  const teaching = withWeeklyPoints(
    (reviewing ? data.baselineBands : data.bands).filter(isTeachBand),
    pointsByTopic,
  );

  const plannedWeek = new Map<string, string>();
  for (const band of teaching) {
    const weeks = band.pointsByWeek
      ? Object.entries(band.pointsByWeek).sort(([a], [b]) => a.localeCompare(b))
      : ([[band.startWeek, pointsByTopic.get(band.topicId) ?? []]] as const);
    for (const [week, refs] of weeks)
      for (const ref of refs)
        if (!plannedWeek.has(ref.specPointId)) plannedWeek.set(ref.specPointId, week);
  }

  const catchUpWeek = new Map<string, string>();
  for (const [week, points] of Object.entries(data.catchUpSchedule?.weeks ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    for (const point of points)
      if (!catchUpWeek.has(point.specPointId)) catchUpWeek.set(point.specPointId, week);

  const byPoint = new Map<string, PointWhen>();
  const byTopic = new Map<string, { covered: number; total: number }>();
  for (const topic of data.progress) {
    let done = 0;
    for (const point of topic.points) {
      const planned = plannedWeek.get(point.id);
      const returning = catchUpWeek.get(point.id);
      if (covered.has(point.id)) {
        done++;
        byPoint.set(point.id, { kind: "covered", week: planned });
      } else if (returning) byPoint.set(point.id, { kind: "catchUp", week: returning });
      else if (planned && planned >= now) byPoint.set(point.id, { kind: "planned", week: planned });
      else if (planned) byPoint.set(point.id, { kind: "missed", week: planned });
    }
    byTopic.set(topic.topicId, { covered: done, total: topic.points.length });
  }
  return { byPoint, byTopic };
}
