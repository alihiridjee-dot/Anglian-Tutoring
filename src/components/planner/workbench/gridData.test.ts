import { describe, expect, test } from "bun:test";
import type { PacingBand } from "@/lib/planner/pacing";
import type { ProgressPoint, TopicProgress } from "@/lib/planner/scheduleDal";
import type { PlanLine, PlanMonth, PlanWeek } from "../fullPlan/formatSchedule";
import type { TutorWeekRow } from "../tutorWeekRows";
import { gridMonths, moveTargets, rowShown, topicRows, type GridRow } from "./gridData";

const NOW = "2026-11-16";

const standing = (id: string, values: Partial<ProgressPoint> = {}) =>
  ({
    id,
    code: id,
    title: `Point ${id}`,
    homeworkScore: null,
    quizScore: null,
    lastReviewedAt: null,
    assessability: "awaiting",
    ...values,
  }) as ProgressPoint;
const POINTS = {
  a: standing("a", { homeworkScore: 82, quizScore: 90, lastReviewedAt: "2026-11-11T10:00:00Z" }),
  b: standing("b"),
  c: standing("c", { quizScore: 45 }),
  d: standing("d", { assessability: "unassessable" }),
  e: standing("e"),
};
const progress = [
  { topicId: "t", title: "Cell biology", points: Object.values(POINTS) },
] as unknown as TopicProgress[];

const line = (kind: PlanLine["kind"], ids: (keyof typeof POINTS)[]) =>
  ({
    kind,
    key: kind,
    topicId: "t",
    title: "Cell biology",
    points: ids.map((id) => ({
      specPointId: id,
      code: id,
      title: `Point ${id}`,
      progress: POINTS[id],
    })),
  }) as unknown as PlanLine;
const week = (key: string, lines: PlanLine[], isExam = false): PlanWeek => ({
  key,
  day: key.slice(8),
  month: "Nov",
  label: key,
  isNow: key === NOW,
  isPast: key < NOW,
  isExam,
  lines,
});
const MONTHS: PlanMonth[] = [
  {
    key: "2026-11",
    label: "November 2026",
    weeks: [
      week("2026-11-09", [line("teach", ["a", "b", "c"])]),
      week(NOW, [line("teach", ["e"])]),
      week("2026-11-23", [line("catchup", ["b"]), line("revisit", ["a"]), line("teach", ["d"])]),
      week("2026-11-30", [line("teach", ["e"])]),
    ],
  },
  { key: "2027-06", label: "June 2027", weeks: [week("2027-06-07", [], true)] },
];

const build = (over: Partial<Parameters<typeof gridMonths>[0]> = {}) =>
  gridMonths({
    months: MONTHS,
    now: NOW,
    progress,
    backlog: [{ specPointId: "b", plannedWeek: "2026-11-09" }] as never,
    completed: ["a"],
    breaks: [],
    detail: null,
    canChange: true,
    ...over,
  });
const rowsOf = (months: ReturnType<typeof build>, key: string) =>
  months.flatMap((m) => m.weeks).find((w) => w.key === key)!.rows;

