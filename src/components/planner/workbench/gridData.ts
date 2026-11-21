import type { BacklogPoint } from "@/lib/planner/backlog";
import { breakCovering, type StudentBreak } from "@/lib/planner/breaks";
import {
  STRONG_THRESHOLD,
  statusOfPoint,
  type PointActivity,
  type PointCoverage,
  type PointStatus,
} from "@/lib/planner/coverage";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import type { ProgressPoint, TopicProgress } from "@/lib/planner/scheduleDal";
import { shortDayLabel, weekKeyToDate, weekRangeLabel } from "@/lib/planner/week";
import type { PlanLineKind, PlanMonth } from "../fullPlan/formatSchedule";
import type { TutorWeekRow, WeekLane } from "../tutorWeekRows";
import type { Work } from "./figures";

/** Why a line is in its week. The grid files a week's lines under these, in this order. */
export type LaneKey = "course" | "catchup" | "revision" | "tutor" | "student";
export const LANE_ORDER: LaneKey[] = ["course", "catchup", "revision", "tutor", "student"];
/** The lanes' names and colours: the ones the student's own week uses. */
export const LANES: Record<LaneKey, { label: string; tint: string }> = {
  course: { label: "Course", tint: "tint-primary" },
  catchup: { label: "Catch-up", tint: "tint-amber" },
  revision: { label: "Revision", tint: "tint-rose" },
  tutor: { label: "Set by you", tint: "tint-accent" },
  student: { label: "Added by the student", tint: "tint-slate" },
};

/** One spec point in one week. */
export interface GridRow {
  /** `<week>:<spec point id>`: a point can sit in more than one week. */
  id: string;
  specPointId: string;
  /** The Monday of its week. */
  week: string;
  lane: LaneKey;
  code: string;
  title: string;
  topic: string;
  task: Work;
  quiz: Work;
  /** Null in a week still to come: nothing has been done in it to judge. */
  status: PointStatus | null;
  /** Due in a week gone by and never covered since. */
  missed: boolean;
  /** When the student ticked it, "Yes" when only the fact is known, or null. */
  ticked: string | null;
  /** When it was last practised, or null for never. */
  last: string | null;
}

export interface GridWeek {
  key: string;
  /** "16–22 Nov 2026" */
  dates: string;
  tag: "Past" | "This week" | "Forecast";
  /** Why the week holds nothing to plan, when it doesn't: a break. */
  note: string | null;
  /** This week, and the student has not opened it: the lines are what they will be given. */
  unopened: boolean;
  /** Its lines cannot be changed: it has gone by, it is a break, or the rule isn't installed. */
  locked: boolean;
  rows: GridRow[];
}

export interface GridMonth {
  /** "2026-11" */
  key: string;
  /** "Nov" */
  label: string;
  weeks: GridWeek[];
}

/** The one week read in full: its saved lines, and the work done on each. */
export interface WeekDetail {
  weekStart: string;
  rows: TutorWeekRow[];
  coverage: Map<string, PointCoverage>;
  activity: Map<string, PointActivity>;
  /** The programme has cut it, which it does when the student opens it. */
  opened: boolean;
}

const LANE_OF_KIND: Record<PlanLineKind, LaneKey> = {
  teach: "course",
  catchup: "catchup",
  revisit: "revision",
};
const LANE_OF_SAVED: Record<WeekLane, LaneKey> = {
  course: "course",
  catchup: "catchup",
  revision: "revision",
  pinned: "tutor",
  student: "student",
};

const dayOf = (iso: string | null | undefined) => (iso ? shortDayLabel(new Date(iso)) : null);

/** A task or quiz in the week read in full: its mark, or where it stands. */
function workDone(
  exists: boolean | undefined,
  mark: number | null | undefined,
  done: boolean | undefined,
  doneWord: string,
): Work {
  if (exists === undefined) return null;
  if (!exists) return { text: "None yet" };
  if (mark != null) return { mark };
  return { text: done ? doneWord : "To do" };
}

/**
 * A task or quiz in any other week, from the point's standing over the whole
 * course: its best mark, or whether there is anything written to do.
 */
function workStanding(
  p: ProgressPoint | null,
  mark: number | null | undefined,
  tag: GridWeek["tag"],
): Work {
  if (mark != null) return { mark };
  if (!p) return null;
  if (p.assessability === "unassessable") return { text: "None yet" };
  return { text: tag === "Forecast" ? "Ready" : tag === "Past" ? "Not done" : "To do" };
}

function standingStatus(p: ProgressPoint | null, tag: GridWeek["tag"]): PointStatus | null {
  const best = Math.max(p?.homeworkScore ?? -1, p?.quizScore ?? -1);
  if (best >= 0) return best >= STRONG_THRESHOLD ? "strong" : "weak";
  return tag === "Past" ? "not_done" : null;
}

/**
 * The plan as the grid shows it: every month of the course, its weeks, and one
 * line per spec point in each.
 *
 * The weeks and what each holds are the full plan's own ([[formatSchedule]]),
 * so the grid and the plan can't disagree. One week, the one in view, is read
 * in full: its saved lines (which carry what a tutor or the student added by
 * hand, and the ticks) and the work done that week. Every other week is drawn
 * from the plan and each point's standing over the course. The exam week holds
 * nothing to plan and is left out.
 */
