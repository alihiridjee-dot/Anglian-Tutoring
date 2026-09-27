import { describe, expect, it } from "bun:test";
import { MIN_WORK_FOR_PREDICTION, hasPrediction, summariseAnalytics } from "./analytics";

const quiz = (pct: number) => ({ subject: "chemistry", pct });

describe("hasPrediction", () => {
  it("withholds a grade until the subject has enough scored work", () => {
    const [one] = summariseAnalytics(["chemistry"], [quiz(0)], []);
    expect(one.predictedGrade).toBe(1);
    expect(hasPrediction(one)).toBe(false);

    const enough = Array.from({ length: MIN_WORK_FOR_PREDICTION }, () => quiz(85));
    const [row] = summariseAnalytics(["chemistry"], enough, []);
    expect(hasPrediction(row)).toBe(true);
    expect(row.predictedGrade).toBe(8);
  });

  it("counts quizzes and marked homework together", () => {
    const [row] = summariseAnalytics(
      ["chemistry"],
      [quiz(70), quiz(70)],
      [{ subject: "chemistry", pct: 70 }],
    );
    expect(row.mcqAttempts + row.hwGraded).toBe(MIN_WORK_FOR_PREDICTION);
    expect(hasPrediction(row)).toBe(true);
  });

  it("never predicts from no work at all", () => {
    const [row] = summariseAnalytics(["physics"], [], []);
    expect(hasPrediction(row)).toBe(false);
  });
});
