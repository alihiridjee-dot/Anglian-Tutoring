import { customSchedule, orderInputs, reorderTopics, type OrderTopic } from "./topicOrder";
import { addWeeks, toDateKey, weekKeyToDate } from "./week";
import { type TopicProgress } from "./scheduleDal";
import {
  type FocusCandidate,
  type FocusLoad,
  type PacingBand,
  type PacingChange,
  type PacingInput,
  computePacing,
  diffPacing,
  focusLoadFor,
  isTeachBand,
  mergeFocus,
  projectReviews,
  weeksBetween,
  withWeeklyPoints,
} from "./pacing";
import { partition, spineReach, type RejectionReason } from "./admissibility";
import {
  byTopic,
  projectCatchUp,
  type CatchUpSchedule,
  spineBacklog,
  type BacklogPoint,
  type TopicBacklog,
} from "./backlog";
import { type PlanPoint, type WithheldPlanPoint } from "./weeklyPlanDal";

/** Assessment-backed cards supply one next review per point. */
export function focusInputs(progress: TopicProgress[]): {
  candidates: FocusCandidate[];
} {
  const candidates: FocusCandidate[] = [];
  for (const t of progress)
    for (const p of t.points) {
      if (p.reps > 0 && p.dueAt && p.eligibleAt && p.lastReviewedAt)
        candidates.push({
          specPointId: p.id,
          topicId: t.topicId,
          topicTitle: t.title,
          code: p.code,
          pointTitle: p.title,
          dueAt: p.dueAt,
          eligibleAt: p.eligibleAt,
          lastReviewedAt: p.lastReviewedAt,
          retention: p.retention,
          weight: p.weight,
        });
    }
  return { candidates };
}

/** One point the admissibility rule kept out of a week, with its reason. */
export interface InadmissiblePoint {
  specPointId: string;
  code: string;
  title: string;
  topicId: string;
  topicTitle: string;
  reason: RejectionReason;
}

export interface RoadmapResult {
  /** The live curriculum bands (past/current/future), most-recent first order. */
  bands: PacingBand[];
  /**
   * The spine the student last accepted. While `needsAck` is true this is what
   * they are still living by, and `bands` is the proposal — the roadmap shows
   * the two side by side so a reschedule is something they see and accept
   * rather than something that has already happened to them.
   */
  baselineBands: PacingBand[];
  /** Topics whose start week moved since the student last acknowledged. */
  changes: PacingChange[];
  needsAck: boolean;
  programStart: string;
  examDate: string;
  /** Topic ids whose points all have assessed marks of at least 70%. */
  coveredTopicIds: string[];
  completedPointIds?: string[];
  /** Per-topic mastery + spec-point breakdown, for the expandable timeline. */
  progress: TopicProgress[];
  reviewBacklog: FocusCandidate[];
  /**
   * Points the programme refused to assign, and why — work that would otherwise
   * have been scheduled for a topic the spine has not reached, a course the
   * student is not on, or a review with nothing behind it. Reported rather than
   * silently dropped, so the tutor's attention panel can show what was withheld
   * instead of the student quietly receiving material they have never been
   * taught. See [[admissibility]].
   */
  inadmissible: InadmissiblePoint[];
  /**
   * Spec points the spine allocated to a week that has passed, and which
   * nothing has covered since — see [[backlog]].
   *
   * Distinct from `inadmissible`, which is work the engine *refused*. This is
   * work it promised and never delivered: before this existed such a point fell
   * out of both lanes permanently and was reported nowhere, so a topic taught
   * before the student engaged simply ceased to exist as far as the planner was
   * concerned.
   */
  backlog: BacklogPoint[];
  /**
   * The backlog grouped by topic, oldest first — **minus** anything the current
   * week's plan is already carrying, which is what a surface should offer to
   * put right. Read this, not `backlog`, for display.
   */
  backlogByTopic: TopicBacklog[];
  catchUpSchedule?: CatchUpSchedule;
  unscheduledTopicTitles: string[];
  /** Exam-horizon backlog reporting for the roadmap and weekly plan. */
  focusLoad: FocusLoad;
}

