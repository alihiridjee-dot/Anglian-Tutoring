import { describe, test, expect } from "bun:test";
import {
  computePacing,
  diffPacing,
  selectWeekPoints,
  withWeeklyPoints,
  projectReviews,
  type PacingBand,
} from "./pacing";
import {
  customSchedule,
  orderInputs,
  reorderTopics,
  resumeAfterPause,
  type OrderTopic,
} from "./topicOrder";
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

describe("resuming after a pause", () => {
  // Stopped in the week of 21 Sept, back in the week of 5 Oct: two weeks lost.
  const pausedFrom = "2026-09-21";
  const resumeFrom = "2026-10-05";
  const resume = (bands = baseline) =>
    resumeAfterPause({ bands, topics, pausedFrom, resumeFrom, examDate });
  const none = {
    assessed: new Set<string>(),
    done: new Set<string>(),
    outstanding: new Set<string>(),
  };
  const ids = (rows: string[][]) => rows.map(([id]) => id).sort();

  test("keeps every promise before the pause and teaches nothing while it lasted", () => {
    const next = resume();
    expect(past(next, pausedFrom)).toEqual(past(baseline, pausedFrom));
    expect(scheduled(next).filter(([, w]) => w >= pausedFrom && w < resumeFrom)).toEqual([]);
  });
  test("still covers every point exactly once, and finishes before the exam", () => {
    const next = resume();
    expect(ids(scheduled(next))).toEqual(ids(scheduled(baseline)));
    expect(new Set(scheduled(next).map(([id]) => id)).size).toBe(12);
    expect(next.every((b) => b.endWeek < examDate)).toBe(true);
  });
  test("work due while paused is not missed; work missed before the pause still is", () => {
    const paused = scheduled(baseline).filter(([, w]) => w >= pausedFrom && w < resumeFrom);
    expect(paused.length).toBeGreaterThan(0);
    const missed = (bands: PacingBand[]) =>
      spineBacklog({ weekStart: resumeFrom, ledger: none, bands })
        .map((p) => p.specPointId)
        .sort();
    expect(missed(baseline)).toEqual(ids(scheduled(baseline).filter(([, w]) => w < resumeFrom)));
    expect(missed(resume())).toEqual(ids(scheduled(baseline).filter(([, w]) => w < pausedFrom)));
  });
  test("picks up the same topics in the same order", () => {
    const next = resume();
    expect(next.filter((b) => b.startWeek >= resumeFrom).map((b) => b.topicId)).toEqual(
      orderInputs(baseline, topics, pausedFrom).remaining.map((t) => t.topicId),
    );
  });
  test("is kept as stored: a custom schedule from the week of return", () => {
    expect(customSchedule(resume())).toEqual({ version: 1, from: resumeFrom, examDate });
  });
  test("a pause inside one week changes nothing", () => {
    expect(
      resumeAfterPause({ bands: baseline, topics, pausedFrom, resumeFrom: pausedFrom, examDate }),
    ).toBe(baseline);
  });
  test("a second pause builds on the first", () => {
    const first = resume();
    const next = resumeAfterPause({
      bands: first,
      topics,
      pausedFrom: "2026-10-12",
      resumeFrom: "2026-10-19",
      examDate,
    });
    expect(past(next, "2026-10-12")).toEqual(past(first, "2026-10-12"));
    expect(scheduled(next).filter(([, w]) => w === "2026-10-12")).toEqual([]);
    expect(ids(scheduled(next))).toEqual(ids(scheduled(baseline)));
  });
  test("refuses, changing nothing, when too few weeks are left for the topics", () => {
    expect(() =>
      resumeAfterPause({ bands: baseline, topics, pausedFrom, resumeFrom: "2026-11-02", examDate }),
    ).toThrow(/not enough weeks/);
  });
});

describe("review horizon after a reorder", () => {
  test("a topic that had not opened yet takes its new start as its review horizon", () => {
    const next = reorderTopics({ ...params, order });
    const unreached = baseline.filter((b) => b.startWeek > today).map((b) => b.topicId);
    expect(unreached.length).toBeGreaterThan(0);
    for (const id of unreached) {
      const moved = next.find((b) => b.topicId === id && b.startWeek >= today)!;
      expect(moved.reviewStartWeek).toBe(moved.startWeek);
      // Its old week may no longer be used to admit a review of it.
      const old = baseline.find((b) => b.topicId === id)!;
      if (old.startWeek < moved.startWeek)
        expect(
          admit(
            { specPointId: `${id}0`, topicId: id, origin: "focus", hasEvidence: true },
            {
              reach: spineReach(next),
              reviewReach: spineReach(next, true),
              weekStart: old.startWeek,
            },
          ).ok,
        ).toBe(false);
    }
  });
  test("a topic already underway keeps the horizon it had", () => {
    const next = reorderTopics({ ...params, order });
    const reached = baseline.filter((b) => b.startWeek <= today).map((b) => b.topicId);
    for (const id of reached) {
      const old = baseline.find((b) => b.topicId === id)!;
      for (const band of next.filter((b) => b.topicId === id))
        expect(band.reviewStartWeek ?? band.startWeek).toBe(old.startWeek);
    }
  });

  // An order as the old code saved it: on 7 Sept, b (due 14 Sept) was moved,
  // untaught, to 12 Oct, and kept 14 Sept as its review horizon.
  const early = "2026-09-07";
  const older = reorderTopics({
    ...params,
    from: early,
    today: early,
    order: orderInputs(baseline, topics, early)
      .remaining.map((t) => t.topicId)
      .reverse(),
  }).map((b) => (b.topicId === "b" ? { ...b, reviewStartWeek: "2026-09-14" } : b));

  test("an older saved order drops an early horizon from a topic not yet taught", () => {
    // Re-ordered on 21 Sept: 14 Sept has gone by, but b's teaching has not begun.
    const later = "2026-09-21";
    const next = reorderTopics({
      ...params,
      bands: older,
      from: later,
      today: later,
      order: orderInputs(older, topics, later).remaining.map((t) => t.topicId),
    });
    const b = next.find((band) => band.topicId === "b")!;
    expect(b.startWeek > later).toBe(true);
    expect(b.reviewStartWeek).toBe(b.startWeek);
    expect(
      admit(
        { specPointId: "b0", topicId: "b", origin: "focus", hasEvidence: true },
        { reach: spineReach(next), reviewReach: spineReach(next, true), weekStart: later },
      ).ok,
    ).toBe(false);
  });
  test("a pause on an older saved order drops it too", () => {
    const next = resumeAfterPause({
      bands: older,
      topics,
      pausedFrom: "2026-09-21",
      resumeFrom: "2026-09-28",
      examDate,
    });
    const b = next.find((band) => band.topicId === "b")!;
    expect(b.reviewStartWeek).toBe(b.startWeek);
  });
});
