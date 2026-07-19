import {
  fsrs,
  createEmptyCard,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade,
} from "ts-fsrs";

/**
 * The spaced-repetition brain for the planner.
 *
 * Each spec point is an FSRS "card" per student, carrying hidden `stability`
 * (how well it's stuck) and `difficulty` numbers plus a `due` date. Every graded
 * event — an MCQ score, a homework mark, or a confidence self-rating — is a
 * "review" that updates the card: strong results stretch the interval (light
 * touch later), weak ones collapse it (resurfaces soon). A high grade followed
 * by a flop is a *lapse* and FSRS pulls the due-date right back, so a topic the
 * student thought they'd nailed but then bombed comes back into focus on its
 * own — no special-casing.
 *
 * We run FSRS at a weekly, event-driven cadence rather than as literal daily
 * flashcards: it's the prioritisation + due-date engine that decides which spec
 * points a weekly plan should surface, weakest/most-overdue first. Pure module —
 * no I/O — so it's trivially testable and the DAL owns persistence.
 */

export { State, Rating };
export type { Card, Grade };

/** Where a review came from — for the review-log ledger (DB-enforced list). */
export type ReviewSource = "homework" | "mcq" | "confidence";

// Deterministic scheduling: fuzz off so the same history always yields the same
// due-date (important for previews/tests), and cap intervals at a year so a
// GCSE course never schedules a review past the exam horizon.
const scheduler = fsrs(generatorParameters({ enable_fuzz: false, maximum_interval: 365 }));

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

/**
 * Map a 0–100 confidence self-rating to a grade. A self-report is a softer
 * signal than a test, but "I feel shaky" should still shorten the interval.
 */
export function confidenceToRating(conf: number): Grade {
  if (conf < 34) return Rating.Again;
  if (conf < 67) return Rating.Hard;
  if (conf < 85) return Rating.Good;
  return Rating.Easy;
}

/** Apply one review to a card (or a fresh one) and return the updated card. */
export function applyReview(card: Card | null, grade: Grade, now: Date = new Date()): Card {
  const base: Card = card ?? createEmptyCard<Card>(now);
  return scheduler.next(base, now, grade).card;
}

/**
 * How urgently a spec point wants attention. A single interpretable scale so
 * never-seen points and overdue reviews can be ordered together:
 *
 *  • New / never-practised → 0–100 from (100 − confidence): weak, unrated points
 *    rank high; confident-but-unpractised ones rank low.
 *  • Reviewed points get a 50 baseline (so a due review outranks a fresh, fairly
 *    confident new point) plus how overdue they are, how weak (low stability),
 *    and how many times they've lapsed — the flop-after-confidence case floats
 *    straight back to the top.
 */
export function priority(
  item: { card: Card | null; confidence: number | null },
  now: Date = new Date(),
): number {
  const c = item.card;
  if (!c || c.state === State.New) {
    const conf = item.confidence ?? 50; // unrated = middling, not urgent
    return 100 - conf;
  }
  const overdueDays = Math.max(0, (now.getTime() - dueMs(c)) / 86_400_000);
  const weakness = 100 / (1 + c.stability); // low stability → up to ~100
  return 50 + Math.min(overdueDays, 30) * 2 + weakness + c.lapses * 5;
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
  return dueMs(card) <= when.getTime();
}

/**
 * A plain-English read of where a spec point sits in its learning curve, for the
 * progress surfaces (roadmap expand, covered ledger). Every graded event —
 * including a confidence self-rating — moves the card, so this reflects the
 * blend of what the student felt and what they actually scored.
 *
 *  • `new`      — never touched (no card yet).
 *  • `due`      — practised, but now due/overdue for another look (a flop lands here).
 *  • `learning` — mid-way through bedding in (learning / relearning steps).
 *  • `strong`   — in long-term review and not due for a while — it's sticking.
 */
export type PointStatus = "new" | "due" | "learning" | "strong";

export function pointStatus(card: Card | null, now: Date = new Date()): PointStatus {
  if (!card || card.state === State.New) return "new";
  if (dueMs(card) <= now.getTime()) return "due"; // overdue trumps the raw state
  if (card.state === State.Learning || card.state === State.Relearning) return "learning";
  return "strong";
}

/** The confidence band where mastery is high enough to call a topic "on track". */
export const SETTLED_THRESHOLD = 67;

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * A 0–100 "mastery" for one spec point, derived from its FSRS card so the
 * programme reflects the same engine that drives the weekly plan. A never-touched
 * point scores its confidence rating (so the termly board feeds the programme
 * before any homework exists); once practised, the card's state and stability
 * take over — a flop drops it back to "due", lapses chip away, a stable review
 * point scores high. Averaged across a topic's points this is what decides
 * whether the topic reads as settled on the roadmap.
 */
export function pointMastery(
  card: Card | null,
  confidence: number | null,
  now: Date = new Date(),
): number {
  if (!card || card.state === State.New) return clampScore(confidence ?? 0);
  const penalty = (card.lapses ?? 0) * 5;
  switch (pointStatus(card, now)) {
    case "due":
      // Due means "needs another look", not "back to zero". Early-stage FSRS
      // intervals are short (minutes–days), so at our weekly cadence a card the
      // student only just rated is due again almost immediately — blend their
      // stated confidence so a confident-but-due point reads mid-40s (one
      // revisit) while a needs-work or lapsing one stays low (keeps recurring).
      return clampScore(25 + (confidence ?? 0) * 0.25 - penalty);
    case "learning":
      return clampScore(50 - penalty);
    default: // strong
      return clampScore(70 + Math.min(30, card.stability / 2) - penalty);
  }
}

export interface Schedulable {
  specPointId: string;
  card: Card | null;
  confidence: number | null;
}

/**
 * Choose the spec points a weekly plan should lead with: everything due by the
 * end of that week (plus never-practised points), ordered most-urgent first,
 * capped at `targetCount`. Confident, not-yet-due points fall away naturally —
 * that's the "light touch" for things already stuck.
 */
export function selectForWeek(
  items: Schedulable[],
  weekEnd: Date,
  targetCount: number,
  now: Date = new Date(),
): string[] {
  return items
    .filter((i) => isDueBy(i.card, weekEnd))
    .sort((a, b) => priority(b, now) - priority(a, now))
    .slice(0, Math.max(0, targetCount))
    .map((i) => i.specPointId);
}
