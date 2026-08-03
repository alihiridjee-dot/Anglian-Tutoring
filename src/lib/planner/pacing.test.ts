import { describe, expect, test } from "bun:test";
import {
  computePacing,
  scheduleFocusPoints,
  selectWeekPoints,
  splitAcrossWeeks,
  withWeeklyPoints,
  type FocusCandidate,
  type PacingBand,
  DEFAULT_FOCUS_BUDGET,
} from "./pacing";
import { addWeeks, mondayOf, toDateKey, weekKeyToDate } from "@/lib/week";

const currentMonday = mondayOf(new Date("2026-09-07T00:00:00"));
const examMonday = mondayOf(new Date("2027-06-07T00:00:00")); // ~39 weeks out

/** N weak points across `topics` topics, all rated `mastery`. */
function makeCandidates(topics: number, pointsEach: number, mastery: number): FocusCandidate[] {
  const out: FocusCandidate[] = [];
  for (let t = 0; t < topics; t++) {
    for (let p = 0; p < pointsEach; p++) {
      out.push({
        specPointId: `t${t}-p${p}`,
        topicId: `t${t}`,
        topicTitle: `Topic ${t}`,
        code: `${t}.${p}`,
        pointTitle: `Point ${t}.${p}`,
        mastery,
      });
    }
  }
  return out;
}

/** Total spec points scheduled in each week (across all topic bands). */
function pointsPerWeek(bands: ReturnType<typeof scheduleFocusPoints>): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bands) {
    if (b.kind !== "revisit") continue;
    m.set(b.startWeek, (m.get(b.startWeek) ?? 0) + (b.points?.length ?? 0));
  }
  return m;
}

