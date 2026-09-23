import { describe, expect, test } from "bun:test";
import { describeChange, foldMonths, formatSchedule, type PlanLine } from "./formatSchedule";
import type { RoadmapResult } from "@/lib/planner/roadmap";
import type { PacingBand, PacingChange } from "@/lib/planner/pacing";
import { plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";

// ICU builds disagree on September ("Sep" in Bun, "Sept" in browsers), so the
// expected label is computed the same way the formatter computes it.
const SEP_14 = plannerDateLabel(weekKeyToDate("2026-09-14"));

const point = (id: string, code: string, title: string) => ({
  id,
  code,
  title,
  homeworkScore: null,
  quizScore: null,
  status: "new",
  assessability: "assessed",
});
const ref = (id: string, code: string, title: string, extra: object = {}) => ({
  specPointId: id,
  code,
  title,
  ...extra,
});
const missedA1 = {
  specPointId: "a1",
  topicId: "t1",
  topicTitle: "Cell biology",
  code: "4.1.1",
  title: "Eukaryotes",
  weight: 1,
  plannedWeek: "2026-09-14",
};

const cells: PacingBand = {
  topicId: "t1",
  title: "Cell biology",
  startWeek: "2026-09-14",
  endWeek: "2026-10-05",
  weeks: 4,
  kind: "teach",
  pointsByWeek: {
    "2026-09-14": [ref("a1", "4.1.1", "Eukaryotes")],
    "2026-09-21": [ref("a2", "4.1.2", "Animal cells")],
    "2026-09-28": [ref("a3", "4.1.3", "Specialisation")],
    "2026-10-05": [ref("a4", "4.1.4", "Differentiation")],
  },
};
// Stored before `pointsByWeek` existed: the whole topic every week.
const organisation: PacingBand = {
  topicId: "t2",
  title: "Organisation",
  startWeek: "2026-10-12",
  endWeek: "2026-11-02",
  weeks: 4,
  kind: "teach",
};
const revisit: PacingBand = {
  topicId: "t1",
  title: "Cell biology",
  startWeek: "2026-11-09",
  endWeek: "2026-11-09",
  weeks: 1,
  kind: "revisit",
  points: [ref("a1", "4.1.1", "Eukaryotes", { dueAt: "2026-11-10" })],
};
const review: PacingBand = {
  topicId: "t2",
  title: "Organisation",
  startWeek: "2026-11-16",
  endWeek: "2026-11-16",
  weeks: 1,
  kind: "review",
};

const roadmap = (patch: Partial<RoadmapResult> = {}) =>
  ({
    bands: [cells, organisation, revisit, review],
    baselineBands: [cells, organisation],
    changes: [],
    needsAck: false,
    programStart: "2026-09-14",
    examDate: "2026-11-30",
    coveredTopicIds: [],
    completedPointIds: [],
    progress: [
      {
        topicId: "t1",
        title: "Cell biology",
        points: [
          point("a1", "4.1.1", "Eukaryotes"),
          point("a2", "4.1.2", "Animal cells"),
          point("a3", "4.1.3", "Specialisation"),
          point("a4", "4.1.4", "Differentiation"),
        ],
      },
      {
        topicId: "t2",
        title: "Organisation",
        points: [point("b1", "4.2.1", "Tissues"), point("b2", "4.2.2", "Digestion")],
      },
    ],
    reviewBacklog: [],
    inadmissible: [],
    backlog: [missedA1],
    backlogByTopic: [
      {
        topicId: "t1",
        topicTitle: "Cell biology",
        points: [missedA1],
        weight: 1,
        since: "2026-09-14",
      },
    ],
    catchUpSchedule: { weeks: { "2026-09-21": [missedA1] }, assignedIds: ["a1"], held: [] },
    unscheduledTopicTitles: [],
    focusLoad: { spine: 8, overloaded: false },
    overrides: [],
    ...patch,
  }) as unknown as RoadmapResult;

const NOW = "2026-09-21";
const weekOf = (s: ReturnType<typeof formatSchedule>, key: string) =>
  s.months.flatMap((m) => m.weeks).find((w) => w.key === key);
const kinds = (lines: PlanLine[] | undefined) => lines?.map((l) => `${l.kind}:${l.title}`);

describe("formatSchedule", () => {
  test("starts at this week, groups weeks under their month, and marks the exam week", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    expect(s.months.map((m) => [m.label, m.weeks.map((w) => w.day)])).toEqual([
      ["September 2026", ["21", "28"]],
      ["October 2026", ["5", "12", "19", "26"]],
      ["November 2026", ["2", "9", "16", "23", "30"]],
    ]);
    const first = s.months[0].weeks[0];
    expect(first).toMatchObject({ isNow: true, isPast: false, isExam: false });
    expect(first.label).toBe("Week of 21 September 2026");
    expect(weekOf(s, "2026-11-30")?.isExam).toBe(true);
    expect(s.earlierWeeks).toBe(1);
  });

  test("this week's line holds only its share of the topic, with the whole topic on request", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    const [teach] = weekOf(s, NOW)!.lines;
    expect(teach.kind).toBe("teach");
    expect(teach.points.map((p) => p.code)).toEqual(["4.1.2"]);
    expect(teach.points[0].progress?.title).toBe("Animal cells");
    expect(teach.wholeTopic?.map((p) => p.code)).toEqual(["4.1.1", "4.1.2", "4.1.3", "4.1.4"]);
  });

  test("a band with no weekly split shows the whole topic and offers nothing more", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    const [teach] = weekOf(s, "2026-10-19")!.lines;
    expect(teach.title).toBe("Organisation");
    expect(teach.points.map((p) => p.code)).toEqual(["4.2.1", "4.2.2"]);
    expect(teach.wholeTopic).toBeNull();
  });

  test("missed work returning is its own line, grouped by the week it was first due", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    const lines = weekOf(s, NOW)!.lines;
    expect(kinds(lines)).toEqual(["teach:Cell biology", "catchup:Cell biology"]);
    const catchUp = lines[1];
    if (catchUp.kind !== "catchup") throw new Error("expected a catch-up line");
    expect(catchUp.confirmed).toBe(true);
    expect(catchUp.byDueWeek.map((g) => [g.label, g.points.map((p) => p.code)])).toEqual([
      [SEP_14, ["4.1.1"]],
    ]);
  });

  test("a projected catch-up is not confirmed", () => {
    const s = formatSchedule(
      roadmap({
        catchUpSchedule: { weeks: { "2026-09-21": [missedA1] }, assignedIds: [], held: [] },
      }),
      { now: NOW, showHistory: false },
    );
    const line = weekOf(s, NOW)!.lines[1];
    expect(line.kind === "catchup" && line.confirmed).toBe(false);
  });

  test("a revisit names its due points; a review is the whole topic", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    const [rev] = weekOf(s, "2026-11-09")!.lines;
    expect(rev).toMatchObject({ kind: "revisit", title: "Cell biology", estimated: true });
    expect(rev.points.map((p) => p.code)).toEqual(["4.1.1"]);
    expect(rev.wholeTopic).toHaveLength(4);
    const [whole] = weekOf(s, "2026-11-16")!.lines;
    expect(whole).toMatchObject({ kind: "revisit", title: "Organisation", estimated: false });
    expect(whole.points).toHaveLength(2);
    expect(whole.wholeTopic).toBeNull();
    expect(weekOf(s, "2026-11-23")!.lines).toEqual([]);
  });

  test("history starts at the programme and says what a past week left undone", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: true });
    const past = weekOf(s, "2026-09-14")!;
    expect(past.isPast).toBe(true);
    expect(past.lines[0]).toMatchObject({ kind: "teach", missed: 1 });
    // Only past weeks report missed work.
    expect(weekOf(s, NOW)!.lines[0]).toMatchObject({ missed: 0 });
  });

  test("the summary counts topics, not bands, and the weeks left to the exam", () => {
    const s = formatSchedule(roadmap({ coveredTopicIds: ["t1"] }), {
      now: NOW,
      showHistory: false,
    });
    expect(s.summary).toEqual({
      covered: 1,
      total: 2,
      percent: 50,
      examDate: "30 Nov 2026",
      weeksLeft: 10,
    });
    expect(weekOf(s, NOW)!.lines[0]).toMatchObject({ covered: true });
  });

  test("attention lists missed topics, and is empty when the plan needs nothing", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    expect(s.attention.missed).toEqual([
      { topicId: "t1", title: "Cell biology", specPointIds: ["a1"], since: SEP_14 },
    ]);
    expect(s.hasAttention).toBe(true);
    const calm = formatSchedule(roadmap({ backlogByTopic: [] }), { now: NOW, showHistory: false });
    expect(calm.hasAttention).toBe(false);
    expect(calm.attention).toEqual({ missed: [], heldCount: 0, overload: null, moved: null });
  });

  test("an overloaded plan and held catch-up are both reported", () => {
    const s = formatSchedule(
      roadmap({
        backlogByTopic: [],
        focusLoad: { spine: 8, overloaded: true },
        reviewBacklog: [
          {
            specPointId: "b1",
            topicId: "t2",
            topicTitle: "Organisation",
            code: "4.2.1",
            pointTitle: "Tissues",
            dueAt: "2026-12-01",
            eligibleAt: "2026-12-01",
            lastReviewedAt: "2026-09-01",
          },
        ],
        unscheduledTopicTitles: ["Homeostasis"],
        catchUpSchedule: { weeks: {}, assignedIds: [], held: [missedA1] },
      }),
      { now: NOW, showHistory: false },
    );
    expect(s.attention.overload).toEqual({
      reviews: [{ specPointId: "b1", code: "4.2.1", title: "Tissues" }],
      topics: ["Homeostasis"],
    });
    expect(s.attention.heldCount).toBe(1);
    expect(s.hasAttention).toBe(true);
  });

  test("a pending re-plan shows the new plan, names what it displaces, and blocks reordering", () => {
    const moved: PacingChange = {
      topicId: "t2",
      title: "Organisation",
      from: "2026-10-19",
      to: "2026-10-12",
      kind: "moved",
      fromWeeks: 4,
      weeks: 4,
    };
    const s = formatSchedule(
      roadmap({
        needsAck: true,
        changes: [moved],
        baselineBands: [
          { ...cells, endWeek: "2026-10-12", weeks: 5 },
          { ...organisation, startWeek: "2026-10-19", endWeek: "2026-11-09" },
        ],
      }),
      { now: NOW, showHistory: false },
    );
    const [teach] = weekOf(s, "2026-10-12")!.lines;
    expect(teach).toMatchObject({
      kind: "teach",
      title: "Organisation",
      replaces: "Cell biology",
      change: { label: "Moved from 19 Oct" },
    });
    // The badge sits on the topic's first week only.
    expect(weekOf(s, "2026-10-19")!.lines[0]).toMatchObject({ change: null, replaces: null });
    expect(s.attention.moved).toEqual([
      { topicId: "t2", title: "Organisation", from: "19 Oct", to: "12 Oct" },
    ]);
    expect(s.replanPending).toBe(true);
  });
});

