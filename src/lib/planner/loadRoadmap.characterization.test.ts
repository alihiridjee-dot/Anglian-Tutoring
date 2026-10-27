import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { ProgramDAL } from "./programDal";
import { type ProgressPoint, type TopicProgress } from "./scheduleDal";
import { type PlanPoint, type PlanPointOrigin, type SavedWeek } from "./weeklyPlanDal";
import { SubjectPauseDAL, type PauseRecord } from "./pausesDal";
import { toOverride } from "./planOverridesDal";
import type { StudentBreak } from "./breaks";
import { computePacing, type PacingBand } from "./pacing";
import { reorderTopics } from "./topicOrder";
import { weekKeyToDate } from "./week";
import * as courseState from "./courseState";
import { dbError } from "../platform/errors";
import * as session from "../auth/session";

// The real client is built and `fetch` is stubbed below, so these only have to
// exist: without them the client throws on a machine with no local `.env`.
process.env.SUPABASE_URL ??= "https://database.example";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";

/**
 * Pins what `ProgramDAL.loadRoadmap` does today.
 *
 * Every other test replaces `loadRoadmap` with a stub, so nothing ran the real
 * thing. These are characterisation tests: they do not say the answers are
 * right, only that a change to them is a change someone meant to make. Each one
 * snapshots the roadmap *and* the ordered log of reads and writes, because the
 * order and arguments of the I/O are behaviour too.
 *
 * Since 17 Oct 2026 the course is read in one trip ([[courseState]]), so the
 * log holds that one read where it held seven. The roadmaps did not change.
 */

// A Wednesday, so "this Monday" is 2026-09-21 and the exam year is 2027.
const NOW = new Date("2026-09-23T10:00:00Z");
const THIS_MONDAY = "2026-09-21";
const course = { subject: "biology", board: "aqa", level: "gcse" } as const;

const point = (id: string, values: Partial<ProgressPoint> = {}): ProgressPoint => ({
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
  ...values,
});

/** A point with graded evidence behind it, which is what makes a review candidate. */
const reviewed = (id: string, lastReviewedAt: string, dueAt: string, weight = 1) =>
  point(id, {
    reps: 2,
    weight,
    status: "learning",
    lastReviewedAt,
    eligibleAt: dueAt,
    dueAt,
    retention: 0.8,
    assessability: "assessed",
  });

const topic = (topicId: string, points: ProgressPoint[], settled = false): TopicProgress => ({
  topicId,
  title: `Topic ${topicId}`,
  points,
  masteryPct: 0,
  settled,
  practisedCount: points.filter((p) => p.reps > 0).length,
  // The shape the snapshots were recorded with, before masteryPct and
  // coveragePct existed. loadRoadmap passes it through, so adding them would
  // rewrite every snapshot; cast instead.
  assessment: {
    total: points.length,
    assessable: 0,
    assessed: 0,
    state: "unassessable",
  } as TopicProgress["assessment"],
});

const progress: TopicProgress[] = [
  topic(
    "t1",
    [
      reviewed("a1", "2026-09-01T09:00:00Z", "2026-09-15T09:00:00Z"),
      reviewed("a2", "2026-09-22T09:00:00Z", "2026-10-06T09:00:00Z", 2),
      point("a3"),
    ],
    true,
  ),
  topic("t2", [reviewed("b1", "2026-09-10T09:00:00Z", "2026-09-28T09:00:00Z"), point("b2")]),
  topic("t3", [point("c1", { weight: 3 }), point("c2")]),
];

const pacingInputs = progress.map((t) => ({
  topicId: t.topicId,
  title: t.title,
  weight: t.points.reduce((sum, p) => sum + p.weight, 0) || 1,
}));
const orderTopics = progress.map((t) => ({
  topicId: t.topicId,
  title: t.title,
  points: t.points.map((p) => ({
    specPointId: p.id,
    code: p.code,
    title: p.title,
    weight: p.weight,
  })),
}));

/** The spine exactly as a first visit on `start` would have seeded it. */
const seeded = (start: string, examDate: string): PacingBand[] =>
  computePacing(pacingInputs, weekKeyToDate(start), weekKeyToDate(examDate));

const planPoint = (
  id: string,
  topicId: string,
  origin: PlanPointOrigin,
  done_at: string | null = null,
): PlanPoint => ({
  spec_point_id: id,
  code: id.toUpperCase(),
  title: `Point ${id}`,
  description: null,
  topic_id: topicId,
  topic_title: `Topic ${topicId}`,
  origin,
  carried_from: null,
  done_at,
});

const savedWeek = (points: PlanPoint[], withheld: SavedWeek["withheld"] = []): SavedWeek => ({
  plan: {
    id: "plan",
    ...course,
    week_start: THIS_MONDAY,
    source: "ai",
    note: null,
    ai_rationale: null,
  },
  points,
  withheld,
});

