import { expect, test } from "bun:test";
import { buildRoadmap, type RoadmapInputs, type RoadmapResult } from "./roadmap";
import { type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { isTeachBand } from "./pacing";
import { selectWeek } from "./weekCut";
import { addWeeks, toDateKey, weekKeyToDate } from "./week";
import { reorderTopics } from "./topicOrder";

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

/**
 * Audit finding M1 (18 Nov 2026): a custom calendar stores the points each
 * week sets, so a point added to the course after it was cut was in no week.
 * It was never taught or chased, and only showed as an unscheduled topic.
 */
const course = [topic("A", 6), topic("B", 6), topic("C", 6), topic("D", 6)];
const orderTopics = (progress: TopicProgress[]) =>
  progress.map((t) => ({
    topicId: t.topicId,
    title: t.title,
    points: t.points.map((p) => ({
      specPointId: p.id,
      code: p.code,
      title: p.title,
      weight: p.weight,
    })),
  }));
const customSpine = reorderTopics({
  bands: buildRoadmap(inputs({ progress: course })).baselineBands,
  topics: orderTopics(course),
  order: ["B", "A", "C", "D"],
  from: START,
  examDate: EXAM,
  today: START,
});
const customBaseline = { program_start: START, exam_date: EXAM, pacing: customSpine };
// Topic A gains a seventh point after the calendar was cut.
const grown = course.map((t) =>
  t.topicId === "A" ? { ...t, points: [...t.points, point("A7")] } : t,
);
const weekOf = (bands: RoadmapResult["bands"], id: string) =>
  bands
    .filter(isTeachBand)
    .flatMap((b) => Object.entries(b.pointsByWeek ?? {}))
    .find(([, points]) => points.some((p) => p.specPointId === id))?.[0];
const weeksBefore = (bands: RoadmapResult["bands"], week: string) =>
  JSON.stringify(
    bands
      .filter(isTeachBand)
      .flatMap((b) => Object.entries(b.pointsByWeek ?? {}))
      .filter(([w]) => w < week)
      .sort(),
  );

test("a custom calendar that holds every point of the course stays as it was cut", () => {
  const kept = buildRoadmap(
    inputs({ progress: course, baseline: customBaseline, thisMonday: weekKeyToDate(NEXT_WEEK) }),
  );
  expect(kept.needsAck).toBe(false);
  expect(kept.unscheduledTopicTitles).toEqual([]);
});

test("a point added to a custom calendar's course gets a week from this Monday on", () => {
  const replanned = buildRoadmap(
    inputs({ progress: grown, baseline: customBaseline, thisMonday: weekKeyToDate(NEXT_WEEK) }),
  );
  expect(replanned.needsAck).toBe(true);
  expect(weekOf(replanned.bands, "A7")! >= NEXT_WEEK).toBe(true);
  // The custom order and the weeks already gone are kept.
  const teach = replanned.bands.filter(isTeachBand);
  expect([...new Set(teach.map((b) => b.topicId))]).toEqual(["B", "A", "C", "D"]);
  expect(weeksBefore(replanned.bands, NEXT_WEEK)).toBe(weeksBefore(customSpine, NEXT_WEEK));
  expect(teach.every((b) => b.schedule?.from === NEXT_WEEK)).toBe(true);

  // Saved: every point has a week, and nothing is re-planned again.
  const accepted = buildRoadmap(
    inputs({
      progress: grown,
      baseline: { ...customBaseline, pacing: teach },
      thisMonday: weekKeyToDate(NEXT_WEEK),
    }),
  );
  expect(accepted.needsAck).toBe(false);
  expect(accepted.unscheduledTopicTitles).toEqual([]);
});

test("a point added to a topic a custom calendar has finished still gets a later week", () => {
  const bEnds = customSpine.filter((b) => b.topicId === "B").at(-1)!.endWeek;
  const later = toDateKey(addWeeks(weekKeyToDate(bEnds), 1));
  const grownB = course.map((t) =>
    t.topicId === "B" ? { ...t, points: [...t.points, point("B7")] } : t,
  );
  const replanned = buildRoadmap(
    inputs({ progress: grownB, baseline: customBaseline, thisMonday: weekKeyToDate(later) }),
  );
  expect(replanned.needsAck).toBe(true);
  expect(weekOf(replanned.bands, "B7")! >= later).toBe(true);
  expect(weeksBefore(replanned.bands, later)).toBe(weeksBefore(customSpine, later));
});
