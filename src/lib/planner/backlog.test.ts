import { describe, expect, test } from "bun:test";
import {
  backlogWeight,
  projectCatchUp,
  byTopic,
  CATCH_UP_SHARE,
  catchUpBudget,
  isDelivered,
  spineBacklog,
  trickle,
  type BacklogPoint,
  type DeliveryLedger,
} from "./backlog";
import { withWeeklyPoints, type FocusPointRef, type PacingBand } from "./pacing";
import { addWeeks, toDateKey, weekKeyToDate } from "./week";

const EMPTY: DeliveryLedger = { assessed: new Set(), done: new Set(), outstanding: new Set() };

const ledger = (over: Partial<DeliveryLedger>): DeliveryLedger => ({ ...EMPTY, ...over });

const point = (id: string, weight = 1): FocusPointRef => ({
  specPointId: id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
  weight,
});

/** Topic 1 ran for three weeks and closed; topic 2 is running now. */
const SPINE: PacingBand[] = [
  { topicId: "t1", title: "Topic 1", startWeek: "2026-07-13", endWeek: "2026-07-27", weeks: 3 },
  { topicId: "t2", title: "Topic 2", startWeek: "2026-08-03", endWeek: "2026-08-10", weeks: 2 },
];

const HYDRATED = withWeeklyPoints(
  SPINE,
  new Map([
    ["t1", [point("a"), point("b"), point("c")]],
    ["t2", [point("d"), point("e")]],
  ]),
);

const NOW = "2026-08-10";

describe("spineBacklog", () => {
  test("chases every point the spine walked past", () => {
    const out = spineBacklog({ bands: HYDRATED, weekStart: NOW, ledger: EMPTY });
    // a/b/c from the closed topic, plus d from the first week of the open one.
    expect(out.map((p) => p.specPointId)).toEqual(["a", "b", "c", "d"]);
  });

  test("leaves this week's own slice alone", () => {
    const out = spineBacklog({ bands: HYDRATED, weekStart: NOW, ledger: EMPTY });
    // `e` is allocated to 2026-08-10 — the week being planned, not a past one.
    expect(out.some((p) => p.specPointId === "e")).toBe(false);
  });

  test("reports the week the point was actually promised, not the band start", () => {
    const out = spineBacklog({ bands: HYDRATED, weekStart: NOW, ledger: EMPTY });
    expect(out.find((p) => p.specPointId === "a")?.plannedWeek).toBe("2026-07-13");
    expect(out.find((p) => p.specPointId === "c")?.plannedWeek).toBe("2026-07-27");
  });

  test("all three delivery routes discharge the promise", () => {
    for (const route of ["assessed", "done", "outstanding"] as const) {
      const out = spineBacklog({
        bands: HYDRATED,
        weekStart: NOW,
        ledger: ledger({ [route]: new Set(["a"]) }),
      });
      expect(out.some((p) => p.specPointId === "a")).toBe(false);
    }
  });

  test("being offered in a past week is not delivery", () => {
    // The whole point: a plan the student never opened still owes them the work.
    const out = spineBacklog({ bands: HYDRATED, weekStart: NOW, ledger: EMPTY });
    expect(out.map((p) => p.specPointId)).toContain("a");
  });

  test("oldest first, so the least runway is served first", () => {
    const out = spineBacklog({ bands: HYDRATED, weekStart: NOW, ledger: EMPTY });
    const weeks = out.map((p) => p.plannedWeek);
    expect([...weeks].sort()).toEqual(weeks);
  });

  test("revisit bands are not promises the spine made", () => {
    const withFocus: PacingBand[] = [
      ...HYDRATED,
      {
        topicId: "t9",
        title: "Focus",
        startWeek: "2026-07-20",
        endWeek: "2026-07-20",
        weeks: 1,
        kind: "revisit",
        points: [point("z")],
      },
    ];
    const out = spineBacklog({ bands: withFocus, weekStart: NOW, ledger: EMPTY });
    expect(out.some((p) => p.specPointId === "z")).toBe(false);
  });

  test("a band with no stored division falls back to its start week", () => {
    const bare: PacingBand[] = [
      { topicId: "t1", title: "Topic 1", startWeek: "2026-07-13", endWeek: "2026-07-27", weeks: 3 },
    ];
    const out = spineBacklog({
      bands: bare,
      weekStart: NOW,
      ledger: EMPTY,
      pointsByTopic: new Map([["t1", [point("a"), point("b")]]]),
    });
    expect(out.map((p) => p.plannedWeek)).toEqual(["2026-07-13", "2026-07-13"]);
  });

  test("codes due the same week come back in number order, 1.7 before 1.10", () => {
    const bare: PacingBand[] = [
      { topicId: "t1", title: "Topic 1", startWeek: "2026-07-13", endWeek: "2026-07-27", weeks: 3 },
    ];
    const codes = ["EDEX 1.10", "EDEX 1.7", "EDEX 1.9"];
    const out = spineBacklog({
      bands: bare,
      weekStart: NOW,
      ledger: EMPTY,
      pointsByTopic: new Map([["t1", codes.map((code) => ({ ...point(code), code }))]]),
    });
    expect(out.map((p) => p.code)).toEqual(["EDEX 1.7", "EDEX 1.9", "EDEX 1.10"]);
  });

  test("nothing is owed when the programme has not started", () => {
    expect(spineBacklog({ bands: HYDRATED, weekStart: "2026-07-13", ledger: EMPTY })).toEqual([]);
  });
});

