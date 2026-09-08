import { describe, expect, test } from "bun:test";
import {
  backlogWeight,
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
