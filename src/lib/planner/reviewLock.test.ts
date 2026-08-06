import { describe, expect, test } from "bun:test";
import { reviewLock } from "./reviewLock";
import { type PointActivity, type PointCoverage } from "./coverage";

const WEEK = "2026-08-03"; // Monday; the week runs to Sunday 9 Aug
const at = (day: number, hour = 12) => new Date(2026, 7, day, hour);

const cov = (over: Partial<PointCoverage> = {}): PointCoverage => ({
  attempted: false,
  homeworkDone: false,
  quizDone: false,
  bestScore: null,
  homeworkScore: null,
  quizScore: null,
  ...over,
});

const act = (over: Partial<PointActivity> = {}): PointActivity => ({
  hasHomework: false,
  hasQuiz: false,
  ...over,
});

const lock = (entries: Parameters<typeof reviewLock>[0]["entries"], now: Date) =>
  reviewLock({ weekStart: WEEK, entries, now });

describe("reviewLock", () => {
  test("is locked mid-week", () => {
    const r = lock([{ coverage: cov(), activity: act({ hasHomework: true }) }], at(5));
    expect(r.locked).toBe(true);
    expect(r.homeworkTotal).toBe(1);
    expect(r.homeworkDone).toBe(0);
  });

  test("opens at midnight on the week's Sunday", () => {
    const entries = [{ coverage: cov(), activity: act({ hasHomework: true }) }];
    expect(lock(entries, at(8, 23)).locked).toBe(true); // Saturday night
    expect(lock(entries, at(9, 0)).locked).toBe(false); // Sunday 00:00
  });

  test("stays open for past weeks", () => {
    expect(lock([{ coverage: cov(), activity: act({ hasHomework: true }) }], at(20)).locked).toBe(
      false,
    );
  });

  test("opens early once every homework set is handed in", () => {
    const r = lock(
      [
        { coverage: cov({ homeworkDone: true }), activity: act({ hasHomework: true }) },
        { coverage: cov({ homeworkDone: true }), activity: act({ hasHomework: true }) },
      ],
      at(4),
    );
    expect(r.locked).toBe(false);
    expect(r.homeworkDone).toBe(2);
  });

  test("one homework outstanding keeps it shut", () => {
    const r = lock(
      [
        { coverage: cov({ homeworkDone: true }), activity: act({ hasHomework: true }) },
        { coverage: cov(), activity: act({ hasHomework: true }) },
      ],
      at(4),
    );
    expect(r.locked).toBe(true);
    expect(r.homeworkDone).toBe(1);
    expect(r.homeworkTotal).toBe(2);
  });

  test("a week with no homework set waits for Sunday", () => {
    // "All of nothing is done" must not read as finished, or the review would
    // open the moment the week was created.
    const r = lock([{ coverage: cov(), activity: act({ hasQuiz: true }) }], at(4));
    expect(r.locked).toBe(true);
    expect(r.homeworkTotal).toBe(0);
  });

  test("quizzes don't count toward opening early", () => {
    const r = lock(
      [
        {
          coverage: cov({ homeworkDone: false, quizDone: true }),
          activity: act({ hasHomework: true, hasQuiz: true }),
        },
      ],
      at(4),
    );
    expect(r.locked).toBe(true);
  });

  test("points with nothing set are ignored by the homework count", () => {
    const r = lock(
      [
        { coverage: cov({ homeworkDone: true }), activity: act({ hasHomework: true }) },
        { coverage: cov(), activity: act() },
      ],
      at(4),
    );
    expect(r.homeworkTotal).toBe(1);
    expect(r.locked).toBe(false);
  });
});