let io: unknown[];
let baseline: Record<string, unknown> | null;
let baselineFails: boolean;
let spies: { mockRestore: () => void }[];

function arrange(world: {
  progress?: TopicProgress[];
  saved?: SavedWeek | null;
  ledger?: { done: string[]; outstanding: string[] };
  viewer?: string;
  /** Rows of `student_plan_overrides`, as the API would return them. */
  overrides?: Record<string, unknown>[];
  /** The subject's recorded stops. */
  pauses?: PauseRecord[];
  /** The database refuses to save the plan picked up after a stop. */
  resumeFails?: boolean;
  /** The student's breaks that stand. */
  breaks?: StudentBreak[];
  /** The exam year the student gave at sign-up. */
  examYear?: number | null;
  /** The database fails to answer the exam-year read. */
  profileFails?: boolean;
}) {
  spies = [
    spyOn(courseState, "readCourseState").mockImplementation(async (args) => {
      io.push(["readCourseState", args]);
      // The one read fails as a whole, whichever part the database refused.
      if (baselineFails) throw dbError({ message: "permission denied", code: "42501" });
      if (world.profileFails) throw dbError({ message: "statement timeout", code: "57014" });
      return stateOf(world);
    }),
    spyOn(SubjectPauseDAL, "resumeProgramme").mockImplementation(async (args) => {
      io.push([
        "resumeProgramme",
        {
          pauseId: args.pauseId,
          pacing: args.pacing?.map((b) => [b.topicId, b.startWeek, b.endWeek]) ?? null,
        },
      ]);
      if (world.resumeFails)
        throw new Error("Only the student or their tutor can pick their plan up after a pause.");
    }),
    spyOn(session, "getSessionUserId").mockImplementation(async () => {
      io.push(["getSessionUserId"]);
      return world.viewer ?? "student";
    }),
    // Cast: Bun's `typeof fetch` also carries `preconnect`, which a mock has no use for.
    spyOn(globalThis, "fetch").mockImplementation((async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const table = url.pathname.split("/").at(-1)!;
      const method = init?.method ?? "GET";
      io.push([
        "db",
        method,
        table,
        method === "GET" ? url.search : JSON.parse(String(init?.body ?? "null")),
      ]);
      // Everything is read with the course's state; only the first view's seed is written here.
      if (table !== "student_program_plan" || method === "GET")
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      return new Response(null, { status: 201 });
    }) as typeof fetch),
  ];
}

/** The world as the course's one read hands it over. Only what loadRoadmap reads is filled. */
function stateOf(world: Parameters<typeof arrange>[0]): courseState.CourseState {
  return {
    course: { studentId: "student", ...course },
    weekStart: THIS_MONDAY,
    progress: world.progress ?? progress,
    // Through JSON, as it arrives from the database.
    baseline: baseline && JSON.parse(JSON.stringify(baseline)),
    examYear: world.examYear ?? null,
    pauses: world.pauses ?? [],
    pause: null,
    breaks: world.breaks ?? [],
    overrides: (world.overrides ?? []).map((r) => toOverride(r as never)),
    ledger: {
      done: new Set(world.ledger?.done ?? []),
      outstanding: new Set(world.ledger?.outstanding ?? []),
    },
    week: world.saved ?? null,
    facts: { pacing: [], examDate: undefined, boards: [], level: null },
  };
}

beforeEach(() => {
  setSystemTime(NOW);
  io = [];
  baseline = null;
  baselineFails = false;
  spies = [];
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  setSystemTime();
});

const load = (extra: { projectOnly?: boolean; state?: courseState.CourseState } = {}) =>
  ProgramDAL.loadRoadmap({ studentId: "student", ...course, ...extra });

