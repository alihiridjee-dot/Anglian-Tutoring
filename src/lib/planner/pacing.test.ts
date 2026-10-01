import { describe, expect, test } from "bun:test";
import {
  projectReviews,
  reviewBudget,
  REVIEW_SHARE,
  examMondayFor,
  programStartFor,
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
import { addWeeks, mondayOf, toDateKey, weekKeyToDate } from "@/lib/planner/week";
import { spineIsForAnotherCourse } from "./roadmap";

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
    expect(bands.reduce((sum, b) => sum + b.weeks, 0)).toBe(
      weeksBetween(currentMonday, examMonday),
    );
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
    expect(focusLoadFor({ topics: [], spine: [], backlog: result.backlog }).overloaded).toBe(false);
    expect(result.bands.every((b) => b.startWeek === toDateKey(currentMonday))).toBe(true);
    const week = selectWeekPoints({
      bands: result.bands,
      weekStart: toDateKey(currentMonday),
      topics: [],
    });
    expect(week.specPointIds).toHaveLength(10);
  });
  test("an indivisible point heavier than six is assigned", () => {
    const result = project([candidate("heavy", { weight: 7 })]);
    expect(result.bands[0].points?.map((p) => p.specPointId)).toEqual(["heavy"]);
    expect(result.backlog).toHaveLength(0);
  });
  test("post-exam dates are not pulled into the final week", () => {
    const result = project([
      candidate("later", {
        dueAt: "2027-07-01T00:00:00+01:00",
        eligibleAt: "2027-07-01T00:00:00+01:00",
      }),
    ]);
    expect(result.bands).toHaveLength(0);
    expect(result.beyondExam).toHaveLength(1);
    expect(result.backlog).toHaveLength(0);
  });
  test("eligible before exam but missing the last weekly opening stays a backlog", () => {
    const result = project(
      [
        candidate("late", {
          dueAt: "2026-09-08T00:00:00+01:00",
          eligibleAt: "2026-09-08T00:00:00+01:00",
        }),
      ],
      { examMonday: new Date("2026-09-10T00:00:00+01:00") },
    );
    expect(result.backlog).toHaveLength(1);
  });
  test("reloading doesn't reset eligibility or invent new repetitions", () => {
    const candidates = [
      candidate("future", {
        dueAt: "2026-10-01T00:00:00+01:00",
        eligibleAt: "2026-10-01T00:00:00+01:00",
      }),
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
    const before: PacingBand = {
      topicId: "t",
      title: "Topic",
      startWeek: "2026-09-07",
      endWeek: "2026-09-14",
      weeks: 2,
    };
    expect(diffPacing([before], [{ ...before, endWeek: "2026-10-05", weeks: 5 }])).toHaveLength(1);
    expect(diffPacing([before], [{ ...before }])).toEqual([]);
  });

  // The badge used to render every change as "Moved from {from}". A topic that
  // kept its start week and only ran longer was therefore told it had moved
  // from the week it was still sitting in. The three cases are now distinct.
  test("a change names what actually differs, not just that something did", () => {
    const before: PacingBand = {
      topicId: "t",
      title: "Topic",
      startWeek: "2026-09-07",
      endWeek: "2026-09-14",
      weeks: 2,
    };

    const resized = diffPacing([before], [{ ...before, endWeek: "2026-09-21", weeks: 3 }])[0];
    expect(resized.kind).toBe("resized");
    expect(resized.from).toBe(resized.to); // same start — never render "moved from"
    expect([resized.fromWeeks, resized.weeks]).toEqual([2, 3]);

    const moved = diffPacing(
      [before],
      [{ ...before, startWeek: "2026-09-14", endWeek: "2026-09-21" }],
    )[0];
    expect(moved.kind).toBe("moved");
    expect(moved.from).toBe("2026-09-07");
    expect(moved.to).toBe("2026-09-14");

    const added = diffPacing([], [before])[0];
    expect(added.kind).toBe("added");
    expect(added.from).toBeNull();
    expect(added.fromWeeks).toBeNull();

    // A shortened run is still a resize, and the delta carries the direction.
    const shorter = diffPacing([before], [{ ...before, endWeek: "2026-09-07", weeks: 1 }])[0];
    expect(shorter.kind).toBe("resized");
    expect(shorter.weeks - shorter.fromWeeks!).toBe(-1);
  });
  test("non-finite weights cannot poison workload arithmetic", () => {
    for (const weight of [NaN, Infinity, -Infinity, 0, -1]) expect(weightOf({ weight })).toBe(1);
    expect(weightOf({ weight: 2.5 })).toBe(2.5);
  });
  test("invalid projection boundaries fail explicitly", () => {
    expect(() =>
      projectReviews({ candidates: [], currentMonday: new Date(NaN), examMonday }),
    ).toThrow();
  });
  test("large uncapped queues retain every point in deterministic weekly order", () => {
    const candidates: FocusCandidate[] = Array.from({ length: 2000 }, (_, i) => ({
      specPointId: String(i).padStart(4, "0"),
      topicId: "t",
      topicTitle: "Topic",
      code: String(i),
      pointTitle: String(i),
      dueAt: i % 2 ? "2026-09-07T00:00:00+01:00" : "2026-09-21T00:00:00+01:00",
      eligibleAt: "2026-09-07T00:00:00+01:00",
      lastReviewedAt: "2026-08-24T00:00:00+01:00",
      weight: 7,
    }));
    const a = projectReviews({ candidates, currentMonday, examMonday });
    const b = projectReviews({ candidates: [...candidates].reverse(), currentMonday, examMonday });
    expect(a).toEqual(b);
    expect(a.bands.map((band) => band.startWeek)).toEqual(["2026-09-07", "2026-09-21"]);
    expect(a.bands.map((band) => band.points?.length)).toEqual([1000, 1000]);
    expect(a.backlog).toEqual([]);
  });
});

