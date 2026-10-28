import { PLANNER_TIME_ZONE, plannerDateLabel } from "@/lib/planner/week";

/**
 * How long a quiz stays shut after an attempt.
 *
 * The answers and explanations appear the moment a quiz is marked, so a retake
 * straight afterwards measures the answer key, not the topic — and every
 * attempt is evidence the planner, the settled-topic check and the predicted
 * grade all read. `grade_mcq_attempt` refuses a second attempt inside this
 * window and returns the first instead (20261005150000_mcq_retake_lock); this
 * is the page's copy of the same number, so it can show the last attempt as a
 * review rather than a blank paper the server will not file.
 *
 * Equal to the planner's floor on revisiting a point, so a retake the planner
 * asks for is never one the lock refuses.
 */
export const RETAKE_LOCK_DAYS = 7;

/** When a quiz attempted at `attemptedAt` can be taken again. */
export function retakeOpensAt(attemptedAt: string | Date): Date {
  return new Date(new Date(attemptedAt).getTime() + RETAKE_LOCK_DAYS * 86_400_000);
}

/**
 * "Tue 3 Nov at 23:17", UK time. The lock lifts at the minute of the attempt,
 * not at the start of the day, so a date alone sent a student back on the
 * morning it named to a quiz still shut until that night. Rounded up to the
 * minute, so the time shown is never a few seconds early.
 */
export function retakeOpensLabel(opensAt: Date): string {
  const at = new Date(Math.ceil(opensAt.getTime() / 60_000) * 60_000);
  const day = plannerDateLabel(at, { weekday: "short", day: "numeric", month: "short" });
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PLANNER_TIME_ZONE,
  });
  return `${day} at ${time}`;
}
