import { describe, expect, test } from "bun:test";
import {
  laneOf,
  statusOf,
  statusOfPoint,
  summarize,
  verdictCopy,
  type PointActivity,
  type PointCoverage,
} from "./coverage";

const cov = (over: Partial<PointCoverage> = {}): PointCoverage => ({
  attempted: false,
  homeworkDone: false,
  quizDone: false,
  bestScore: null,
  homeworkScore: null,
  quizScore: null,
  ...over,
});

const done = (score: number | null) =>
  cov({ attempted: true, homeworkDone: true, bestScore: score, homeworkScore: score });

const act = (over: Partial<PointActivity> = {}): PointActivity => ({
  hasHomework: false,
  hasQuiz: false,
  ...over,
});

describe("statusOfPoint", () => {
  test("untouched with work set reads as not done", () => {
    expect(statusOfPoint(cov(), act({ hasHomework: true }))).toBe("not_done");
    expect(statusOfPoint(cov(), act({ hasQuiz: true }))).toBe("not_done");
  });

  test("untouched with nothing set reads as not set", () => {
    expect(statusOfPoint(cov(), act())).toBe("not_set");
    expect(statusOfPoint(undefined, undefined)).toBe("not_set");
  });

  test("attempted points grade the same either way", () => {
    for (const c of [done(90), done(50), done(null)]) {
      expect(statusOfPoint(c, act())).toBe(statusOf(c));
    }
  });
});

describe("summarize", () => {
  test("counts each status", () => {
    const s = summarize([
      { specPointId: "a", coverage: done(80), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: done(40), activity: act({ hasHomework: true }) },
      { specPointId: "c", coverage: done(null), activity: act({ hasHomework: true }) },
      { specPointId: "d", coverage: cov(), activity: act({ hasHomework: true }) },
      { specPointId: "e", coverage: cov(), activity: act() },
    ]);
    expect([s.strong, s.weak, s.practised, s.notDone, s.notSet]).toEqual([1, 1, 1, 1, 1]);
    expect(s.covered).toEqual(["a", "c"]);
    expect(s.toRevisit).toEqual(["b", "d", "e"]);
  });

  test("a week with nothing set is not a bad week", () => {
    const s = summarize(
      ["a", "b", "c"].map((specPointId) => ({ specPointId, coverage: cov(), activity: act() })),
    );
    expect(s.verdict).toBe("no_signal");
    // Still worth another week, just not evidence against the student.
    expect(s.toRevisit).toHaveLength(3);
  });

  test("points with nothing set never drag the verdict down", () => {
    const s = summarize([
      { specPointId: "a", coverage: done(80), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: cov(), activity: act() },
    ]);
    expect(s.verdict).toBe("move_on");
  });

  test("all covered is move on", () => {
    const s = summarize([
      { specPointId: "a", coverage: done(80), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: done(95), activity: act({ hasHomework: true }) },
    ]);
    expect(s.verdict).toBe("move_on");
  });

  test("covered outweighing loose is almost", () => {
    const s = summarize([
      { specPointId: "a", coverage: done(80), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: done(40), activity: act({ hasHomework: true }) },
    ]);
    expect(s.verdict).toBe("almost");
  });

  test("mostly loose is keep going", () => {
    const s = summarize([
      { specPointId: "a", coverage: done(80), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: done(40), activity: act({ hasHomework: true }) },
      { specPointId: "c", coverage: cov(), activity: act({ hasHomework: true }) },
    ]);
    expect(s.verdict).toBe("keep_going");
  });

  test("an empty week is not a failure", () => {
    expect(summarize([]).verdict).toBe("move_on");
  });

  test("activity is optional — callers without it grade as before", () => {
    const s = summarize([{ specPointId: "a", coverage: cov() }]);
    expect(s.notDone).toBe(0);
    expect(s.notSet).toBe(1);
  });
});

describe("verdictCopy", () => {
  test("agrees in number", () => {
    const one = summarize([
      { specPointId: "a", coverage: cov(), activity: act({ hasHomework: true }) },
    ]);
    expect(verdictCopy(one.verdict, one).sub).toContain("1 point is");

    const two = summarize([
      { specPointId: "a", coverage: cov(), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: cov(), activity: act({ hasHomework: true }) },
    ]);
    expect(verdictCopy(two.verdict, two).sub).toContain("2 points are");
  });

  test("counts only graded points, not the ones with nothing set", () => {
    const s = summarize([
      { specPointId: "a", coverage: cov(), activity: act({ hasHomework: true }) },
      { specPointId: "b", coverage: cov(), activity: act() },
      { specPointId: "c", coverage: cov(), activity: act() },
    ]);
    expect(verdictCopy(s.verdict, s).sub).toContain("1 point is");
  });
});

describe("laneOf", () => {
  test("maps origins to the lanes the plan shows", () => {
    expect(laneOf("core")).toBe("core");
    expect(laneOf("ai")).toBe("core"); // pre-lanes rows read as core
    expect(laneOf("focus")).toBe("focus");
    expect(laneOf("student")).toBe("yours");
    expect(laneOf("tutor")).toBe("yours");
    expect(laneOf("carried_over")).toBe("yours"); // legacy carry origin
  });
});
