import { describe, expect, test } from "bun:test";
import {
  projectReviews,
  mondayOnOrAfter,
  computePacing,
  diffPacing,
  weightOf,
  focusLoadFor,
  weeksBetween,
  selectWeekPoints,
  splitAcrossWeeks,
  withWeeklyPoints,
  type FocusCandidate,
  type PacingBand,
} from "./pacing";
import { addWeeks, mondayOf, toDateKey, weekKeyToDate } from "@/lib/week";

const currentMonday = mondayOf(new Date("2026-09-07T00:00:00+01:00"));
const examMonday = mondayOf(new Date("2027-06-07T00:00:00+01:00")); // ~39 weeks out

describe("computePacing — the fixed core spine", () => {
  const topics = [
    { topicId: "a", title: "A", weight: 10 },
    { topicId: "b", title: "B", weight: 20 },
    { topicId: "c", title: "C", weight: 10 },
  ];

  test("runs sequentially, gapless and overlap-free, from the student's start week", () => {
    const bands = computePacing(topics, currentMonday, examMonday);
    expect(bands[0].startWeek).toBe(toDateKey(currentMonday));
    expect(bands.at(-1)?.endWeek).toBe(toDateKey(addWeeks(examMonday, -1)));
    expect(bands.reduce((sum, b) => sum + b.weeks, 0)).toBe(weeksBetween(currentMonday, examMonday));
    // Strictly sequential: each band starts the week after the previous ends.
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].startWeek).toBe(toDateKey(addWeeks(weekKeyToDate(bands[i - 1].endWeek), 1)));
    }
    // Spec order is preserved, and weeks are shared by weight: B is twice the
    // work of A, so it gets (about) twice the weeks.
    expect(bands.map((b) => b.topicId)).toEqual(["a", "b", "c"]);
    const weeks = new Map(bands.map((b) => [b.topicId, b.weeks]));
    expect(weeks.get("b")! / weeks.get("a")!).toBeGreaterThanOrEqual(1.5);
  });

  test("is deterministic — progress can't move it, only the inputs can", () => {
    const a = computePacing(topics, currentMonday, examMonday);
    const b = computePacing(topics, currentMonday, examMonday);
    expect(a).toEqual(b);
  });

  test("a late joiner covers the same course in fewer weeks — heavier weeks, even spread", () => {
    const early = computePacing(topics, currentMonday, examMonday); // ~39-week runway
    const late = computePacing(topics, addWeeks(currentMonday, 20), examMonday); // ~19 weeks
    const totalWeeks = (bands: typeof early) => bands.reduce((s, b) => s + b.weeks, 0);
    // Both plans hold the whole course; the late one just compresses it.
    expect(early.map((b) => b.topicId)).toEqual(late.map((b) => b.topicId));
    expect(totalWeeks(late)).toBeLessThan(totalWeeks(early));
    // The spread stays proportional to weight on both runways: B (weight 20)
    // never gets fewer weeks than A or C (weight 10) on any runway.
    for (const bands of [early, late]) {
      const weeks = new Map(bands.map((b) => [b.topicId, b.weeks]));
      expect(weeks.get("b")!).toBeGreaterThanOrEqual(weeks.get("a")!);
      expect(weeks.get("b")!).toBeGreaterThanOrEqual(weeks.get("c")!);
    }
  });
});

