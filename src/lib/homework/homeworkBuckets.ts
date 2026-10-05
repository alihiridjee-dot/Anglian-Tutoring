import type { Homework, SubmissionRow } from "@/lib/homework/types";
import { breakCovering, type StudentBreak } from "@/lib/planner/breaks";
import { toDateKey } from "@/lib/planner/week";

/**
 * How the homework list is ordered: by what the student has to do about it.
 *
 * Two things now create homework — a tutor setting a brief, and the planner
 * writing a sheet for a spec point nobody had covered — and the temptation was
 * to give each its own section. That would sort the list by whose idea it was,
 * which is not a question any student has ever asked. What they want to know is
 * what is due, what they are waiting on, and what came back.
 *
 * So the sections are lifecycle states, and origin is only a label on the card.
 * The rule falls out of two fields with nothing to configure:
 *
 *   submitted + marked      -> marked
 *   submitted               -> submitted
 *   not submitted + due     -> due
 *   not submitted + no due  -> practice
 *   due before they joined  -> practice
 *   due during their break  -> practice
 *
 * A generated sheet has no due date, so it lands in practice without being
 * special-cased — and a tutor brief set without one lands there too, which is
 * honest: nothing is being asked of the student by a particular day. Do a
 * practice sheet and it moves up into submitted, then marked, alongside
 * everything else. Its mark counts the same, because it is the same work.
 */
export type HomeworkBucket = "due" | "submitted" | "marked" | "practice";

export type HomeworkItem = {
  hw: Homework;
  submission?: SubmissionRow;
  /** When the student took this subject up, if known. */
  enrolledAt?: string | null;
  /** The student's breaks that stand (student_breaks), if known. */
  breaks?: readonly StudentBreak[];
};

/**
 * A brief whose deadline passed before the student took the subject up.
 *
 * Briefs are visible to everyone on the subject and level, not set per student,
 * so a student who joins in November also sees October's brief. Nobody asked
 * them for it by that date, and calling it Overdue blames them for work set
 * before they were here. It is still a good sheet, so it stays on offer as
 * practice.
 */
export function wasDueBeforeJoining(item: HomeworkItem): boolean {
  if (!item.hw.due_at || !item.enrolledAt) return false;
  return new Date(item.hw.due_at).getTime() < new Date(item.enrolledAt).getTime();
}

/**
 * A brief due on a day the student was on a break.
 *
 * Nothing is asked of a student in a break week (Ali, 4 Oct 2026), so a brief
 * due then is treated as one due before they joined: not Overdue, not held
 * against them, still on offer as practice. The day is its UK date, the same
 * calendar the planner's weeks use.
 */
export function wasDueOnBreak(item: HomeworkItem): boolean {
  if (!item.hw.due_at || !item.breaks?.length) return false;
  return !!breakCovering(item.breaks, toDateKey(new Date(item.hw.due_at)));
}

export function bucketOf(item: HomeworkItem): HomeworkBucket {
  if (item.submission) return item.submission.graded_at ? "marked" : "submitted";
  return item.hw.due_at && !wasDueBeforeJoining(item) && !wasDueOnBreak(item) ? "due" : "practice";
}

/** Past its due date and still not handed in. */
export function isOverdue(item: HomeworkItem, now = Date.now()): boolean {
  if (item.submission || !item.hw.due_at || wasDueBeforeJoining(item) || wasDueOnBreak(item))
    return false;
  return new Date(item.hw.due_at).getTime() < now;
}

/**
 * Whether a submitted piece is still inside its review window.
 *
 * The student is told their marks are coming rather than left looking at work
 * that appears to have been ignored — the one thing a silent day would say
 * that isn't true.
 */
export function isAwaitingRelease(item: HomeworkItem, now = Date.now()): boolean {
  const release = item.submission?.release_at;
  if (!release || item.submission?.graded_at) return false;
  return new Date(release).getTime() > now;
}

/** Lifecycle order — also the order of the tabs on the student page. */
export const BUCKET_ORDER: HomeworkBucket[] = ["due", "submitted", "marked", "practice"];

/** The key each section sorts on, and which way round. */
const SORT: Record<HomeworkBucket, { key: (i: HomeworkItem) => string; descending: boolean }> = {
  // Soonest first, which puts anything overdue at the very top.
  due: { key: (i) => i.hw.due_at ?? "", descending: false },
  submitted: { key: (i) => i.submission?.submitted_at ?? "", descending: true },
  marked: { key: (i) => i.submission?.graded_at ?? "", descending: true },
  // Alphabetical by title, which for a generated sheet is its spec point code —
  // so the practice section comes out in specification order. That needs the
  // numeric comparison below: as plain text, 4.1.1.10 sorts before 4.1.1.2.
  practice: { key: (i) => i.hw.title.toLocaleLowerCase(), descending: false },
};

/** Text order, with runs of digits compared as numbers. */
const byKey = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** The whole list, split into its sections and sorted inside each one. */
export function groupHomework(items: HomeworkItem[]): Array<{
  bucket: HomeworkBucket;
  items: HomeworkItem[];
}> {
  const byBucket: Partial<Record<HomeworkBucket, HomeworkItem[]>> = {};
  for (const item of items) {
    (byBucket[bucketOf(item)] ??= []).push(item);
  }

  return BUCKET_ORDER.map((bucket) => {
    const { key, descending } = SORT[bucket];
    const sorted = [...(byBucket[bucket] ?? [])].sort((a, b) =>
      descending ? byKey(key(b), key(a)) : byKey(key(a), key(b)),
    );
    return { bucket, items: sorted };
  }).filter((section) => section.items.length > 0);
}

export const BUCKET_LABEL: Record<HomeworkBucket, string> = {
  due: "Due",
  submitted: "Handed in",
  marked: "Marked",
  practice: "Practice by topic",
};

export const BUCKET_HINT: Record<HomeworkBucket, string> = {
  due: "Set with a deadline — do these first.",
  submitted: "Handed in and being marked.",
  marked: "Your marks and feedback.",
  practice: "A sheet for every topic you've covered. Do one whenever you like.",
};

/** The tint each section paints itself with, per the design system. */
export const BUCKET_TINT: Record<HomeworkBucket, string> = {
  due: "tint-amber",
  submitted: "tint-primary",
  marked: "tint-emerald",
  practice: "tint-slate",
};
