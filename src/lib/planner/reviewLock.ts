import { sundayOf, weekKeyToDate } from "@/lib/week";
import { type PointActivity, type PointCoverage } from "./coverage";

/**
 * When the end-of-week review opens.
 *
 * A review is a verdict on a finished week. Handed to the student on Tuesday it
 * grades work they still have five days to do, so the honest answer is always
 * "not done" and the card reads as a telling-off for being mid-week. It stays
 * shut until the week is actually over — or until there is nothing left to wait
 * for, because every piece of homework set on the week's points is in.
 *
 * The early opening deliberately requires homework to *exist*: "all of nothing
 * is done" is true of a week where nothing was ever set, and treating that as
 * finished would open every review the moment it was created. A week with no
 * homework simply waits for Sunday.
 *
 * Quizzes are not part of the test. They can be retaken and are often practice
 * a student dips into, so "all quizzes attempted" is not a finish line the way a
 * submitted homework is.
 */
export interface ReviewLock {
  locked: boolean;
  /** Local midnight on the Sunday the review opens by itself. */
  opensOn: Date;
  /** Points with homework set on them, and how many have been submitted. */
  homeworkTotal: number;
  homeworkDone: number;
}

export function reviewLock(params: {
  /** Monday date-key of the week under review. */
  weekStart: string;
  entries: {
    coverage: PointCoverage | undefined;
    activity: PointActivity | undefined;
  }[];
  now?: Date;
}): ReviewLock {
  const now = params.now ?? new Date();
  const opensOn = sundayOf(weekKeyToDate(params.weekStart));

  let homeworkTotal = 0;
  let homeworkDone = 0;
  for (const e of params.entries) {
    if (!e.activity?.hasHomework) continue;
    homeworkTotal++;
    if (e.coverage?.homeworkDone) homeworkDone++;
  }

  // Sunday counts as the end of the week, so the review opens at its midnight
  // rather than at the end of it — a student reviewing on Sunday evening is the
  // normal case, not an early one. Every past week is open by the same rule.
  const weekOver = now.getTime() >= opensOn.getTime();
  const allHandedIn = homeworkTotal > 0 && homeworkDone === homeworkTotal;

  return { locked: !weekOver && !allHandedIn, opensOn, homeworkTotal, homeworkDone };
}
