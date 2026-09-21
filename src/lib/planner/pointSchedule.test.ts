import { describe, expect, test } from "bun:test";
import { courseSchedule } from "./pointSchedule";
import type { PacingBand } from "./pacing";
import type { ProgressPoint, TopicProgress } from "@/lib/planner/scheduleDal";

const point = (id: string, assessability = "unassessable") =>
  ({ id, code: id, title: id, weight: 1, assessability }) as unknown as ProgressPoint;

const topic = (topicId: string, points: ProgressPoint[]) =>
  ({ topicId, title: topicId, points }) as unknown as TopicProgress;

const SPINE: PacingBand[] = [
  { topicId: "t1", title: "T1", startWeek: "2026-07-13", endWeek: "2026-07-27", weeks: 3 },
  { topicId: "t2", title: "T2", startWeek: "2026-08-03", endWeek: "2026-08-17", weeks: 3 },
];

const base = {
  bands: SPINE,
  baselineBands: SPINE,
  needsAck: false,
  progress: [
    topic("t1", [point("a", "assessed"), point("b"), point("c")]),
    topic("t2", [point("d"), point("e"), point("f")]),
  ],
  completedPointIds: ["c"],
};

describe("courseSchedule", () => {
  test("covered means assessed or ticked off", () => {
    const { byPoint, byTopic } = courseSchedule(base, "2026-08-10");
    expect(byPoint.get("a")).toEqual({ kind: "covered", week: "2026-07-13" });
    expect(byPoint.get("c")).toEqual({ kind: "covered", week: "2026-07-27" });
    expect(byTopic.get("t1")).toEqual({ covered: 2, total: 3 });
    expect(byTopic.get("t2")).toEqual({ covered: 0, total: 3 });
  });

  test("uncovered points carry their teaching week, split across the run", () => {
    const { byPoint } = courseSchedule(base, "2026-08-10");
    expect(byPoint.get("e")).toEqual({ kind: "planned", week: "2026-08-10" });
    expect(byPoint.get("f")).toEqual({ kind: "planned", week: "2026-08-17" });
    expect(byPoint.get("d")).toEqual({ kind: "missed", week: "2026-08-03" });
  });

  test("a missed point returning in catch-up shows the catch-up week", () => {
    const { byPoint } = courseSchedule(
      {
        ...base,
        catchUpSchedule: {
          weeks: {
            "2026-08-24": [
              {
                specPointId: "b",
                topicId: "t1",
                topicTitle: "T1",
                code: "b",
                title: "b",
                weight: 1,
                plannedWeek: "2026-07-20",
              },
            ],
          },
          assignedIds: [],
          held: [],
        },
      },
      "2026-08-10",
    );
    expect(byPoint.get("b")).toEqual({ kind: "catchUp", week: "2026-08-24" });
  });
});
