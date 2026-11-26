import { describe, expect, test } from "bun:test";
import { ONBOARDING_STEPS, stepIndex } from "./onboarding";

describe("onboarding progress", () => {
  test("counts only the steps a student sees: Your topics is retired", () => {
    expect(ONBOARDING_STEPS.map((s) => s.label)).toEqual([
      "Exam board",
      "Subjects",
      "How you learn",
      "Questions",
      "School & grades",
      "Choose a plan",
    ]);
  });

  test("questions is step 4, school step 5 and the plan step 6 of 6", () => {
    expect(stepIndex("/onboarding/questions") + 1).toBe(4);
    expect(stepIndex("/onboarding/school") + 1).toBe(5);
    expect(stepIndex("/onboarding/plan") + 1).toBe(6);
    expect(ONBOARDING_STEPS).toHaveLength(6);
  });
});
