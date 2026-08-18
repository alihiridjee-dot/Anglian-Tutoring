import { Repeat, Sparkles } from "lucide-react";
import { FOCUS_RED_BELOW, type PacingBand } from "@/lib/planner/pacing";
import { type TopicProgress } from "@/lib/scheduleDal";

/**
 * How the focus lane describes itself — the words and colours, kept apart from
 * the components in {@link ./FocusLane} that render them.
 */

/** What a student is told "focused topics" means, on hover. */
export const FOCUSED_TOPICS_BLURB =
  "Topics we bring back round. When a confidence rating, a quiz or a piece of homework says something hasn't stuck, it's scheduled again just before you'd forget it — and it keeps coming back until it does.";

/** Why a topic is in the focus lane, strongest call on attention first. */
export type FocusToneName = "needsWork" | "revisit" | "refresh";

/**
 * The three reasons a topic comes back, as colour.
 *
 * Each row is shaded rather than chipped, so a week reads at a glance — a run of
 * red is a student in trouble, a run of green is one coasting to the exams, and
 * you can see which you're looking at without reading a word. The icon carries
 * the same distinction as the colour, because a plan that only speaks in red and
 * green excludes the students most likely to be colour-blind from reading it,
 * and {@link FocusKey} names all three on the page.
 */
export const FOCUS_TONES: Record<
  FocusToneName,
  {
    label: string;
    icon: typeof Repeat;
    /** The shaded row: tint, left edge and hover. */
    row: string;
    /** The key's swatch — the row in miniature, tint and coloured edge both. */
    swatch: string;
    iconCls: string;
    /** What the colour means. Shown on hover in the key, not printed beside it. */
    meaning: string;
  }
> = {
  needsWork: {
    label: "Needs work",
    icon: Repeat,
    row: "bg-rose-500/[0.10] border-l-rose-500 hover:bg-rose-500/[0.16]",
    swatch: "bg-rose-500/[0.14] border-rose-500/30 border-l-rose-500",
    iconCls: "text-rose-600 dark:text-rose-400",
    meaning: "A long way from sticking — comes back most often.",
  },
  revisit: {
    label: "Revisit",
    icon: Repeat,
    row: "bg-amber-500/[0.10] border-l-amber-500 hover:bg-amber-500/[0.16]",
    swatch: "bg-amber-500/[0.14] border-amber-500/30 border-l-amber-500",
    iconCls: "text-amber-600 dark:text-amber-400",
    meaning: "Getting there — due a spaced review.",
  },
  refresh: {
    label: "Quick refresh",
    icon: Sparkles,
    row: "bg-emerald-500/[0.09] border-l-emerald-500 hover:bg-emerald-500/[0.15]",
    swatch: "bg-emerald-500/[0.13] border-emerald-500/30 border-l-emerald-500",
    iconCls: "text-emerald-600 dark:text-emerald-400",
    meaning: "Already covered — a light look before the exams.",
  },
};

/** The key's order: worst first, so it reads as a scale. */
export const FOCUS_TONE_ORDER: FocusToneName[] = ["needsWork", "revisit", "refresh"];

/** Which of the three a band is, from its kind and how well it's sticking. */
export function focusToneOf(b: PacingBand, mastery: number): FocusToneName {
  if (b.kind !== "revisit") return "refresh";
  return mastery < FOCUS_RED_BELOW ? "needsWork" : "revisit";
}

/**
 * A band's tone, plus `why` — the plain-English driver, shown on hover. The
 * numbers only exist per band, which is why they aren't in {@link FOCUS_TONES}.
 */
export function focusTone(b: PacingBand, mastery: number) {
  const name = focusToneOf(b, mastery);
  const tone = FOCUS_TONES[name];
  const pct = Math.round(mastery);
  const why =
    name === "refresh"
      ? "Already covered — a light review before the exams."
      : name === "needsWork"
        ? `Low mastery (${pct}%) — the engine resurfaces this often until it sticks.`
        : `Getting there (${pct}%) — due a spaced review so it doesn't slip.`;
  return { ...tone, name, why };
}

/**
 * Expansion key for one focus band on one week's row.
 *
 * Per ROW, not per band, for the same reason the core column is: a band can span
 * several weeks, and opening it in October must not also open its November row.
 */
export function focusRowKey(b: PacingBand, weekStart: string): string {
  return `focus:${b.topicId}|${b.kind}|${b.startWeek}@${weekStart}`;
}

/** Does this band have anything to show if opened? */
export function focusHasDetail(band: PacingBand, progress: TopicProgress | undefined): boolean {
  return (band.points?.length ?? 0) > 0 || (progress?.points.length ?? 0) > 0;
}
