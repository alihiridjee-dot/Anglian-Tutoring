import { expect, test } from "bun:test";
import { buildRoadmap, type RoadmapInputs } from "./roadmap";
import { type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { isTeachBand } from "./pacing";
import { selectWeek } from "./weekCut";
import { weekKeyToDate } from "./week";

/**
 * Audit finding H1 (18 Nov 2026): a change to the course itself (topic order,
 * weights, the point list) must not re-deal weeks already gone. Recomputing a
 * curriculum-order spine from the programme start moved topics into weeks the
 * student had already lived through, and the work those weeks really set
 * became "missed".
 */

const START = "2026-11-09";
const NEXT_WEEK = "2026-11-16";
const EXAM = "2028-06-05";

const point = (id: string): ProgressPoint => ({
  id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
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
  assessability: "unassessable",
});

const topic = (topicId: string, count: number): TopicProgress => ({
  topicId,
  title: `Topic ${topicId}`,
  points: Array.from({ length: count }, (_, i) => point(`${topicId}${i + 1}`)),
  masteryPct: 0,
  settled: false,
  practisedCount: 0,
  assessment: {
    total: count,
    assessable: 0,
    assessed: 0,
    state: "unassessable",
  } as TopicProgress["assessment"],
});

const before = [topic("S", 37), topic("A", 30), topic("B", 30), topic("C", 30)];
// The course changes: S moves to the end and keeps only its first 15 points.
const after = [
  topic("A", 30),
  topic("B", 30),
  topic("C", 30),
  { ...topic("S", 37), points: topic("S", 37).points.slice(0, 15) },
];

const inputs = (over: Partial<RoadmapInputs>): RoadmapInputs => ({
  progress: before,
  baseline: null,
  savedWeek: null,
  catchUpWeek: null,
  ledger: { done: new Set(), outstanding: new Set() },
  thisMonday: weekKeyToDate(START),
  firstWeek: weekKeyToDate(START),
  examMonday: weekKeyToDate(EXAM),
  ...over,
});

const seeded = buildRoadmap(inputs({}));
const stored = seeded.baselineBands;
const weekOne = selectWeek(seeded, START).specPointIds;
const baseline = { program_start: START, exam_date: EXAM, pacing: stored };

test("week one taught S, so the seeded spine is the one the drift is measured against", () => {
  expect(weekOne.length).toBeGreaterThan(0);
  expect(weekOne.every((id) => id.startsWith("S"))).toBe(true);
});

test("a course change after week one keeps week one as it was and re-spreads from this Monday", () => {
  const ledger = { done: new Set(weekOne), outstanding: new Set<string>() };
  const drifted = buildRoadmap(
    inputs({ progress: after, baseline, ledger, thisMonday: weekKeyToDate(NEXT_WEEK) }),
  );
  expect(drifted.needsAck).toBe(true);
  const teach = drifted.bands.filter(isTeachBand);
  expect(teach[0].topicId).toBe("S");
  expect(teach[0].startWeek).toBe(START);
  expect(teach.slice(1).every((b) => b.startWeek >= NEXT_WEEK)).toBe(true);
  expect(teach.every((b) => b.schedule?.from === NEXT_WEEK)).toBe(true);
  const order = [...new Set(teach.map((b) => b.topicId))];
  expect(order).toEqual(["S", "A", "B", "C"]);

  // Accepting the change: nothing is owed and every point has a week.
  const accepted = buildRoadmap(
    inputs({
      progress: after,
      baseline: { ...baseline, pacing: teach },
      ledger,
      thisMonday: weekKeyToDate(NEXT_WEEK),
    }),
  );
  expect(accepted.needsAck).toBe(false);
  expect(accepted.backlog).toEqual([]);
  expect(accepted.unscheduledTopicTitles).toEqual([]);
});

test("a course change before any week has passed is the recomputed spine", () => {
  const fresh = buildRoadmap(inputs({ progress: after, baseline }));
  const teach = fresh.bands.filter(isTeachBand);
  expect(teach.map((b) => b.topicId)).toEqual(["A", "B", "C", "S"]);
  expect(teach.every((b) => b.schedule === undefined)).toBe(true);
});
