import type { PointWork } from "./coverage";
import type { PlanPoint } from "./weeklyPlanDal";

/**
 * Where a task or quiz sits in this week's plan: the section the dashboard's
 * "This week" shows its spec point in.
 *
 * The Tasks and MCQs pages used to read the library rather than the plan, so
 * everything the practice queue wrote landed in "Practice by topic" and "Past
 * MCQs" — a sheet on this week's plan looked no different from one for a topic
 * months away. Now Due is this week's plan, split the way the dashboard splits
 * it, and a sheet is due on these pages exactly when the dashboard offers it.
 */
export type DueLane = "new" | "returning" | "revision" | "tutor" | "yours";

/** The dashboard's order: its three lanes, then the tutor's and the student's own. */
export const DUE_LANE_ORDER: readonly DueLane[] = [
  "new",
  "returning",
  "revision",
  "tutor",
  "yours",
];

/** The dashboard's names for the lanes (see `ThisWeekLanes`), so both read the same. */
export const DUE_LANE_LABEL: Record<DueLane, string> = {
  new: "New learning",
  returning: "Missed work returning",
  revision: "Revision",
  tutor: "From your tutor",
  yours: "Added by you",
};

/** A piece of work's lane, and its point's place in the week so a lane keeps the dashboard's order. */
export type DueSlot = { lane: DueLane; order: number };

/**
 * Every task and quiz attached to this week's points, keyed by its own id.
 *
 * Reads the per-point work the dashboard's checklist links to, so the two can't
 * disagree about what is due. A sheet attached to points in two lanes is filed
 * under the earlier one.
 */
export function dueSlots(
  lanes: Record<DueLane, readonly PlanPoint[]>,
  work: ReadonlyMap<string, PointWork>,
): { tasks: Map<string, DueSlot>; quizzes: Map<string, DueSlot> } {
  const tasks = new Map<string, DueSlot>();
  const quizzes = new Map<string, DueSlot>();
  let order = 0;
  for (const lane of DUE_LANE_ORDER) {
    for (const point of lanes[lane]) {
      const w = work.get(point.spec_point_id);
      for (const h of w?.homework ?? []) if (!tasks.has(h.id)) tasks.set(h.id, { lane, order });
      for (const q of w?.quizzes ?? []) if (!quizzes.has(q.id)) quizzes.set(q.id, { lane, order });
      order++;
    }
  }
  return { tasks, quizzes };
}