describe("the plan as the grid shows it", () => {
  test("the exam week is left out, and with it a month that holds nothing else", () => {
    const months = build();
    expect(months.map((m) => [m.key, m.label])).toEqual([["2026-11", "Nov"]]);
    expect(months[0].weeks.map((w) => w.tag)).toEqual([
      "Past",
      "This week",
      "Forecast",
      "Forecast",
    ]);
  });

  test("a week gone by: marks as rings, a missed point flagged, and nothing to change", () => {
    const months = build();
    const past = months[0].weeks[0];
    expect(past.locked).toBe(true);
    const [a, b, c] = past.rows;
    expect(a).toMatchObject({
      id: "2026-11-09:a",
      lane: "course",
      topic: "Cell biology",
      task: { mark: 82 },
      quiz: { mark: 90 },
      status: "strong",
      missed: false,
      ticked: "Yes",
    });
    expect(a.last).toContain("11 Nov");
    expect(b).toMatchObject({ task: { text: "Not done" }, status: "not_done", missed: true });
    expect(c).toMatchObject({ task: { text: "Not done" }, quiz: { mark: 45 }, status: "weak" });
  });

  test("a week to come: no status yet, the lanes from the plan, and whether work exists", () => {
    const rows = rowsOf(build(), "2026-11-23");
    expect(rows.map((r) => [r.specPointId, r.lane, r.status])).toEqual([
      ["b", "catchup", null],
      ["a", "revision", "strong"],
      ["d", "course", null],
    ]);
    expect(rows[0].task).toEqual({ text: "Ready" });
    expect(rows[2].task).toEqual({ text: "None yet" });
    // Missed is about the week it was due in, not the week it comes back in.
    expect(rows[0].missed).toBe(false);
  });

  test("the week read in full uses its saved lines: who set them, the ticks and that week's work", () => {
    const saved = (id: string, values: Partial<TutorWeekRow> = {}): TutorWeekRow => ({
      specPointId: id,
      code: id,
      title: `Point ${id}`,
      topicId: "t",
      topicTitle: "Cell biology",
      state: "saved",
      origin: "core",
      lane: "course",
      pinned: false,
      carriedFrom: null,
      doneAt: null,
      ...values,
    });
    const months = build({
      detail: {
        weekStart: NOW,
        rows: [
          saved("e", { doneAt: "2026-11-17T09:00:00Z" }),
          saved("c", { lane: "pinned", origin: "tutor", pinned: true }),
          saved("d", { state: "projected" }),
        ],
        coverage: new Map([
          [
            "e",
            {
              attempted: true,
              homeworkDone: true,
              quizDone: false,
              bestScore: null,
              homeworkScore: null,
              quizScore: null,
            },
          ],
        ]),
        activity: new Map([
          ["e", { hasHomework: true, hasQuiz: true }],
          ["c", { hasHomework: false, hasQuiz: true }],
        ]),
        opened: false,
      },
    });
    const now = months[0].weeks[1];
    expect(now.unopened).toBe(true);
    const [e, c, d] = now.rows;
    expect(e).toMatchObject({
      lane: "course",
      task: { text: "Handed in" },
      quiz: { text: "To do" },
      status: "practised",
    });
    expect(e.ticked).toContain("17 Nov");
    expect(c).toMatchObject({
      lane: "tutor",
      task: { text: "None yet" },
      quiz: { text: "To do" },
      status: "not_done",
    });
    // A line the programme will set, with no work read for it yet.
    expect(d).toMatchObject({ task: null, quiz: null, status: null });
  });

  test("a break week is named and locked, and is no place to move a line to", () => {
    const months = build({
      breaks: [{ startsOn: "2026-11-23", endsOn: "2026-11-29" }] as never,
    });
    const brk = months[0].weeks[2];
    expect([brk.note, brk.locked]).toEqual(["Break", true]);
    expect(moveTargets(months).map((w) => w.key)).toEqual([NOW, "2026-11-30"]);
  });

  test("with the override rules missing, no week can be changed", () => {
    expect(build({ canChange: false })[0].weeks.every((w) => w.locked)).toBe(true);
  });
});

describe("narrowing the grid", () => {
  const row = (values: Partial<GridRow>) =>
    ({ lane: "course", status: null, missed: false, ...values }) as GridRow;
  test("a missed point is shown under Missed, not under Not done", () => {
    const missed = row({ status: "not_done", missed: true });
    expect(rowShown(missed, "missed")).toBe(true);
    expect(rowShown(missed, "not_done")).toBe(false);
    expect(rowShown(row({ status: "not_done" }), "not_done")).toBe(true);
  });
  test("a lane shows its own lines only", () => {
    expect(rowShown(row({ lane: "catchup" }), "catchup")).toBe(true);
    expect(rowShown(row({ lane: "course" }), "catchup")).toBe(false);
    expect(rowShown(row({ lane: "revision" }), "all")).toBe(true);
  });
});

describe("the topics in teaching order", () => {
  const band = (topicId: string, startWeek: string, endWeek: string, kind?: string) =>
    ({ topicId, title: topicId.toUpperCase(), startWeek, endWeek, weeks: 1, kind }) as PacingBand;
  test("in date order, a topic cut in two by a break is one row, and reviews are not topics", () => {
    const rows = topicRows(
      [
        band("b", "2026-11-16", "2026-11-23"),
        band("a", "2026-10-05", "2026-11-09"),
        band("b", "2026-12-07", "2026-12-14"),
        band("c", "2027-01-04", "2027-01-11"),
        band("a", "2026-11-16", "2026-11-16", "focus"),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.topicId, r.state])).toEqual([
      ["a", "done"],
      ["b", "now"],
      ["c", null],
    ]);
    expect(rows[1].when).toContain("Dec");
  });
});
