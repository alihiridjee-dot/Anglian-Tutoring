import { describe, expect, test } from "bun:test";
import { ONBOARDING_STEPS, stepIndex } from "./onboarding";

describe("onboarding progress", () => {
  test("counts only the steps a student sees: Your topics is retired", () => {
    expect(ONBOARDING_STEPS.map((s) => s.label)).toEqual([
      "Exam board",
      "Subjects",
      "How you learn",
      "School & grades",
      "Choose a plan",
    ]);
  });

  test("school is step 4 and the plan step 5 of 5", () => {
    expect(stepIndex("/onboarding/school") + 1).toBe(4);
    expect(stepIndex("/onboarding/plan") + 1).toBe(5);
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });
});
