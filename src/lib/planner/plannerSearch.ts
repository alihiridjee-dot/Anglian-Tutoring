/**
 * The planner route's search params, shared by the route (which validates
 * them) and the tutor planner (which reads and writes them). Deep links open
 * a course's full plan at a given week, e.g. from a curriculum point; for a
 * tutor the same search names the student, so a student's week is a link
 * that can be bookmarked, shared with a colleague, or gone back to.
 */
export interface PlannerSearch {
  subject?: string;
  tab?: "week" | "plan" | "topics";
  week?: string;
  /** Tutor view: the student whose plan is open. */
  student?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WEEK = /^\d{4}-\d{2}-\d{2}$/;

/** Keep only well-formed values; anything else is as if it were absent. */
export function validatePlannerSearch(search: Record<string, unknown>): PlannerSearch {
  return {
    subject: typeof search.subject === "string" ? search.subject : undefined,
    tab:
      search.tab === "week" || search.tab === "plan" || search.tab === "topics"
        ? search.tab
        : undefined,
    week: typeof search.week === "string" && WEEK.test(search.week) ? search.week : undefined,
    student:
      typeof search.student === "string" && UUID.test(search.student) ? search.student : undefined,
  };
}
