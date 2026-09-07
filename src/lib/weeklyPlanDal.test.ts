import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { WeeklyPlanDAL } from "./weeklyPlanDal";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import * as session from "./auth/session";
import { ProgramDAL } from "./programDal";
import type { PacingBand } from "./planner/pacing";

const course = { subject: "biology", board: "aqa", level: "gcse" } as const;
const plan = {
  id: "plan",
  student_id: "student",
  ...course,
  week_start: "2026-09-07",
  source: "ai",
  note: null,
  ai_rationale: null,
};
const band: PacingBand = {
  topicId: "t",
  title: "Topic",
  startWeek: "2026-11-02",
  endWeek: "2027-05-31",
  weeks: 30,
};
let tables: Record<string, unknown[]>;
let denied: string | null;
let version: number;
let writes: { name: string; body: Record<string, unknown> }[];
let network: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let viewer: ReturnType<typeof spyOn<typeof session, "getSessionUserId">>;
let evidence: ReturnType<typeof spyOn<typeof ScheduleDAL, "getTopicProgress">>;
const pointRow = (id: string, origin: string, done_at: string | null = null) => ({
  origin,
  done_at,
  carried_from: null,
  spec_points: {
    id,
    code: id,
    title: id,
    description: null,
    topic_id: "t",
    sort_order: 1,
    topics: { title: "Topic", sort_order: 1 },
  },
});
beforeEach(() => {
  denied = null;
  version = 4;
  writes = [];
  viewer = spyOn(session, "getSessionUserId").mockResolvedValue("student");
  tables = {
    student_weekly_plans: [plan],
    student_weekly_plan_points: [
      pointRow("early", "focus", "2026-09-08"),
      pointRow("manual", "tutor"),
    ],
    student_program_plan: [{ pacing: [band], exam_date: "2027-06-07" }],
    student_enrolments: [{ board: "aqa" }],
    profiles: [{ level: "gcse" }],
    spec_points: ["early", "manual"].map((id) => ({ id, topic_id: "t", topics: course })),
  };
  evidence = spyOn(ScheduleDAL, "getTopicProgress").mockResolvedValue([
    { topicId: "t", points: [{ id: "early", reps: 1 }] } as TopicProgress,
  ]);
  network = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const name = url.pathname.split("/").at(-1)!;
    if (name === denied)
      return new Response(JSON.stringify({ message: "permission denied", code: "42501" }), {
        status: 403,
      });
    if (url.pathname.includes("/rpc/")) {
      writes.push({ name, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(
        JSON.stringify(name === "assessment_scheduler_version" ? version : "plan"),
      );
    }
    if (init?.method === "POST") {
      writes.push({ name, body: JSON.parse(String(init.body)) });
      return new Response(null, { status: 201 });
    }
    if (!(name in tables)) throw new Error(`Unexpected read: ${url.pathname}`);
    return new Response(JSON.stringify(tables[name]), {
      headers: { "Content-Type": "application/json" },
    });
  });
});
afterEach(() => {
  network.mockRestore();
  evidence.mockRestore();
  viewer.mockRestore();
});

test("saved reads withhold early reviews but retain completion and allow manual overrides", async () => {
  const saved = await WeeklyPlanDAL.getPlan("student", "biology", plan.week_start);
  expect(saved?.points.map((p) => p.spec_point_id)).toEqual(["manual"]);
  expect(saved?.withheld[0].reason).toBe("ahead-of-spine");
  expect(saved?.withheld[0].point.done_at).toBe("2026-09-08");
  expect(writes).toEqual([]);
});

test("absence of a baseline does not bypass course, orphan or evidence checks", async () => {
  tables.student_program_plan = [];
  tables.student_weekly_plan_points = [
    pointRow("early", "focus"),
    pointRow("manual", "tutor"),
    pointRow("orphan", "core"),
  ];
  tables.spec_points = [
    { id: "early", topic_id: "t", topics: course },
    { id: "manual", topic_id: "other", topics: { ...course, board: "edexcel" } },
    { id: "orphan", topic_id: null, topics: null },
  ];
  evidence.mockResolvedValue([]);
  const saved = await WeeklyPlanDAL.getPlan("student", "biology", plan.week_start);
  expect(saved?.points).toEqual([]);
  expect(saved?.withheld.map((r) => r.reason).sort()).toEqual([
    "no-evidence",
    "off-course",
    "orphaned",
  ]);
});

