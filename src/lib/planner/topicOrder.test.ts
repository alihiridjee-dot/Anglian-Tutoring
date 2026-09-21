import { describe, test, expect } from "bun:test";
import {
  computePacing,
  diffPacing,
  selectWeekPoints,
  withWeeklyPoints,
  projectReviews,
  type PacingBand,
} from "./pacing";
import { orderInputs, reorderTopics, type OrderTopic } from "./topicOrder";
import { spineReach, admit } from "./admissibility";
import { spineBacklog } from "./backlog";
import { weekKeyToDate } from "./week";
const today = "2026-09-14";
const examDate = "2026-11-09";
const topics: OrderTopic[] = ["a", "b", "c"].map((id, i) => ({
  topicId: id,
  title: id,
  points: Array.from({ length: 4 }, (_, j) => ({
    specPointId: `${id}${j}`,
    code: `${id}${j}`,
    title: `${id}${j}`,
    weight: i + 1,
  })),
}));
const pointMap = new Map(topics.map((t) => [t.topicId, t.points]));
const baseline = withWeeklyPoints(
  computePacing(
    topics.map((t) => ({ ...t, weight: t.points.reduce((s, p) => s + p.weight!, 0) })),
    weekKeyToDate("2026-08-31"),
    weekKeyToDate(examDate),
  ),
  pointMap,
);
const params = { bands: baseline, topics, from: today, examDate, today };
const scheduled = (bands: PacingBand[]) =>
  bands.flatMap((b) =>
    Object.entries(b.pointsByWeek ?? {}).flatMap(([week, ps]) =>
      ps.map((p) => [p.specPointId, week]),
    ),
  );
const past = (bands: PacingBand[], from = today) =>
  scheduled(bands).filter(([, week]) => week < from);
const order = orderInputs(baseline, topics, today)
  .remaining.map((t) => t.topicId)
  .reverse();

