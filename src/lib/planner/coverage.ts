// The coverage loop: at the end of a week we look at what the student actually
// did on each spec point in the plan — homework submissions and MCQ attempts,
// both already spec-point-linked — and turn that into a per-point status and a
// whole-week verdict ("you've got this, move on" vs "worth another pass"). Kept
// as pure functions so the panel, the check-in card and any tests all agree.

/** A score at or above this (percent) counts as "solid" on a point. */
export const STRONG_THRESHOLD = 70;

/** What the student did on one spec point over the plan's week. */
export interface PointCoverage {
  /** Any homework submission or quiz attempt touched this point. */
  attempted: boolean;
  homeworkDone: boolean;
  quizDone: boolean;
  /** Best percentage across their homework/quiz on this point, or null if
   *  attempted but nothing is graded/scored yet. */
  bestScore: number | null;
  /** Best homework mark on this point (null if none graded yet). */
  homeworkScore: number | null;
  /** Best quiz mark on this point (null if none scored yet). */
  quizScore: number | null;
}

/** Whether a point has any practice attached at all ({@link getActivity}). */
export interface PointActivity {
  hasHomework: boolean;
  hasQuiz: boolean;
}

export type PointStatus =
  | "strong" // did it and scored well
  | "weak" // did it but scored below the bar
  | "practised" // did it, no score to judge by yet
  | "not_done" // there was work set on it and they didn't do it
  | "not_set"; // nothing was ever set on it — not their doing

export function statusOf(c: PointCoverage | undefined): PointStatus {
  if (!c || !c.attempted) return "not_done";
  if (c.bestScore == null) return "practised";
  return c.bestScore >= STRONG_THRESHOLD ? "strong" : "weak";
}

/**
 * The same grade, but able to tell "you skipped it" from "there was nothing to
 * skip".
 *
 * `statusOf` alone reports every untouched point as "Not done", which reads as
 * an accusation on a spec point that has no homework and no quiz tagged to it —
 * a gap in the library, not in the student's week. Callers that know what was
 * actually set (the ones holding {@link Activity}) should use this instead.
 */
export function statusOfPoint(
  c: PointCoverage | undefined,
  a: PointActivity | undefined,
): PointStatus {
  const s = statusOf(c);
  if (s === "not_done" && !a?.hasHomework && !a?.hasQuiz) return "not_set";
  return s;
}

export interface StatusStyle {
  label: string;
  /**
   * What the label actually means, in the student's words. A tally reading
   * "1 Practised" is only informative to whoever wrote the rule — every status
   * carries its definition with it so no surface has to explain them again.
   */
  meaning: string;
  /** Tailwind classes for the pill (bg + text + border), light/dark aware. */
  pill: string;
  /** Solid background for a dot or a bar segment. */
  dot: string;
}