/** A week as `WeeklyPlanDAL.getPlan` reads it back: what is active, and what was withheld. */
type SavedWeek = { points: PlanPoint[]; withheld: WithheldPlanPoint[] };

/**
 * Everything {@link buildRoadmap} needs, already read. `ProgramDAL.loadRoadmap`
 * gathers these; nothing in this file touches the network or the clock.
 */
export interface RoadmapInputs {
  progress: TopicProgress[];
  /** The acknowledged programme row, or null before the student's first view. */
  baseline: { program_start: string; exam_date: string; pacing: PacingBand[] } | null;
  /** This week's saved assignment. Null when there is none, or when only projecting. */
  savedWeek: SavedWeek | null;
  /** The week whose catch-up allowance is already spoken for. */
  catchUpWeek: SavedWeek | null;
  ledger: { done: Set<string>; outstanding: Set<string> };
  thisMonday: Date;
  /** The stored exam week, or the default one before a baseline exists. */
  examMonday: Date;
}

/**
 * The roadmap as a pure function of what was read: the spine, the reviews
 * projected onto it, what the admissibility rule withheld, and the debt the
 * spine promised and did not deliver.
 */
export function buildRoadmap(inputs: RoadmapInputs): RoadmapResult {
  const { progress, baseline, savedWeek, catchUpWeek, ledger, thisMonday, examMonday } = inputs;

  const topics: PacingInput[] = progress.map((t) => ({
    topicId: t.topicId,
    title: t.title,
    weight: t.points.reduce((sum, p) => sum + p.weight, 0) || 1,
  }));

  // Coverage is assessed understanding, separate from the next memory review.
  const coveredTopicIds = new Set(progress.filter((t) => t.settled).map((t) => t.topicId));
  const focus = focusInputs(progress);

  // Each topic's spec points in curriculum order, so a teach band can carry
  // its week-by-week division rather than just a topic and a date range.
  const pointsByTopic = new Map(
    progress.map((t) => [
      t.topicId,
      t.points.map((p) => ({
        specPointId: p.id,
        code: p.code,
        title: p.title,
        weight: p.weight,
      })),
    ]),
  );

  // The spine is a pure function of (enrolment week, exam date, topic weights),
  // so it is computed once, before anything is allowed into a week. Its reach
  // is what the admissibility rule tests against: a review cannot be assigned
  // for a topic the programme has not opened yet, however good the FSRS
  // evidence behind it looks. See [[admissibility]].
  const start = baseline ? weekKeyToDate(baseline.program_start) : thisMonday;
  const stored = baseline ? baseline.pacing : [];
  const custom = customSchedule(stored);
  const live = liveSpine({
    topics,
    start,
    examMonday,
    baseline,
    progress,
    pointsByTopic,
    thisMonday,
  });
  // The acknowledged spine, not the live recomputation, so this agrees with
  // the `plan_point_admissible` trigger — which reads the same stored pacing.
  // Two enforcement layers answering the same question differently is worse
  // than either answer. Falls back to `live` only before a baseline exists.
  const reviewReach = spineReach(baseline ? stored : live, true);
  const thisWeek = toDateKey(thisMonday);
  const examDate = baseline ? baseline.exam_date : toDateKey(examMonday);
  const inadmissible: InadmissiblePoint[] = [];

  const savedIds = new Set(savedWeek?.points.map((p) => p.spec_point_id) ?? []);
  // A saved assignment owns this week. Never project a second copy of pending work.
  const eligible = partition(
    focus.candidates.filter(
      (p) => !savedIds.has(p.specPointId) || new Date(p.lastReviewedAt) >= thisMonday,
    ),
    (c) => ({
      specPointId: c.specPointId,
      topicId: c.topicId,
      origin: "focus",
      // A candidate only exists because assessed practice produced a card.
      hasEvidence: true,
      onCourse: true,
    }),
    // Projection starts at the week the plan is being cut for, so that is the
    // week the spine test has to answer for.
    {
      reach: new Map(),
      weekStart: savedWeek ? toDateKey(addWeeks(thisMonday, 1)) : thisWeek,
      examDate,
    },
  );
  for (const { point, reason } of eligible.rejected)
    inadmissible.push({
      specPointId: point.specPointId,
      code: point.code,
      title: point.pointTitle,
      topicId: point.topicId,
      topicTitle: point.topicTitle,
      reason,
    });
  const projection = projectReviews({
    ...focus,
    candidates: eligible.admitted,
    topicOpenings: reviewReach,
    currentMonday: savedWeek ? addWeeks(thisMonday, 1) : thisMonday,
    examMonday,
  });
  if (savedWeek) {
    // All saved-week consumers use the DAL's same active/history split.
    const admitted = savedWeek.points.filter((p) => p.origin === "focus");
    for (const { point, reason } of savedWeek.withheld)
      inadmissible.push({
        specPointId: point.spec_point_id,
        code: point.code,
        title: point.title,
        topicId: point.topic_id,
        topicTitle: point.topic_title ?? "",
        reason,
      });
    const grouped = new Map<string, typeof savedWeek.points>();
    for (const p of admitted) {
      grouped.set(p.topic_id, [...(grouped.get(p.topic_id) ?? []), p]);
    }
    for (const [topicId, points] of grouped)
      projection.bands.unshift({
        topicId,
        title: points[0].topic_title ?? "Assigned review",
        kind: "revisit",
        startWeek: thisWeek,
        endWeek: thisWeek,
        weeks: 1,
        points: points.map((p) => ({
          specPointId: p.spec_point_id,
          code: p.code,
          title: p.title,
        })),
      });
  }
  const teachingWeeksShort = Math.max(
    0,
    topics.length - Math.max(0, weeksBetween(start, examMonday)),
  );

  /**
   * What the spine promised and did not deliver.
   *
   * Measured against the **acknowledged** spine, hydrated with the same
   * weighted weekly division the student was shown, for the same reason the
   * admissibility rule reads it: until they accept a reschedule, the stored
   * plan is the one they are living by, and chasing them for a week a
   * recomputation has since moved would be chasing a promise nobody made.
   *
   * Evidence counts as delivery, so a point FSRS is already scheduling never
   * appears here — the focus lane owns it and the two must not both assign it.
   */
  const promised = withWeeklyPoints(
    baseline ? baseline.pacing.filter(isTeachBand) : live,
    pointsByTopic,
  );

  const backlog = spineBacklog({
    bands: promised,
    weekStart: thisWeek,
    pointsByTopic,
    ledger: {
      ...ledger,
      assessed: new Set(
        progress.flatMap((t) =>
          t.points.filter((p) => p.assessability === "assessed").map((p) => p.id),
        ),
      ),
    },
  });
  /**
   * The same debt, minus what this week is already carrying.
   *
   * `backlog` deliberately still holds those points — the trickle re-selects
   * them on every cut of the current week, and dropping them would make a
   * re-cut lose the catch-up work and the next cut put it back. But a panel
   * that goes on offering "practise Topic 1 now" the moment after a student
   * has put all of Topic 1 into this week is nagging them about work they can
   * see in front of them, so the display asks the narrower question: what is
   * still not being dealt with anywhere?
   */
  const inThisWeek = new Set(savedWeek?.points.map((p) => p.spec_point_id) ?? []);
  const unaddressed = backlog.filter((p) => !inThisWeek.has(p.specPointId));

  const assignedIds = new Set(
    catchUpWeek?.points.filter((p) => p.origin !== "focus").map((p) => p.spec_point_id) ?? [],
  );
  const pastPromises = spineBacklog({
    bands: promised,
    weekStart: thisWeek,
    pointsByTopic,
    ledger: { assessed: new Set(), done: new Set(), outstanding: new Set() },
  });
  const catchUpSchedule = projectCatchUp({
    backlog,
    assigned: pastPromises.filter((p) => assignedIds.has(p.specPointId)),
    weekStart: thisWeek,
    examDate,
    weeklyWeight: focusLoadFor({ topics, spine: live }).spine,
  });

  // The topics the runway is too short to reach, in curriculum order.
  const beyondTheRunway = topics
    .slice(Math.max(0, topics.length - teachingWeeksShort))
    .map((t) => t.title);

  // What the roadmap says whether or not a baseline has been acknowledged yet.
  const common = {
    // Weekly points are added for display only — `live` stays clean, so the
    // stored baseline and its diff never see them.
    bands: mergeFocus(withWeeklyPoints(live, pointsByTopic), projection.bands),
    examDate,
    coveredTopicIds: [...coveredTopicIds],
    completedPointIds: [...ledger.done],
    progress,
    reviewBacklog: projection.backlog,
    inadmissible,
    backlog,
    backlogByTopic: byTopic(unaddressed),
    catchUpSchedule,
    focusLoad: focusLoadFor({
      topics,
      spine: live,
      backlog: projection.backlog,
      teachingWeeksShort,
    }),
  };

  if (!baseline) {
    return {
      ...common,
      baselineBands: live,
      changes: [],
      needsAck: false,
      // First view = enrolment: this Monday becomes the student's permanent
      // spine anchor, and their runway to the exam sets the weekly pace.
      programStart: toDateKey(thisMonday),
      unscheduledTopicTitles: beyondTheRunway,
    };
  }

  // `live` was recomputed above from the same inputs — it only ever differs
  // from the stored baseline when the exam date moved or the curriculum
  // itself changed.
  const changes = diffPacing(baseline.pacing, live);
  return {
    ...common,
    baselineBands: baseline.pacing.filter(isTeachBand),
    changes,
    needsAck: changes.length > 0,
    programStart: baseline.program_start,
    unscheduledTopicTitles: custom
      ? topicsWithUnpromisedPoints(progress, promised)
      : beyondTheRunway,
  };
}

