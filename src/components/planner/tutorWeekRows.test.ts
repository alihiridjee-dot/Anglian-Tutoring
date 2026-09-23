import { describe, expect, test } from "bun:test";
import { assignmentWarnings, laneSections, showsProjection, tutorWeekRows } from "./tutorWeekRows";
import type { PlanPoint } from "@/lib/planner/weeklyPlanDal";
import type { RoadmapResult } from "@/lib/planner/roadmap";
import type { PlanOverride } from "@/lib/planner/overrides";

const roadmap = {
  progress: [
    {
      topicId: "t1",
      title: "Cells",
      points: [
        { id: "a1", code: "1.1", title: "Cell structure", homeworkScore: 85, quizScore: null },
        { id: "a2", code: "1.2", title: "Microscopy", homeworkScore: null, quizScore: 40 },
        { id: "a3", code: "1.3", title: "Cell division", homeworkScore: null, quizScore: null },
      ],
    },
    {
      topicId: "t2",
      title: "Organisation",
      points: [{ id: "b1", code: "2.1", title: "Tissues", homeworkScore: null, quizScore: null }],
    },
  ],
  completedPointIds: ["a3"],
  backlog: [{ specPointId: "a3", plannedWeek: "2026-09-07" }],
  catchUpSchedule: { weeks: { "2026-09-21": [{ specPointId: "a3" }] }, assignedIds: [], held: [] },
} as unknown as RoadmapResult;

const saved = (
  id: string,
  origin: PlanPoint["origin"],
  extra: Partial<PlanPoint> = {},
): PlanPoint => ({
  spec_point_id: id,
  code: id,
  title: `Saved ${id}`,
  description: null,
  topic_id: id.startsWith("a") ? "t1" : "t2",
  topic_title: id.startsWith("a") ? "Cells" : "Organisation",
  origin,
  carried_from: null,
  done_at: null,
  ...extra,
});

const override = (
  specPointId: string,
  kind: PlanOverride["kind"],
  weekStart: string | null = null,
) =>
  ({
    id: `${kind}:${specPointId}`,
    specPointId,
    kind,
    weekStart,
    note: null,
    createdBy: null,
    createdAt: "2026-09-22T00:00:00Z",
  }) satisfies PlanOverride;

describe("showsProjection", () => {
  test("a past week never shows what was not set", () => {
    expect(
      showsProjection({ weekStart: "2026-09-14", currentWeek: "2026-09-21", plan: null }),
    ).toBe(false);
  });
  test("an uncut current or future week does", () => {
    expect(
      showsProjection({ weekStart: "2026-09-21", currentWeek: "2026-09-21", plan: null }),
    ).toBe(true);
    expect(
      showsProjection({
        weekStart: "2026-09-28",
        currentWeek: "2026-09-21",
        plan: { source: "tutor" },
      }),
    ).toBe(true);
  });
  test("a week the programme has cut does not", () => {
    expect(
      showsProjection({
        weekStart: "2026-09-21",
        currentWeek: "2026-09-21",
        plan: { source: "ai" },
      }),
    ).toBe(false);
  });
});

describe("tutorWeekRows", () => {
  test("saved rows win, projected rows fill in, overridden projections are left out", () => {
    const rows = tutorWeekRows({
      saved: [saved("a1", "tutor"), saved("b1", "core", { carried_from: "2026-09-14" })],
      projection: {
        specPointIds: ["a1", "a2", "a3", "zz"],
        origins: { a1: "core", a2: "core", a3: "focus", zz: "core" },
        rationale: "",
      },
      roadmap,
      overrides: [override("a2", "remove", "2026-09-21"), override("a3", "remove", "2026-09-28")],
      weekStart: "2026-09-21",
    });
    expect(rows.map((r) => [r.specPointId, r.state, r.pinned])).toEqual([
      ["a1", "saved", true],
      ["a3", "projected", false],
      ["b1", "saved", false],
    ]);
    // The saved row keeps its own title and origin over the projection's.
    expect(rows[0].title).toBe("Saved a1");
    expect(rows[0].origin).toBe("tutor");
    expect(rows[1].origin).toBe("focus");
    expect(rows[2].carriedFrom).toBe("2026-09-14");
  });

  test("rows follow curriculum order across saved and projected points", () => {
    const rows = tutorWeekRows({
      saved: [saved("a3", "core")],
      projection: { specPointIds: ["a1"], origins: { a1: "core" }, rationale: "" },
      roadmap,
      overrides: [],
      weekStart: "2026-09-21",
    });
    expect(rows.map((r) => r.specPointId)).toEqual(["a1", "a3"]);
  });

  test("each row is filed under the reason it is in the week", () => {
    const rows = tutorWeekRows({
      saved: [
        saved("a1", "tutor"),
        saved("a2", "student"),
        saved("a3", "core"), // promised in an earlier week: catch-up
        saved("b1", "focus"),
      ],
      projection: null,
      roadmap,
      overrides: [],
      weekStart: "2026-09-21",
    });
    expect(rows.map((r) => [r.specPointId, r.lane])).toEqual([
      ["a1", "pinned"],
      ["a2", "student"],
      ["a3", "catchup"],
      ["b1", "revision"],
    ]);
    // The same core point in its own week is the course, not catch-up.
    expect(
      tutorWeekRows({
        saved: [saved("a3", "core")],
        projection: null,
        roadmap,
        overrides: [],
        weekStart: "2026-09-07",
      })[0].lane,
    ).toBe("course");
  });

  test("laneSections keeps lane order, groups by topic, and drops empty lanes", () => {
    const lanes = laneSections(
      tutorWeekRows({
        saved: [saved("b1", "focus"), saved("a1", "core"), saved("a2", "tutor")],
        projection: null,
        roadmap,
        overrides: [],
        weekStart: "2026-09-21",
      }),
    );
    expect(lanes.map((l) => [l.key, l.count])).toEqual([
      ["course", 1],
      ["revision", 1],
      ["pinned", 1],
    ]);
    expect(lanes[0].groups.map((g) => g.title)).toEqual(["Cells"]);
    expect(lanes[1].groups[0].rows[0].specPointId).toBe("b1");
  });
});

describe("assignmentWarnings", () => {
  test("names what the student has covered, done, the tutor skipped, or the week holds", () => {
    const warnings = assignmentWarnings({
      specPointIds: ["a1", "a2", "a3", "b1"],
      roadmap,
      saved: [saved("b1", "core")],
      overrides: [override("a2", "skip")],
    });
    expect(warnings.map((w) => [w.specPointId, w.reason, w.bestScore])).toEqual([
      ["a1", "covered", 85],
      ["a2", "skipped", null],
      ["a3", "done", null],
      ["b1", "in-week", null],
    ]);
  });

  test("a shaky point raises nothing: assigning it is the ordinary case", () => {
    expect(
      assignmentWarnings({
        specPointIds: ["a2"],
        roadmap,
        saved: [],
        overrides: [],
      }),
    ).toEqual([]);
  });
});
