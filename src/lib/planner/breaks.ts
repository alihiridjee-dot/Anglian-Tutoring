import { resumeAfterPause, type OrderTopic } from "./topicOrder";
import type { PacingBand } from "./pacing";
import { plannerDateLabel, weekKeyToDate } from "./week";

/**
 * Breaks: a student stops their work for a while without touching the plan
 * they pay for (`student_breaks`, booked through `book_break`).
 *
 * A break is whole weeks, Monday to Sunday. While one is booked or under way
 * the planner shows the course as it will be picked up — no teaching in the
 * break weeks, the rest spread from the week the student is back to the exam
 * ({@link layBreaksOver}) — and builds nothing for a break week. Once it is
 * over the database records it as a finished stop of each subject, and the
 * planner saves that same calendar exactly as it does after a billing pause.
 */

/** Why a break was taken. The database holds the same four. */
export type BreakReason = "holiday" | "school" | "exams" | "other";

/** The reasons offered, in the order they're offered. */
export const BREAK_REASONS: readonly { value: BreakReason; label: string }[] = [
  { value: "holiday", label: "Holiday" },
  { value: "school", label: "Busy with school" },
  { value: "exams", label: "School exams" },
  { value: "other", label: "Something else" },
];

export const breakReasonLabel = (reason: string): string =>
  BREAK_REASONS.find((r) => r.value === reason)?.label ?? "Break";

/** A break that stands: booked, under way or over, never called off. */
export interface StudentBreak {
  id: string;
  /** The Monday it starts. */
  startsOn: string;
  /** The Sunday it ends. Coming back early moves it to the Sunday before. */
  endsOn: string;
  reason: BreakReason;
  /** Set once it was over and recorded as a stop of each subject. */
  recordedAt: string | null;
}

/** The longest break, counting any it runs on from (`book_break`). */
export const MAX_BREAK_WEEKS = 4;
/** The weeks before an exam that no break may touch, besides the exam week (`book_break`). */
export const EXAM_CLEAR_WEEKS = 6;

/** A calendar key `days` on. Keys are dates, not instants, so this is plain date arithmetic. */
export function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week a calendar key falls in. */
export function mondayKeyOf(key: string): string {
  return shiftKey(key, -((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7));
}

/** "Mon 26 Oct": how every date in a break is written. */
export const breakDay = (key: string): string =>
  plannerDateLabel(weekKeyToDate(key), { weekday: "short", day: "numeric", month: "short" });

/** The Monday the student is back: the day after the break ends. */
export const backOn = (b: Pick<StudentBreak, "endsOn">): string => shiftKey(b.endsOn, 1);

/** The Sunday a break of `weeks` from the Monday `startsOn` ends. */
export const breakEndsOn = (startsOn: string, weeks: number): string =>
  shiftKey(startsOn, 7 * weeks - 1);

/** The Monday of every week the breaks cover. */
export function breakWeekKeys(
  breaks: readonly Pick<StudentBreak, "startsOn" | "endsOn">[],
): string[] {
  const weeks: string[] = [];
  for (const b of breaks)
    for (let week = b.startsOn; week <= b.endsOn; week = shiftKey(week, 7)) weeks.push(week);
  return weeks;
}

/** The break, if any, that the week starting `weekKey` falls in. */
export function breakCovering(
  breaks: readonly StudentBreak[],
  weekKey: string,
): StudentBreak | null {
  return breaks.find((b) => b.startsOn <= weekKey && weekKey <= b.endsOn) ?? null;
}

/**
 * The spine as it will be picked up after each break, oldest first.
 *
 * Each break is the move a billing pause makes when it ends: every promise
 * before the break stands, the break weeks hold no teaching, and what they
 * would have held is spread with the rest from the week the student is back to
 * the exam ({@link resumeAfterPause}). Applying it to a spine it was already
 * applied to changes nothing, which is why the planner can show it from the
 * day a break is booked and save it only once the break is over.
 *
 * A break that can't be fitted — the exams have begun, or too few weeks are
 * left for the topics — leaves the spine as it was. Returns the input bands,
 * unchanged, when nothing moved.
 */
export function layBreaksOver(params: {
  bands: PacingBand[];
  topics: OrderTopic[];
  breaks: readonly Pick<StudentBreak, "startsOn" | "endsOn">[];
  examDate: string;
}): PacingBand[] {
  let bands = params.bands;
  const oldestFirst = [...params.breaks].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  for (const b of oldestFirst) {
    try {
      bands = resumeAfterPause({
        bands,
        topics: params.topics,
        pausedFrom: b.startsOn,
        resumeFrom: backOn(b),
        examDate: params.examDate,
      });
    } catch {
      // Nothing sensible to spread: the plan stays as it is for this break.
    }
  }
  return bands;
}

/**
 * How many weeks in a row a new break would make, counting the breaks it
 * touches on either side: `book_break` refuses more than {@link MAX_BREAK_WEEKS}.
 */
export function runWeeks(
  breaks: readonly Pick<StudentBreak, "startsOn" | "endsOn">[],
  startsOn: string,
  weeks: number,
): number {
  let from = startsOn;
  let to = breakEndsOn(startsOn, weeks);
  for (let b = breaks.find((x) => x.endsOn === shiftKey(from, -1)); b;) {
    from = b.startsOn;
    b = breaks.find((x) => x.endsOn === shiftKey(from, -1));
  }
  for (let b = breaks.find((x) => x.startsOn === shiftKey(to, 1)); b;) {
    to = b.endsOn;
    b = breaks.find((x) => x.startsOn === shiftKey(to, 1));
  }
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5 + 1) / 7
  );
}

/** Whether a new break would overlap one already booked. */
export function overlapsBreak(
  breaks: readonly Pick<StudentBreak, "startsOn" | "endsOn">[],
  startsOn: string,
  weeks: number,
): boolean {
  const endsOn = breakEndsOn(startsOn, weeks);
  return breaks.some((b) => b.startsOn <= endsOn && b.endsOn >= startsOn);
}

/** Whether a break touches the 6 weeks before an exam, or the exam week (`book_break`). */
export function touchesExam(p: { startsOn: string; weeks: number; examDate: string }): boolean {
  const examMonday = mondayKeyOf(p.examDate);
  return (
    p.startsOn <= shiftKey(examMonday, 6) &&
    breakEndsOn(p.startsOn, p.weeks) >= shiftKey(examMonday, -7 * EXAM_CLEAR_WEEKS)
  );
}
