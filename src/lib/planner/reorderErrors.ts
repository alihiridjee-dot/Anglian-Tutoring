/**
 * What a refused topic order says to the person who pressed Save.
 *
 * `reorder_student_topics` answers in its own words, written for whoever reads
 * the logs: "Invalid calendar allocation." was printed to a student as it
 * came. So were the words of `plan_point_admissible`, which checks each week
 * the reorder re-saves. Each of these is a plan that moved under an open page
 * (another window, a new week, a changed course), and the fix is the same:
 * read the plan again and save once more. So every one ends by saying so, in
 * the words of the Reload button beside it. A refusal not listed here is
 * already plain (a break week, a pause) and is shown as the database wrote it.
 */
const STALE = "The plan has changed since this page opened. Reload, then save the order again.";
const DATES = "The new dates no longer fit the plan as saved. Reload, then save the order again.";
const COURSE = "The course has changed since this page opened. Reload, then save the order again.";
const WEEK = "A new week has started since this page opened. Reload, then save the order again.";

const PLAIN: [RegExp, string][] = [
  [/^The plan changed in another window\./, STALE],
  [/^Invalid topic order\.$/, STALE],
  [/^Invalid calendar allocation\.$/, DATES],
  [/^Teaching weeks overlap\.$/, DATES],
  [/^A point is outside its topic or teaching dates\.$/, DATES],
  [/^Earlier weeks must stay unchanged\.$/, DATES],
  [/^Every course point must appear exactly once\./, COURSE],
  [/^The course changed\. Reload the planner\.$/, COURSE],
  [/^Choose a current or future Monday before the exams\.$/, WEEK],
  // plan_point_admissible, through the weeks the reorder re-saves.
  [/^week is at or past the programme exam date$/, DATES],
  [/^spec point .* is in a topic the programme does not reach until /, DATES],
  [/^spec point .* does not belong to a topic$/, COURSE],
  [/^spec point .* is on a different course /, COURSE],
  [/^plan course no longer matches student enrolment$/, COURSE],
];

export function plainReorderError(message: string): string {
  const raw = message.trim();
  return PLAIN.find(([pattern]) => pattern.test(raw))?.[1] ?? message;
}
