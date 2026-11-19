import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { ProgressPoint } from "@/lib/planner/scheduleDal";
import { PointRow } from "./PointRow";

const point = (over: Partial<ProgressPoint>): ProgressPoint => ({
  id: "p1",
  code: "1.1",
  title: "Cells",
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
  assessability: "assessed",
  ...over,
});

test("a point's task and quiz marks are kit chips coloured by a tint", () => {
  const html = renderToString(
    <ul>
      <PointRow point={point({ status: "due", homeworkScore: 55, quizScore: 80 })} />
    </ul>,
  );
  expect(html).toContain('title="Task: best 55%"><span class="chip tint-amber');
  expect(html).toContain('title="Quiz: best 80%"><span class="chip tint-emerald');
});