describe("isDelivered", () => {
  test("any one route is enough", () => {
    expect(isDelivered("a", ledger({ done: new Set(["a"]) }))).toBe(true);
    expect(isDelivered("a", EMPTY)).toBe(false);
  });
});

describe("trickle", () => {
  const backlog = (...weights: number[]): BacklogPoint[] =>
    weights.map((weight, i) => ({
      specPointId: `p${i}`,
      topicId: "t1",
      topicTitle: "Topic 1",
      code: `P${i}`,
      title: `Point ${i}`,
      weight,
      plannedWeek: "2026-07-13",
    }));

  test("takes what fits and holds the rest", () => {
    const { take, held } = trickle(backlog(1, 1, 1, 1), 2);
    expect(take.map((p) => p.specPointId)).toEqual(["p0", "p1"]);
    expect(held.map((p) => p.specPointId)).toEqual(["p2", "p3"]);
  });

  test("a point heavier than the whole budget still moves", () => {
    // Otherwise the heaviest points on the spec are excluded forever, which is
    // the exact failure this module exists to end.
    const { take, held } = trickle(backlog(9), 2);
    expect(take).toHaveLength(1);
    expect(held).toHaveLength(0);
  });

  test("a light point never jumps a heavy one it is queued behind", () => {
    const { take, held } = trickle(backlog(1, 9, 1), 2);
    expect(take.map((p) => p.specPointId)).toEqual(["p0"]);
    expect(held.map((p) => p.specPointId)).toEqual(["p1", "p2"]);
  });

  test("no budget takes nothing", () => {
    const { take, held } = trickle(backlog(1, 1), 0);
    expect(take).toHaveLength(0);
    expect(held).toHaveLength(2);
  });

  test("everything fits when the budget covers it", () => {
    const { take, held } = trickle(backlog(1, 1), 5);
    expect(take).toHaveLength(2);
    expect(held).toHaveLength(0);
  });
});

describe("catchUpBudget", () => {
  test("is a fixed share of the week's spine load", () => {
    expect(catchUpBudget(10)).toBeCloseTo(10 * CATCH_UP_SHARE);
  });

  test("never negative", () => {
    expect(catchUpBudget(-5)).toBe(0);
  });

  test("leaves the great majority of the week for the spine", () => {
    expect(CATCH_UP_SHARE).toBeLessThanOrEqual(0.25);
  });
});

describe("byTopic", () => {
  test("groups, totals and dates the debt, oldest topic first", () => {
    const out = byTopic([
      {
        specPointId: "d",
        topicId: "t2",
        topicTitle: "Topic 2",
        code: "D",
        title: "d",
        weight: 2,
        plannedWeek: "2026-08-03",
      },
      {
        specPointId: "a",
        topicId: "t1",
        topicTitle: "Topic 1",
        code: "A",
        title: "a",
        weight: 3,
        plannedWeek: "2026-07-13",
      },
      {
        specPointId: "b",
        topicId: "t1",
        topicTitle: "Topic 1",
        code: "B",
        title: "b",
        weight: 1,
        plannedWeek: "2026-07-20",
      },
    ]);
    expect(out.map((g) => g.topicId)).toEqual(["t1", "t2"]);
    expect(out[0].weight).toBe(4);
    expect(out[0].since).toBe("2026-07-13");
  });
});

describe("backlogWeight", () => {
  test("sums the debt", () => {
    expect(
      backlogWeight([
        {
          specPointId: "a",
          topicId: "t",
          topicTitle: "T",
          code: "A",
          title: "a",
          weight: 2.5,
          plannedWeek: "2026-07-13",
        },
      ]),
    ).toBe(2.5);
  });
});

