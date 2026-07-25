import { describe, expect, test } from "bun:test";
import { scheduleFocusPoints, type FocusCandidate, DEFAULT_FOCUS_BUDGET } from "./pacing";
import { mondayOf, toDateKey } from "@/lib/week";

const currentMonday = mondayOf(new Date("2026-09-07T00:00:00"));
const examMonday = mondayOf(new Date("2027-06-07T00:00:00")); // ~39 weeks out

/** N weak points across `topics` topics, all rated `mastery`. */
function makeCandidates(topics: number, pointsEach: number, mastery: number): FocusCandidate[] {
  const out: FocusCandidate[] = [];
  for (let t = 0; t < topics; t++) {
    for (let p = 0; p < pointsEach; p++) {
      out.push({
        specPointId: `t${t}-p${p}`,
        topicId: `t${t}`,
        topicTitle: `Topic ${t}`,
        code: `${t}.${p}`,
        pointTitle: `Point ${t}.${p}`,
        mastery,
      });
    }
  }
  return out;
}

/** Total spec points scheduled in each week (across all topic bands). */
function pointsPerWeek(bands: ReturnType<typeof scheduleFocusPoints>): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bands) {
    if (b.kind !== "revisit") continue;
    m.set(b.startWeek, (m.get(b.startWeek) ?? 0) + (b.points?.length ?? 0));
  }
  return m;
}

describe("scheduleFocusPoints — revision load balancer", () => {
  test("never exceeds the weekly budget, even with a huge backlog", () => {
    // Nine topics rated badly, 8 points each = 72 weak points landing at once.
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(9, 8, 10),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    for (const [, n] of pointsPerWeek(bands)) {
      expect(n).toBeLessThanOrEqual(DEFAULT_FOCUS_BUDGET);
    }
  });

  test("spreads the backlog across multiple weeks instead of flooding week one", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(9, 8, 10),
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    const weeks = pointsPerWeek(bands);
    expect(weeks.size).toBeGreaterThan(5); // cascaded over many weeks, not one
  });

  test("weakest points are scheduled first", () => {
    const candidates: FocusCandidate[] = [
      { specPointId: "weak", topicId: "a", topicTitle: "A", code: "a.1", pointTitle: "weak", mastery: 5 },
      ...makeCandidates(2, DEFAULT_FOCUS_BUDGET, 60), // fill the first week with amber
    ];
    const bands = scheduleFocusPoints({ candidates, coveredTopics: [], currentMonday, examMonday });
    const firstWeek = toDateKey(mondayOf(new Date("2026-09-14T00:00:00")));
    const inFirst = bands
      .filter((b) => b.startWeek === firstWeek)
      .flatMap((b) => b.points ?? [])
      .map((p) => p.specPointId);
    expect(inFirst).toContain("weak"); // the mastery-5 point is never bumped
  });

  test("respects budget with a small backlog and groups points under their topic", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(1, 3, 10), // one topic, 3 weak points
      coveredTopics: [],
      currentMonday,
      examMonday,
    });
    const firstWeek = toDateKey(mondayOf(new Date("2026-09-14T00:00:00")));
    const band = bands.find((b) => b.startWeek === firstWeek && b.topicId === "t0");
    expect(band).toBeDefined();
    expect(band!.points?.length).toBe(3); // all three fit in one week under one topic band
  });

  test("settled topics get a review band, weak ones get revisits", () => {
    const bands = scheduleFocusPoints({
      candidates: makeCandidates(1, 2, 10),
      coveredTopics: [{ topicId: "done", title: "Done topic" }],
      currentMonday,
      examMonday,
    });
    expect(bands.some((b) => b.kind === "review" && b.topicId === "done")).toBe(true);
    expect(bands.some((b) => b.kind === "revisit" && b.topicId === "t0")).toBe(true);
  });
});
