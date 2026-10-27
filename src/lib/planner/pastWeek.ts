import type { PauseRecord } from "./pausesDal";
import type { StudentBreak } from "./breaks";
import type { PlanPoint, WithheldPlanPoint } from "./weeklyPlanDal";
import { weekIsForAnotherCourse } from "./weekCut";
import { addWeeks, weekKeyToDate } from "./week";

/**
 * Why a week that has gone by holds nothing, when the record can say.
 *
 * A past week with no points read "No plan was set for this week" whatever
 * happened in it. Three things leave a week empty on purpose, and all three
 * are recorded:
 *
 *  • a break: nothing is planned in a break week (`student_breaks`);
 *  • a stopped subject: nothing is planned while it is paused, lapsed or
 *    ended (`student_subject_pauses`);
 *  • another course: a week saved before a board or level change keeps the
 *    old course's points, and every one reads back as off-course, so the week
 *    showed "No plan was set" above a "Kept aside" list of what was set.
 *
 * Null means none of them: nobody opened that week, and "No plan was set"
 * is the truth. Pure, so the planner, the dashboard and the tutor agree.
 */
export type PastWeekGap =
  | { kind: "break"; brk: StudentBreak }
  | { kind: "paused"; pause: PauseRecord }
  | { kind: "old-course"; board: string; level: string; points: PlanPoint[] };

export function pastWeekGap(params: {
  weekStart: string;
  plan: { board: string; level: string } | null;
  points: readonly PlanPoint[];
  withheld: readonly WithheldPlanPoint[];
  /** The course the student is on now. */
  course: { board: string; level: string };
  onBreak: StudentBreak | null;
  pauses: readonly PauseRecord[];
}): PastWeekGap | null {
  // A week with work in it shows the work, whatever else was going on.
  if (params.points.length > 0) return null;
  const { plan, withheld } = params;
  if (plan && withheld.length > 0 && weekIsForAnotherCourse(plan, params.course))
    return {
      kind: "old-course",
      board: plan.board,
      level: plan.level,
      points: withheld.map((w) => w.point),
    };
  // Before a pause: an ended break is also recorded as a stop of each subject,
  // and the break card says more about it.
  if (params.onBreak) return { kind: "break", brk: params.onBreak };
  const pause = pauseCovering(params.pauses, params.weekStart);
  return pause ? { kind: "paused", pause } : null;
}

/** The stop that overlaps the week starting `weekStart` (London time), if any. */
export function pauseCovering(
  pauses: readonly PauseRecord[],
  weekStart: string,
): PauseRecord | null {
  const monday = weekKeyToDate(weekStart);
  const from = monday.getTime();
  const to = addWeeks(monday, 1).getTime();
  return (
    pauses.find(
      (p) => Date.parse(p.startedAt) < to && (p.endedAt == null || Date.parse(p.endedAt) > from),
    ) ?? null
  );
}