describe("catch-up forecast", () => {
  const missed = ["a", "b", "c", "d"].map((id): BacklogPoint => ({
    specPointId: id,
    code: id,
    title: id,
    topicId: "old",
    topicTitle: "Old topic",
    weight: 1,
    plannedWeek: "2026-07-13",
  }));
  const params = {
    backlog: missed,
    assigned: [],
    weekStart: "2026-09-07",
    examDate: "2026-10-05",
    weeklyWeight: 5,
  };
  test("September 7 and 14 receive different oldest points without manual action", () => {
    const result = projectCatchUp(params);
    expect(result.weeks["2026-09-07"].map((p) => p.specPointId)).toEqual(["a"]);
    expect(result.weeks["2026-09-14"].map((p) => p.specPointId)).toEqual(["b"]);
    expect(Object.values(result.weeks).flat()).toEqual(missed);
    expect(result.held).toEqual([]);
  });
  test("saving or completing this week's catch-up does not refill its allowance", () => {
    const saved = projectCatchUp({ ...params, assigned: [missed[0]] });
    const completed = projectCatchUp({
      ...params,
      backlog: missed.slice(1),
      assigned: [missed[0]],
    });
    expect(saved).toEqual(completed);
    expect(completed.weeks["2026-09-07"]).toEqual([missed[0]]);
  });
  test("an unfinished point returns first when the next week arrives", () => {
    const result = projectCatchUp({ ...params, weekStart: "2026-09-14" });
    // Four owed and three weeks left, so the week also takes its fair share.
    expect(result.weeks["2026-09-14"]).toEqual(missed.slice(0, 2));
  });
  test("manual catch-up consumes capacity and is not forecast again", () => {
    const result = projectCatchUp({ ...params, assigned: missed.slice(0, 2) });
    expect(result.weeks["2026-09-07"]).toEqual(missed.slice(0, 2));
    expect(result.weeks["2026-09-14"]).toEqual([missed[2]]);
  });
  test("an oversized point is served once, without opening another floor on reload", () => {
    const heavy = { ...missed[0], weight: 8 };
    const result = projectCatchUp({ ...params, backlog: [heavy, missed[1]] });
    expect(result.weeks["2026-09-07"]).toEqual([heavy]);
    expect(projectCatchUp({ ...params, backlog: [heavy, missed[1]], assigned: [heavy] })).toEqual({
      ...result,
      assignedIds: [heavy.specPointId],
    });
  });
  test("does not allocate on or after the exam; reports what cannot fit", () => {
    const lastWeek = projectCatchUp({ ...params, examDate: "2026-09-14" });
    expect(lastWeek.weeks["2026-09-14"]).toBeUndefined();
    expect(lastWeek.weeks["2026-09-07"]).toEqual(missed);
    expect(lastWeek.held).toEqual([]);
    const examHere = projectCatchUp({ ...params, examDate: "2026-09-07" });
    expect(examHere.weeks).toEqual({});
    expect(examHere.held).toEqual(missed);
  });

  const owed = (n: number) =>
    Array.from({ length: n }, (_, i): BacklogPoint => ({
      ...missed[0],
      specPointId: `p${String(i).padStart(2, "0")}`,
      code: `p${String(i).padStart(2, "0")}`,
    }));
  const perWeek = (result: { weeks: Record<string, BacklogPoint[]> }) =>
    Object.values(result.weeks).map((points) => points.length);

  test("short of the exam at the steady pace, each week takes its fair share, extra first", () => {
    // Six owed, four weeks, one a week at the steady pace: two would not fit.
    const result = projectCatchUp({ ...params, backlog: owed(6) });
    expect(perWeek(result)).toEqual([2, 2, 1, 1]);
    expect(Object.values(result.weeks).flat()).toEqual(owed(6));
    expect(result.held).toEqual([]);
  });

  test("40 owed with 36 weeks left: four weeks carry one extra, then one a week", () => {
    const examDate = toDateKey(addWeeks(weekKeyToDate(params.weekStart), 36));
    const steady = { ...params, backlog: owed(40), examDate, weeklyWeight: 4 };
    const result = projectCatchUp(steady);
    expect(perWeek(result)).toEqual([2, 2, 2, 2, ...Array(32).fill(1)]);
    expect(result.held).toEqual([]);
    // At one a week the steady pace fits 36 and is left alone; 40 is four short.
    expect(perWeek(projectCatchUp({ ...steady, backlog: owed(36) }))).toEqual(Array(36).fill(1));
  });

  test("this week's own catch-up counts towards its fair share", () => {
    const result = projectCatchUp({ ...params, backlog: owed(6), assigned: owed(6).slice(0, 2) });
    expect(result.weeks["2026-09-07"]).toEqual(owed(6).slice(0, 2));
    expect(perWeek(result)).toEqual([2, 2, 1, 1]);
    expect(result.held).toEqual([]);
  });

  test("a point a tutor has blocked from every week left is all that is held", () => {
    const result = projectCatchUp({
      ...params,
      backlog: owed(6),
      isBlocked: (id) => id === "p01",
    });
    expect(result.held.map((p) => p.specPointId)).toEqual(["p01"]);
    expect(Object.values(result.weeks).flat()).toHaveLength(5);
  });

  test("with no measured week the fair share alone still clears it", () => {
    const result = projectCatchUp({ ...params, weeklyWeight: 0 });
    expect(perWeek(result)).toEqual([1, 1, 1, 1]);
    expect(result.held).toEqual([]);
  });
});

describe("catch-up order inside one week", () => {
  test("spec codes order as numbers, so 1.8 and 1.9 come back before 1.10", () => {
    const bands = withWeeklyPoints(
      [{ topicId: "t", title: "Topic", startWeek: "2026-07-13", endWeek: "2026-07-13", weeks: 1 }],
      new Map([["t", ["1.10", "1.8", "1.11", "1.9"].map((c) => ({ ...point(c), code: c }))]]),
    );
    const out = spineBacklog({ bands, weekStart: "2026-09-07", ledger: EMPTY });
    expect(out.map((p) => p.code)).toEqual(["1.8", "1.9", "1.10", "1.11"]);
  });
});