describe("computePacing — the fixed core spine", () => {
  const topics = [
    { topicId: "a", title: "A", weight: 10 },
    { topicId: "b", title: "B", weight: 20 },
    { topicId: "c", title: "C", weight: 10 },
  ];

  test("runs sequentially, gapless and overlap-free, from the student's start week", () => {
    const bands = computePacing(topics, currentMonday, examMonday);
    expect(bands[0].startWeek).toBe(toDateKey(currentMonday));
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

describe("scheduleFocusPoints — revision load balancer", () => {
  test("never exceeds the weekly budget, even with a huge backlog", () => {
    // Nine topics rated badly, 8 points each = 72 weak points landing at once.
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(9, 8, 10),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    for (const [, n] of pointsPerWeek(bands)) {
      expect(n).toBeLessThanOrEqual(DEFAULT_FOCUS_BUDGET);
    }
  });

  test("spreads the backlog across multiple weeks instead of flooding week one", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(9, 8, 10),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    const weeks = pointsPerWeek(bands);
    expect(weeks.size).toBeGreaterThan(5); // cascaded over many weeks, not one
  });

  test("weakest points are scheduled first", () => {
    const candidates: FocusCandidate[] = [
      {
        specPointId: "weak",
        topicId: "a",
        topicTitle: "A",
        code: "a.1",
        pointTitle: "weak",
        mastery: 5,
      },
      ...makeCandidates(2, DEFAULT_FOCUS_BUDGET, 60), // fill the first week with amber
    ];
    const bands = scheduleFocusPoints({ candidates, coveredTopics: [], currentMonday, examMonday });
    const firstWeek = toDateKey(currentMonday);
    const inFirst = bands
      .filter((b) => b.startWeek === firstWeek)
      .flatMap((b) => b.points ?? [])
      .map((p) => p.specPointId);
    expect(inFirst).toContain("weak"); // the mastery-5 point is never bumped
  });

  test("respects budget with a small backlog and groups points under their topic", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(1, 3, 10), // one topic, 3 weak points
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    const firstWeek = toDateKey(currentMonday);
    const band = bands.find((b) => b.startWeek === firstWeek && b.topicId === "t0");
    expect(band).toBeDefined();
    expect(band!.points?.length).toBe(3); // all three fit in one week under one topic band
  });

  test("the weekly budget is work, not a headcount", () => {
    // Six heavy points can't all land in one week just because six is the
    // number. With everything weighing 3, a budget of 6 buys two of them.
    const heavy = makeCandidates(1, 6, 10).map((c) => ({ ...c, weight: 3 }));
    const bands = scheduleFocusPoints({
      candidates: heavy,
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    const first = pointsPerWeek(bands).get(toDateKey(currentMonday));
    expect(first).toBe(2);

    // The same six, unweighted, still fill the lane exactly as before — a tree
    // with no measured weights must behave identically to the old build.
    const plain = scheduleFocusPoints({
      candidates: makeCandidates(1, 6, 10),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    expect(pointsPerWeek(plain).get(toDateKey(currentMonday))).toBe(DEFAULT_FOCUS_BUDGET);
  });

  test("plans the week the student is standing in, not just the ones after it", () => {
    // It used to start at week 1, so a topic dragged into "Needs work" could not
    // be acted on until the following Monday however weak it was.
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(1, 2, 5),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    expect(pointsPerWeek(bands).get(toDateKey(currentMonday))).toBe(2);
  });

  test("settled topics get a review band, weak ones get revisits", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(1, 2, 10),
      coveredTopics: [{ topicId: "done", title: "Done topic" }],
      currentMonday,
      examMonday,
    });
    expect(bands.some((b) => b.kind === "review" && b.topicId === "done")).toBe(true);
    expect(bands.some((b) => b.kind === "revisit" && b.topicId === "t0")).toBe(true);
  });
});

describe("selectWeekPoints — the year plan's slice of one week", () => {
  const wk = (n: number) => toDateKey(addWeeks(currentMonday, n));
  const SETTLED = 67;

  /** A topic whose points all sit at `mastery`. */
  const topic = (topicId: string, n: number, mastery: number) => ({
    topicId,
    points: Array.from({ length: n }, (_, i) => ({ id: `${topicId}-p${i}`, mastery })),
  });

  const teachBand = (topicId: string, title: string, start: number, weeks: number): PacingBand => ({
    topicId,
    title,
    startWeek: wk(start),
    endWeek: wk(start + weeks - 1),
    weeks,
    kind: "teach",
  });

  const revisitBand = (topicId: string, start: number, codes: string[]): PacingBand => ({
    topicId,
    title: topicId,
    startWeek: wk(start),
    endWeek: wk(start),
    weeks: 1,
    kind: "revisit",
    points: codes.map((c) => ({ specPointId: c, code: c, title: c })),
  });

  test("revisits never starve the spine — the two lanes are budgeted separately", () => {
    // The bug this guards: one shared cap of 6 meant a full revisit lane left no
    // room to teach anything, every week, until the backlog cleared.
    const sel = selectWeekPoints({
      bands: [
        revisitBand("t1", 0, ["a", "b", "c", "d", "e", "f"]),
        teachBand("t2", "Topic 2", 0, 1),
      ],
      weekStart: wk(0),
      topics: [topic("t1", 6, 10), topic("t2", 4, 0)],
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(sel.focusCount).toBe(6); // the lane is full…
    expect(sel.teachCount).toBe(4); // …and the whole topic still gets taught
    expect(sel.teachTitle).toBe("Topic 2");
    expect(sel.specPointIds).toHaveLength(10);
  });

  test("the focus budget caps revisits only", () => {
    const sel = selectWeekPoints({
      bands: [revisitBand("t1", 0, ["a", "b", "c", "d"]), teachBand("t2", "Topic 2", 0, 1)],
      weekStart: wk(0),
      topics: [topic("t1", 4, 10), topic("t2", 5, 0)],
      focusBudget: 2,
      settledThreshold: SETTLED,
    });
    expect(sel.specPointIds.slice(0, 2)).toEqual(["a", "b"]); // capped at 2
    expect(sel.focusCount).toBe(2);
    expect(sel.teachCount).toBe(5); // teaching is untouched by the cap
  });

  test("a long teach band hands out a share a week, not everything at once", () => {
    // A 9-point topic over 3 weeks moves 3 a week as they're covered — that is
    // what "spread across the year" means. The plan advances because the work
    // got done, never because the calendar moved on without it.
    const bands = [teachBand("t1", "Topic 1", 0, 3)];
    const points = Array.from({ length: 9 }, (_, i) => ({ id: `t1-p${i}`, mastery: 0 }));
    const pick = (n: number) =>
      selectWeekPoints({
        bands,
        weekStart: wk(n),
        topics: [{ topicId: "t1", points }],
        focusBudget: 6,
        settledThreshold: SETTLED,
      }).specPointIds;
    const markDone = (ids: string[]) => {
      for (const p of points) if (ids.includes(p.id)) p.mastery = 90;
    };

    expect(pick(0)).toEqual(["t1-p0", "t1-p1", "t1-p2"]);
    markDone(pick(0));
    expect(pick(1)).toEqual(["t1-p3", "t1-p4", "t1-p5"]);
    markDone(pick(1));
    expect(pick(2)).toEqual(["t1-p6", "t1-p7", "t1-p8"]);
  });

  test("points left undone come back first, and nothing is stepped over", () => {
    // Week 0 was offered p0–p2; say only p1 got done. Week 1 owes p3–p5, but the
    // two stragglers are still outstanding — they lead, and the week keeps its
    // size, so p5 rolls on rather than vanishing. Slicing the unsettled list by
    // week index (the earlier approach) silently skipped p0 and p2 forever.
    const bands = [teachBand("t1", "Topic 1", 0, 3)];
    const topics = [
      {
        topicId: "t1",
        points: [
          { id: "p0", mastery: 10 },
          { id: "p1", mastery: 90 }, // done
          { id: "p2", mastery: 10 },
          { id: "p3", mastery: 10 },
          { id: "p4", mastery: 10 },
          { id: "p5", mastery: 10 },
          { id: "p6", mastery: 10 },
          { id: "p7", mastery: 10 },
          { id: "p8", mastery: 10 },
        ],
      },
    ];
    const week1 = selectWeekPoints({
      bands,
      weekStart: wk(1),
      topics,
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(week1.specPointIds).toEqual(["p0", "p2", "p3"]);
  });

  test("a week's share is measured in work, so one heavy point can be the week", () => {
    // Under the old count-based cap this week handed over three points whatever
    // they weighed. The first point here is worth three of the others, so it is
    // a week's work on its own.
    const bands = [teachBand("t1", "Topic 1", 0, 3)];
    const points = [
      { id: "heavy", mastery: 0, weight: 3 },
      { id: "a", mastery: 0, weight: 1 },
      { id: "b", mastery: 0, weight: 1 },
      { id: "c", mastery: 0, weight: 1 },
      { id: "d", mastery: 0, weight: 1 },
      { id: "e", mastery: 0, weight: 1 },
    ];
    const sel = selectWeekPoints({
      bands,
      weekStart: wk(0),
      topics: [{ topicId: "t1", points }],
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(sel.specPointIds).toEqual(["heavy"]);
  });

  test("the roadmap's last week and the week view agree on its size", () => {
    // 13 points over 5 weeks: the old split was 3/3/3/3/1 and the week view
    // capped on chunks[0].length = 3, so the roadmap promised one point in week
    // 5 and the planner handed over three. Both now read the same chunk.
    const bands = [teachBand("t1", "Topic 1", 0, 5)];
    const points = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, mastery: 0 }));
    const [band] = withWeeklyPoints(
      bands,
      new Map([["t1", points.map((p) => ({ specPointId: p.id, code: p.id, title: p.id }))]]),
    );
    const lastWeek = band.pointsByWeek?.[wk(4)] ?? [];
    const sel = selectWeekPoints({
      bands,
      weekStart: wk(4),
      // Everything before the last week is done, so only its own share is owed.
      topics: [
        {
          topicId: "t1",
          points: points.map((p, i) => ({ ...p, mastery: i < 13 - lastWeek.length ? 90 : 0 })),
        },
      ],
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(sel.teachCount).toBe(lastWeek.length);
  });

  test("settled points are never re-taught, and a week outside every band is empty", () => {
    const bands = [teachBand("t1", "Topic 1", 0, 1)];
    const topics = [
      {
        topicId: "t1",
        points: [
          { id: "weak", mastery: 20 },
          { id: "solid", mastery: 90 },
        ],
      },
    ];
    expect(
      selectWeekPoints({
        bands,
        weekStart: wk(0),
        topics,
        focusBudget: 6,
        settledThreshold: SETTLED,
      }).specPointIds,
    ).toEqual(["weak"]);
    expect(
      selectWeekPoints({
        bands,
        weekStart: wk(5),
        topics,
        focusBudget: 6,
        settledThreshold: SETTLED,
      }).specPointIds,
    ).toEqual([]);
  });

  test("never repeats a point that both lanes want", () => {
    const sel = selectWeekPoints({
      bands: [revisitBand("t1", 0, ["t1-p0", "t1-p1"]), teachBand("t1", "Topic 1", 0, 1)],
      weekStart: wk(0),
      topics: [topic("t1", 8, 10)],
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(new Set(sel.specPointIds).size).toBe(sel.specPointIds.length);
    expect(sel.specPointIds).toHaveLength(8); // 2 revisits + the other 6 taught
  });

  test("a revision week falls back to a light pass over settled topics", () => {
    const sel = selectWeekPoints({
      bands: [
        {
          topicId: "t1",
          title: "Topic 1",
          startWeek: wk(0),
          endWeek: wk(0),
          weeks: 1,
          kind: "review",
        },
      ],
      weekStart: wk(0),
      topics: [
        {
          topicId: "t1",
          points: [
            { id: "hi", mastery: 95 },
            { id: "lo", mastery: 70 },
          ],
        },
      ],
      focusBudget: 6,
      settledThreshold: SETTLED,
    });
    expect(sel.specPointIds).toEqual(["lo", "hi"]); // weakest first
    expect(sel.reviewCount).toBe(2);
  });
});

describe("selectWeekPoints — lane labelling", () => {
  const wk = (n: number) => toDateKey(addWeeks(currentMonday, n));

  test("every point is tagged with the lane it came from", () => {
    const sel = selectWeekPoints({
      bands: [
        {
          topicId: "t1",
          title: "T1",
          startWeek: wk(0),
          endWeek: wk(0),
          weeks: 1,
          kind: "revisit",
          points: [{ specPointId: "r1", code: "r1", title: "r1" }],
        },
        { topicId: "t2", title: "T2", startWeek: wk(0), endWeek: wk(0), weeks: 1, kind: "teach" },
      ],
      weekStart: wk(0),
      topics: [
        { topicId: "t1", points: [{ id: "r1", mastery: 10 }] },
        { topicId: "t2", points: [{ id: "c1", mastery: 0 }] },
      ],
      focusBudget: 6,
      settledThreshold: 67,
    });
    expect(sel.lanes).toEqual({ r1: "focus", c1: "core" });
  });

  test("the pre-exam review pass counts as core curriculum", () => {
    const sel = selectWeekPoints({
      bands: [
        { topicId: "t1", title: "T1", startWeek: wk(0), endWeek: wk(0), weeks: 1, kind: "review" },
      ],
      weekStart: wk(0),
      topics: [{ topicId: "t1", points: [{ id: "s1", mastery: 90 }] }],
      focusBudget: 6,
      settledThreshold: 67,
    });
    expect(sel.lanes).toEqual({ s1: "core" });
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
