import { describe, expect, test } from "bun:test";
import { foldReviews, reviewKey, type ReviewEvent } from "@/lib/scheduleDal";
import { applyReview, type Card, type Grade } from "@/lib/planner/scheduler";

/**
 * `syncReviewsFromAttempts` used to make two network round trips per review
 * event, sequentially, on the planner's load path. It now folds the whole replay
 * in memory and writes once. These tests pin the property that made the swap
 * safe: the batched fold must land on the same cards the one-at-a-time version
 * would have, including when part of the history is already in the ledger.
 */

const POINT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const POINT_B = "bbbbbbbb-0000-0000-0000-000000000002";

function event(
  specPointId: string,
  rating: Grade,
  dayOffset: number,
  sourceId: string,
  source: ReviewEvent["source"] = "mcq",
): ReviewEvent {
  return {
    specPointId,
    rating,
    source,
    scorePct: null,
    sourceId,
    reviewedAt: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
  };
}

/** The behaviour being replaced: apply one event at a time, re-reading state. */
function sequential(events: ReviewEvent[], start: Map<string, Card>, seen: ReadonlySet<string>) {
  const cards = new Map(start);
  const ordered = [...events].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
  for (const e of ordered) {
    if (seen.has(reviewKey(e))) continue; // the RPC skips it; the card must not move
    cards.set(
      e.specPointId,
      applyReview(cards.get(e.specPointId) ?? null, e.rating, e.reviewedAt, {
        countsAsLapse: e.source !== "confidence",
      }),
    );
  }
  return cards;
}

function foldedInto(events: ReviewEvent[], start: Map<string, Card>, seen: ReadonlySet<string>) {
  const cards = new Map(start);
  for (const r of foldReviews(events, start, seen)) cards.set(r.specPointId, r.card);
  return cards;
}

describe("foldReviews", () => {
  test("matches the sequential replay for a fresh history", () => {
    const events = [
      event(POINT_A, 3, 0, "m1"),
      event(POINT_A, 1, 5, "m2"),
      event(POINT_B, 4, 2, "m3"),
      event(POINT_A, 4, 9, "m4"),
    ];
    const seen = new Set<string>();
    expect(foldedInto(events, new Map(), seen)).toEqual(sequential(events, new Map(), seen));
  });

  test("replays in time order regardless of input order", () => {
    const ordered = [event(POINT_A, 4, 0, "m1"), event(POINT_A, 1, 3, "m2")];
    const shuffled = [ordered[1], ordered[0]];
    expect(foldedInto(shuffled, new Map(), new Set())).toEqual(
      foldedInto(ordered, new Map(), new Set()),
    );
  });

  test("a strong-then-weak run lapses the card, a reordered one would not", () => {
    const strongThenWeak = [event(POINT_A, 4, 0, "m1"), event(POINT_A, 1, 6, "m2")];
    const weakThenStrong = [event(POINT_A, 1, 0, "m1"), event(POINT_A, 4, 6, "m2")];
    const a = foldedInto(strongThenWeak, new Map(), new Set()).get(POINT_A)!;
    const b = foldedInto(weakThenStrong, new Map(), new Set()).get(POINT_A)!;
    // Order genuinely matters here — if it didn't, the sort would be untested.
    expect(a.stability).not.toEqual(b.stability);
  });

  test("skips events already in the ledger instead of double-counting them", () => {
    const events = [
      event(POINT_A, 4, 0, "m1"),
      event(POINT_A, 3, 4, "m2"),
      event(POINT_A, 2, 8, "m3"),
    ];
    // m1 and m2 have already been applied; the stored card reflects them.
    const seen = new Set([reviewKey(events[0]), reviewKey(events[1])]);
    const stored = new Map<string, Card>();
    for (const r of foldReviews(events.slice(0, 2), new Map(), new Set())) {
      stored.set(r.specPointId, r.card);
    }

    const rows = foldReviews(events, stored, seen);
    expect(rows).toHaveLength(1);
    expect(rows[0].event.sourceId).toBe("m3");
    expect(foldedInto(events, stored, seen)).toEqual(sequential(events, stored, seen));
  });

  test("a fully-replayed history produces no writes", () => {
    const events = [event(POINT_A, 4, 0, "m1"), event(POINT_B, 2, 1, "m2")];
    const seen = new Set(events.map(reviewKey));
    expect(foldReviews(events, new Map(), seen)).toEqual([]);
  });

  test("confidence events never lapse the card, unlike marks", () => {
    const asConfidence = [
      event(POINT_A, 4, 0, "c0", "confidence"),
      { ...event(POINT_A, 1, 5, ""), source: "confidence" as const, sourceId: null },
    ];
    const asMarks = [event(POINT_A, 4, 0, "m1"), event(POINT_A, 1, 5, "m2")];
    const conf = foldedInto(asConfidence, new Map(), new Set()).get(POINT_A)!;
    const mark = foldedInto(asMarks, new Map(), new Set()).get(POINT_A)!;
    expect(conf.lapses).toBe(0);
    expect(mark.lapses).toBeGreaterThan(0);
  });

  test("interleaved points keep independent card lineages", () => {
    const events = [
      event(POINT_A, 1, 0, "m1"),
      event(POINT_B, 4, 1, "m2"),
      event(POINT_A, 1, 2, "m3"),
    ];
    const cards = foldedInto(events, new Map(), new Set());
    expect(cards.get(POINT_A)!.lapses).toBeGreaterThan(cards.get(POINT_B)!.lapses);
  });
});
