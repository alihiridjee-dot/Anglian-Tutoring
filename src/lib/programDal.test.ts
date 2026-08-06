import { describe, expect, test } from "bun:test";
import { focusInputs } from "./programDal";
import {
  bandsForWeek,
  scheduleFocusPoints,
  selectWeekPoints,
  type PacingBand,
} from "./planner/pacing";
import { SETTLED_THRESHOLD } from "./planner/scheduler";
import { type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { addWeeks, mondayOf, toDateKey } from "./week";

const currentMonday = mondayOf(new Date("2026-09-07T00:00:00"));
const examMonday = mondayOf(new Date("2027-06-07T00:00:00"));
const wk = (n: number) => toDateKey(addWeeks(currentMonday, n));

/** One spec point's standing. `mastery` defaults to the confidence rating, which
 *  is what an unpractised point actually scores. */
function point(
  id: string,
  confidence: number | null,
  mastery = confidence ?? 0,
  stability: number | null = null,
): ProgressPoint {
  return {
    id,
    code: id,
    title: `Point ${id}`,
    confidence,
    homeworkScore: null,
    quizScore: null,
    status: "new",
    mastery,
    stability,
    weight: 1,
  };
}

function topic(topicId: string, title: string, points: ProgressPoint[]): TopicProgress {
  const masteryPct = Math.round(points.reduce((s, p) => s + p.mastery, 0) / points.length);
  return {
    topicId,
    title,
    points,
    masteryPct,
    settled: masteryPct >= SETTLED_THRESHOLD,
    practisedCount: 0,
  };
}

describe("focusInputs — what comes back round", () => {
  test("a weak point inside a strong topic is still a candidate", () => {
    // The bug: candidacy was gated on the topic, so a topic averaging 80% had
    // every one of its points discarded — including the one the student had just
    // rated 20. Their clearest signal about themselves was outvoted by a mean.
    const strong = topic("t4", "Natural selection", [
      point("4.1B", 20),
      ...Array.from({ length: 9 }, (_, i) => point(`4.${i + 2}`, 87)),
    ]);
    expect(strong.settled).toBe(true); // the topic really is healthy overall

    const { candidates } = focusInputs([strong]);
    expect(candidates.map((c) => c.specPointId)).toEqual(["4.1B"]);
    expect(candidates[0].mastery).toBe(20); // the rating is the ranking signal
  });

  test("a settled topic still gets its pre-exam review pass", () => {
    const settled = topic("t1", "Key concepts", [point("1.1", 90), point("1.2", 80)]);
    const { candidates, coveredTopics } = focusInputs([settled]);
    expect(coveredTopics).toEqual([{ topicId: "t1", title: "Key concepts" }]);
    expect(candidates).toEqual([]);
  });

  test("unrated points never qualify — first contact is the teach spine's job", () => {
    const untouched = topic("t2", "Cells", [point("2.1", null), point("2.2", null)]);
    expect(focusInputs([untouched]).candidates).toEqual([]);
  });

  test("the settled line is exclusive at the boundary", () => {
    const t = topic("t3", "Genetics", [
      point("3.1", SETTLED_THRESHOLD - 1),
      point("3.2", SETTLED_THRESHOLD),
    ]);
    expect(focusInputs([t]).candidates.map((c) => c.specPointId)).toEqual(["3.1"]);
  });
});

describe("a covered spine week with weak points elsewhere", () => {
  // The reported bug, end to end over the pure pieces: the topic on the spine is
  // fully covered, and a *different* topic holds points the student rated badly.
  // The week used to come out empty, fall through to the fallback planner, and
  // label everything it grabbed as revision.
  const spine = topic("t1", "Key concepts in biology", [point("1.1", 90), point("1.2", 85)]);
  const weakPointsElsewhere = topic("t4", "Natural selection", [
    point("4.1B", 20),
    ...Array.from({ length: 9 }, (_, i) => point(`4.${i + 2}`, 87)),
  ]);
  const progress = [spine, weakPointsElsewhere];

  const teach: PacingBand = {
    topicId: "t1",
    title: "Key concepts in biology",
    startWeek: wk(0),
    endWeek: wk(4),
    weeks: 5,
    kind: "teach",
  };

  const bands = [
    teach,
    ...scheduleFocusPoints({ ...focusInputs(progress), currentMonday, examMonday }),
  ];

  test("the week is not empty, so it never reaches the fallback planner", () => {
    // The branch `planForWeek` takes: bands cover the week, so the programme's
    // answer stands whatever it is.
    expect(bandsForWeek(bands, wk(0)).length).toBeGreaterThan(0);

    const sel = selectWeekPoints({
      bands,
      weekStart: wk(0),
      topics: progress,
      focusBudget: 6,
      settledThreshold: SETTLED_THRESHOLD,
    });
    expect(sel.specPointIds).toContain("4.1B");
  });

  test("nothing from the covered spine topic is ever called revision", () => {
    const sel = selectWeekPoints({
      bands,
      weekStart: wk(0),
      topics: progress,
      focusBudget: 6,
      settledThreshold: SETTLED_THRESHOLD,
    });
    expect(sel.teachCount).toBe(0); // every spine point is already settled
    expect(sel.refreshCount).toBeGreaterThan(0); // so it gets a light pass instead
    // The whole point of the bug: the spine topic is core, whatever kind of week
    // it is. Only what the student actually flagged sits in the revisit lane.
    expect(sel.lanes["1.1"]).toBe("core"); // this week's share, refreshed
    expect(sel.lanes["1.2"]).toBeUndefined(); // next week's share, left where it is
    const focused = Object.entries(sel.lanes)
      .filter(([, lane]) => lane === "focus")
      .map(([id]) => id);
    expect(focused).toEqual(["4.1B"]);
  });

  test("the strong points of the flagged topic are not dragged in with it", () => {
    const sel = selectWeekPoints({
      bands,
      weekStart: wk(0),
      topics: progress,
      focusBudget: 6,
      settledThreshold: SETTLED_THRESHOLD,
    });
    expect(sel.specPointIds).not.toContain("4.2");
  });
});
