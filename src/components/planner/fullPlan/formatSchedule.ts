import { isTeachBand, type PacingBand, type PacingChange } from "@/lib/planner/pacing";
import { byTopic, type BacklogPoint } from "@/lib/planner/backlog";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type ProgressPoint } from "@/lib/planner/scheduleDal";
import { plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";
import { weekKeysBetween } from "../roadmapWeeks";

/**
 * The tutor's full plan, shaped for reading before anything renders it.
 *
 * The roadmap arrives as bands — "Topic 1 runs these six weeks", "revisit Topic
 * 3 in February" — plus a backlog, a catch-up projection, a list of changes and
 * a coverage set. The old table worked all of that out inside each row's
 * render, which is why a single week could say "Cell biology" three times in
 * three type sizes: every lane decided its own wording. Here each week becomes
 * a short list of lines that already say what they are, so the components only
 * draw them.
 *
 * Pure and clock-free: `now` is passed in, which is what lets the tests pin a
 * week.
 */

/** Why a line is on a week: the course in order, missed work coming back, or a revisit. */
export type PlanLineKind = "teach" | "catchup" | "revisit";

/** A spec point on a line: its code and title, and its standing when the course has one. */
export interface PlanPoint {
  specPointId: string;
  code: string;
  title: string;
  /** Null when no progress row came back for it — shown by name only. */
  progress: ProgressPoint | null;
}

/** A re-plan put into words, once, so no surface can describe it differently. */
export interface ChangeLabel {
  /** Short, for a chip: "Moved from 14 Sept", "+1 week", "New in plan". */
  label: string;
  /** The sentence behind it, for the hover. */
  detail: string;
}

interface LineBase {
  /** Unique within its week. Expansion is per line, per week. */
  key: string;
  topicId: string;
  title: string;
  /** What this week holds of the topic. */
  points: PlanPoint[];
  /** The whole topic, when this week holds only part of it; otherwise null. */
  wholeTopic: PlanPoint[] | null;
}

export interface TeachLine extends LineBase {
  kind: "teach";
  /** Every point in the topic has an assessed mark of at least 70%. */
  covered: boolean;
  /** A past week: how many of the points it promised were never covered. */
  missed: number;
  /** Set on the week a re-plan moved (or added, or resized) this topic. */
  change: ChangeLabel | null;
  /** While a re-plan waits to apply: the topic the current plan has here, when it differs. */
  replaces: string | null;
}

export interface CatchUpLine extends LineBase {
  kind: "catchup";
  /** Already saved into this week's plan, rather than projected. */
  confirmed: boolean;
  /** The points grouped by the week they were first due, oldest first. */
  byDueWeek: { week: string; label: string; points: PlanPoint[] }[];
}

export interface RevisitLine extends LineBase {
  kind: "revisit";
  /** Projected from marks and memory timing, not yet saved into a week. */
  estimated: boolean;
}

export type PlanLine = TeachLine | CatchUpLine | RevisitLine;

export interface PlanWeek {
  /** The Monday, as a date-key. */
  key: string;
  /** "21" */
  day: string;
  /** "Sept" */
  month: string;
  /** "Week of 21 September 2026", for screen readers. */
  label: string;
  isNow: boolean;
  isPast: boolean;
  /** The exam week (or later). */
  isExam: boolean;
  lines: PlanLine[];
}

export interface PlanMonth {
  /** "2026-09" */
  key: string;
  /** "September 2026" */
  label: string;
  weeks: PlanWeek[];
}

/** A topic with points that were due in weeks gone by and never covered. */
export interface MissedTopic {
  topicId: string;
  title: string;
  specPointIds: string[];
  /** The earliest week any of them was due, as "14 Sept". */
  since: string;
}

/** A topic a pending re-plan has moved, for the "what moved" list. */
export interface MovedTopic {
  topicId: string;
  title: string;
  /** "14 Sept", or null for a topic the re-plan added. */
  from: string | null;
  to: string;
}

/** Everything on the plan a tutor may need to act on. Empty lists mean nothing to show. */
export interface PlanAttention {
  missed: MissedTopic[];
  /** Missed points that cannot fit before the exam at the catch-up pace. */
  heldCount: number;
  /** The plan asks for more weeks than there are; what is left over. Null when it fits. */
  overload: {
    reviews: { specPointId: string; code: string; title: string }[];
    topics: string[];
  } | null;
  /** A re-plan waiting for the student's next visit to apply. Null when there is none. */
  moved: MovedTopic[] | null;
}

export interface PlanSummary {
  covered: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
  /** "7 Jun 2027" */
  examDate: string;
  /** Whole weeks from this one to the exam week. */
  weeksLeft: number;
}

export interface FormattedSchedule {
  summary: PlanSummary;
  attention: PlanAttention;
  hasAttention: boolean;
  /** Weeks between the programme's start and this one — the history that can be unfolded. */
  earlierWeeks: number;
  months: PlanMonth[];
  /** A re-plan is waiting to apply; the topic order cannot be edited until it has. */
  replanPending: boolean;
}

const inBand = (b: PacingBand, wk: string) => b.startWeek <= wk && wk <= b.endWeek;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "14 Sept" */
export const shortDate = (key: string) => plannerDateLabel(weekKeyToDate(key));

/**
 * The one place a re-plan is put into words.
 *
 * Rendering follows {@link PacingChange.kind}, so a case cannot be described as
 * another one: a topic that kept its September start and simply ran a week
 * longer must not be told it "moved from September", the week it is still in.
 */
export function describeChange(change: PacingChange): ChangeLabel {
  if (change.kind === "added") return { label: "New in plan", detail: "Newly added to the plan" };
  if (change.kind === "moved" && change.from)
    return {
      label: `Moved from ${shortDate(change.from)}`,
      detail: `Rescheduled from the week of ${shortDate(change.from)}`,
    };
  const delta = change.fromWeeks === null ? 0 : change.weeks - change.fromWeeks;
  return {
    label: `${delta > 0 ? "+" : "−"}${plural(Math.abs(delta), "week")}`,
    detail: `Starts the same week, but now runs ${plural(change.weeks, "week")} instead of ${plural(
      change.fromWeeks ?? change.weeks,
      "week",
    )}`,
  };
}

/**
 * Shape the roadmap for the tutor's full plan.
 *
 * `showHistory` starts the weeks at the programme's first week rather than this
 * one — a topic taught before today has no row at all otherwise, and cannot be
 * found or opened.
 *
 * While a re-plan is pending, the weeks show the new plan: the student applies
 * it without being asked the next time they open their planner, so it is the
 * plan they will actually meet. The topic it displaces is named on the line.
 */
export function formatSchedule(
  data: RoadmapResult,
  opts: { now: string; showHistory: boolean },
): FormattedSchedule {
  const { now } = opts;

  const pointById = new Map<string, ProgressPoint>(
    data.progress.flatMap((t) => t.points.map((p) => [p.id, p] as const)),
  );
  const topicPoints = new Map<string, PlanPoint[]>(
    data.progress.map((t) => [t.topicId, t.points.map(fromProgress)]),
  );
  const toPlanPoint = (ref: { specPointId: string; code: string; title: string }): PlanPoint => ({
    specPointId: ref.specPointId,
    code: ref.code,
    title: ref.title,
    progress: pointById.get(ref.specPointId) ?? null,
  });

  const spine = data.bands.filter(isTeachBand);
  const focus = data.bands.filter((b) => !isTeachBand(b));
  const pending = data.needsAck && data.changes.length > 0;
  const baseline = pending ? data.baselineBands.filter(isTeachBand) : [];
  const covered = new Set(data.coveredTopicIds);
  const changes = new Map(data.changes.map((c) => [c.topicId, c]));
  const assigned = new Set(data.catchUpSchedule?.assignedIds ?? []);

  // Which of a past week's promises are still outstanding. From the display
  // backlog, so work already pulled into this week stops being reported as
  // missed in the week it was first due.
  const missedByWeek = new Map<string, number>();
  for (const topic of data.backlogByTopic ?? [])
    for (const point of topic.points)
      missedByWeek.set(point.plannedWeek, (missedByWeek.get(point.plannedWeek) ?? 0) + 1);

  const teachLine = (wk: string): TeachLine | null => {
    const band = spine.find((b) => inBand(b, wk));
    if (!band) return null;
    const all = topicPoints.get(band.topicId) ?? [];
    // This week's share, as the year plan divided it. A band stored before
    // `pointsByWeek` existed falls back to the whole topic.
    const refs = band.pointsByWeek?.[wk] ?? (band.fixedPoints ? [] : undefined);
    const points = refs ? refs.map(toPlanPoint) : all;
    const was = baseline.find((b) => inBand(b, wk));
    const change = wk === band.startWeek ? changes.get(band.topicId) : undefined;
    return {
      kind: "teach",
      key: `teach:${band.topicId}`,
      topicId: band.topicId,
      title: band.title,
      points,
      wholeTopic: refs && refs.length < all.length ? all : null,
      covered: covered.has(band.topicId),
      missed: wk < now ? (missedByWeek.get(wk) ?? 0) : 0,
      change: change ? describeChange(change) : null,
      replaces: pending && was && was.topicId !== band.topicId ? was.title : null,
    };
  };

  const catchUpLines = (wk: string): CatchUpLine[] =>
    byTopic(data.catchUpSchedule?.weeks[wk] ?? []).map((topic) => ({
      kind: "catchup",
      key: `catchup:${topic.topicId}`,
      topicId: topic.topicId,
      title: topic.topicTitle,
      points: topic.points.map(toPlanPoint),
      wholeTopic: null,
      confirmed: topic.points.every((p) => assigned.has(p.specPointId)),
      byDueWeek: groupByDueWeek(topic.points).map(({ week, points }) => ({
        week,
        label: shortDate(week),
        points: points.map(toPlanPoint),
      })),
    }));

  const revisitLines = (wk: string): RevisitLine[] =>
    focus
      .filter((b) => inBand(b, wk))
      .map((band) => {
        const all = topicPoints.get(band.topicId) ?? [];
        const refs = band.points ?? [];
        // A revisit names the weak points it brought back; a review is the
        // whole topic taken lightly, so the topic's own list is the honest one.
        return {
          kind: "revisit",
          key: `revisit:${band.topicId}|${band.kind}|${band.startWeek}`,
          topicId: band.topicId,
          title: band.title,
          points: refs.length > 0 ? refs.map(toPlanPoint) : all,
          wholeTopic: refs.length > 0 && refs.length < all.length ? all : null,
          estimated: refs.some((p) => !!p.dueAt),
        };
      });

  const weekKeys = weekKeysBetween(opts.showHistory ? data.programStart : now, data.examDate);
  const months: PlanMonth[] = [];
  for (const wk of weekKeys) {
    const date = weekKeyToDate(wk);
    const teach = teachLine(wk);
    const week: PlanWeek = {
      key: wk,
      day: String(Number(wk.slice(8))),
      month: plannerDateLabel(date, { month: "short" }),
      label: `Week of ${plannerDateLabel(date, { day: "numeric", month: "long", year: "numeric" })}`,
      isNow: wk === now,
      isPast: wk < now,
      isExam: wk >= data.examDate,
      lines: [...(teach ? [teach] : []), ...catchUpLines(wk), ...revisitLines(wk)],
    };
    const monthKey = wk.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === monthKey) last.weeks.push(week);
    else
      months.push({
        key: monthKey,
        label: plannerDateLabel(weekKeyToDate(`${monthKey}-01`), {
          month: "long",
          year: "numeric",
        }),
        weeks: [week],
      });
  }

  const topicIds = new Set(spine.map((b) => b.topicId));
  const coveredCount = [...topicIds].filter((id) => covered.has(id)).length;
  const summary: PlanSummary = {
    covered: coveredCount,
    total: topicIds.size,
    percent: topicIds.size ? Math.round((coveredCount / topicIds.size) * 100) : 0,
    examDate: plannerDateLabel(weekKeyToDate(data.examDate), {
      day: "numeric",
      month: "short",
      year: "numeric",
    }),
    weeksLeft: Math.max(0, weekKeysBetween(now, data.examDate).length - 1),
  };

  const attention: PlanAttention = {
    missed: (data.backlogByTopic ?? []).map((t) => ({
      topicId: t.topicId,
      title: t.topicTitle,
      specPointIds: t.points.map((p) => p.specPointId),
      since: shortDate(t.since),
    })),
    heldCount: data.catchUpSchedule?.held.length ?? 0,
    overload: data.focusLoad.overloaded
      ? {
          reviews: data.reviewBacklog.map((p) => ({
            specPointId: p.specPointId,
            code: p.code,
            title: p.pointTitle,
          })),
          topics: data.unscheduledTopicTitles,
        }
      : null,
    moved: pending
      ? data.changes.map((c) => ({
          topicId: c.topicId,
          title: c.title,
          from: c.from ? shortDate(c.from) : null,
          to: shortDate(c.to),
        }))
      : null,
  };

  return {
    summary,
    attention,
    hasAttention:
      attention.missed.length > 0 ||
      attention.heldCount > 0 ||
      attention.overload !== null ||
      attention.moved !== null,
    earlierWeeks: Math.max(0, weekKeysBetween(data.programStart, now).length - 1),
    months,
    replanPending: data.needsAck,
  };
}

/**
 * The months shown before the tutor asks for the rest: every month up to and
 * including the current one, then `upcoming - 1` more. A year of weeks is
 * forty rows; the next few months are what a tutor plans against.
 */
export function foldMonths(
  months: PlanMonth[],
  upcoming: number,
): { visible: PlanMonth[]; hiddenWeeks: number } {
  const nowAt = months.findIndex((m) => m.weeks.some((w) => w.isNow));
  const cut = Math.max(0, nowAt) + upcoming;
  const visible = months.slice(0, cut);
  const hiddenWeeks = months.slice(cut).reduce((n, m) => n + m.weeks.length, 0);
  return { visible, hiddenWeeks };
}

function fromProgress(p: ProgressPoint): PlanPoint {
  return { specPointId: p.id, code: p.code, title: p.title, progress: p };
}

function groupByDueWeek(points: BacklogPoint[]): { week: string; points: BacklogPoint[] }[] {
  const groups = new Map<string, BacklogPoint[]>();
  for (const p of points) groups.set(p.plannedWeek, [...(groups.get(p.plannedWeek) ?? []), p]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, pts]) => ({ week, points: pts }));
}