describe("assessment-driven review queue", () => {
  const candidate = (id: string, overrides: Partial<FocusCandidate> = {}): FocusCandidate => ({
    specPointId: id,
    topicId: "t",
    topicTitle: "Topic",
    code: id,
    pointTitle: id,
    dueAt: "2026-09-07T00:00:00+01:00",
    eligibleAt: "2026-09-07T00:00:00+01:00",
    lastReviewedAt: "2026-08-24T00:00:00+01:00",
    weight: 1,
    ...overrides,
  });
  const project = (candidates: FocusCandidate[], extra = {}) =>
    projectReviews({ candidates, currentMonday, examMonday, ...extra });
  test("one next review per skill, no repeats or automatic final sweep", () => {
    const c = candidate("a");
    const result = project([c, c]);
    expect(result.bands.flatMap((b) => b.points ?? []).map((p) => p.specPointId)).toEqual(["a"]);
    expect(result.bands.every((b) => b.kind === "revisit")).toBe(true);
  });
  test("seven-day minimum cannot be bypassed by an early FSRS date", () => {
    const result = project([candidate("a", { lastReviewedAt: "2026-09-09T12:00:00+01:00" })]);
    expect(result.bands[0].startWeek).toBe("2026-09-21");
  });
  test("a Monday afternoon eligibility cannot unlock Monday morning", () => {
    expect(toDateKey(mondayOnOrAfter(new Date("2026-09-14T12:00:00+01:00")))).toBe("2026-09-21");
  });
  test("all eligible reviews fit in the first week regardless of total weight", () => {
    const result = project(
      Array.from({ length: 10 }, (_, i) => candidate(String(i), { weight: 2 })),
      { examMonday: addWeeks(currentMonday, 1) },
    );
    expect(result.bands.flatMap((b) => b.points ?? [])).toHaveLength(10);
    expect(result.backlog).toHaveLength(0);
    expect(
      focusLoadFor({ topics: [], spine: [], backlog: result.backlog }).overloaded,
    ).toBe(false);
    expect(result.bands.every((b) => b.startWeek === toDateKey(currentMonday))).toBe(true);
    const week = selectWeekPoints({ bands: result.bands, weekStart: toDateKey(currentMonday), topics: [] });
    expect(week.specPointIds).toHaveLength(10);
  });
  test("an indivisible point heavier than six is assigned", () => {
    const result = project([candidate("heavy", { weight: 7 })]);
    expect(result.bands[0].points?.map((p) => p.specPointId)).toEqual(["heavy"]);
    expect(result.backlog).toHaveLength(0);
  });
  test("post-exam dates are not pulled into the final week", () => {
    const result = project([
      candidate("later", { dueAt: "2027-07-01T00:00:00+01:00", eligibleAt: "2027-07-01T00:00:00+01:00" }),
    ]);
    expect(result.bands).toHaveLength(0);
    expect(result.beyondExam).toHaveLength(1);
    expect(result.backlog).toHaveLength(0);
  });
  test("eligible before exam but missing the last weekly opening stays a backlog", () => {
    const result = project(
      [candidate("late", { dueAt: "2026-09-08T00:00:00+01:00", eligibleAt: "2026-09-08T00:00:00+01:00" })],
      { examMonday: new Date("2026-09-10T00:00:00+01:00") },
    );
    expect(result.backlog).toHaveLength(1);
  });
  test("reloading doesn't reset eligibility or invent new repetitions", () => {
    const candidates = [
      candidate("future", { dueAt: "2026-10-01T00:00:00+01:00", eligibleAt: "2026-10-01T00:00:00+01:00" }),
    ];
    expect(project(candidates).bands).toEqual(
      project(candidates, { currentMonday: addWeeks(currentMonday, 1) }).bands,
    );
  });
  test("no graded evidence means no reviews", () => {
    expect(project([]).bands).toHaveLength(0);
  });
  test("short teaching runway never silently runs past its window", () => {
    const bands = computePacing(
      Array.from({ length: 8 }, (_, i) => ({ topicId: String(i), title: String(i), weight: 1 })),
      currentMonday,
      addWeeks(currentMonday, 5),
    );
    expect(bands).toHaveLength(5);
    expect(bands.every((b) => b.endWeek < toDateKey(addWeeks(currentMonday, 5)))).toBe(true);
  });
  test("assessed teaching points don't become automatic refreshers", () => {
    const bands = computePacing(
      [{ topicId: "t", title: "T", weight: 1 }],
      currentMonday,
      addWeeks(currentMonday, 4),
    );
    const selection = selectWeekPoints({
      bands,
      weekStart: toDateKey(currentMonday),
      topics: [{ topicId: "t", points: [{ id: "a", mastery: 0, reps: 1 }] }],
    });
    expect(selection.specPointIds).toEqual([]);
  });
});

