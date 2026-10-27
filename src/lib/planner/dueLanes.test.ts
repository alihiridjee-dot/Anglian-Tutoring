import { describe, expect, test } from "bun:test";
import { dueSlots, type DueLane } from "@/lib/planner/dueLanes";
import { noWork, type PointWork } from "@/lib/planner/coverage";
import type { PlanPoint } from "@/lib/planner/weeklyPlanDal";

function point(id: string): PlanPoint {
  return {
    spec_point_id: id,
    code: id,
    title: id,
    description: null,
    topic_id: "t1",
    topic_title: "Topic",
    origin: "core",
    carried_from: null,
    done_at: null,
  };
}

const item = (id: string) => ({ id, title: id });

function lanes(over: Partial<Record<DueLane, PlanPoint[]>>): Record<DueLane, PlanPoint[]> {
  return { new: [], returning: [], revision: [], tutor: [], yours: [], ...over };
}

describe("dueSlots", () => {
  test("files each task and quiz under its point's lane, in the week's order", () => {
    const work = new Map<string, PointWork>([
      ["p-new", { ...noWork(), homework: [item("hw-new")], quizzes: [item("q-new")] }],
      ["p-back", { ...noWork(), homework: [item("hw-back")], quizzes: [item("q-back")] }],
      ["p-rev", { ...noWork(), quizzes: [item("q-rev")] }],
    ]);
    const { tasks, quizzes } = dueSlots(
      // Given out of the dashboard's order, to show the order is the lanes'.
      lanes({ revision: [point("p-rev")], new: [point("p-new")], returning: [point("p-back")] }),
      work,
    );
    expect(Object.fromEntries(tasks)).toEqual({
      "hw-new": { lane: "new", order: 0 },
      "hw-back": { lane: "returning", order: 1 },
    });
    expect(Object.fromEntries(quizzes)).toEqual({
      "q-new": { lane: "new", order: 0 },
      "q-back": { lane: "returning", order: 1 },
      "q-rev": { lane: "revision", order: 2 },
    });
  });

  test("a sheet on two points takes the earlier lane", () => {
    const shared = { ...noWork(), homework: [item("hw-shared")] };
    const work = new Map<string, PointWork>([
      ["p-rev", shared],
      ["p-new", shared],
    ]);
    const { tasks } = dueSlots(lanes({ new: [point("p-new")], revision: [point("p-rev")] }), work);
    expect(tasks.get("hw-shared")).toEqual({ lane: "new", order: 0 });
  });

  test("a point with no work behind it adds nothing", () => {
    const { tasks, quizzes } = dueSlots(lanes({ new: [point("p-bare")] }), new Map());
    expect(tasks.size + quizzes.size).toBe(0);
  });
});