export const STATUS_STYLE: Record<PointStatus, StatusStyle> = {
  strong: {
    label: "Nailed it",
    meaning: `you scored ${STRONG_THRESHOLD}% or more`,
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  practised: {
    label: "Practised",
    meaning: "you did the work — it isn't marked yet",
    pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
    dot: "bg-sky-500",
  },
  weak: {
    label: "Shaky",
    meaning: `you scored under ${STRONG_THRESHOLD}%`,
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    dot: "bg-amber-500",
  },
  not_done: {
    label: "Not done",
    meaning: "homework or a quiz is waiting on this one",
    pill: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/40",
  },
  not_set: {
    label: "Nothing set",
    meaning: "nothing has been set on this one yet",
    pill: "bg-muted/50 text-muted-foreground/80 border-dashed border-border",
    dot: "bg-muted-foreground/25",
  },
};

/** The five statuses best-first, with how to read each one off a summary. */
export const BREAKDOWN: { status: PointStatus; count: (s: WeekSummary) => number }[] = [
  { status: "strong", count: (s) => s.strong },
  { status: "practised", count: (s) => s.practised },
  { status: "weak", count: (s) => s.weak },
  { status: "not_done", count: (s) => s.notDone },
  { status: "not_set", count: (s) => s.notSet },
];

/** Statuses that carry no score, so a pill shouldn't try to show one. */
export const UNSCORED: ReadonlySet<PointStatus> = new Set<PointStatus>(["not_done", "not_set"]);

export type Verdict = "move_on" | "almost" | "keep_going" | "no_signal";

export interface WeekSummary {
  total: number;
  strong: number;
  practised: number;
  weak: number;
  notDone: number;
  /** Points with no homework or quiz attached at all. */
  notSet: number;
  /** Points worth carrying into next week (shaky, skipped, or never set). */
  toRevisit: string[];
  /** Points the student clearly covered (strong or practised). */
  covered: string[];
  verdict: Verdict;
}

/**
 * Roll a set of per-point coverages up into the week's verdict.
 *
 * Points with nothing set are counted and carried, but deliberately kept out of
 * the verdict: a library gap is not a bad week, and grading it as one turned
 * every week red for students who had done everything asked of them.
 */
export function summarize(
  entries: { specPointId: string; coverage: PointCoverage | undefined; activity?: PointActivity }[],
): WeekSummary {
  let strong = 0;
  let practised = 0;
  let weak = 0;
  let notDone = 0;
  let notSet = 0;
  const toRevisit: string[] = [];
  const covered: string[] = [];

  for (const e of entries) {
    const s = statusOfPoint(e.coverage, e.activity);
    if (s === "strong") {
      strong++;
      covered.push(e.specPointId);
    } else if (s === "practised") {
      practised++;
      covered.push(e.specPointId);
    } else if (s === "weak") {
      weak++;
      toRevisit.push(e.specPointId);
    } else if (s === "not_done") {
      notDone++;
      toRevisit.push(e.specPointId);
    } else {
      // Still worth another week — the student hasn't been shown to know it —
      // but not evidence against them, so it never turns the banner red.
      notSet++;
      toRevisit.push(e.specPointId);
    }
  }

  const total = entries.length;
  const loose = weak + notDone;
  const graded = strong + practised + weak + notDone;
  let verdict: Verdict;
  if (total > 0 && graded === 0) verdict = "no_signal";
  else if (total === 0 || loose === 0) verdict = "move_on";
  else if (covered.length >= loose) verdict = "almost";
  else verdict = "keep_going";

  return { total, strong, practised, weak, notDone, notSet, toRevisit, covered, verdict };
}

export interface VerdictCopy {
  headline: string;
  sub: string;
  /** Tailwind classes for the banner (bg + border). */
  tone: string;
  accent: string;
}

/** "1 point" / "3 points", with a verb that agrees. */
function points(n: number): string {
  return n === 1 ? "1 point is" : `${n} points are`;
}

export function verdictCopy(v: Verdict, s: WeekSummary): VerdictCopy {
  if (v === "no_signal") {
    return {
      headline: "Nothing to mark this week",
      sub: `No homework or quizzes were set on ${
        s.total === 1 ? "this point" : "these points"
      }, so there's nothing to score yet. Tell us how you feel about it below.`,
      tone: "bg-muted/40 border-border",
      accent: "text-foreground",
    };
  }
  if (v === "move_on") {
    return {
      headline: "You've covered this week — ready to move on",
      sub:
        s.total === 0
          ? "No topics were planned for this week."
          : "Nice work. When you're happy, roll on to your next focus area.",
      tone: "bg-emerald-500/5 border-emerald-500/20",
      accent: "text-emerald-700 dark:text-emerald-300",
    };
  }
  if (v === "almost") {
    return {
      headline: "Almost there — a couple worth another pass",
      sub: `You covered most of it. ${points(
        s.weak + s.notDone,
      )} worth a bit more before you move on.`,
      tone: "bg-amber-500/5 border-amber-500/20",
      accent: "text-amber-700 dark:text-amber-300",
    };
  }
  return {
    headline: "Keep going — a few still need work",
    sub: `${points(
      s.weak + s.notDone,
    )} still shaky or not done. Carry them into next week to keep the focus.`,
    tone: "bg-rose-500/5 border-rose-500/20",
    accent: "text-rose-700 dark:text-rose-300",
  };
}

/**
 * How the week's review is split up: the same two lanes the plan itself shows
 * ({@link ThisWeekPanel}), because "did I keep up with the course" and "did the
 * revision stick" are different questions and averaging them into one banner
 * answers neither.
 */
export type Lane = "core" | "focus" | "yours";

export const LANE_LABEL: Record<Lane, string> = {
  core: "Core topic",
  focus: "Focused topics",
  yours: "Added by you",
};

/**
 * Which lane a plan point belongs to. `ai` predates lanes and has always read as
 * core — presenting unlabelled work as revision tells the student they flagged
 * something they never flagged. `carried_over` is the legacy carry origin, kept
 * here for rows written before `carried_from` existed.
 */
export function laneOf(origin: string): Lane {
  if (origin === "core" || origin === "ai") return "core";
  if (origin === "focus") return "focus";
  return "yours";
}

/**
 * The origin to file a point under when it's carried into another week — the
 * lane it is already in, never a lane of its own.
 *
 * Carrying used to overwrite `origin` with `carried_over`, so a shaky core point
 * left the core column for the neutral "added by you" box and, because the year
 * plan gives each spec point exactly one week, never came back. `ai` normalises
 * to `core` (it has always read as core) and the legacy `carried_over` has no
 * lane to recover, so it settles as the student's own.
 */
export function carryOrigin(origin: string): "core" | "focus" | "student" | "tutor" {
  if (origin === "core" || origin === "ai") return "core";
  if (origin === "focus") return "focus";
  if (origin === "tutor") return "tutor";
  return "student";
}