describe("individual topic order", () => {
  test("moves whole remaining topics and keeps every earlier promise exactly", () => {
    const next = reorderTopics({ ...params, order });
    expect(past(next)).toEqual(past(baseline));
    expect(next.filter((b) => b.startWeek >= today).map((b) => b.topicId)).toEqual(order);
    expect(
      scheduled(next)
        .map(([id]) => id)
        .sort(),
    ).toEqual(topics.flatMap((t) => t.points.map((p) => p.specPointId)).sort());
    expect(new Set(scheduled(next).map(([id]) => id)).size).toBe(12);
    expect(next.every((b) => b.endWeek < examDate)).toBe(true);
    expect(params.bands).toEqual(baseline);
  });
  test("partially taught topics keep earlier points; only their remaining points move", () => {
    const from = "2026-09-21";
    const remaining = orderInputs(baseline, topics, from).remaining;
    const next = reorderTopics({
      ...params,
      from,
      order: remaining.map((t) => t.topicId).reverse(),
    });
    expect(past(next, from)).toEqual(past(baseline, from));
    expect(new Set(scheduled(next).map(([id]) => id)).size).toBe(12);
    const splitTopic = baseline.find((b) => b.startWeek < from && b.endWeek >= from)!;
    expect(next.filter((b) => b.topicId === splitTopic.topicId)).toHaveLength(2);
    expect(diffPacing(next, next)).toEqual([]);
  });
  test("hydration never re-divides saved custom history", () => {
    const next = reorderTopics({ ...params, order });
    expect(
      withWeeklyPoints(next, new Map(topics.map((t) => [t.topicId, [...t.points].reverse()]))),
    ).toEqual(next);
  });
  test("a second reorder preserves the first one's promises before its new boundary", () => {
    const first = reorderTopics({ ...params, order });
    const from = "2026-10-05";
    const remaining = orderInputs(first, topics, from).remaining;
    const next = reorderTopics({
      ...params,
      bands: first,
      from,
      order: remaining.map((t) => t.topicId).reverse(),
    });
    expect(past(next, from)).toEqual(past(first, from));
    expect(
      scheduled(next)
        .map(([id]) => id)
        .sort(),
    ).toEqual(
      scheduled(first)
        .map(([id]) => id)
        .sort(),
    );
  });
  test("missed work retains its original due dates", () => {
    const next = reorderTopics({ ...params, order });
    const args = {
      weekStart: today,
      ledger: {
        assessed: new Set<string>(),
        done: new Set<string>(),
        outstanding: new Set<string>(),
      },
    };
    expect(spineBacklog({ ...args, bands: next })).toEqual(
      spineBacklog({ ...args, bands: baseline }),
    );
  });
  test("weekly selection uses the snapshot, not the whole partially taught topic", () => {
    const next = reorderTopics({ ...params, order });
    for (const [week] of next.flatMap((b) => Object.entries(b.pointsByWeek ?? {}))) {
      const selected = selectWeekPoints({
        bands: next,
        weekStart: week,
        topics: topics.map((t) => ({
          topicId: t.topicId,
          points: t.points.map((p) => ({ id: p.specPointId, mastery: 0, weight: p.weight })),
        })),
      });
      expect(selected.specPointIds.sort()).toEqual(
        scheduled(next)
          .filter(([, w]) => w === week)
          .map(([id]) => id)
          .sort(),
      );
    }
  });
  test("already assessed points do not become new teaching again", () => {
    const next = reorderTopics({ ...params, order });
    const selected = selectWeekPoints({
      bands: next,
      weekStart: today,
      topics: topics.map((t) => ({
        topicId: t.topicId,
        points: t.points.map((p) => ({ id: p.specPointId, mastery: 80, reps: 1 })),
      })),
    });
    expect(selected.teachCount).toBe(0);
  });
  test("moving a topic later does not delay its previous assessed review horizon", () => {
    const next = reorderTopics({ ...params, order });
    const candidate = {
      specPointId: "b0",
      topicId: "b",
      topicTitle: "b",
      code: "b0",
      pointTitle: "b0",
      lastReviewedAt: "2026-09-01T00:00:00Z",
      dueAt: "2026-09-14T00:00:00Z",
      eligibleAt: "2026-09-14T00:00:00Z",
      retention: 0.5,
    };
    const before = projectReviews({
      candidates: [candidate],
      topicOpenings: spineReach(baseline, true),
      currentMonday: weekKeyToDate(today),
      examMonday: weekKeyToDate(examDate),
    });
    const after = projectReviews({
      candidates: [candidate],
      topicOpenings: spineReach(next, true),
      currentMonday: weekKeyToDate(today),
      examMonday: weekKeyToDate(examDate),
    });
    expect(after.bands[0].startWeek <= before.bands[0].startWeek).toBe(true);
    expect(
      admit(
        { specPointId: "b0", topicId: "b", origin: "focus", hasEvidence: true },
        {
          weekStart: after.bands[0].startWeek,
          reach: spineReach(next),
          reviewReach: spineReach(next, true),
          examDate,
        },
      ).ok,
    ).toBe(true);
  });
  test("rejects duplicates, missing topics, foreign topics, past dates and impossible runway", () => {
    for (const invalid of [["b", "b"], [], ["alien", "b"]])
      expect(() => reorderTopics({ ...params, order: invalid })).toThrow();
    expect(() => reorderTopics({ ...params, order, from: "2026-09-07" })).toThrow("Earlier");
    expect(() => reorderTopics({ ...params, order, from: "2026-09-15" })).toThrow("Monday");
    expect(() => reorderTopics({ ...params, order, examDate: "2026-09-21" })).toThrow("not enough");
  });
  test("a future effective date preserves current assignments' teaching weeks", () => {
    const from = "2026-10-05";
    const next = reorderTopics({
      ...params,
      from,
      order: orderInputs(baseline, topics, from)
        .remaining.map((t) => t.topicId)
        .reverse(),
    });
    expect(past(next, from)).toEqual(past(baseline, from));
  });
});