test("no curriculum: answers null and reads nothing else", async () => {
  arrange({ progress: [] });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("first view by the student: seeds the baseline", async () => {
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("first view by someone else: answers the same but leaves no mark", async () => {
  arrange({ viewer: "tutor" });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("acknowledged baseline, nothing saved this week", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({ ledger: { done: ["a3"], outstanding: ["b2"] } });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("saved week: owns its reviews, reports withheld points, narrows the backlog", async () => {
  baseline = {
    program_start: "2026-06-01",
    exam_date: "2027-06-07",
    pacing: seeded("2026-06-01", "2027-06-07"),
  };
  arrange({
    saved: savedWeek(
      [
        planPoint("a1", "t1", "focus"),
        planPoint("b1", "t2", "focus", "2026-09-22"),
        planPoint("a3", "t1", "core"),
        planPoint("c2", "t3", "tutor"),
      ],
      [{ point: planPoint("c1", "t3", "focus"), reason: "ahead-of-spine" }],
    ),
    ledger: { done: [], outstanding: ["a3"] },
  });
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("projectOnly: skips the saved-week read but still reserves its catch-up", async () => {
  baseline = {
    program_start: "2026-06-01",
    exam_date: "2027-06-07",
    pacing: seeded("2026-06-01", "2027-06-07"),
  };
  arrange({
    saved: savedWeek([planPoint("a3", "t1", "core"), planPoint("a1", "t1", "focus")]),
  });
  expect({ result: await load({ projectOnly: true }), io }).toMatchSnapshot();
});

test("exam date moved: proposes changes and asks for acknowledgement", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-05-10",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

const customOrder = (examDate: string) =>
  reorderTopics({
    bands: seeded("2026-09-07", "2027-06-07"),
    topics: orderTopics,
    order: ["t3", "t2"],
    from: "2026-10-05",
    examDate,
    today: THIS_MONDAY,
  });

test("custom topic order is kept as stored", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: customOrder("2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("custom topic order is re-spread when the exam date has moved", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-05-10",
    pacing: customOrder("2027-06-07"),
  };
  arrange({});
  expect({ result: await load(), io }).toMatchSnapshot();
});

test("a caller-supplied state is used instead of reading it", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({});
  const state = stateOf({ progress: progress.slice(0, 2) });
  expect({ result: await load({ state }), io }).toMatchSnapshot();
});

test("a failed baseline read throws rather than posing as a first view", async () => {
  baselineFails = true;
  arrange({});
  await expect(load()).rejects.toMatchObject({ code: "42501" });
  expect(io).toMatchSnapshot();
});

/**
 * The exam year given at sign-up. The nearest June was the only answer before,
 * so a Year 10 who joined in September had a two-year course squeezed into
 * nine months. Asserted outright rather than snapshotted: this is a fix, not
 * a characterisation.
 */
const seedOf = () =>
  (
    io.find((e) => Array.isArray(e) && e[0] === "db" && e[1] === "POST") as unknown[] | undefined
  )?.[3] as { exam_date: string } | undefined;

test("first view by a Year 10: the plan runs to the summer after next", async () => {
  arrange({ examYear: 2028 });
  const result = await load();
  expect(result!.examDate).toBe("2028-06-05");
  expect(seedOf()?.exam_date).toBe("2028-06-05");
});

test("first view with no exam year given: the nearest summer, as before", async () => {
  arrange({ examYear: null });
  const result = await load();
  expect(result!.examDate).toBe("2027-06-07");
  expect(seedOf()?.exam_date).toBe("2027-06-07");
});

test("a plan that exists keeps its own date, whatever the exam year", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({ examYear: 2028 });
  const result = await load();
  expect(result!.examDate).toBe("2027-06-07");
  expect(seedOf()).toBeUndefined();
});

test("an unreadable stored date is repaired to the exam year", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "0002-06-01",
    pacing: seeded("2026-09-07", "2027-06-07"),
  };
  arrange({ examYear: 2028 });
  expect((await load())!.examDate).toBe("2028-06-05");
});

test("a failed exam-year read throws rather than saving a plan on the guess", async () => {
  arrange({ profileFails: true });
  await expect(load()).rejects.toMatchObject({ code: "57014" });
  expect(seedOf()).toBeUndefined();
});

/**
 * S-29. A custom order cut for the student's old course, after a tutor moved
 * them to another board: the stored spine named only the old course's topics,
 * and under a custom order the roadmap returned it as it stood, so nothing on
 * the new course was ever scheduled. Asserted outright rather than
 * snapshotted: this is a fix, not a characterisation.
 */
test("a custom order for another course is rebuilt for this one (S-29)", async () => {
  // The old course (t1..t3) in a custom order; the student is now on e1, e2.
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: customOrder("2027-06-07"),
  };
  const edexcel = [topic("e1", [point("x1"), point("x2")]), topic("e2", [point("y1")])];
  arrange({ progress: edexcel });
  const result = await load();

  const teaching = result!.bands.filter((b) => b.kind !== "revisit");
  expect(new Set(teaching.map((b) => b.topicId))).toEqual(new Set(["e1", "e2"]));
  expect(teaching.some((b) => b.startWeek <= THIS_MONDAY && b.endWeek >= THIS_MONDAY)).toBe(true);
  expect(result!.unscheduledTopicTitles).toEqual([]);
  expect(result!.needsAck).toBe(false);
  // Rebuilt from this week, keeping the exam date, and saved by the student.
  expect(result!.programStart).toBe(THIS_MONDAY);
  expect(result!.examDate).toBe("2027-06-07");
  const seed = io.find((e) => Array.isArray(e) && e[0] === "db" && e[1] === "POST") as unknown[];
  expect((seed[3] as { program_start: string }).program_start).toBe(THIS_MONDAY);
});

test("a tutor looking at a moved student's planner answers the same but saves nothing (S-29)", async () => {
  baseline = {
    program_start: "2026-09-07",
    exam_date: "2027-06-07",
    pacing: customOrder("2027-06-07"),
  };
  arrange({ progress: [topic("e1", [point("x1")])], viewer: "tutor" });
  const result = await load();
  expect(result!.bands.some((b) => b.topicId === "e1")).toBe(true);
  expect(io.some((e) => Array.isArray(e) && e[0] === "db" && e[1] === "POST")).toBe(false);
});

// Paused in the week of 31 Aug, back on Monday 14 Sept: two weeks stopped.
const stop = (values: Partial<PauseRecord> = {}): PauseRecord => ({
  id: "p1",
  reason: "paused",
  startedAt: "2026-09-02T10:00:00Z",
  endedAt: "2026-09-14T10:00:00Z",
  programmeResumedAt: null,
  ...values,
});
const taughtIn = (bands: PacingBand[], from: string, to: string) =>
  bands.flatMap((b) => Object.keys(b.pointsByWeek ?? {})).filter((w) => w >= from && w < to);

test("an ended stop is picked up before anything is cut from the programme", async () => {
  baseline = {
    program_start: "2026-08-24",
    exam_date: "2027-06-07",
    pacing: seeded("2026-08-24", "2027-06-07"),
  };
  arrange({ pauses: [stop({ id: "p0", programmeResumedAt: "2026-08-20T10:00:00Z" }), stop()] });
  const result = await load();
  expect(io.filter((e) => (e as unknown[])[0] === "resumeProgramme")).toHaveLength(1);
  expect(taughtIn(result!.baselineBands, "2026-08-31", "2026-09-14")).toEqual([]);
  expect({ result, io }).toMatchSnapshot();
});

test("a stop that can't be saved (a parent looking) leaves the programme as it was", async () => {
  const pacing = seeded("2026-08-24", "2027-06-07");
  baseline = { program_start: "2026-08-24", exam_date: "2027-06-07", pacing };
  arrange({ pauses: [stop()], resumeFails: true, viewer: "parent" });
  const result = await load();
  expect(result!.baselineBands.map((b) => [b.topicId, b.startWeek, b.endWeek])).toEqual(
    pacing.map((b) => [b.topicId, b.startWeek, b.endWeek]),
  );
});

// Away for the fortnight of 12 Oct, back on Monday 26 Oct.
const holiday = (values: Partial<StudentBreak> = {}): StudentBreak => ({
  id: "b1",
  startsOn: "2026-10-12",
  endsOn: "2026-10-25",
  reason: "holiday",
  recordedAt: null,
  ...values,
});

test("a break still to come shows the course as it will be picked up, and saves nothing", async () => {
  const pacing = seeded("2026-08-24", "2027-06-07");
  baseline = { program_start: "2026-08-24", exam_date: "2027-06-07", pacing };
  arrange({ breaks: [holiday()] });
  const result = await load();
  // As stored, a topic is taught across the fortnight.
  expect(pacing.some((b) => b.startWeek <= "2026-10-19" && b.endWeek >= "2026-10-12")).toBe(true);
  expect(taughtIn(result!.baselineBands, "2026-10-12", "2026-10-26")).toEqual([]);
  // A change to the programme is saved from what the database holds.
  expect(result!.storedBands?.map((b) => [b.topicId, b.startWeek, b.endWeek])).toEqual(
    pacing.map((b) => [b.topicId, b.startWeek, b.endWeek]),
  );
  expect(io.filter((e) => (e as unknown[])[0] === "resumeProgramme")).toEqual([]);
  expect(io.some((e) => Array.isArray(e) && e[0] === "db" && e[1] !== "GET")).toBe(false);
  // Nor is any catch-up or review forecast into it.
  const inBreak = (week: string) => week >= "2026-10-12" && week < "2026-10-26";
  expect(Object.keys(result!.catchUpSchedule?.weeks ?? {}).filter(inBreak)).toEqual([]);
  expect(result!.bands.filter((b) => b.kind && b.kind !== "teach" && inBreak(b.startWeek))).toEqual(
    [],
  );
});

test("a recorded break is left to the stop it became", async () => {
  const pacing = seeded("2026-08-24", "2027-06-07");
  baseline = { program_start: "2026-08-24", exam_date: "2027-06-07", pacing };
  arrange({ breaks: [holiday({ recordedAt: "2026-10-26T00:10:00Z" })] });
  const result = await load();
  expect(result!.baselineBands.map((b) => [b.topicId, b.startWeek, b.endWeek])).toEqual(
    pacing.map((b) => [b.topicId, b.startWeek, b.endWeek]),
  );
});
