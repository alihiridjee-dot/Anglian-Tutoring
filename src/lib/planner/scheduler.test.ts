import { describe, expect, test } from "bun:test";
import {
  Rating,
  SETTLED_THRESHOLD,
  STRONG_STABILITY_DAYS,
  State,
  applyReview,
  confidenceToRating,
  isDueBy,
  isFirstContact,
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

  test("isFirstContact separates new material from work coming back round", () => {
    // The lane rule the fallback planner runs on. It used to have none, so a
    // point the student had never been taught was presented to them as revision.
    const reviewed = applyReview(null, Rating.Good, now);
    expect(isFirstContact(null)).toBe(true);
    expect(isFirstContact({ ...reviewed, state: State.New })).toBe(true); // card row, never sat
    expect(isFirstContact(reviewed)).toBe(false);
    // A lapsed point has been met before — still revision, however badly it went.
    expect(isFirstContact(replay([Rating.Easy, Rating.Again], now))).toBe(false);
  });

  test("pointStatus: overdue trumps raw state; strong = future-due review card", () => {
    expect(pointStatus(null, now)).toBe("new");
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    expect(pointStatus(strong, new Date(strong.due.getTime() - 1))).toBe("strong");
    expect(pointStatus(strong, new Date(strong.due.getTime() + 1))).toBe("due");
  });

  test("a just-rated point is not due again before the student's next weekly visit", () => {
    // The whole reason for the week floor: on FSRS defaults a "confident" rating
    // came due in minutes, so by the next visit every point the student had just
    // sorted read as overdue and flooded the focus lane.
    const justRated = applyReview(null, Rating.Good, now);
    const day = 86_400_000;
    expect(isDueBy(justRated, new Date(now.getTime() + 6 * day))).toBe(false);
    expect(pointStatus(justRated, new Date(now.getTime() + 8 * day))).toBe("due");
    // It holds for the grades FSRS would otherwise pull back hardest.
    for (const g of [Rating.Again, Rating.Hard] as Grade[]) {
      const card = applyReview(null, g, now);
      expect(card.due.getTime() - now.getTime()).toBeGreaterThanOrEqual(7 * day);
    }
  });

  test("a point just flagged 'needs work' reads weak immediately, not strong", () => {
    // The regression this guards, and it was a bad one: the week floor pushes
    // every fresh card's due date out, so a status read off the due date called a
    // point the student had *just* dragged into "Needs work" strong — scoring it
    // 70, over the settled line. It was then excluded from the focus lane and
    // from the whole year plan, and its topic could read as already mastered.
    const rate = (conf: number) =>
      applyReview(null, confidenceToRating(conf), now, { countsAsLapse: false });
    const mastery = (conf: number) => pointMastery(rate(conf), conf, now);

    expect(pointStatus(rate(17), now)).toBe("learning"); // bedding in, not strong
    expect(mastery(17)).toBeLessThan(34); // red: earns recurring revisits
    expect(mastery(50)).toBeLessThan(SETTLED_THRESHOLD);
    expect(mastery(83)).toBeGreaterThanOrEqual(SETTLED_THRESHOLD);
    // The three board columns must be distinguishable on day one — they all
    // scored ~70 before, so sorting the board changed nothing for a week.
    expect(mastery(50)).toBeGreaterThan(mastery(17));
    expect(mastery(83)).toBeGreaterThan(mastery(50));
  });

  test("a mature point that has just lapsed goes back in the lane, not out of it", () => {
    const mature = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const at = new Date(mature.due.getTime() + 86_400_000);
    const lapsed = applyReview(mature, Rating.Again, at);
    expect(pointStatus(mature, new Date(mature.due.getTime() - 1))).toBe("strong");
    // Its stability has collapsed, so it is shaky from the moment it flops —
    // waiting for the floored due date to pass would sit it out for a week.
    expect(lapsed.stability).toBeLessThan(STRONG_STABILITY_DAYS);
    expect(pointStatus(lapsed, at)).toBe("learning");
    expect(pointMastery(lapsed, 50, at)).toBeLessThan(SETTLED_THRESHOLD);
  });

  test("the floor only ever pushes a due date out — a mature card keeps its long interval", () => {
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const at = new Date(strong.due.getTime());
    const next = applyReview(strong, Rating.Easy, at);
    expect(next.due.getTime() - at.getTime()).toBeGreaterThan(30 * 86_400_000);
  });

  test("a self-rating shortens the interval but never lapses the card", () => {
    // Dragging a topic to "Not confident" used to be recorded identically to
    // failing a test, so an honest student was permanently marked down for it.
    const mature = replay([Rating.Good, Rating.Good, Rating.Good, Rating.Easy], now, 14);
    const at = new Date(mature.due.getTime() + 86_400_000);
    const selfRated = applyReview(mature, Rating.Again, at, { countsAsLapse: false });
    const flopped = applyReview(mature, Rating.Again, at);

    expect(selfRated.lapses).toBe(mature.lapses); // no lapse recorded
    expect(flopped.lapses).toBe(mature.lapses + 1); // a real flop still counts
    // The scheduling is identical either way — the counter is bookkeeping, and
    // a shaky self-report must still bring the point back sooner.
    expect(selfRated.due.getTime()).toBe(flopped.due.getTime());
    expect(selfRated.stability).toBe(flopped.stability);
    expect(selfRated.due.getTime() - at.getTime()).toBeLessThan(
      mature.due.getTime() - now.getTime(),
    );
  });

  test("the lapse penalty is capped and absent once a point reads strong", () => {
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const at = new Date(strong.due.getTime() - 1);
    // Stability already carries the lapse in this branch, so it is not charged
    // again — which is also how a re-learned point sheds the penalty.
    const clean = pointMastery({ ...strong, lapses: 0 }, 50, at);
    expect(pointMastery({ ...strong, lapses: 6 }, 50, at)).toBe(clean);

    // Elsewhere it is capped, so an old bad patch cannot bury a point forever.
    const due = applyReview(null, Rating.Good, now);
    const dueAt = new Date(due.due.getTime() + 60_000);
    const three = pointMastery({ ...due, lapses: 3 }, 83, dueAt);
    expect(pointMastery({ ...due, lapses: 6 }, 83, dueAt)).toBe(three);
    expect(pointMastery({ ...due, lapses: 20 }, 83, dueAt)).toBe(three);
    expect(pointMastery({ ...due, lapses: 0 }, 83, dueAt)).toBeGreaterThan(three);
  });

  test("a confident point that has just come due stays above the settled line", () => {
    // The regression this guards: the old formula scored a due point
    // 25 + confidence/4, so its ceiling was 50 against a settled bar of 67. A
    // student could sort every topic into "Confident" and the plan would still
    // drag all of it back into the focus lane, forever.
    const card = applyReview(null, Rating.Good, now);
    const justDue = new Date(card.due.getTime() + 60_000);
    expect(pointMastery(card, 83, justDue)).toBeGreaterThanOrEqual(SETTLED_THRESHOLD);
    // and a shaky one still reads shaky
    expect(pointMastery(card, 17, justDue)).toBeLessThan(SETTLED_THRESHOLD);
    expect(pointMastery(card, 50, justDue)).toBeLessThan(SETTLED_THRESHOLD);
  });

  test("a due point erodes the longer it is ignored, down to a floor", () => {
    const card = applyReview(null, Rating.Good, now);
    const at = (weeks: number) => new Date(card.due.getTime() + weeks * 7 * 86_400_000);
    const fresh = pointMastery(card, 83, at(0));
    const twoWeeks = pointMastery(card, 83, at(2));
    const twoMonths = pointMastery(card, 83, at(8));
    expect(twoWeeks).toBeLessThan(fresh);
    expect(twoMonths).toBeLessThan(SETTLED_THRESHOLD); // ignored long enough, it comes back
    // The erosion is capped, so an ancient point doesn't read as total ignorance.
    expect(pointMastery(card, 83, at(52))).toBe(twoMonths);
  });

  test("mastery rises with confidence at every card state", () => {
    const due = applyReview(null, Rating.Good, now);
    const dueAt = new Date(due.due.getTime() + 60_000);
    const strong = replay(Array(8).fill(Rating.Easy), new Date("2026-05-01T00:00:00Z"), 20);
    const strongAt = new Date(strong.due.getTime() - 1);
    for (const [card, at] of [
      [due, dueAt],
      [strong, strongAt],
    ] as [Card, Date][]) {
      const scores = [0, 17, 50, 83, 100].map((c) => pointMastery(card, c, at));
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      }
    }
  });

  test("a point with marks but no self-rating starts from neutral, not zero", () => {
    // Homework and quizzes move the card without ever setting a confidence; the
    // old formula read that silence as a 0 and buried the point.
    const card = applyReview(null, Rating.Good, now);
    const justDue = new Date(card.due.getTime() + 60_000);
    expect(pointMastery(card, null, justDue)).toBeGreaterThan(30);
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
