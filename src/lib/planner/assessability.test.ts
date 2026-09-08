import { describe, expect, test } from "bun:test";
import {
  assessTopic,
  pointAssessability,
  reflectsStudent,
  TOPIC_ASSESSABILITY_STYLE,
  type PointAssessability,
} from "./assessability";

describe("pointAssessability", () => {
  test("evidence wins over everything", () => {
    expect(pointAssessability({ hasMaterial: true, hasEvidence: true })).toBe("assessed");
    // Evidence can outlive the material that produced it — a deleted quiz does
    // not un-mark the attempt it was marked from.
    expect(pointAssessability({ hasMaterial: false, hasEvidence: true })).toBe("assessed");
  });

  test("separates the student's gap from the library's", () => {
    expect(pointAssessability({ hasMaterial: true, hasEvidence: false })).toBe("awaiting");
    expect(pointAssessability({ hasMaterial: false, hasEvidence: false })).toBe("unassessable");
  });
});

describe("assessTopic", () => {
  const pt = (state: PointAssessability, mastery = 0) => ({ state, mastery });

  test("a topic nobody has written practice for is unassessable, not zero", () => {
    const out = assessTopic([pt("unassessable"), pt("unassessable")]);
    expect(out.state).toBe("unassessable");
    // The whole point: null, so no surface can render it as a low score.
    expect(out.masteryPct).toBeNull();
    expect(out.assessable).toBe(0);
  });

  test("unassessable is not the same as complete", () => {
    expect(assessTopic([pt("unassessable")]).coveragePct).toBe(0);
  });

  test("mastery averages the assessed points only", () => {
    // 80 and 60 are the marks; the three unwritten points must not dilute them.
    const out = assessTopic([
      pt("assessed", 80),
      pt("assessed", 60),
      pt("unassessable"),
      pt("unassessable"),
      pt("unassessable"),
    ]);
    expect(out.masteryPct).toBe(70);
  });

  test("work waiting on the student is its own state", () => {
    const out = assessTopic([pt("awaiting"), pt("awaiting")]);
    expect(out.state).toBe("awaiting");
    expect(out.assessable).toBe(2);
    expect(out.masteryPct).toBeNull();
  });

  test("assessed only when every assessable point is marked", () => {
    expect(assessTopic([pt("assessed", 90), pt("awaiting")]).state).toBe("partial");
    // Unwritten points do not hold a topic back from being fully assessed.
    expect(assessTopic([pt("assessed", 90), pt("unassessable")]).state).toBe("assessed");
  });

  test("coverage counts against the whole topic, mastery against the marked part", () => {
    const out = assessTopic([pt("assessed", 100), pt("awaiting"), pt("unassessable")]);
    expect(out.coveragePct).toBe(33);
    expect(out.masteryPct).toBe(100);
  });

  test("an empty topic reports nothing rather than guessing", () => {
    const out = assessTopic([]);
    expect(out.state).toBe("unassessable");
    expect(out.masteryPct).toBeNull();
    expect(out.coveragePct).toBe(0);
  });
});

describe("reflectsStudent", () => {
  test("only an unassessable topic says nothing about the student", () => {
    expect(reflectsStudent("unassessable")).toBe(false);
    for (const state of ["assessed", "partial", "awaiting"] as const)
      expect(reflectsStudent(state)).toBe(true);
  });
});

describe("TOPIC_ASSESSABILITY_STYLE", () => {
  test("every state carries its own meaning, so no surface re-explains them", () => {
    for (const state of ["assessed", "partial", "awaiting", "unassessable"] as const) {
      expect(TOPIC_ASSESSABILITY_STYLE[state].label.length).toBeGreaterThan(0);
      expect(TOPIC_ASSESSABILITY_STYLE[state].meaning.length).toBeGreaterThan(0);
    }
  });
});
