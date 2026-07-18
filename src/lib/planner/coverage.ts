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

export type PointStatus =
  | "strong" // did it and scored well
  | "weak" // did it but scored below the bar
  | "practised" // did it, no score to judge by yet
  | "not_done"; // never touched it

export function statusOf(c: PointCoverage | undefined): PointStatus {
  if (!c || !c.attempted) return "not_done";
  if (c.bestScore == null) return "practised";
  return c.bestScore >= STRONG_THRESHOLD ? "strong" : "weak";
}

export interface StatusStyle {
  label: string;
  /** Tailwind classes for the pill (bg + text + border), light/dark aware. */
  pill: string;
  dot: string;
}

export const STATUS_STYLE: Record<PointStatus, StatusStyle> = {
  strong: {
    label: "Nailed it",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  practised: {
    label: "Practised",
    pill: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/20",
    dot: "bg-sky-500",
  },
  weak: {
    label: "Shaky",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    dot: "bg-amber-500",
  },
  not_done: {
    label: "Not done",
    pill: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground/40",
  },
};

export type Verdict = "move_on" | "almost" | "keep_going";

export interface WeekSummary {
  total: number;
  strong: number;
  practised: number;
  weak: number;
  notDone: number;
  /** Points worth carrying into next week (weak or never done). */
  toRevisit: string[];
  /** Points the student clearly covered (strong or practised). */
  covered: string[];
  verdict: Verdict;
}

/** Roll a set of per-point coverages up into the week's verdict. */
export function summarize(
  entries: { specPointId: string; coverage: PointCoverage | undefined }[],
): WeekSummary {
  let strong = 0;
  let practised = 0;
  let weak = 0;
  let notDone = 0;
  const toRevisit: string[] = [];
  const covered: string[] = [];

  for (const e of entries) {
    const s = statusOf(e.coverage);
    if (s === "strong") {
      strong++;
      covered.push(e.specPointId);
    } else if (s === "practised") {
      practised++;
      covered.push(e.specPointId);
    } else if (s === "weak") {
      weak++;
      toRevisit.push(e.specPointId);
    } else {
      notDone++;
      toRevisit.push(e.specPointId);
    }
  }

  const total = entries.length;
  const loose = weak + notDone;
  let verdict: Verdict;
  if (total === 0 || loose === 0) verdict = "move_on";
  else if (covered.length >= loose) verdict = "almost";
  else verdict = "keep_going";

  return { total, strong, practised, weak, notDone, toRevisit, covered, verdict };
}

export interface VerdictCopy {
  headline: string;
  sub: string;
  /** Tailwind classes for the banner (bg + border). */
  tone: string;
  accent: string;
}

export function verdictCopy(v: Verdict, s: WeekSummary): VerdictCopy {
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
      sub: `You covered most of it. ${s.toRevisit.length} ${
        s.toRevisit.length === 1 ? "point" : "points"
      } could use a bit more before you move on.`,
      tone: "bg-amber-500/5 border-amber-500/20",
      accent: "text-amber-700 dark:text-amber-300",
    };
  }
  return {
    headline: "Keep going — a few still need work",
    sub: `${s.toRevisit.length} ${
      s.toRevisit.length === 1 ? "point" : "points"
    } are still shaky or not done. Carry them into next week to keep the focus.`,
    tone: "bg-rose-500/5 border-rose-500/20",
    accent: "text-rose-700 dark:text-rose-300",
  };
}