test("a known profile level is enforced independently of subject enrolment", async () => {
  tables.student_enrolments = [];
  tables.profiles = [{ level: "igcse" }];
  const saved = await WeeklyPlanDAL.getPlan("student", "biology", plan.week_start);
  expect(saved?.points).toEqual([]);
  expect(saved?.withheld.every((p) => p.reason === "off-course")).toBe(true);
});

test("pacing read failures fail closed for reads and writes", async () => {
  denied = "student_program_plan";
  await expect(WeeklyPlanDAL.getPlan("student", "biology", plan.week_start)).rejects.toThrow(
    "permission denied",
  );
  await expect(
    WeeklyPlanDAL.savePlan({
      studentId: "student",
      ...course,
      weekStart: plan.week_start,
      specPointIds: ["manual"],
      origin: "tutor",
      source: "student",
    }),
  ).rejects.toThrow("permission denied");
  expect(writes).toEqual([]);
});

test("both write paths apply the same acknowledged pacing rule as reads", async () => {
  await WeeklyPlanDAL.savePlan({
    studentId: "student",
    ...course,
    weekStart: plan.week_start,
    specPointIds: ["early", "manual"],
    origins: { early: "focus", manual: "tutor" },
    source: "ai",
  });
  expect(writes.find((w) => w.name === "save_weekly_plan")?.body._points).toEqual([
    { spec_point_id: "manual", origin: "tutor", carried_from: null },
  ]);
  writes = [];
  await WeeklyPlanDAL.addPoints("plan", ["early"], "focus");
  expect(writes).toEqual([]);
});

test("old databases cannot erase attempted history through savePlan", async () => {
  version = 3;
  await expect(
    WeeklyPlanDAL.savePlan({
      studentId: "student",
      ...course,
      weekStart: plan.week_start,
      specPointIds: [],
      source: "ai",
    }),
  ).rejects.toThrow("history protection");
  expect(writes.some((w) => w.name === "save_weekly_plan")).toBe(false);
});

test("manual off-course additions throw instead of reporting false success", async () => {
  tables.student_enrolments = [{ board: "edexcel" }];
  await expect(WeeklyPlanDAL.addPoints("plan", ["manual"], "tutor")).rejects.toThrow("course");
  expect(writes).toEqual([]);
});

test("week generation uses acknowledged teaching even when the preview has moved", async () => {
  const selected = await ProgramDAL.planForWeek({
    studentId: "student",
    ...course,
    weekStart: "2026-09-07",
    roadmap: {
      examDate: "2027-06-07",
      baselineBands: [band],
      bands: [{ ...band, startWeek: "2026-09-07" }],
      progress: [
        { topicId: "t", points: [{ id: "early", code: "B1", title: "Point", weight: 1 }] },
      ],
    } as Parameters<typeof ProgramDAL.planForWeek>[0]["roadmap"],
  });
  expect(selected.specPointIds).toEqual([]);
});

test("refresh removes withheld work from the proposal without re-inserting historical rows", async () => {
  const roadmap = spyOn(ProgramDAL, "loadRoadmap").mockResolvedValue(null);
  const coverage = spyOn(WeeklyPlanDAL, "getCoverage").mockResolvedValue(new Map());
  try {
    await ProgramDAL.refreshWeek({
      studentId: "student",
      ...course,
      weekStart: plan.week_start,
      expectedPointIds: ["manual"],
    });
    expect(writes.find((w) => w.name === "save_weekly_plan")?.body._points).toEqual([
      { spec_point_id: "manual", origin: "tutor", carried_from: null },
    ]);
    // SQL, tested separately, retains omitted history without re-running its admission trigger.
    expect(tables.student_weekly_plan_points).toHaveLength(2);
  } finally {
    roadmap.mockRestore();
    coverage.mockRestore();
  }
});
