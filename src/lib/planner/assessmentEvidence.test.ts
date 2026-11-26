import { describe, expect, test } from "bun:test";
import { assessmentPointScores, foldReviews, type ReviewEvent } from "@/lib/planner/scheduleDal";
import { Rating, scoreToRating } from "./scheduler";

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
  // A student on Reduced is set six of a shared quiz's eight questions
  // (src/lib/practice/questionLoad.ts). The server files the attempt out of
  // six and freezes the point's score over those six, so the planner reads
  // 4 right as 67%, not as 4 of 8.
  test("an attempt on a cut quiz is read out of the questions it was set", () => {
    const frozen = assessmentPointScores({ a: (100 * 4) / 6 }, new Set(["a"]), 4, 6).get("a")!;
    expect(Math.round(frozen)).toBe(67);
    expect(scoreToRating(frozen)).toBe(Rating.Hard);
    // With no snapshot it is the attempt's own total, never the stored count.
    const fallback = assessmentPointScores(null, new Set(["a"]), 5, 6).get("a")!;
    expect(Math.round(fallback)).toBe(83);
    expect(scoreToRating(fallback)).toBe(Rating.Good);
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