describe("describeChange", () => {
  const base = { topicId: "t", title: "T", to: "2026-10-12", weeks: 4 };
  test("says what actually changed", () => {
    expect(describeChange({ ...base, kind: "added", from: null, fromWeeks: null }).label).toBe(
      "New in plan",
    );
    expect(describeChange({ ...base, kind: "moved", from: "2026-09-14", fromWeeks: 4 }).label).toBe(
      `Moved from ${SEP_14}`,
    );
    const longer = describeChange({ ...base, kind: "resized", from: "2026-10-12", fromWeeks: 3 });
    expect(longer).toEqual({
      label: "+1 week",
      detail: "Starts the same week, but now runs 4 weeks instead of 3 weeks",
    });
    expect(
      describeChange({ ...base, kind: "resized", from: "2026-10-12", fromWeeks: 6 }).label,
    ).toBe("−2 weeks");
  });
});

describe("foldMonths", () => {
  test("shows up to the current month plus the next few, and counts what is folded", () => {
    const s = formatSchedule(roadmap(), { now: NOW, showHistory: false });
    const folded = foldMonths(s.months, 2);
    expect(folded.visible.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
    expect(folded.hiddenWeeks).toBe(5);
    expect(foldMonths(s.months, 5)).toEqual({ visible: s.months, hiddenWeeks: 0 });
  });

  test("keeps unfolded history in view ahead of the current month", () => {
    const s = formatSchedule(roadmap(), { now: "2026-10-05", showHistory: true });
    expect(foldMonths(s.months, 1).visible.map((m) => m.key)).toEqual(["2026-09", "2026-10"]);
  });
});
