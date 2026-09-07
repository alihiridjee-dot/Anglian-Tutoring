import { describe, expect, test } from "bun:test";
import {
  Rating,
  State,
  applyReview,
  isDueBy,
  isFirstContact,
  pointMastery,
  reviveCard,
  reviewEligibleAt,
  scoreToRating,
  type Card,
  type Grade,
} from "./scheduler";

/** Drive a card through a sequence of grades, one review per `stepDays`. */
function replay(grades: Grade[], start: Date, stepDays = 7): Card {
  let card: Card | null = null;
  let t = start;
  for (const g of grades) {
    card = applyReview(card, g, t);
    t = new Date(t.getTime() + stepDays * 86_400_000);
  }
  return card!;
}

describe("rating maps (boundary inputs)", () => {
  test("scoreToRating thresholds sit exactly at 50/70/90", () => {
    expect(scoreToRating(0)).toBe(Rating.Again);
    expect(scoreToRating(49)).toBe(Rating.Again);
    expect(scoreToRating(50)).toBe(Rating.Hard);
    expect(scoreToRating(69)).toBe(Rating.Hard);
    expect(scoreToRating(70)).toBe(Rating.Good);
    expect(scoreToRating(89)).toBe(Rating.Good);
    expect(scoreToRating(90)).toBe(Rating.Easy);
    expect(scoreToRating(100)).toBe(Rating.Easy);
  });
});

describe("applyReview / FSRS engine", () => {
  const t0 = new Date("2026-01-05T10:00:00Z");

  test("first review of a fresh card leaves the New state and schedules a due date", () => {
    const card = applyReview(null, Rating.Good, t0);
    expect(card.state).not.toBe(State.New);
    expect(card.reps).toBe(1);
    expect(card.due.getTime()).toBeGreaterThan(t0.getTime());
  });

  test("deterministic: same history yields the identical card (fuzz disabled)", () => {
    const a = replay([Rating.Good, Rating.Good, Rating.Easy], t0);
    const b = replay([Rating.Good, Rating.Good, Rating.Easy], t0);
    expect(a).toEqual(b);
  });

  test("'Again' on a mature card is a lapse, not a reset: stability collapses but reps/history survive", () => {
    const mature = replay([Rating.Good, Rating.Good, Rating.Good, Rating.Easy], t0, 14);
    expect(mature.state).toBe(State.Review);
    const lapseAt = new Date(mature.due.getTime() + 86_400_000);
    const lapsed = applyReview(mature, Rating.Again, lapseAt);
    expect(lapsed.lapses).toBe(mature.lapses + 1);
    expect(lapsed.reps).toBe(mature.reps + 1); // history kept — not a reset
    expect(lapsed.stability).toBeLessThan(mature.stability);
    // Pulled right back: due again far sooner than the mature interval.
    expect(lapsed.due.getTime() - lapseAt.getTime()).toBeLessThan(
      mature.due.getTime() - t0.getTime(),
    );
  });

  test("higher grades never produce shorter intervals (monotonicity on a mature card)", () => {
    const mature = replay([Rating.Good, Rating.Good, Rating.Good], t0, 10);
    const at = new Date(mature.due.getTime());
    const dues = ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map((g) =>
      applyReview(mature, g, at).due.getTime(),
    );
    for (let i = 1; i < dues.length; i++) expect(dues[i]).toBeGreaterThanOrEqual(dues[i - 1]);
  });

  test("maximum_interval caps scheduling at a year even for a very strong card", () => {
    const strong = replay(Array(12).fill(Rating.Easy), t0, 30);
    const at = new Date(strong.due.getTime());
    const next = applyReview(strong, Rating.Easy, at);
    // ts-fsrs caps the interval at 365 days but rounds the due date, which can
    // land a day or two past the raw cap — the contract is "about a year, never
    // multi-year growth".
    expect(next.due.getTime() - at.getTime()).toBeLessThanOrEqual(368 * 86_400_000);
  });
});

describe("timezone / DST handling", () => {
  test("reviews across the spring-forward boundary keep a monotonic, UTC-consistent schedule", () => {
    // Europe/London jumps BST at 2026-03-29T01:00Z. Review just before, again just after.
    const before = new Date("2026-03-29T00:30:00Z");
    const after = new Date("2026-03-29T02:30:00Z");
    let card = applyReview(null, Rating.Good, before);
    card = applyReview(card, Rating.Good, after);
    expect(card.due.getTime()).toBeGreaterThan(after.getTime());
    expect(card.last_review?.getTime()).toBe(after.getTime());
  });

  test("isDueBy compares absolute instants, so a wall-clock shift cannot hide a due card", () => {
    const card = applyReview(null, Rating.Hard, new Date("2026-10-24T20:00:00Z"));
    // Autumn back-shift (2026-10-25 in London): one ms past due is due, one before is not.
    const justBefore = new Date(reviewEligibleAt(card).getTime() - 1);
    const justAfter = new Date(reviewEligibleAt(card).getTime() + 1);
    expect(isDueBy(card, justBefore)).toBe(false);
    expect(isDueBy(card, justAfter)).toBe(true);
  });

  test("reviveCard round-trips ISO strings (jsonb storage) into equivalent Dates", () => {
    const card = replay([Rating.Good, Rating.Again], new Date("2026-01-01T00:00:00Z"));
    const stored = JSON.parse(JSON.stringify(card));
    const revived = reviveCard(stored);
    expect(revived.due.getTime()).toBe(card.due.getTime());
    expect(revived.last_review?.getTime()).toBe(card.last_review?.getTime());
    expect(revived.stability).toBe(card.stability);
  });
});

describe("assessment scheduling", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  test("historical confidence cannot rank or establish memory", () => {
    for (const confidence of [null, 0, 50, 100]) {
      expect(pointMastery(null, confidence, now)).toBe(0);
    }
    const card = applyReview(null, Rating.Good, now);
    expect(pointMastery(card, 0, now)).toBe(pointMastery(card, 100, now));
  });
  test("raw due and weekly eligibility remain distinct", () => {
    const card = applyReview(null, Rating.Again, now);
    expect(card.due.getTime()).toBeLessThan(now.getTime() + 7 * 86400000);
    expect(reviewEligibleAt(card).getTime()).toBe(now.getTime() + 7 * 86400000);
    expect(isDueBy(card, new Date(now.getTime() + 86400000))).toBe(false);
    expect(isDueBy(card, reviewEligibleAt(card))).toBe(true);
  });
  test("mature intervals are never shortened by the weekly minimum", () => {
    const card = replay([Rating.Easy, Rating.Easy, Rating.Easy], now, 30);
    expect(reviewEligibleAt(card)).toEqual(card.due);
  });
  test("unassessed and assessed points remain distinguishable", () => {
    expect(isFirstContact(null)).toBe(true);
    expect(isFirstContact(applyReview(null, Rating.Again, now))).toBe(false);
  });
});