/**
 * The spine as it would be cut today. Curriculum order is recomputed from the
 * topic weights. A custom order is kept as stored, and is only re-spread over
 * the topics still to come when the exam date has moved since it was chosen.
 */
function liveSpine(params: {
  topics: PacingInput[];
  start: Date;
  examMonday: Date;
  baseline: RoadmapInputs["baseline"];
  progress: TopicProgress[];
  pointsByTopic: Map<string, OrderTopic["points"]>;
  thisMonday: Date;
}): PacingBand[] {
  const { topics, start, examMonday, baseline, progress, pointsByTopic, thisMonday } = params;
  const computed = computePacing(topics, start, examMonday);
  const stored = baseline ? baseline.pacing : [];
  const custom = customSchedule(stored);
  if (!custom || !baseline) return computed;
  if (custom.examDate === baseline.exam_date) return stored;

  const from = [custom.from, toDateKey(thisMonday)].sort().at(-1)!;
  const orderTopics = progress.map((t) => ({
    topicId: t.topicId,
    title: t.title,
    points: pointsByTopic.get(t.topicId)!,
  }));
  const remaining = orderInputs(stored, orderTopics, from).remaining;
  if (!remaining.length) return stored;
  return reorderTopics({
    bands: stored,
    topics: orderTopics,
    order: remaining.map((t) => t.topicId),
    from,
    examDate: baseline.exam_date,
  });
}

/** Under a custom order: topics with at least one point no week of the spine carries. */
function topicsWithUnpromisedPoints(progress: TopicProgress[], promised: PacingBand[]): string[] {
  return progress
    .filter((t) =>
      t.points.some(
        (p) =>
          !promised.some((b) =>
            Object.values(b.pointsByWeek ?? {})
              .flat()
              .some((ref) => ref.specPointId === p.id),
          ),
      ),
    )
    .map((t) => t.title);
}
