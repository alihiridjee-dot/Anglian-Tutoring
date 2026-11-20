import { describe, expect, it } from "bun:test";
import { readGraded } from "./mcqDal";

describe("readGraded", () => {
  it("reads the marks, the answers it marked and the attempt it filed", () => {
    const review = readGraded({
      attempt_id: "a1",
      score: 1,
      total: 2,
      results: [
        { question_id: "q1", correct_index: 2, explanation: "Because.", chosen_index: 2 },
        { question_id: "q2", correct_index: 0, explanation: null, chosen_index: null },
      ],
      retake_opens_at: "2026-11-27T10:00:00Z",
    });
    expect(review.attemptId).toBe("a1");
    expect(review.answers).toEqual({ q1: 2 });
    expect(review.marked.score).toBe(1);
    expect(review.marked.total).toBe(2);
    expect(review.marked.byQuestion).toEqual({
      q1: { correctIndex: 2, explanation: "Because." },
      q2: { correctIndex: 0, explanation: null },
    });
    expect(review.marked.retakeOpensAt?.toISOString()).toBe("2026-11-27T10:00:00.000Z");
  });

  it("has no retake date when the server sends none or one it can't read", () => {
    const base = { score: 0, total: 0, results: [] };
    expect(readGraded(base).marked.retakeOpensAt).toBeNull();
    expect(readGraded({ ...base, retake_opens_at: "soon" }).marked.retakeOpensAt).toBeNull();
    expect(readGraded(base).attemptId).toBeNull();
  });

  it("refuses a reply with no score", () => {
    expect(() => readGraded(null)).toThrow("The quiz couldn't be marked");
    expect(() => readGraded({ total: 3, results: [] })).toThrow("The quiz couldn't be marked");
  });
});
