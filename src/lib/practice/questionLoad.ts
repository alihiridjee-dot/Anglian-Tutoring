/**
 * How many of a point's questions a student sees: Reduced, Normal or Enhanced
 * (`profiles.question_load`).
 *
 * The quiz and the task for a point are shared: every student gets the same
 * questions. A level only decides how many of the first ones are shown, so a
 * smaller set drops the last questions by position. Normal is what every
 * student had before the levels existed.
 */
export const QUESTION_LOADS = ["reduced", "normal", "enhanced"] as const;
export type QuestionLoad = (typeof QUESTION_LOADS)[number];

export const DEFAULT_QUESTION_LOAD: QuestionLoad = "normal";

export type LoadKind = "quiz" | "task";

/** The most questions each level shows, per quiz and per task. */
export const QUESTION_CAPS: Record<QuestionLoad, Record<LoadKind, number>> = {
  reduced: { quiz: 6, task: 3 },
  normal: { quiz: 8, task: 5 },
  enhanced: { quiz: 10, task: 7 },
};

export function isQuestionLoad(value: unknown): value is QuestionLoad {
  return QUESTION_LOADS.includes(value as QuestionLoad);
}

/**
 * Enhanced is held back for now (Ali, 26 Nov 2026). Its tile is still shown,
 * dimmed, and pressing it gives Normal. Nothing else is switched off: the
 * database, the caps and the scoring all know the level, so a profile set to
 * it is simply treated as Normal until it is let through here.
 *
 * Letting it through is taking it off this list. The practice queue then
 * writes 10 MCQs and 7 written questions (`HEAVIEST_LIVE_LOAD`), which is
 * paid: about 20% more for every quiz and task from then on, so it needs
 * Ali's yes.
 */
export const HELD_QUESTION_LOADS: readonly QuestionLoad[] = ["enhanced"];

/** The level a student is on in practice: a held level counts as Normal. */
export function liveLoad(load: QuestionLoad): QuestionLoad {
  return HELD_QUESTION_LOADS.includes(load) ? DEFAULT_QUESTION_LOAD : load;
}

/**
 * The level a stored `profiles.question_load` stands for in practice: what a
 * student, their tutor and their parent are all shown. A value that is not a
 * level reads as Normal, and so does a level that is held back.
 */
export function readLoad(value: unknown): QuestionLoad {
  return isQuestionLoad(value) ? liveLoad(value) : DEFAULT_QUESTION_LOAD;
}

/**
 * The heaviest level a student can be on. The practice queue writes a quiz
 * and a task this long, as nobody is set more.
 */
export const HEAVIEST_LIVE_LOAD: QuestionLoad =
  [...QUESTION_LOADS].reverse().find((load) => liveLoad(load) === load) ?? DEFAULT_QUESTION_LOAD;

/**
 * The questions shown: the level's cap or what is stored, whichever is
 * smaller. A quiz with six stored questions shows six on every level.
 */
export function shownCount(kind: LoadKind, stored: number, load: QuestionLoad): number {
  return Math.max(0, Math.min(stored, QUESTION_CAPS[load][kind]));
}

/**
 * How many of a quiz's or task's questions a student on `load` is set. Null
 * means all of them: only the shared ones the practice queue writes (origin
 * "generated") are cut, and one a tutor wrote is always set whole.
 */
export function setCount(
  kind: LoadKind,
  origin: string | null | undefined,
  stored: number,
  load: QuestionLoad,
): number | null {
  return origin === "generated" ? shownCount(kind, stored, load) : null;
}

/** What a level left out of one quiz or task. */
export type LoadCut = {
  /** Questions the student was set. */
  set: number;
  /** Stored questions they were not set. */
  leftOut: number;
  /** The level that sets this many, or null if none does. */
  load: QuestionLoad | null;
};

/**
 * What a level left out of one piece of work, read from the work itself: the
 * count the server filed with it (`shown_count`) against the questions the
 * quiz or task held. Null when nothing was left out, which is every piece of
 * work filed without a count and every one that was set whole.
 *
 * The level is named from the count, not from the student's profile: they may
 * have changed level since, and the work says what it was set.
 */
export function loadCut(
  kind: LoadKind,
  shown: number | null | undefined,
  stored: number,
): LoadCut | null {
  if (shown == null || shown >= stored) return null;
  const set = Math.max(0, shown);
  return {
    set,
    leftOut: stored - set,
    load: QUESTION_LOADS.find((load) => QUESTION_CAPS[load][kind] === set) ?? null,
  };
}

/**
 * The first `count` questions by position, ties by id, as the server picks
 * them (`grade_mcq_attempt`, `submit_homework_answers`). Null: every question,
 * in the order given.
 */
export function firstQuestions<T extends { id: string; position: number }>(
  questions: T[],
  count: number | null,
): T[] {
  if (count == null) return questions;
  return [...questions]
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, count));
}

/**
 * Average marks of a task's question, by its position. Positions 1–5 are the
 * live averages over the queue's tasks on 26 Nov 2026 (2.2, 3.5, 4.2, 4.8 and
 * 5.6, from Ali's brief of that day). Positions 6–7 had not been written then:
 * they are taken as the mean of 4 and 5, extra exam-style questions.
 */
const TASK_MARKS_BY_POSITION = [2.2, 3.5, 4.2, 4.8, 5.6, 5.2, 5.2];
/** An MCQ is one mark, and a mark is a minute. */
const MINUTES_PER_MARK = 1;

/** Minutes for one point's quiz and task together, at a minute a mark. */
export function minutesPerTopic(load: QuestionLoad): number {
  const { quiz, task } = QUESTION_CAPS[load];
  const written = TASK_MARKS_BY_POSITION.slice(0, task).reduce((sum, marks) => sum + marks, 0);
  return Math.round((quiz + written) * MINUTES_PER_MARK);
}

/**
 * Minutes a day for a week of that many points, to the nearest five. It is
 * shown with "about": the marks are averages, and a student is not a clock.
 */
export function minutesPerDay(load: QuestionLoad, topicsPerWeek: number): number {
  const perDay = (Math.max(0, topicsPerWeek) * minutesPerTopic(load)) / 7;
  return Math.max(5, Math.round(perDay / 5) * 5);
}

/**
 * Sign-up has no plan to count yet. Plans average about seven points a week
 * for a subject, so a new student is taken at one point a day per subject.
 */
export const TOPICS_PER_WEEK_PER_SUBJECT = 7;
