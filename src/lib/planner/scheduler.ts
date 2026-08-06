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
//
// `enable_short_term: false` is what makes this a weekly engine rather than a
// flashcard one. FSRS ships with learning steps of 1 and 10 MINUTES: out of the
// box, a student who rates a point "confident" gets it back the same afternoon.
// That is right for someone drilling cards all day and wrong for us — nobody
// opens their planner twice in an hour. With short-term off there are no
// sub-day steps at all; a card goes straight into review with an interval
// measured in days.
const scheduler = fsrs(
  generatorParameters({ enable_fuzz: false, maximum_interval: 365, enable_short_term: false }),
);

/**
 * Nothing is due sooner than the student's next visit.
 *
 * Even without the minute-level steps, FSRS thinks in days: a shaky point wants
 * to come back in one or two. That is correct memory science and useless to us —
 * the planner is a weekly grid and the student sees it once a week, so a card
 * due on Wednesday is simply "overdue" by the time anyone looks, and everything
 * piles into the focus lane at once. Flooring the due date at a week aligns the
 * engine's cadence with the product's. It only ever pushes a due date later, so
 * a mature card's long interval is untouched, and stability/difficulty are not
 * altered — FSRS still computes those from the real elapsed time at the next
 * review.
 */
const MIN_INTERVAL_DAYS = 7;

/**
 * How long a card must hold before it reads as genuinely strong.
 *
 * This exists because of the floor above. Once every card is pushed at least a
 * week out, "not due yet" stops meaning anything — a point the student has just
 * dragged into *Needs work* is no more due than one they've aced four times, so
 * a status derived from the due date alone called both of them strong. It scored
 * a just-flagged weak point 70/100, over the settled line, which kept it out of
 * the focus lane and out of the year plan entirely: the student's clearest
 * signal about themselves was read as its opposite.
 *
 * Stability is the honest measure — it's how many days FSRS thinks the memory
 * survives, and it's untouched by our flooring. Two weeks is the bar: one full
 * cycle beyond the weekly cadence we schedule on, so a card only counts as
 * strong once its own interval clears our floor with room to spare. Below it the
 * card is still bedding in, whatever its due date says — including a mature
 * point that has just lapsed, which collapses to ~14 days and belongs back in
 * the lane rather than sitting out until it comes due.
 */
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

/**
 * Apply one review to a card (or a fresh one) and return the updated card, with
 * its due date floored to {@link MIN_INTERVAL_DAYS} (see the note there).
 *
 * `countsAsLapse: false` keeps the card's lapse counter where it was. A lapse is
 * meant to mean "knew it, then got it wrong" — evidence from a mark. A student
 * dragging a topic into "Not confident" is telling us something useful, and it
 * still shortens the interval exactly as before (FSRS's scheduling reads
 * stability, difficulty and retrievability — never the lapse count, which is
 * bookkeeping). Recording it as a failure on top of that punishes them for being
 * honest, and the penalty it feeds is permanent.
 */
