import { describe, expect, it } from "bun:test";
import {
  MIN_WORK_FOR_PREDICTION,
  gradeFill,
  gradesToGo,
  hasPrediction,
  summariseAnalytics,
} from "./analytics";

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

// The scales `gradeOptions` returns, best first.
const GCSE = ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
const A_LEVEL = ["A*", "A", "B", "C", "D", "E", "U"];

describe("gradeFill", () => {
  it("fills the ring by how far up the scale a grade sits", () => {
    expect(gradeFill("9", GCSE)).toBe(100);
    expect(gradeFill("U", GCSE)).toBe(0);
    expect(gradeFill("6", GCSE)).toBeCloseTo((6 / 9) * 100);
    expect(gradeFill("A*", A_LEVEL)).toBe(100);
    expect(gradeFill("C", A_LEVEL)).toBe(50);
  });

  it("draws nothing for a missing grade or one from another scale", () => {
    expect(gradeFill(null, GCSE)).toBe(0);
    expect(gradeFill("", GCSE)).toBe(0);
    expect(gradeFill("A*", GCSE)).toBe(0);
  });
});

describe("gradesToGo", () => {
  it("counts the grades still to climb, and zero or less once there", () => {
    expect(gradesToGo("5", "7", GCSE)).toBe(2);
    expect(gradesToGo("7", "7", GCSE)).toBe(0);
    expect(gradesToGo("8", "7", GCSE)).toBe(-1);
    expect(gradesToGo("B", "A*", A_LEVEL)).toBe(2);
  });

  it("compares nothing when either grade is missing or off the scale", () => {
    expect(gradesToGo(null, "7", GCSE)).toBeNull();
    expect(gradesToGo("5", null, GCSE)).toBeNull();
    expect(gradesToGo("5", "A", GCSE)).toBeNull();
  });
});
