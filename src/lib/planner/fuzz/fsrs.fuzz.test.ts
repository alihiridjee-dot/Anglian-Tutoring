/**
 * Brute test 1 of 4: memory (FSRS), the fold of graded work, and paused time.
 * scheduler.ts, scheduleDal.ts, pauseTime.ts. Seeded; see helpers.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  applyReview,
  retrievability,
  reviewEligibleAt,
  scoreToRating,
  pointStatus,
  Rating,
  type Card,
  type Grade,
} from "../scheduler";
import { assessmentPointScores, foldReviews, ScheduleDAL, type ReviewEvent } from "../scheduleDal";
import { pausedMsSince, type PauseSpan } from "../pauseTime";
import type { CourseSnapshot } from "../readModels";
import { rng, Tally } from "./helpers";

const DAY = 86_400_000;
const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
const sound = (c: Card) =>
  Number.isFinite(c.stability) &&
  c.stability > 0 &&
  Number.isFinite(c.difficulty) &&
  Number.isFinite(new Date(c.due).getTime()) &&
  Number.isInteger(c.reps);

describe("FSRS card under any run of marks", () => {
  test("F1 · 3,000 runs of 1–14 reviews in time order: never throws, card stays sound, due never before the review", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 3000; seed++) {
      const r = rng(seed);
      const problems: string[] = [];
      let card: Card | null = null;
      let at = Date.UTC(2026, r.int(0, 11), r.int(1, 28), r.int(0, 23), r.int(0, 59));
      const steps = r.int(1, 14);
      try {
        for (let i = 0; i < steps; i++) {
          // Gaps from zero (same instant) to 400 days.
          at += r.pick([
            0,
            1,
            60_000,
            3_600_000,
            DAY,
            7 * DAY,
            30 * DAY,
            400 * DAY,
            r.int(0, 60 * DAY),
          ]);
          card = applyReview(card, r.pick(grades), new Date(at));
          if (!sound(card)) problems.push(`unsound card after step ${i}: ${JSON.stringify(card)}`);
          if (new Date(card.due).getTime() < at)
            problems.push(`due before the review at step ${i}`);
          if (reviewEligibleAt(card).getTime() < at + 7 * DAY)
            problems.push(`eligible inside 7 days at step ${i}`);
          const ret = retrievability(card, new Date(at + r.int(0, 500 * DAY)));
          if (ret === null || !(ret >= 0 && ret <= 1))
            problems.push(`retention out of range: ${ret}`);
        }
      } catch (e) {
        problems.push(`threw: ${(e as Error).message}`);
      }
      tally.check(seed, problems);
    }
    expect(tally.failed, tally.report("F1")).toBe(0);
  });

  test("F2 · 2,000 reviews stamped BEFORE the last one (clock skew, incl. across UTC midnight): never throws", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 2000; seed++) {
      const r = rng(10_000 + seed);
      const problems: string[] = [];
      // Half the cases sit a few hundred ms either side of UTC midnight.
      const base = r.bool()
        ? Date.UTC(2026, 9, 27, 0, 0, 0, r.int(0, 400))
        : Date.UTC(2026, r.int(0, 11), r.int(1, 28), r.int(0, 23), r.int(0, 59));
      let card = applyReview(null, r.pick(grades), new Date(base - r.int(0, 40) * DAY));
      card = applyReview(card, r.pick(grades), new Date(base));
      const skew = r.pick([1, 200, 500, 60_000, 3_600_000, DAY, 3 * DAY, 30 * DAY]);
      try {
        const next = applyReview(card, r.pick(grades), new Date(base - skew));
        if (!sound(next)) problems.push(`unsound card after a ${skew} ms backwards review`);
      } catch (e) {
        problems.push(`threw on a ${skew} ms backwards review: ${(e as Error).message}`);
      }
      tally.check(10_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F2")).toBe(0);
  });

  test("F2b · 2,000 READS with the device clock behind the last review (what a slow phone clock does): never throws, retention 0–1", async () => {
    const tally = new Tally();
    const course = { studentId: "s", subject: "biology", board: "aqa", level: "gcse" } as const;
    for (let seed = 0; seed < 2000; seed++) {
      const r = rng(15_000 + seed);
      const problems: string[] = [];
      const base = r.bool()
        ? Date.UTC(2026, 9, 27, 0, 0, 0, r.int(0, 400))
        : Date.UTC(2026, r.int(0, 11), r.int(1, 28), r.int(0, 23), r.int(0, 59));
      const skew = r.pick([1, 200, 500, 60_000, 3_600_000, DAY, 3 * DAY, 30 * DAY]);
      const now = new Date(base - skew);
      try {
        let card = applyReview(null, r.pick(grades), new Date(base - r.int(1, 40) * DAY));
        card = applyReview(card, r.pick(grades), new Date(base));
        const ret = retrievability(card, now);
        if (ret === null || !(ret >= 0 && ret <= 1))
          problems.push(`retention ${ret} read ${skew} ms early`);
        pointStatus(card, now);
        // The whole read path, as the planner runs it on open.
        const [topic] = await ScheduleDAL.progressFrom({
          ...course,
          snapshot: {
            topics: [{ id: "t1", title: "T", sort_order: 1 }],
            points: [
              { id: "p1", code: "1.1", title: "P", sort_order: 1, topic_id: "t1", weight: 1 },
            ],
            sources: {
              resourceLinks: [],
              setLinks: [],
              setScope: [{ set_id: "q1", spec_point_id: "p1" }],
            },
            submissions: [],
            attempts: [
              {
                id: "a1",
                set_id: "q1",
                score: 7,
                total: 10,
                created_at: new Date(base).toISOString(),
              },
            ],
          },
          pauses: [],
          breaks: [],
          now,
        });
        const p = topic.points[0];
        if (!(p.retention !== null && p.retention >= 0 && p.retention <= 1))
          problems.push(`planner read gave retention ${p.retention}`);
        if (!Number.isFinite(p.mastery) || p.mastery < 0 || p.mastery > 100)
          problems.push(`planner read gave mastery ${p.mastery}`);
      } catch (e) {
        problems.push(`threw with the clock ${skew} ms behind: ${(e as Error).message}`);
      }
      tally.check(15_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F2b")).toBe(0);
  });
});

describe("the fold of graded work", () => {
  const event = (
    id: string,
    at: number,
    rating: Grade,
    source: "mcq" | "homework",
    n: number,
  ): ReviewEvent => ({
    specPointId: id,
    rating,
    source,
    scorePct: 50,
    sourceId: `${source}-${n}`,
    reviewedAt: new Date(at),
  });

  test("F3 · 1,500 histories: the order events arrive in never changes the cards (late marks, same-instant quiz + task)", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 1500; seed++) {
      const r = rng(20_000 + seed);
      const start = Date.UTC(2026, 8, 1, 9);
      const events: ReviewEvent[] = [];
      const count = r.int(2, 16);
      for (let i = 0; i < count; i++) {
        // A third share a timestamp with the previous event (double fold).
        const at =
          i > 0 && r.bool(0.33)
            ? events[i - 1].reviewedAt.getTime()
            : start + r.int(0, 120) * DAY + r.int(0, DAY);
        events.push(event(`p${r.int(0, 2)}`, at, r.pick(grades), r.bool() ? "mcq" : "homework", i));
      }
      const final = (list: ReviewEvent[]) => {
        const cards = new Map<string, string>();
        for (const row of foldReviews(list, new Map(), new Set()))
          cards.set(row.specPointId, JSON.stringify(row.card));
        return JSON.stringify([...cards].sort());
      };
      const problems: string[] = [];
      try {
        const want = final(events);
        for (let k = 0; k < 3; k++)
          if (final(r.shuffle(events)) !== want)
            problems.push("a different arrival order gave different cards");
      } catch (e) {
        problems.push(`threw: ${(e as Error).message}`);
      }
      tally.check(20_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F3")).toBe(0);
  });

  test("F4 · junk events (NaN dates, ratings 0/5/2.5/NaN, confidence) are dropped, never folded", () => {
    const good = event("p", Date.UTC(2026, 8, 1), Rating.Good, "mcq", 1);
    const junk: ReviewEvent[] = [
      { ...good, sourceId: "a", reviewedAt: new Date(NaN) },
      { ...good, sourceId: "b", rating: 0 as Grade },
      { ...good, sourceId: "c", rating: 5 as Grade },
      { ...good, sourceId: "d", rating: 2.5 as Grade },
      { ...good, sourceId: "e", rating: NaN as Grade },
      { ...good, sourceId: "f", source: "confidence" },
    ];
    expect(foldReviews([good, ...junk], new Map(), new Set())).toHaveLength(1);
  });

  test("F5 · A3: a quiz and a task on the same day — measured, not asserted (see report)", () => {
    const t0 = Date.UTC(2026, 8, 1, 9);
    const once = foldReviews([event("p", t0, Rating.Good, "mcq", 1)], new Map(), new Set()).at(
      -1,
    )!.card;
    const twice = foldReviews(
      [
        event("p", t0, Rating.Good, "mcq", 1),
        event("p", t0 + 3_600_000, Rating.Good, "homework", 2),
      ],
      new Map(),
      new Set(),
    ).at(-1)!.card;
    // Recorded for the report: the same-day second review counts as a rep.
    console.log(
      `[F5] one review: stability ${once.stability.toFixed(2)} d, reps ${once.reps}; quiz + task same day: stability ${twice.stability.toFixed(2)} d, reps ${twice.reps}, due ${((new Date(twice.due).getTime() - t0) / DAY).toFixed(1)} d out (one: ${((new Date(once.due).getTime() - t0) / DAY).toFixed(1)} d)`,
    );
    expect(twice.reps).toBe(2);
  });

  // Only scores that aren't real numbers: one over 100 reading as Easy is fine.
  test("F6 · NaN and ±Infinity never read as a top mark", () => {
    const bad: string[] = [];
    for (const pct of [NaN, Infinity, -Infinity]) {
      const rating = scoreToRating(pct);
      if (!grades.includes(rating)) bad.push(`scoreToRating(${pct}) = ${rating}`);
      if (!(pct >= 90 && pct <= 100) && rating === Rating.Easy)
        bad.push(`scoreToRating(${pct}) reads as Easy (a 90%+ mark)`);
    }
    expect(bad).toEqual([]);
  });

  test("F7 · 2,000 junk quiz snapshots: every score that comes out is a finite 0–100", () => {
    const tally = new Tally();
    const junk = [NaN, Infinity, -5, 101, "80", null, undefined, {}, [], true, 0, 100, 55.5];
    for (let seed = 0; seed < 2000; seed++) {
      const r = rng(30_000 + seed);
      const snapshot = r.bool(0.7)
        ? Object.fromEntries(Array.from({ length: r.int(0, 5) }, (_, i) => [`p${i}`, r.pick(junk)]))
        : r.pick([null, undefined, [], "x", 7]);
      const scope = new Set(r.bool() ? ["p0"] : r.bool() ? ["p0", "p1"] : ["__unattributed__"]);
      const score = r.pick([null, NaN, -3, 0, 4, 9, Infinity]) as number | null;
      const total = r.pick([null, 0, NaN, -2, 8, Infinity]) as number | null;
      const problems: string[] = [];
      for (const [point, pct] of assessmentPointScores(snapshot, scope, score, total))
        if (!(Number.isFinite(pct) && pct >= 0 && pct <= 100))
          problems.push(`${point} scored ${pct} from score=${score} total=${total}`);
      tally.check(30_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F7")).toBe(0);
  });
});

describe("paused time", () => {
  /** The same answer the slow way: walk the merged spans. */
  const bruteForce = (spans: PauseSpan[], since: number, now: number) => {
    const marks = new Set<number>([since, now]);
    for (const s of spans) {
      marks.add(s.start.getTime());
      marks.add((s.end ?? new Date(now)).getTime());
    }
    const sorted = [...marks].filter((m) => m >= since && m <= now).sort((a, b) => a - b);
    let ms = 0;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const mid = (sorted[i] + sorted[i + 1]) / 2;
      if (spans.some((s) => s.start.getTime() <= mid && mid < (s.end ?? new Date(now)).getTime()))
        ms += sorted[i + 1] - sorted[i];
    }
    return ms;
  };

  test("F8 · 4,000 sets of overlapping break + pause spans: counted once, never more than the time elapsed", () => {
    const tally = new Tally();
    for (let seed = 0; seed < 4000; seed++) {
      const r = rng(40_000 + seed);
      const since = Date.UTC(2026, 8, 1) + r.int(0, 30) * DAY;
      const now = since + r.int(0, 200) * DAY + r.int(0, DAY);
      const spans: PauseSpan[] = Array.from({ length: r.int(0, 6) }, () => {
        const start = since + r.int(-40, 180) * DAY + r.int(0, DAY);
        // Some open-ended, some zero-length, some ending before they start.
        const end = r.bool(0.15) ? null : new Date(start + r.int(-3, 60) * DAY);
        return { start: new Date(start), end };
      });
      const got = pausedMsSince(spans, new Date(since), new Date(now));
      const want = bruteForce(spans, since, now);
      const problems: string[] = [];
      if (got !== want) problems.push(`got ${got} ms, the slow way says ${want} ms`);
      if (got < 0 || got > now - since)
        problems.push(`${got} ms paused out of ${now - since} elapsed`);
      tally.check(40_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F8")).toBe(0);
  });

  test("F9 · 1,000 students with a pause and a break laid over one review: 'due' and the dates shown always agree", async () => {
    const tally = new Tally();
    const course = { studentId: "s", subject: "biology", board: "aqa", level: "gcse" } as const;
    for (let seed = 0; seed < 1000; seed++) {
      const r = rng(50_000 + seed);
      const reviewed = Date.UTC(2026, 8, 7, 9) + r.int(0, 20) * DAY;
      const now = new Date(reviewed + r.int(0, 120) * DAY + r.int(0, DAY));
      const snapshot: CourseSnapshot = {
        topics: [{ id: "t1", title: "T", sort_order: 1 }],
        points: [{ id: "p1", code: "1.1", title: "P", sort_order: 1, topic_id: "t1", weight: 1 }],
        sources: {
          resourceLinks: [],
          setLinks: [],
          setScope: [{ set_id: "q1", spec_point_id: "p1" }],
        },
        submissions: [],
        attempts: [
          {
            id: "a1",
            set_id: "q1",
            score: r.int(0, 10),
            total: 10,
            created_at: new Date(reviewed).toISOString(),
          },
        ],
      };
      const pauseStart = reviewed + r.int(-10, 60) * DAY;
      const pauses = r.bool(0.8)
        ? [
            {
              id: "x",
              reason: "payment" as const,
              startedAt: new Date(pauseStart).toISOString(),
              endedAt: r.bool(0.2) ? null : new Date(pauseStart + r.int(1, 50) * DAY).toISOString(),
              programmeResumedAt: null,
            },
          ]
        : [];
      // A break on Mondays that may overlap the pause.
      const breakStart = `2026-${String(r.int(9, 12)).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`;
      const monday = new Date(`${breakStart}T00:00:00Z`);
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      const startsOn = monday.toISOString().slice(0, 10);
      const ends = new Date(monday);
      ends.setUTCDate(ends.getUTCDate() + 7 * r.int(1, 4) - 1);
      const breaks = r.bool(0.7)
        ? [
            {
              id: "b",
              startsOn,
              endsOn: ends.toISOString().slice(0, 10),
              reason: "holiday" as const,
              recordedAt: null,
            },
          ]
        : [];
      const problems: string[] = [];
      try {
        const [topic] = await ScheduleDAL.progressFrom({
          ...course,
          snapshot,
          pauses,
          breaks,
          now,
        });
        const p = topic.points[0];
        const bare = (
          await ScheduleDAL.progressFrom({ ...course, snapshot, pauses: [], breaks: [], now })
        )[0].points[0];
        const dueNow = new Date(p.eligibleAt!).getTime() <= now.getTime();
        if ((p.status === "due") !== dueNow)
          problems.push(
            `status ${p.status} but eligibleAt ${p.eligibleAt} vs now ${now.toISOString()}`,
          );
        if (new Date(p.dueAt!).getTime() < new Date(bare.dueAt!).getTime())
          problems.push("a pause pulled a due date EARLIER");
        if ((p.retention ?? 0) + 1e-12 < (bare.retention ?? 0))
          problems.push("a pause LOWERED retention");
        const shift = new Date(p.eligibleAt!).getTime() - new Date(bare.eligibleAt!).getTime();
        if (shift < 0 || shift > Math.max(0, now.getTime() - reviewed))
          problems.push(`eligibility moved ${shift} ms, more than the time since the review`);
      } catch (e) {
        problems.push(`threw: ${(e as Error).message}`);
      }
      tally.check(50_000 + seed, problems);
    }
    expect(tally.failed, tally.report("F9")).toBe(0);
  });

  test("F10 · A1: a 7-week stop between two reviews — measured, not asserted (see report)", () => {
    const r1 = new Date("2026-09-01T10:00:00Z");
    const mk = (at: Date, n: number): ReviewEvent => ({
      specPointId: "p",
      rating: Rating.Good,
      source: "mcq",
      scorePct: 80,
      sourceId: `m${n}`,
      reviewedAt: at,
    });
    const wall = foldReviews(
      [mk(r1, 1), mk(new Date("2026-10-27T10:00:00Z"), 2)],
      new Map(),
      new Set(),
    ).at(-1)!.card;
    const active = foldReviews(
      [mk(r1, 1), mk(new Date("2026-09-08T10:00:00Z"), 2)],
      new Map(),
      new Set(),
    ).at(-1)!.card;
    console.log(
      `[F10] second review 56 days on, 49 of them paused: stability ${wall.stability.toFixed(2)} d; the same 7 active days with no pause: ${active.stability.toFixed(2)} d`,
    );
    expect(wall.stability).toBeGreaterThan(0);
  });
});
