import { addWeeks, currentWeekKey, mondayOf, toDateKey, weekKeyToDate } from "./week";
import {
  computePacing,
  isTeachBand,
  weightOf,
  withWeeklyPoints,
  weeksBetween,
  type FocusPointRef,
  type PacingBand,
} from "./pacing";

export interface OrderTopic {
  topicId: string;
  title: string;
  points: FocusPointRef[];
}
export const customSchedule = (bands: PacingBand[]) => bands.find((b) => b.schedule)?.schedule;

/** Freeze the actual weekly promises before the boundary, including a partial topic. */
export function orderInputs(bands: PacingBand[], topics: OrderTopic[], from: string) {
  const hydrated = withWeeklyPoints(
    bands.filter(isTeachBand),
    new Map(topics.map((t) => [t.topicId, t.points])),
  );
  const frozen: PacingBand[] = [];
  const promised = new Set<string>();
  for (const band of hydrated) {
    if (band.startWeek >= from) continue;
    const endWeek =
      band.endWeek < from ? band.endWeek : toDateKey(addWeeks(weekKeyToDate(from), -1));
    const pointsByWeek = Object.fromEntries(
      Object.entries(band.pointsByWeek ?? {}).filter(([week]) => week < from),
    );
    Object.values(pointsByWeek)
      .flat()
      .forEach((p) => promised.add(p.specPointId));
    frozen.push({
      ...band,
      endWeek,
      weeks: weeksBetween(weekKeyToDate(band.startWeek), weekKeyToDate(endWeek)) + 1,
      pointsByWeek,
      fixedPoints: true,
    });
  }
  const remaining = topics
    .map((t) => ({ ...t, points: t.points.filter((p) => !promised.has(p.specPointId)) }))
    .filter((t) => t.points.length);
  const position = new Map<string, number>();
  hydrated
    .filter((b) => b.endWeek >= from)
    .forEach((b, i) => {
      if (!position.has(b.topicId)) position.set(b.topicId, i);
    });
  remaining.sort(
    (a, b) => (position.get(a.topicId) ?? Infinity) - (position.get(b.topicId) ?? Infinity),
  );
  return { frozen, remaining };
}

export function reorderTopics(params: {
  bands: PacingBand[];
  topics: OrderTopic[];
  order: string[];
  from: string;
  examDate: string;
  today?: string;
}): PacingBand[] {
  const { bands, topics, order, from, examDate } = params;
  const day = weekKeyToDate(from);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || !Number.isFinite(weekKeyToDate(examDate).getTime()))
    throw new Error("Set a valid exam date before changing topic order.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !Number.isFinite(day.getTime()) ||
    toDateKey(mondayOf(day)) !== from
  )
    throw new Error("Choose a Monday for the change to start.");
  if (from < (params.today ?? currentWeekKey()))
    throw new Error("Earlier weeks cannot be changed.");
  if (from >= examDate) throw new Error("Choose a week before your exams.");
  const { frozen, remaining } = orderInputs(bands, topics, from);
  const byId = new Map(remaining.map((t) => [t.topicId, t]));
  if (
    order.length !== remaining.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !byId.has(id))
  )
    throw new Error("Include each remaining topic exactly once.");
  if (!remaining.length) throw new Error("There are no remaining topics to move from this week.");
  if (weeksBetween(day, weekKeyToDate(examDate)) < remaining.length)
    throw new Error(
      `There are not enough weeks before the exam for all ${remaining.length} remaining topics. Choose an earlier week or review your exam date.`,
    );
  const sorted = order.map((id) => byId.get(id)!);
  const allocated = computePacing(
    sorted.map((t) => ({ ...t, weight: t.points.reduce((sum, p) => sum + weightOf(p), 0) })),
    day,
    weekKeyToDate(examDate),
  );
  const future = withWeeklyPoints(allocated, new Map(sorted.map((t) => [t.topicId, t.points]))).map(
    (b) => {
      const previous = bands.filter((p) => p.topicId === b.topicId);
      return {
        ...b,
        fixedPoints: true,
        // Preserve admission for teaching already reached and the previous review horizon.
        openedWeek: previous
          .map((p) => p.openedWeek ?? p.startWeek)
          .filter((w) => w <= (params.today ?? currentWeekKey()))
          .sort()[0],
        // The old review horizon is kept only for a band that had actually
        // opened. Keeping a never-reached band's start let a topic moved from
        // November to April be revised from November — untaught material
        // assigned as revision.
        reviewStartWeek: [
          b.startWeek,
          ...previous
            .map((p) => p.reviewStartWeek ?? p.startWeek)
            .filter((w) => w <= (params.today ?? currentWeekKey())),
        ].sort()[0],
      };
    },
  );
  return [...frozen, ...future].map((b) => ({ ...b, schedule: { version: 1, from, examDate } }));
}

/**
 * The programme after a pause: it picks up where it stopped.
 *
 * Every promise before the week the pause began stands, so work missed before
 * the pause is still missed. Whatever was promised from that week on is spread
 * again, in the same topic order, from the week the student came back to the
 * exam. The weeks the subject was stopped hold no teaching, so nothing in them
 * counts as missed. The exam doesn't move, so the rest of the course runs a
 * little fuller each week (Ali's choice, 3 Oct 2026).
 *
 * Throws, leaving the plan as it was, when there are fewer weeks left than
 * topics: a pause ending right before the exams has nothing sensible to spread.
 */
export function resumeAfterPause(params: {
  bands: PacingBand[];
  topics: OrderTopic[];
  /** Monday of the week the pause began. */
  pausedFrom: string;
  /** Monday of the week the student came back. */
  resumeFrom: string;
  examDate: string;
}): PacingBand[] {
  const { bands, topics, pausedFrom, resumeFrom, examDate } = params;
  // Stopped and started in the same week: no week was skipped.
  if (resumeFrom <= pausedFrom) return bands;
  if (resumeFrom >= examDate)
    throw new Error("The exams have started, so there is nothing to re-plan.");
  const { frozen, remaining } = orderInputs(bands, topics, pausedFrom);
  if (!remaining.length) return bands;
  if (weeksBetween(weekKeyToDate(resumeFrom), weekKeyToDate(examDate)) < remaining.length)
    throw new Error(
      `There are not enough weeks before the exam for all ${remaining.length} remaining topics.`,
    );
  const allocated = computePacing(
    remaining.map((t) => ({ ...t, weight: t.points.reduce((sum, p) => sum + weightOf(p), 0) })),
    weekKeyToDate(resumeFrom),
    weekKeyToDate(examDate),
  );
  const future = withWeeklyPoints(
    allocated,
    new Map(remaining.map((t) => [t.topicId, t.points])),
  ).map((b) => {
    const previous = bands.filter((p) => p.topicId === b.topicId);
    return {
      ...b,
      fixedPoints: true,
      // Only teaching actually reached, before the pause, keeps a topic open.
      openedWeek: previous
        .map((p) => p.openedWeek ?? p.startWeek)
        .filter((w) => w < pausedFrom)
        .sort()[0],
      // As in reorderTopics: a review horizon survives only from a band that
      // was reached before the pause.
      reviewStartWeek: [
        b.startWeek,
        ...previous.map((p) => p.reviewStartWeek ?? p.startWeek).filter((w) => w < pausedFrom),
      ].sort()[0],
    };
  });
  return [...frozen, ...future].map((b) => ({
    ...b,
    schedule: { version: 1, from: resumeFrom, examDate },
  }));
}