describe("reviews respect acknowledged teaching openings", () => {
  const candidate: FocusCandidate = {
    specPointId: "early",
    topicId: "future",
    topicTitle: "Future topic",
    code: "B6",
    pointTitle: "Early assessment",
    dueAt: "2026-09-14T00:00:00+01:00",
    eligibleAt: "2026-09-14T00:00:00+01:00",
    lastReviewedAt: "2026-09-01T00:00:00Z",
  };
  test("early evidence waits for teaching instead of disappearing", () => {
    const result = projectReviews({
      candidates: [candidate],
      currentMonday,
      examMonday,
      topicOpenings: new Map([["future", "2026-11-02"]]),
    });
    expect(result.bands[0].startWeek).toBe("2026-11-02");
    expect(result.bands[0].points?.[0].specPointId).toBe("early");
  });
  test("a review due after opening keeps its later eligibility", () => {
    const result = projectReviews({
      candidates: [{ ...candidate, dueAt: "2026-12-07T00:00:00Z" }],
      currentMonday,
      examMonday,
      topicOpenings: new Map([["future", "2026-11-02"]]),
    });
    expect(result.bands[0].startWeek).toBe("2026-12-07");
  });
  test("teaching beyond the exam is reported as backlog, never silently removed", () => {
    const result = projectReviews({
      candidates: [candidate],
      currentMonday,
      examMonday,
      topicOpenings: new Map([["future", "2027-06-14"]]),
    });
    expect(result.bands).toEqual([]);
    expect(result.backlog).toEqual([candidate]);
  });
});

describe("weekly review budget (S-28)", () => {
  // 230 reviews all overdue on the same day — a student back after weeks away.
  // Each due a minute apart, so "oldest first" has one right answer.
  const overdue = Array.from({ length: 230 }, (_, i) => ({
    specPointId: `p${String(i).padStart(3, "0")}`,
    topicId: `t${i % 7}`,
    topicTitle: `Topic ${i % 7}`,
    code: `${i}`,
    pointTitle: `Point ${i}`,
    dueAt: new Date(Date.parse("2026-08-01T09:00:00Z") + i * 60_000).toISOString(),
    eligibleAt: "2026-08-01T09:00:00Z",
    lastReviewedAt: "2026-07-20T09:00:00Z",
    weight: 1,
  }));
  const thisWeek = toDateKey(currentMonday);
  // A week's reviews are grouped by topic, so compare which ones, not their order.
  const idsIn = (r: ReturnType<typeof projectReviews>, week: string) =>
    r.bands
      .filter((b) => b.startWeek === week)
      .flatMap((b) => b.points!.map((p) => p.specPointId))
      .sort();
  // A course teaching about six points a week, as today's courses do.
  const budget = reviewBudget(6);

  test("the budget is three times a week's teaching", () => {
    expect(REVIEW_SHARE).toBe(3);
    expect(budget).toBe(18);
  });

  test("without a budget every overdue review lands in one week — the week that couldn't save", () => {
    const r = projectReviews({ candidates: overdue, currentMonday, examMonday });
    expect(idsIn(r, thisWeek)).toHaveLength(230);
  });

  test("with it, this week holds the budget's worth, oldest due first", () => {
    const r = projectReviews({
      candidates: overdue,
      currentMonday,
      examMonday,
      weeklyBudget: budget,
    });
    expect(idsIn(r, thisWeek)).toEqual(overdue.slice(0, 18).map((c) => c.specPointId));
  });

  test("the rest roll into the following weeks in order, and nothing is lost", () => {
    const r = projectReviews({
      candidates: overdue,
      currentMonday,
      examMonday,
      weeklyBudget: budget,
    });
    expect(idsIn(r, toDateKey(addWeeks(currentMonday, 1)))).toEqual(
      overdue.slice(18, 36).map((c) => c.specPointId),
    );
    const placed = r.bands.flatMap((b) => b.points!.map((p) => p.specPointId));
    expect(new Set(placed).size).toBe(230);
    expect(r.backlog).toEqual([]);
  });

  test("what is due now but waiting is offered to pull forward, oldest first", () => {
    const r = projectReviews({
      candidates: overdue,
      currentMonday,
      examMonday,
      weeklyBudget: budget,
      readyBy: currentMonday,
    });
    expect(r.waiting.map((c) => c.specPointId)).toEqual(
      overdue.slice(18).map((c) => c.specPointId),
    );
  });

  test("a review not yet due is never 'waiting', and keeps its own week", () => {
    const later = { ...overdue[0], specPointId: "later", dueAt: "2026-10-05T00:00:00+01:00" };
    const r = projectReviews({
      candidates: [later],
      currentMonday,
      examMonday,
      weeklyBudget: budget,
      readyBy: currentMonday,
    });
    expect(r.waiting).toEqual([]);
    expect(idsIn(r, "2026-10-05")).toEqual(["later"]);
  });

  test("a review heavier than the whole budget still gets a week of its own", () => {
    const heavy = { ...overdue[0], specPointId: "heavy", weight: 40 };
    const r = projectReviews({
      candidates: [heavy],
      currentMonday,
      examMonday,
      weeklyBudget: budget,
    });
    expect(idsIn(r, thisWeek)).toEqual(["heavy"]);
  });

  test("a week the tutor closed to a point is stepped past", () => {
    const [a, b] = overdue;
    const r = projectReviews({
      candidates: [a, b],
      currentMonday,
      examMonday,
      weeklyBudget: 1,
      isBlocked: (id, week) => id === a.specPointId && week === thisWeek,
    });
    expect(idsIn(r, thisWeek)).toEqual([b.specPointId]);
    expect(idsIn(r, toDateKey(addWeeks(currentMonday, 1)))).toEqual([a.specPointId]);
  });

  test("reviews with no room before the exam are reported as backlog", () => {
    const nearExam = addWeeks(currentMonday, 2);
    const r = projectReviews({
      candidates: overdue.slice(0, 10),
      currentMonday,
      examMonday: nearExam,
      weeklyBudget: 3,
    });
    expect(r.bands.flatMap((b) => b.points!)).toHaveLength(6);
    expect(r.backlog.map((c) => c.specPointId)).toEqual(
      overdue.slice(6, 10).map((c) => c.specPointId),
    );
  });
});