export function gridMonths(p: {
  months: PlanMonth[];
  /** This week's Monday. */
  now: string;
  progress: TopicProgress[];
  backlog: BacklogPoint[];
  completed: readonly string[];
  breaks: readonly StudentBreak[];
  detail: WeekDetail | null;
  /** The override rules are installed, so lines can be changed at all. */
  canChange: boolean;
}): GridMonth[] {
  const standing = new Map<string, { point: ProgressPoint; topic: string }>();
  for (const t of p.progress)
    for (const point of t.points) standing.set(point.id, { point, topic: t.title });
  const missed = new Set(p.backlog.map((b) => `${b.plannedWeek}:${b.specPointId}`));
  const completed = new Set(p.completed);

  return p.months
    .map((month) => ({
      key: month.key,
      // A course over more than a year has two Novembers: say which.
      label:
        p.months.length > 12
          ? `${month.label.slice(0, 3)} ${month.key.slice(2, 4)}`
          : month.label.slice(0, 3),
      weeks: month.weeks
        .filter((week) => !week.isExam)
        .map((week): GridWeek => {
          const tag = week.isNow ? "This week" : week.isPast ? "Past" : "Forecast";
          const onBreak = !!breakCovering(p.breaks, week.key);
          const detail = p.detail?.weekStart === week.key ? p.detail : null;
          const rows = new Map<string, GridRow>();
          const add = (row: Omit<GridRow, "id" | "week" | "missed">) => {
            const id = `${week.key}:${row.specPointId}`;
            if (!rows.has(id)) rows.set(id, { ...row, id, week: week.key, missed: missed.has(id) });
          };
          if (detail)
            for (const row of detail.rows) {
              const cov = detail.coverage.get(row.specPointId);
              const act = detail.activity.get(row.specPointId);
              add({
                specPointId: row.specPointId,
                lane: LANE_OF_SAVED[row.lane],
                code: row.code,
                title: row.title,
                topic: row.topicTitle,
                task: workDone(
                  act?.hasHomework,
                  cov?.homeworkScore,
                  cov?.homeworkDone,
                  "Handed in",
                ),
                quiz: workDone(act?.hasQuiz, cov?.quizScore, cov?.quizDone, "Done"),
                status:
                  row.state === "saved" && tag !== "Forecast" ? statusOfPoint(cov, act) : null,
                ticked: dayOf(row.doneAt),
                last: dayOf(standing.get(row.specPointId)?.point.lastReviewedAt),
              });
            }
          else
            for (const line of week.lines)
              for (const point of line.points) {
                const known = point.progress ?? standing.get(point.specPointId)?.point ?? null;
                add({
                  specPointId: point.specPointId,
                  lane: LANE_OF_KIND[line.kind],
                  code: point.code,
                  title: point.title,
                  topic: standing.get(point.specPointId)?.topic ?? line.title,
                  task: workStanding(known, known?.homeworkScore, tag),
                  quiz: workStanding(known, known?.quizScore, tag),
                  status: standingStatus(known, tag),
                  ticked: completed.has(point.specPointId) ? "Yes" : null,
                  last: dayOf(known?.lastReviewedAt),
                });
              }
          return {
            key: week.key,
            dates: weekRangeLabel(weekKeyToDate(week.key)),
            tag,
            note: onBreak ? "Break" : null,
            unopened: tag === "This week" && !!detail && !detail.opened,
            locked: tag === "Past" || onBreak || !p.canChange,
            rows: [...rows.values()],
          };
        }),
    }))
    .filter((month) => month.weeks.length > 0);
}

/** What the grid is narrowed to: a lane, or how a point is going. */
export type Show = "all" | LaneKey | "weak" | "not_done" | "missed";

export function rowShown(row: GridRow, show: Show): boolean {
  if (show === "all") return true;
  if (show === "missed") return row.missed;
  if (show === "weak") return row.status === "weak" && !row.missed;
  if (show === "not_done") return row.status === "not_done" && !row.missed;
  return row.lane === show;
}

/** The weeks a line may be moved to: from this week to the exams, breaks left out. */
export function moveTargets(months: GridMonth[]): { key: string; dates: string }[] {
  return months
    .flatMap((m) => m.weeks)
    .filter((w) => w.tag !== "Past" && !w.note)
    .map((w) => ({ key: w.key, dates: w.dates }));
}

/** A topic in teaching order, with the weeks it runs over. */
export interface TopicRow {
  topicId: string;
  title: string;
  /** "16 Nov – 13 Dec 2026" */
  when: string;
  state: "done" | "now" | null;
}

/**
 * The topics in the order they are taught, from the plan's teaching bands. A
 * topic a break has cut in two is one row, from its first week to its last.
 */
export function topicRows(bands: PacingBand[], now: string): TopicRow[] {
  const runs = new Map<string, { title: string; start: string; end: string }>();
  for (const band of bands) {
    if (!isTeachBand(band)) continue;
    const run = runs.get(band.topicId);
    if (!run)
      runs.set(band.topicId, { title: band.title, start: band.startWeek, end: band.endWeek });
    else {
      if (band.startWeek < run.start) run.start = band.startWeek;
      if (band.endWeek > run.end) run.end = band.endWeek;
    }
  }
  return [...runs.entries()]
    .sort(([, a], [, b]) => a.start.localeCompare(b.start))
    .map(([topicId, run]) => ({
      topicId,
      title: run.title,
      when: weekRangeLabel(weekKeyToDate(run.start), weekKeyToDate(run.end)),
      state: run.end < now ? "done" : run.start <= now ? "now" : null,
    }));
}
