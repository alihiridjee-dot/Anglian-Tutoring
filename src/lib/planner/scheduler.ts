import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from "ts-fsrs";

/** Assessment-driven memory model. FSRS owns the raw due date; the weekly
 * planner applies eligibility and capacity separately. Confidence is historical
 * metadata only and must never advance a memory card. */

export { State, Rating };
export type { Card, Grade };

/** Where a review came from — for the review-log ledger (DB-enforced list). */
export type ReviewSource = "homework" | "mcq" | "confidence";

const scheduler = fsrs(
  generatorParameters({ enable_fuzz: false, maximum_interval: 365, enable_short_term: false }),
);

export const MIN_INTERVAL_DAYS = 7;

/** Weekly-product minimum; deliberately does not mutate FSRS's recommendation. */
export function reviewEligibleAt(card: Card): Date {
  const last = card.last_review ? new Date(card.last_review).getTime() : 0;
  return new Date(Math.max(dueMs(card), last + MIN_INTERVAL_DAYS * 86_400_000));
}

/** Memory strength indicator, never an assessment of curriculum understanding. */
export const STRONG_STABILITY_DAYS = 2 * MIN_INTERVAL_DAYS;

/**
 * Rehydrate a card read back from jsonb, where `due`/`last_review` are ISO
 * strings rather than Dates. Everything downstream can then assume real Dates.
 */
export function reviveCard(raw: unknown): Card {
  const c = raw as Card & { due: string | Date; last_review?: string | Date };
  return {
    ...c,
    due: new Date(c.due),
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  } as Card;
}

function dueMs(card: Card): number {
  return card.due instanceof Date ? card.due.getTime() : new Date(card.due).getTime();
}

/**
 * Map a 0–100 test/homework score to an FSRS grade. Thresholds mirror the
 * coverage model's STRONG_THRESHOLD (70 = solid): a fail resurfaces soon, a
 * strong pass stretches the interval.
 */
export function scoreToRating(pct: number): Grade {
  if (pct < 50) return Rating.Again;
  if (pct < 70) return Rating.Hard;
  if (pct < 90) return Rating.Good;
  return Rating.Easy;
}

/** Apply assessed evidence, preserving the raw FSRS due date. */
export function applyReview(
  card: Card | null,
  grade: Grade,
  now: Date = new Date(),
  { countsAsLapse = true }: { countsAsLapse?: boolean } = {},
): Card {
  const base: Card = card ?? createEmptyCard<Card>(now);
  const next = scheduler.next(base, now, grade).card;
  return { ...next, lapses: countsAsLapse ? next.lapses : base.lapses };
}

/**
 * FSRS retrievability: the probability (0–1) the student could recall this
 * point right now. Null for never-practised points — "no data" is different
 * from "will forget", and the dashboard renders them separately.
 */
export function retrievability(card: Card | null, now: Date = new Date()): number | null {
  if (!card || card.state === State.New) return null;
  return scheduler.get_retrievability(card, now, false);
}

/** Is this point eligible to appear in a plan for a week ending `when`? */
export function isDueBy(card: Card | null, when: Date): boolean {
  if (!card || card.state === State.New) return true; // never practised → always eligible
  return reviewEligibleAt(card).getTime() <= when.getTime();
}

/**
 * Has the student never met this point? The one honest lane signal available
 * when there is no programme to ask.
 *
 * A point with no card behind it is first contact — that's teaching, and it
 * belongs in the core lane. A point that already has one is coming back round,
 * which is revision. The fallback planner had no such rule and labelled
 * everything it picked as revision, so a student who had simply never been
 * taught a topic was told they were revisiting it.
 */
export function isFirstContact(card: Card | null): boolean {
  return !card || card.state === State.New;
}

/** A memory estimate, distinct from completed teaching and assessed marks. */
export type PointStatus = "new" | "due" | "learning" | "strong";

export function pointStatus(card: Card | null, now: Date = new Date()): PointStatus {
  if (!card || card.state === State.New) return "new";
  if (reviewEligibleAt(card).getTime() <= now.getTime()) return "due"; // overdue trumps the raw state
  // Strength is what the card holds, not when we happen to have scheduled it.
  if (
    card.state === State.Learning ||
    card.state === State.Relearning ||
    card.stability < STRONG_STABILITY_DAYS
  )
    return "learning";
  return "strong";
}

/** Compatibility threshold for evidence-based coverage, not self-confidence. */
export const SETTLED_THRESHOLD = 70;

/** Legacy API for consumers still requiring a numeric memory indicator.
 * Confidence is ignored. This is NOT a mastery or curriculum coverage score. */
export function pointMastery(
  card: Card | null,
  _confidence: number | null,
  now: Date = new Date(),
): number {
  if (!card || card.state === State.New) return 0;
  const strength = Math.min(1, card.stability / STRONG_STABILITY_DAYS);
  return Math.round(100 * strength * (retrievability(card, now) ?? 0));
}
