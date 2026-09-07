import { describe, expect, test } from "bun:test";
import { assessmentPointScores, foldReviews, type ReviewEvent } from "@/lib/scheduleDal";
import { Rating } from "./scheduler";

describe("assessment evidence", () => {
  test("mixed quiz totals cannot masquerade as individual skill scores", () => {
    expect(assessmentPointScores(null, new Set(["a", "b"]), 8, 10).size).toBe(0);
    expect(assessmentPointScores(null, new Set(["a", "__unattributed__"]), 8, 10).size).toBe(0);
    expect(assessmentPointScores(null, new Set(["a"]), 8, 10).get("a")).toBe(80);
  });
  test("immutable snapshots win over later set-level totals", () => {
    expect([...assessmentPointScores({ a: 20, b: 100 }, new Set(["a", "b"]), 10, 10)]).toEqual([
      ["a", 20],
      ["b", 100],
    ]);
    expect(assessmentPointScores({}, new Set(["a"]), 10, 10).size).toBe(0);
  });
  test("invalid evidence is excluded", () => {
    expect([
      ...assessmentPointScores({ a: -1, b: 101, c: "90", d: 50 }, new Set(), null, null),
    ]).toEqual([["d", 50]]);
  });
  test("duplicate evidence advances a card once", () => {
    const event: ReviewEvent = {
      specPointId: "a",
      rating: Rating.Good,
      source: "mcq",
      sourceId: "attempt",
      scorePct: 80,
      reviewedAt: new Date("2026-01-01"),
    };
    const rows = foldReviews([event, event], new Map(), new Set());
    expect(rows.length).toBe(1);
    expect(rows[0].card.reps).toBe(1);
  });
});