export function applyReview(
  card: Card | null,
  grade: Grade,
  now: Date = new Date(),
  { countsAsLapse = true }: { countsAsLapse?: boolean } = {},
): Card {
  const base: Card = card ?? createEmptyCard<Card>(now);
  const next = scheduler.next(base, now, grade).card;
  const floor = now.getTime() + MIN_INTERVAL_DAYS * 86_400_000;
  const due = dueMs(next) >= floor ? next.due : new Date(floor);
  return { ...next, due, lapses: countsAsLapse ? next.lapses : base.lapses };
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

/**
 * A plain-English read of where a spec point sits in its learning curve, for the
 * progress surfaces (roadmap expand, covered ledger). Every graded event —
 * including a confidence self-rating — moves the card, so this reflects the
 * blend of what the student felt and what they actually scored.
 *
 *  • `new`      — never touched (no card yet).
 *  • `due`      — practised, but now due/overdue for another look (a flop lands here).
 *  • `learning` — bedding in: the memory doesn't hold for {@link STRONG_STABILITY_DAYS}
 *                 yet, so a freshly rated point sits here whatever its due date.
 *  • `strong`   — holds for a fortnight or more and isn't due — it's sticking.
 */
export type PointStatus = "new" | "due" | "learning" | "strong";

export function pointStatus(card: Card | null, now: Date = new Date()): PointStatus {
  if (!card || card.state === State.New) return "new";
  if (dueMs(card) <= now.getTime()) return "due"; // overdue trumps the raw state
  // Strength is what the card holds, not when we happen to have scheduled it.
  if (
    card.state === State.Learning ||
    card.state === State.Relearning ||
    card.stability < STRONG_STABILITY_DAYS
  )
    return "learning";
  return "strong";
}

/** The confidence band where mastery is high enough to call a topic "on track". */
export const SETTLED_THRESHOLD = 67;

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * How much a due point loses per week it sits unreviewed, and the most it can
 * lose that way. Being due is a prompt to look again, not evidence of ignorance —
 * so a point that came due yesterday is barely marked down, while one ignored for
 * a month and a half slides a full band.
 */
export const DUE_STALENESS_PER_WEEK = 5;
export const DUE_STALENESS_MAX = 25;

/**
 * What a lapse costs, and the most lapses can cost in total.
 *
 * Capped, and deliberately absent from the `strong` branch: a lapse has already
 * collapsed the card's stability, and that branch is *made of* stability, so
 * charging again there would price the same mistake twice. Leaving it out is
 * also the way back — a point re-learned until it reads strong sheds the penalty
 * entirely, which an uncapped permanent tax never allowed.
 */
export const LAPSE_PENALTY = 5;
export const LAPSE_PENALTY_MAX = 15;

function lapsePenalty(card: Card): number {
  return Math.min(LAPSE_PENALTY_MAX, (card.lapses ?? 0) * LAPSE_PENALTY);
}

/**
 * A 0–100 "mastery" for one spec point, derived from its FSRS card so the
 * programme reflects the same engine that drives the weekly plan. A never-touched
 * point scores its confidence rating (so the termly board feeds the programme
 * before any homework exists); once practised, the card's state and stability
 * take over — a stale point drifts down, real lapses chip away (capped, and only
 * while the point is still shaky), and a stable review point scores high. Averaged across a topic's points this is what decides whether the
 * topic reads as settled on the roadmap.
 *
 * What the student said is the anchor, not a garnish. The old formula scored a
 * due point `25 + confidence × 0.25`, which topped out at 50 — below the 67
 * settled line — so ANY point that came due was condemned to the focus lane no
 * matter how well the student knew it. They could drag every topic into
 * "Confident" and watch the plan disagree with them forever. Confidence now sets
 * the level and the card's state adjusts it, so the board and the plan tell the
 * same story.
 *
 * With no self-rating at all (a point only ever touched by homework or a quiz) we
 * start from neutral rather than zero — the marks have already moved the card,
 * and scoring silence as ignorance would bury it.
 */
export function pointMastery(
  card: Card | null,
  confidence: number | null,
  now: Date = new Date(),
): number {
  if (!card || card.state === State.New) return clampScore(confidence ?? 0);
  const penalty = lapsePenalty(card);
  const stated = confidence ?? 50;
  switch (pointStatus(card, now)) {
    case "due": {
      // Due, marked down by how long it has been sitting there unlooked-at.
      const weeksOverdue = Math.max(0, (now.getTime() - dueMs(card)) / (7 * 86_400_000));
      const staleness = Math.min(DUE_STALENESS_MAX, weeksOverdue * DUE_STALENESS_PER_WEEK);
      return clampScore(stated - 5 - staleness - penalty);
    }
    case "learning":
      // Bedding in: not due, but not holding either. What the student says about
      // it is the best evidence there is, so a point they've just called shaky
      // scores shaky — the case that used to land in `strong` and read 70.
      return clampScore(stated - 3 - penalty);
    default: // strong
      // No lapse penalty here on purpose: stability already carries it.
      return clampScore(70 + Math.min(30, card.stability / 2));
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