describe("splitAcrossWeeks / withWeeklyPoints — a week's worth of a topic", () => {
  const ref = (n: number) => ({ specPointId: `p${n}`, code: `1.${n}`, title: `Point ${n}` });

  test("divides a topic evenly, remainder in the last week", () => {
    expect(splitAcrossWeeks([1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    // 17 over 6 weeks: 3 a week, the last one short — never a 12-point week.
    const uneven = splitAcrossWeeks(
      Array.from({ length: 17 }, (_, i) => i),
      6,
    );
    expect(uneven.map((c) => c.length)).toEqual([3, 3, 3, 3, 3, 2]);
    expect(uneven.flat()).toHaveLength(17);
  });

  test("degenerate inputs don't lose points or divide by zero", () => {
    expect(splitAcrossWeeks([1, 2], 0)).toEqual([[1, 2]]);
    expect(splitAcrossWeeks([], 3)).toEqual([[], [], []]);
    expect(splitAcrossWeeks([1, 2, 3], 10).flat()).toEqual([1, 2, 3]);
  });

  test("balances by weight, not by count", () => {
    // One heavy point and four light ones over two weeks. By count that is 3/2
    // and the heavy week is nearly double the other; by weight the big point
    // earns a week largely to itself.
    const pts = [
      { id: "heavy", weight: 6 },
      { id: "a", weight: 1 },
      { id: "b", weight: 1 },
      { id: "c", weight: 1 },
      { id: "d", weight: 1 },
    ];
    const chunks = splitAcrossWeeks(pts, 2, (p) => p.weight);
    expect(chunks.map((c) => c.map((p) => p.id))).toEqual([["heavy"], ["a", "b", "c", "d"]]);
    const load = chunks.map((c) => c.reduce((s, p) => s + p.weight, 0));
    expect(Math.max(...load) / Math.min(...load)).toBeLessThan(2);
  });

  test("never leaves a week of a topic's run empty", () => {
    // 10 points over 6 weeks used to give ceil(10/6)=2 per week — 2×5=10, so the
    // sixth week got nothing at all and the roadmap showed a blank week.
    const pts = Array.from({ length: 10 }, (_, i) => i);
    const chunks = splitAcrossWeeks(pts, 6);
    expect(chunks).toHaveLength(6);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(chunks.flat()).toEqual(pts); // order preserved, nothing dropped
  });

  test("levels up the lightest week too, not just down the heaviest", () => {
    // Minimising the heaviest week alone leaves many equally-good splits, and
    // the arbitrary pick is usually the one that strands the remainder in a stub
    // week. Here [4,4,4] and [1,1,10]-style splits can share a maximum; the
    // lightest week is what separates them.
    const pts = Array.from({ length: 12 }, () => ({ weight: 1 }));
    const chunks = splitAcrossWeeks(pts, 3, (p) => p.weight);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 4]);

    // 10 units over 3 weeks can't be even, but the shortfall should be one week
    // light by one — not one week carrying almost nothing.
    const ten = Array.from({ length: 10 }, () => ({ weight: 1 }));
    const sizes = splitAcrossWeeks(ten, 3, (p) => p.weight).map((c) => c.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  test("keeps spec order — a week is always a contiguous run", () => {
    const pts = [
      { id: "p0", weight: 1 },
      { id: "p1", weight: 9 },
      { id: "p2", weight: 1 },
      { id: "p3", weight: 1 },
    ];
    const chunks = splitAcrossWeeks(pts, 3, (p) => p.weight);
    expect(chunks.flat().map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  test("teach bands carry their weekly division, keyed by each week's Monday", () => {
    const band: PacingBand = {
      topicId: "t1",
      title: "Topic 1",
      startWeek: toDateKey(currentMonday),
      endWeek: toDateKey(addWeeks(currentMonday, 2)),
      weeks: 3,
      kind: "teach",
    };
    const [out] = withWeeklyPoints([band], new Map([["t1", [1, 2, 3, 4, 5, 6].map(ref)]]));
    expect(Object.keys(out.pointsByWeek!)).toEqual([
      toDateKey(currentMonday),
      toDateKey(addWeeks(currentMonday, 1)),
      toDateKey(addWeeks(currentMonday, 2)),
    ]);
    expect(out.pointsByWeek![toDateKey(addWeeks(currentMonday, 1))].map((p) => p.code)).toEqual([
      "1.3",
      "1.4",
    ]);
  });

  test("focus bands are left alone, and a topic with no points gets no division", () => {
    const revisit: PacingBand = {
      topicId: "t1",
      title: "T1",
      startWeek: toDateKey(currentMonday),
      endWeek: toDateKey(currentMonday),
      weeks: 1,
      kind: "revisit",
      points: [ref(1)],
    };
    const teach: PacingBand = { ...revisit, kind: "teach", points: undefined };
    const [r, t] = withWeeklyPoints([revisit, teach], new Map());
    expect(r.pointsByWeek).toBeUndefined();
    expect(t.pointsByWeek).toBeUndefined();
  });
});


describe("engine robustness", () => {
  test("duration-only teaching changes require acknowledgement", () => {
    const before: PacingBand = { topicId: "t", title: "Topic", startWeek: "2026-09-07", endWeek: "2026-09-14", weeks: 2 };
    expect(diffPacing([before], [{ ...before, endWeek: "2026-10-05", weeks: 5 }])).toHaveLength(1);
    expect(diffPacing([before], [{ ...before }])).toEqual([]);
  });
  test("non-finite weights cannot poison workload arithmetic", () => {
    for (const weight of [NaN, Infinity, -Infinity, 0, -1]) expect(weightOf({ weight })).toBe(1);
    expect(weightOf({ weight: 2.5 })).toBe(2.5);
  });
  test("invalid projection boundaries fail explicitly", () => {
    expect(() => projectReviews({ candidates: [], currentMonday: new Date(NaN), examMonday })).toThrow();
  });
  test("large uncapped queues retain every point in deterministic weekly order", () => {
    const candidates: FocusCandidate[] = Array.from({ length: 2000 }, (_, i) => ({
      specPointId: String(i).padStart(4, "0"), topicId: "t", topicTitle: "Topic", code: String(i), pointTitle: String(i),
      dueAt: i % 2 ? "2026-09-07T00:00:00+01:00" : "2026-09-21T00:00:00+01:00",
      eligibleAt: "2026-09-07T00:00:00+01:00", lastReviewedAt: "2026-08-24T00:00:00+01:00", weight: 7,
    }));
    const a = projectReviews({ candidates, currentMonday, examMonday });
    const b = projectReviews({ candidates: [...candidates].reverse(), currentMonday, examMonday });
    expect(a).toEqual(b);
    expect(a.bands.map((band) => band.startWeek)).toEqual(["2026-09-07", "2026-09-21"]);
    expect(a.bands.map((band) => band.points?.length)).toEqual([1000, 1000]);
    expect(a.backlog).toEqual([]);
  });
});
