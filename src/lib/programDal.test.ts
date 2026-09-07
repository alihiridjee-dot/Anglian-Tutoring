import { describe, expect, test } from "bun:test";
import { focusInputs, handPicked } from "./programDal";
import type { ProgressPoint, TopicProgress } from "./scheduleDal";

const point = (id: string, values: Partial<ProgressPoint> = {}): ProgressPoint => ({
  id,
  code: id,
  title: id,
  confidence: null,
  homeworkScore: null,
  quizScore: null,
  status: "new",
  mastery: 0,
  stability: null,
  weight: 1,
  card: null,
  dueAt: null,
  eligibleAt: null,
  lastReviewedAt: null,
  reps: 0,
  retention: null,
  ...values,
});
const topic = (points: ProgressPoint[]): TopicProgress => ({
  topicId: "t",
  title: "T",
  points,
  masteryPct: 0,
  settled: false,
  practisedCount: 0,
});
describe("assessment-backed focus inputs", () => {
  test("confidence alone cannot admit a point", () => {
    expect(focusInputs([topic([point("a", { confidence: 10 })])]).candidates).toEqual([]);
  });
  test("strong confidence cannot hide an assessed review", () => {
    const p = point("a", {
      confidence: 100,
      reps: 1,
      dueAt: "2026-09-14T00:00:00Z",
      eligibleAt: "2026-09-14T00:00:00Z",
      lastReviewedAt: "2026-09-01T00:00:00Z",
    });
    const result = focusInputs([topic([p])]);
    expect(result.candidates.map((c) => c.specPointId)).toEqual(["a"]);
    expect(result.candidates[0].dueAt).toBe(p.dueAt!);
  });
});
describe("what survives a re-cut of the week", () => {
  test("a point a person put in by hand is kept, whoever that person was", () => {
    // The bug: only `student` was listed, so a tutor's hand-added point vanished
    // from the week the next time anything re-cut it — a rating on the confidence
    // board silently undoing the tutor's assignment.
    expect(handPicked("student")).toBe(true);
    expect(handPicked("tutor")).toBe(true);
  });

  test("points the programme chose are not pinned by origin", () => {
    // They are replaced by what the programme now says; the in-flight and
    // carried-over rules are what hold anything of theirs in place.
    expect(handPicked("ai")).toBe(false);
    expect(handPicked("core")).toBe(false);
    expect(handPicked("focus")).toBe(false);
    expect(handPicked("carried_over")).toBe(false);
  });
});
