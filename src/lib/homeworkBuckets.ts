import type { Homework, SubmissionRow } from "@/hooks/data/useHomework";

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
};

export function bucketOf(item: HomeworkItem): HomeworkBucket {
  if (item.submission) return item.submission.graded_at ? "marked" : "submitted";
  return item.hw.due_at ? "due" : "practice";
}

/** Past its due date and still not handed in. */
export function isOverdue(item: HomeworkItem, now = Date.now()): boolean {
  if (item.submission || !item.hw.due_at) return false;
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

const BUCKET_ORDER: HomeworkBucket[] = ["due", "submitted", "marked", "practice"];

/** The key each section sorts on, and which way round. */
const SORT: Record<HomeworkBucket, { key: (i: HomeworkItem) => string; descending: boolean }> = {
  // Soonest first, which puts anything overdue at the very top.
  due: { key: (i) => i.hw.due_at ?? "", descending: false },
  submitted: { key: (i) => i.submission?.submitted_at ?? "", descending: true },
  marked: { key: (i) => i.submission?.graded_at ?? "", descending: true },
  // Alphabetical by title, which for a generated sheet is its spec point code —
  // so the practice section comes out in specification order.
  practice: { key: (i) => i.hw.title.toLocaleLowerCase(), descending: false },
};

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
      descending ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b)),
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
