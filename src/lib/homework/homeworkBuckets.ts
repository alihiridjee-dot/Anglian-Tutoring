import type { Homework, SubmissionRow } from "@/lib/homework/types";
import { breakCovering, type StudentBreak } from "@/lib/planner/breaks";
import { DUE_LANE_ORDER, type DueLane, type DueSlot } from "@/lib/planner/dueLanes";
import { toDateKey } from "@/lib/planner/week";
import { groupUnderTopics, noTopic, type TopicRef } from "@/lib/curriculum/topicGroups";

/**
 * How the homework list is ordered: by what the student has to do about it.
 *
 * Two things now create homework — a tutor setting a brief, and the planner
 * writing a sheet for a spec point nobody had covered — and the temptation was
 * to give each its own section. That would sort the list by whose idea it was,
 * which is not a question any student has ever asked. What they want to know is
 * what is due, what they are waiting on, and what came back.
 *
 * So the sections are lifecycle states, and origin is only a label on the card:
 *
 *   submitted + marked                      -> marked
 *   submitted                               -> submitted
 *   on this week's plan                     -> due, under its dashboard lane
 *   set by a tutor                          -> due, under "From your tutor"
 *   set by a tutor, due before they joined  -> not shown
 *   set by a tutor, due during their break  -> not shown
 *   anything else                           -> not shown
 *
 * Due is this week, as the dashboard has it. A generated sheet is due while its
 * spec point is in this week's plan, filed under the lane the dashboard shows
 * the point in (see `@/lib/planner/dueLanes`). Off the plan it isn't shown: the
 * dashboard's catch-up brings missed points back a few at a time, and this page
 * follows it rather than listing all of them at once (Ali, 6 Oct 2026). There
 * used to be a fourth section, "Practice by topic", holding every sheet in the
 * library; it read as optional extras when most of it was this week's work.
 * Hand a sheet in and it moves on to submitted, then marked, like everything
 * else.
 */
export type HomeworkBucket = "due" | "submitted" | "marked";

export type HomeworkItem = {
  hw: Homework;
  submission?: SubmissionRow;
  /** When the student took this subject up, if known. */
  enrolledAt?: string | null;
  /** The student's breaks that stand (student_breaks), if known. */
  breaks?: readonly StudentBreak[];
  /** Where this week's plan puts the sheet, if it is on it (see `useDueThisWeek`). */
  slot?: DueSlot;
};

/**
 * A brief whose deadline passed before the student took the subject up.
 *
 * Briefs are visible to everyone on the subject and level, not set per student,
 * so a student who joins in November also sees October's brief. Nobody asked
 * them for it by that date, and calling it Overdue blames them for work set
 * before they were here, so it isn't listed as due.
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
 * against them, not listed as due. The day is its UK date, the same calendar
 * the planner's weeks use.
 */
export function wasDueOnBreak(item: HomeworkItem): boolean {
  if (!item.hw.due_at || !item.breaks?.length) return false;
  return !!breakCovering(item.breaks, toDateKey(new Date(item.hw.due_at)));
}

/** The section a sheet belongs in, or null when it isn't the student's to do now. */
export function bucketOf(item: HomeworkItem): HomeworkBucket | null {
  if (item.submission) return item.submission.graded_at ? "marked" : "submitted";
  if (item.slot) return "due";
  return item.hw.origin === "tutor" && !wasDueBeforeJoining(item) && !wasDueOnBreak(item)
    ? "due"
    : null;
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
export const BUCKET_ORDER: HomeworkBucket[] = ["due", "submitted", "marked"];

/** Text order, with runs of digits compared as numbers. */
const byKey = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Plan work after the plan's own order; a brief off it after. */
const planOrder = (i: HomeworkItem) => i.slot?.order ?? Number.MAX_SAFE_INTEGER;
/** A brief's deadline as a number, with no deadline after every date. */
const deadline = (i: HomeworkItem) =>
  i.hw.due_at ? Date.parse(i.hw.due_at) : Number.MAX_SAFE_INTEGER;

/** How each section sorts. */
const ORDER: Record<HomeworkBucket, (a: HomeworkItem, b: HomeworkItem) => number> = {
  // The week's own order, which is the dashboard's. A brief off the plan goes by
  // its deadline — soonest first, so anything overdue leads — and one with no
  // deadline last. The numeric title order settles the rest: a generated
  // sheet's title is its spec point code, and as plain text 4.1.1.10 sorts
  // before 4.1.1.2.
  due: (a, b) =>
    planOrder(a) - planOrder(b) ||
    deadline(a) - deadline(b) ||
    byKey(a.hw.title.toLocaleLowerCase(), b.hw.title.toLocaleLowerCase()),
  submitted: (a, b) => byKey(b.submission?.submitted_at ?? "", a.submission?.submitted_at ?? ""),
  marked: (a, b) => byKey(b.submission?.graded_at ?? "", a.submission?.graded_at ?? ""),
};

/** The whole list, split into its sections and sorted inside each one. */
export function groupHomework(items: HomeworkItem[]): Array<{
  bucket: HomeworkBucket;
  items: HomeworkItem[];
}> {
  const byBucket: Partial<Record<HomeworkBucket, HomeworkItem[]>> = {};
  for (const item of items) {
    const bucket = bucketOf(item);
    if (bucket) (byBucket[bucket] ??= []).push(item);
  }

  return BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: [...(byBucket[bucket] ?? [])].sort(ORDER[bucket]),
  })).filter((section) => section.items.length > 0);
}

/** A due sheet's lane: its point's, or the tutor's for a brief off the plan. */
export function dueLaneOf(item: HomeworkItem): DueLane {
  return item.slot?.lane ?? "tutor";
}

/** Due, split into the dashboard's lanes. Keeps the order it is given; empty lanes are left out. */
export function splitDue(items: HomeworkItem[]): Array<{ lane: DueLane; items: HomeworkItem[] }> {
  return DUE_LANE_ORDER.map((lane) => ({
    lane,
    items: items.filter((i) => dueLaneOf(i) === lane),
  })).filter((section) => section.items.length > 0);
}

/**
 * Marked, filed under the course's topics (see `groupUnderTopics`). A
 * generated sheet's title is its spec point code, so the title order inside a
 * topic is the spec's. A tutor's brief has no spec point, so briefs go after
 * the topics under the lane name the dashboard gives them.
 */
export function groupByTopic(
  items: HomeworkItem[],
  topics: Record<string, TopicRef>,
): Array<{ key: string; title: string; items: HomeworkItem[] }> {
  return groupUnderTopics(
    items,
    (item) =>
      topics[item.hw.id] ??
      (item.hw.origin === "tutor" ? TUTOR_BRIEFS : noTopic("other", "Other tasks")),
    (item) => item.hw.title,
  );
}

/** Where a tutor's briefs go: after the topics, before anything unfiled. */
const TUTOR_BRIEFS: TopicRef = {
  id: "tutor",
  title: "From your tutor",
  order: Number.MAX_SAFE_INTEGER - 1,
};

export const BUCKET_LABEL: Record<HomeworkBucket, string> = {
  due: "Due",
  submitted: "Handed in",
  marked: "Marked",
};

/** The tint each section paints itself with, per the design system. */
export const BUCKET_TINT: Record<HomeworkBucket, string> = {
  due: "tint-amber",
  submitted: "tint-primary",
  marked: "tint-emerald",
};
