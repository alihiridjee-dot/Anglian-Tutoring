import { describe, expect, test } from "bun:test";
import {
  Rating,
  State,
  applyReview,
  confidenceToRating,
  isDueBy,
  pointMastery,
  pointStatus,
  priority,
  reviveCard,
  scoreToRating,
  selectForWeek,
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

  test("confidenceToRating thresholds sit exactly at 34/67/85", () => {
    expect(confidenceToRating(0)).toBe(Rating.Again);
    expect(confidenceToRating(33)).toBe(Rating.Again);
    expect(confidenceToRating(34)).toBe(Rating.Hard);
    expect(confidenceToRating(66)).toBe(Rating.Hard);
    expect(confidenceToRating(67)).toBe(Rating.Good);
    expect(confidenceToRating(84)).toBe(Rating.Good);
    expect(confidenceToRating(85)).toBe(Rating.Easy);
    expect(confidenceToRating(100)).toBe(Rating.Easy);
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
    const dues = ([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as Grade[]).map(
      (g) => applyReview(mature, g, at).due.getTime(),
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
    const justBefore = new Date(card.due.getTime() - 1);
    const justAfter = new Date(card.due.getTime() + 1);
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

describe("priority & selection (new vs mature)", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  test("never-practised points rank by inverse confidence; unrated defaults to middling", () => {
    expect(priority({ card: null, confidence: 0 }, now)).toBe(100);
    expect(priority({ card: null, confidence: 100 }, now)).toBe(0);
    expect(priority({ card: null, confidence: null }, now)).toBe(50);
  });

  test("an overdue lapsed card outranks any new point", () => {
    const mature = replay([Rating.Easy, Rating.Easy], new Date("2026-01-01T00:00:00Z"), 14);
    const lapsed = applyReview(mature, Rating.Again, new Date("2026-05-01T00:00:00Z"));
    const overdue = { card: lapsed, confidence: 80 };
    const worstNew = { card: null, confidence: 0 };
    expect(priority(overdue, now)).toBeGreaterThan(priority(worstNew, now));
  });

  test("selectForWeek filters to due-by-week-end, orders by urgency, and honours the cap", () => {
    const weekEnd = new Date("2026-06-07T23:59:59Z");
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const items = [
      { specPointId: "new-weak", card: null, confidence: 10 },
      { specPointId: "new-strong", card: null, confidence: 95 },
      { specPointId: "not-due", card: strong, confidence: null }, // due far beyond weekEnd
      {
        specPointId: "overdue",
        card: applyReview(null, Rating.Again, new Date("2026-05-20T00:00:00Z")),
        confidence: null,
      },
    ];
    const picked = selectForWeek(items, weekEnd, 2, now);
    expect(picked).toHaveLength(2);
    expect(picked[0]).toBe("overdue"); // reviewed + overdue beats every new point
    expect(picked[1]).toBe("new-weak");
    expect(picked).not.toContain("not-due");
    expect(selectForWeek(items, weekEnd, 0, now)).toHaveLength(0);
    expect(selectForWeek([], weekEnd, 5, now)).toHaveLength(0);
  });

  test("pointStatus: overdue trumps raw state; strong = future-due review card", () => {
    expect(pointStatus(null, now)).toBe("new");
    const justRated = applyReview(null, Rating.Good, now);
    // Early learning steps come due in minutes — an hour later it's already "due".
    expect(pointStatus(justRated, new Date(now.getTime() + 3_600_000 * 24))).toBe("due");
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    expect(pointStatus(strong, new Date(strong.due.getTime() - 1))).toBe("strong");
    expect(pointStatus(strong, new Date(strong.due.getTime() + 1))).toBe("due");
  });

  test("pointMastery boundaries: clamped 0–100, never-touched uses confidence", () => {
    expect(pointMastery(null, null, now)).toBe(0);
    expect(pointMastery(null, 250, now)).toBe(100); // clamped
    expect(pointMastery(null, -5, now)).toBe(0);
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const m = pointMastery(strong, 50, new Date(strong.due.getTime() - 1));
    expect(m).toBeGreaterThanOrEqual(70);
    expect(m).toBeLessThanOrEqual(100);
  });
});
