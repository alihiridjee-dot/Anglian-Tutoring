import { expect, test } from "bun:test";
import { ScheduleDAL } from "./scheduleDal";
import type { CourseSnapshot } from "./readModels";

const course = { studentId: "student", subject: "biology", board: "aqa", level: "gcse" } as const;

// Day 0 is 1 Oct. The task is handed in on day 0 and marked on day 3.
const HANDED_IN = "2026-10-01T09:00:00.000Z";
const MARKED = "2026-10-04T10:00:00.000Z";

const snapshot = (attempts: CourseSnapshot["attempts"] = []): CourseSnapshot => ({
  topics: [{ id: "t1", title: "Topic t1", sort_order: 1 }],
  points: [{ id: "p1", code: "P1", title: "Point p1", sort_order: 1, topic_id: "t1", weight: 1 }],
  sources: {
    resourceLinks: [{ resource_id: "r1", spec_point_id: "p1" }],
    setLinks: [],
    setScope: [],
  },
  submissions: [
    { id: "s1", resource_id: "r1", score_pct: 40, graded_at: MARKED, submitted_at: HANDED_IN },
  ],
  attempts,
});

const p1 = async (snap: CourseSnapshot) => {
  const [topic] = await ScheduleDAL.progressFrom({
    ...course,
    snapshot: snap,
    pauses: [],
    breaks: [],
    now: new Date("2026-10-10T10:00:00Z"),
  });
  return topic.points[0];
};

test("a task's review is dated when it was handed in, not when it was marked", async () => {
  expect((await p1(snapshot())).lastReviewedAt).toBe(HANDED_IN);
});

test("a quiz taken between hand-in and marking is replayed after the task", async () => {
  // Day 1: a quiz on the same point. The task came first, so the quiz is the last review.
  const quizAt = "2026-10-02T12:00:00.000Z";
  const point = await p1(
    snapshot([
      { id: "a1", set_id: "q1", score: 9, total: 10, created_at: quizAt, point_scores: { p1: 90 } },
    ]),
  );
  expect(point.lastReviewedAt).toBe(quizAt);
  expect(point.reps).toBe(2);
});