describe("spineIsForAnotherCourse (S-29)", () => {
  const band = (topicId: string): PacingBand => ({
    topicId,
    title: topicId,
    startWeek: "2026-09-07",
    endWeek: "2026-10-05",
    weeks: 5,
  });
  const course = (...ids: string[]) =>
    ids.map((topicId) => ({ topicId, title: topicId, points: [] }) as never);

  test("a spine naming none of the course's topics is another course's", () => {
    expect(spineIsForAnotherCourse([band("aqa1"), band("aqa2")], course("edx1", "edx2"))).toBe(
      true,
    );
  });

  test("one shared topic is enough to call it this course's (an edited curriculum, not a switch)", () => {
    expect(spineIsForAnotherCourse([band("t1"), band("gone")], course("t1", "t2"))).toBe(false);
  });

  test("nothing stored, or no curriculum, is never a course change", () => {
    expect(spineIsForAnotherCourse([], course("t1"))).toBe(false);
    expect(spineIsForAnotherCourse([band("t1")], [])).toBe(false);
  });
});

describe("default exam date (S-32)", () => {
  const exam = (iso: string) => toDateKey(examMondayFor(new Date(iso)));

  test("once this year's exam Monday has come, the default is next year's", () => {
    // 1 June 2026 is a Monday; 10 June is after it.
    expect(exam("2026-06-10T12:00:00Z")).toBe("2027-06-07");
    // 2027's first Monday of June is the 7th; the 8th is after it.
    expect(exam("2027-06-08T12:00:00Z")).toBe("2028-06-05");
    // On the exam Monday itself, this year's series has begun.
    expect(exam("2027-06-07T09:00:00+01:00")).toBe("2028-06-05");
  });

  test("before it, this year's series stands", () => {
    expect(exam("2027-06-06T20:00:00+01:00")).toBe("2027-06-07");
    expect(exam("2026-09-07T12:00:00Z")).toBe("2027-06-07");
    expect(exam("2027-01-15T12:00:00Z")).toBe("2027-06-07");
  });
});

describe("programme start from a first visit (M-9)", () => {
  const start = (iso: string) => toDateKey(programStartFor(new Date(iso)));

  test("Monday to Friday anchors to this week", () => {
    expect(start("2026-10-05T09:00:00+01:00")).toBe("2026-10-05"); // Monday
    expect(start("2026-10-09T23:30:00+01:00")).toBe("2026-10-05"); // Friday night
  });

  test("from Saturday (UK time) it starts next Monday", () => {
    expect(start("2026-10-10T00:05:00+01:00")).toBe("2026-10-12"); // Saturday
    expect(start("2026-10-11T23:30:00+01:00")).toBe("2026-10-12"); // late Sunday
    // Friday 23:30 in London is already Saturday in Dubai; London decides.
    expect(start("2026-10-09T22:30:00Z")).toBe("2026-10-05");
  });
});
