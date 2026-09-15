import { customSchedule, orderInputs, reorderTopics } from "./planner/topicOrder";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Json } from "@/integrations/supabase/types";
import { mondayOf, addWeeks, toDateKey, weekKeyToDate } from "./week";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import {
  type FocusCandidate,
  type FocusLoad,
  type PacingBand,
  type PacingChange,
  type PacingInput,
  computePacing,
  diffPacing,
  examMondayFor,
  focusLoadFor,
  isTeachBand,
  mergeFocus,
  projectReviews,
  weeksBetween,
  selectWeekPoints,
  withWeeklyPoints,
} from "./planner/pacing";
import {
  hasStudentHistory,
  partition,
  spineReach,
  type RejectionReason,
} from "./planner/admissibility";
import {
  byTopic,
  projectCatchUp,
  type CatchUpSchedule,
  catchUpBudget,
  spineBacklog,
  trickle,
  type BacklogPoint,
  type TopicBacklog,
} from "./planner/backlog";
import { WeeklyPlanDAL, type PlanPoint, type PlanPointOrigin } from "./weeklyPlanDal";
import { type PointCoverage } from "./planner/coverage";

/** "a", "a and b", "a, b and c" — for the plan's one-line rationale. */
function listSentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

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

/**
 * Was this point put in the week by a person rather than by the programme?
 *
 * The two hand-picked origins are the student's own additions and the tutor's
 * ({@link TutorPlannerPanel} writes `tutor`). They behave identically on a
 * re-cut — see {@link ProgramDAL.refreshWeek} — because the distinction that
 * matters there is "the programme did not choose this, so it does not get to
 * un-choose it", and that is equally true of both.
 */
export function handPicked(origin: PlanPointOrigin): boolean {
  return origin === "student" || origin === "tutor";
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

/**
 * The year-long curriculum programme ([[pacing]]) with persistence. The core
 * spine defaults to curriculum order from the first programme visit to the exam,
 * weighted by topic size. An explicit student reorder snapshots earlier weekly
 * promises and redistributes the remaining topics from a chosen Monday. Progress
 * never re-flows either schedule. Exam changes retain a custom order and require
 * acknowledgement before the remaining timetable is replaced. The
 * focus lane is the moving part: recomputed from assessed memory every load and
 * overlaid on the spine.
 */
export class ProgramDAL {
  static async loadRoadmap(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    projectOnly?: boolean;
    progress?: TopicProgress[];
  }): Promise<RoadmapResult | null> {
    const { studentId, subject, board, level } = params;

    // Progress already contains the ordered curriculum and weights. Reusing it
    // avoids two redundant reads and keeps teaching and reviews on one snapshot.
    const progress =
      params.progress ?? (await ScheduleDAL.getTopicProgress({ studentId, subject, board, level }));
    if (progress.length === 0) return null;
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

    const { data: baseline, error: baselineError } = await supabase
      .from("student_program_plan")
      .select("program_start, exam_date, pacing")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .maybeSingle();

    if (baselineError) throw baselineError;

    const thisMonday = mondayOf();

    // One figure for the year, computed once from the same candidates both the
    // roadmap and the week are about to be cut from.
    const examMonday = baseline ? weekKeyToDate(baseline.exam_date) : examMondayFor();

    // The spine is a pure function of (enrolment week, exam date, topic weights),
    // so it is computed once, before anything is allowed into a week. Its reach
    // is what the admissibility rule tests against: a review cannot be assigned
    // for a topic the programme has not opened yet, however good the FSRS
    // evidence behind it looks. See [[admissibility]].
    const start = baseline ? weekKeyToDate(baseline.program_start) : thisMonday;
    const stored = baseline ? (baseline.pacing as unknown as PacingBand[]) : [];
    const custom = customSchedule(stored);
    let live = computePacing(topics, start, examMonday);
    if (custom) {
      live = stored;
      if (custom.examDate !== baseline!.exam_date) {
        const from = [custom.from, toDateKey(thisMonday)].sort().at(-1)!;
        const orderTopics = progress.map((t) => ({
          topicId: t.topicId,
          title: t.title,
          points: pointsByTopic.get(t.topicId)!,
        }));
        const remaining = orderInputs(stored, orderTopics, from).remaining;
        if (remaining.length)
          live = reorderTopics({
            bands: stored,
            topics: orderTopics,
            order: remaining.map((t) => t.topicId),
            from,
            examDate: baseline!.exam_date,
          });
      }
    }
    // The acknowledged spine, not the live recomputation, so this agrees with
    // the `plan_point_admissible` trigger — which reads the same stored pacing.
    // Two enforcement layers answering the same question differently is worse
    // than either answer. Falls back to `live` only before a baseline exists.
    const reviewReach = spineReach(baseline ? stored : live, true);
    const thisWeek = toDateKey(thisMonday);
    const examDate = baseline ? baseline.exam_date : toDateKey(examMonday);
    const inadmissible: InadmissiblePoint[] = [];

    const savedWeek = params.projectOnly
      ? null
      : await WeeklyPlanDAL.getPlan(studentId, subject, toDateKey(thisMonday));
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
      baseline ? (baseline.pacing as unknown as PacingBand[]).filter(isTeachBand) : live,
      pointsByTopic,
    );
    // Read even under `projectOnly` — that flag suppresses reading back the
    // *saved week* so projection isn't doubled, and this is a different fact.
    // Skipping it would hand the generation path an empty ledger and chase the
    // student for work they had already done.
    const ledger = await WeeklyPlanDAL.getDeliveryLedger(studentId, subject, thisWeek);
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
    // Generation suppresses saved review bands, but must still reserve catch-up
    // capacity already used by this week's assignments, including completed ones.
    const catchUpWeek =
      savedWeek ??
      (params.projectOnly ? await WeeklyPlanDAL.getPlan(studentId, subject, thisWeek) : null);
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

    if (!baseline) {
      // First view = enrolment: this Monday becomes the student's permanent
      // spine anchor, and their runway to the exam sets the weekly pace.
      const programStart = toDateKey(thisMonday);

      // Seed the acknowledged baseline so the first view is calm (no diff) —
      // but ONLY when the student is the one looking.
      //
      // "First view = enrolment" is the rule, and it sets an anchor that never
      // moves again. That has to mean the student's first view. A tutor opening
      // the planner to check on a new student, or a parent looking before their
      // child has logged in, would otherwise stamp the programme's permanent
      // start week with the date THEY happened to look — silently compressing
      // or stretching a runway to the exam that nobody chose. With one tutor and
      // fifty students, the tutor gets there first almost every time.
      //
      // The read still answers normally; it just doesn't leave a mark. The
      // student's own first visit does the seeding, as intended.
      const viewerId = await getSessionUserId();
      if (viewerId === studentId) {
        const { error: seedError } = await supabase.from("student_program_plan").upsert(
          {
            student_id: studentId,
            subject,
            program_start: programStart,
            exam_date: examDate,
            pacing: live as unknown as Json,
          },
          { onConflict: "student_id,subject" },
        );
        if (seedError) throw seedError;
      }
      return {
        // Weekly points are added for display only — `live` stays clean, so the
        // stored baseline and its diff never see them.
        bands: mergeFocus(withWeeklyPoints(live, pointsByTopic), projection.bands),
        baselineBands: live,
        changes: [],
        needsAck: false,
        programStart,
        examDate,
        coveredTopicIds: [...coveredTopicIds],
        completedPointIds: [...ledger.done],
        progress,
        reviewBacklog: projection.backlog,
        inadmissible,
        backlog,
        backlogByTopic: byTopic(unaddressed),
        catchUpSchedule,
        unscheduledTopicTitles: topics
          .slice(Math.max(0, topics.length - teachingWeeksShort))
          .map((t) => t.title),
        focusLoad: focusLoadFor({
          topics,
          spine: live,
          backlog: projection.backlog,
          teachingWeeksShort,
        }),
      };
    }

    // `live` was recomputed above from the same inputs — it only ever differs
    // from the stored baseline when the exam date moved or the curriculum
    // itself changed.
    const changes = diffPacing(baseline.pacing as unknown as PacingBand[], live);
    return {
      bands: mergeFocus(withWeeklyPoints(live, pointsByTopic), projection.bands),
      baselineBands: (baseline.pacing as unknown as PacingBand[]).filter(isTeachBand),
      changes,
      needsAck: changes.length > 0,
      programStart: baseline.program_start,
      examDate: baseline.exam_date,
      coveredTopicIds: [...coveredTopicIds],
      completedPointIds: [...ledger.done],
      progress,
      reviewBacklog: projection.backlog,
      inadmissible,
      backlog,
      backlogByTopic: byTopic(unaddressed),
      catchUpSchedule,
      unscheduledTopicTitles: custom
        ? progress
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
            .map((t) => t.title)
        : topics.slice(Math.max(0, topics.length - teachingWeeksShort)).map((t) => t.title),
      focusLoad: focusLoadFor({
        topics,
        spine: live,
        backlog: projection.backlog,
        teachingWeeksShort,
      }),
    };
  }

  /** Top up only the catch-up allowance; never replace a saved assignment. */
  static async ensureCatchUp(params: {
    planId: string;
    weekStart: string;
    points: PlanPoint[];
    roadmap: RoadmapResult | null;
  }): Promise<boolean> {
    const existing = new Set(params.points.map((p) => p.spec_point_id));
    const missing = (params.roadmap?.catchUpSchedule?.weeks[params.weekStart] ?? [])
      .filter((p) => !existing.has(p.specPointId))
      .map((p) => p.specPointId);
    if (!missing.length) return false;
    await WeeklyPlanDAL.addPoints(params.planId, missing, "core");
    return true;
  }

  /** Build a week from fixed teaching and assessed reviews. Empty weeks stay empty. */
  static async planForWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    /** Monday date-key of the week being planned. */
    weekStart: string;
    roadmap?: RoadmapResult | null;
  }): Promise<{
    specPointIds: string[];
    /** Spec-point id → `core` or `focus`, persisted as the point's origin. */
    origins: Record<string, PlanPointOrigin>;
    rationale: string;
  }> {
    const { studentId, subject, board, level, weekStart } = params;
    const roadmap =
      params.roadmap !== undefined
        ? params.roadmap
        : await this.loadRoadmap({ studentId, subject, board, level, projectOnly: true });

    if (roadmap) {
      if (weekStart >= roadmap.examDate) return { specPointIds: [], origins: {}, rationale: "" };
      // Only what was promised strictly before the week being cut: the roadmap
      // measures the backlog from today, and a week planned further ahead has
      // not yet passed the weeks between.
      //
      // Both fields are tolerated as absent because the roadmap can be handed in
      // by a caller rather than loaded here. Catching up is an addition to the
      // week, so a roadmap that cannot describe the debt yields no catch-up
      // rather than no week.
      const due = (roadmap.backlog ?? []).filter((b) => b.plannedWeek < weekStart);
      const take = roadmap.catchUpSchedule
        ? (roadmap.catchUpSchedule.weeks[weekStart] ?? []).filter((p) =>
            due.some((b) => b.specPointId === p.specPointId),
          )
        : trickle(due, catchUpBudget(roadmap.focusLoad?.spine ?? 0)).take;
      const { specPointIds, lanes, teachTitle, focusCount, teachCount, catchUpIds, catchUpTopics } =
        selectWeekPoints({
          bands: [
            ...withWeeklyPoints(
              roadmap.baselineBands,
              new Map(
                roadmap.progress.map((t) => [
                  t.topicId,
                  t.points.map((p) => ({
                    specPointId: p.id,
                    code: p.code,
                    title: p.title,
                    weight: p.weight,
                  })),
                ]),
              ),
            ),
            ...roadmap.bands.filter((b) => !isTeachBand(b)),
          ],
          weekStart,
          topics: customSchedule(roadmap.baselineBands)
            ? roadmap.progress.map((t) => ({
                ...t,
                points: t.points.map((p) => ({
                  ...p,
                  reps: roadmap.completedPointIds?.includes(p.id) ? Math.max(1, p.reps) : p.reps,
                })),
              }))
            : roadmap.progress,
          catchUp: take.map((b) => ({
            specPointId: b.specPointId,
            topicTitle: b.topicTitle,
            weight: b.weight,
          })),
        });
      if (specPointIds.length === 0) {
        // The programme covers this week and has nothing outstanding in it. A
        // real answer, and the week's own copy says it far better than six
        // points picked for no stated reason would.
        return { specPointIds: [], origins: {}, rationale: "" };
      }
      const parts: string[] = [];
      if (focusCount > 0) parts.push(`${focusCount} to revisit`);
      if (teachCount > 0) parts.push(`${teachCount} from this week's topic (${teachTitle})`);
      if (catchUpIds.length > 0)
        parts.push(`${catchUpIds.length} catching up on ${listSentence(catchUpTopics)}`);
      // Naming the rest of the backlog is the point: the student is told the
      // debt exists and is being worked through, rather than meeting it as
      // unexplained old material appearing in their week for months.
      const remaining = due.length - catchUpIds.length;
      const chasing =
        remaining > 0
          ? ` ${remaining} more missed ${remaining === 1 ? "point is" : "points are"} queued for the weeks after this one.`
          : "";
      return {
        specPointIds,
        origins: lanes,
        rationale: `From your programme: ${listSentence(parts)}. Reviews follow assessed practice and are assigned when eligible.${chasing}`,
      };
    }

    // No curriculum means there is no work to allocate.
    return { specPointIds: [], origins: {}, rationale: "" };
  }

  /** Explicitly replace automatic assignments while preserving started, completed,
   * carried and manually assigned work. Returns whether the point set changed. */
  static async refreshWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
    expectedPointIds?: string[];
    /** Repair legacy review lanes without churning otherwise valid saved weeks. */
    repairUnsupportedReviews?: boolean;
    roadmap?: RoadmapResult | null;
  }): Promise<boolean> {
    const { studentId, subject, board, level, weekStart } = params;
    const existing = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
    if (!existing) return false; // nothing saved yet — the normal build path owns this

    // A caller that already holds the roadmap hands it over; otherwise it is
    // loaded here exactly as before.
    const roadmap =
      params.roadmap !== undefined
        ? params.roadmap
        : await this.loadRoadmap({
            studentId,
            subject,
            board,
            level,
            projectOnly: true,
          });
    // Missing curriculum is not evidence that a saved assignment is invalid.
    if (params.repairUnsupportedReviews && !roadmap) return false;
    const assessed = new Set(
      focusInputs(roadmap?.progress ?? []).candidates.map((p) => p.specPointId),
    );
    const unsupported = (p: PlanPoint) => p.origin === "focus" && !assessed.has(p.spec_point_id);
    /**
     * Reviews quarantined for having nothing behind them, which the repair is
     * about to turn into teaching.
     *
     * Since [[admissibility]], `getPlan` splits a saved week into `points` and
     * `withheld`, and a `focus` point with no assessed evidence is precisely
     * what lands in the second — so a repair that only scanned `points` would
     * find nothing to do and quietly no-op. Only `no-evidence` is pulled back:
     * a point withheld as ahead-of-spine or off-course has a different problem,
     * and relabelling its lane would not fix it.
     */
    const quarantined = existing.withheld
      .filter((w) => w.reason === "no-evidence")
      .map((w) => w.point);
    const saved = [...existing.points, ...quarantined];
    if (params.repairUnsupportedReviews && !saved.some(unsupported)) return false;
    const fresh = await this.planForWeek({ ...params, roadmap });

    const coverage = await WeeklyPlanDAL.getCoverage(
      studentId,
      saved.map((p) => p.spec_point_id),
      weekStart,
    );

    // Completed attempts remain visible too: re-planning must not erase progress.
    const inFlight = (id: string): boolean => !!coverage.get(id)?.attempted;
    /**
     * What survives the re-cut: hand-picked work, anything the student has
     * touched, and — when repairing — the quarantined reviews themselves.
     *
     * Withheld history is normally left alone, because resubmitting it would
     * just re-trigger admission and it is preserved by `save_weekly_plan`
     * regardless. A `no-evidence` review is the exception the repair exists
     * for: it is re-admitted deliberately, and only because its lane is about
     * to change to `core` below, which is a lane the rule accepts.
     */
    const keep = [
      // The original rule, unchanged: an active point survives a re-cut only if
      // a person chose it or the student has touched it. A stale automatic
      // review with no history is still dropped and re-selected from scratch.
      ...existing.points.filter(
        (p) =>
          handPicked(p.origin) || hasStudentHistory({ ...p, attempted: inFlight(p.spec_point_id) }),
      ),
      // Quarantined reviews are the addition, and they come back regardless of
      // history: having none is the whole reason they were withheld.
      ...(params.repairUnsupportedReviews ? quarantined : []),
    ];

    // Kept points first so their original lane wins the merge. Both planners
    // label every point they return, so the default below is unreachable — it is
    // `ai` ("generated, lane unknown") rather than `focus` because guessing
    // `focus` is exactly how a point the student never flagged ends up presented
    // to them as revision.
    const origins: Record<string, PlanPointOrigin> = {};
    // Carry markers ride along too — `savePlan` rewrites the point set wholesale,
    // so anything not handed back here is lost.
    const carriedFroms: Record<string, string | null> = {};
    for (const p of keep) {
      origins[p.spec_point_id] = roadmap && unsupported(p) ? "core" : p.origin;
      carriedFroms[p.spec_point_id] = p.carried_from;
    }
    for (const id of fresh.specPointIds) origins[id] ??= fresh.origins[id] ?? "ai";
    const specPointIds = Object.keys(origins);
    if (
      params.expectedPointIds &&
      (params.expectedPointIds.length !== specPointIds.length ||
        specPointIds.some((id) => !params.expectedPointIds!.includes(id)))
    ) {
      throw new Error(
        "Your assessment results or assignments changed. Preview the updated week again before applying it.",
      );
    }

    const before = new Set(existing.points.map((p) => p.spec_point_id));
    // Three independent reasons to write. The point set differing is the
    // obvious one; a point keeping its id while its *lane* was repaired is
    // Codex's case; and a week still holding withheld rows must be re-saved so
    // they are cleared, which is why an unchanged set is not enough on its own.
    const unchanged =
      specPointIds.length === before.size &&
      specPointIds.every((id) => before.has(id)) &&
      existing.points.every((p) => origins[p.spec_point_id] === p.origin);
    if (unchanged && existing.withheld.length === 0) return false;

    await WeeklyPlanDAL.savePlan({
      studentId,
      subject,
      board,
      level,
      weekStart,
      specPointIds,
      source: "ai",
      rationale: fresh.rationale,
      origins,
      carriedFroms,
      origin: "ai",
    });
    return true;
  }

  private static async reorderedReviews(p: {
    studentId: string;
    subject: SubjectV;
    progress: TopicProgress[];
    pacing: PacingBand[];
    examDate: string;
  }) {
    const monday = mondayOf();
    const saved = await WeeklyPlanDAL.getPlan(p.studentId, p.subject, toDateKey(monday));
    const assigned = new Set(saved?.points.map((point) => point.spec_point_id) ?? []);
    return projectReviews({
      candidates: focusInputs(p.progress).candidates.filter(
        (c) => !assigned.has(c.specPointId) || new Date(c.lastReviewedAt) >= monday,
      ),
      topicOpenings: spineReach(p.pacing, true),
      currentMonday: saved ? addWeeks(monday, 1) : monday,
      examMonday: weekKeyToDate(p.examDate),
    }).bands;
  }

  /** One transaction updates the spine and every already-saved affected week. */
  static async reorder(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    data: RoadmapResult;
    from: string;
    order: string[];
  }): Promise<void> {
    const { studentId, subject, board, level, data, from, order } = params;
    if ((await getSessionUserId()) !== studentId)
      throw new Error("Only the student can change their topic order.");
    if (data.needsAck)
      throw new Error("Accept your pending exam-date change before changing topic order.");
    const progress = await ScheduleDAL.getTopicProgress({ studentId, subject, board, level });
    const fingerprint = (items: TopicProgress[]) =>
      JSON.stringify(items.map((t) => [t.topicId, t.points.map((p) => [p.id, p.weight])]));
    if (fingerprint(progress) !== fingerprint(data.progress))
      throw new Error("Your curriculum changed. Reload and preview the new order.");
    const topics = progress.map((t) => ({
      topicId: t.topicId,
      title: t.title,
      points: t.points.map((p) => ({
        specPointId: p.id,
        code: p.code,
        title: p.title,
        weight: p.weight,
      })),
    }));
    const pacing = reorderTopics({
      bands: data.baselineBands,
      topics,
      order,
      from,
      examDate: data.examDate,
    });
    const { error } = await supabase.rpc("reorder_student_topics", {
      _subject: subject,
      _board: board,
      _level: level,
      _from: from,
      _expected_pacing: data.baselineBands as unknown as Json,
      _expected_exam: data.examDate,
      _pacing: pacing as unknown as Json,
      _assessed: progress.flatMap((t) => t.points.filter((p) => p.reps > 0).map((p) => p.id)),
      _reviews: (await this.reorderedReviews({
        studentId,
        subject,
        progress,
        pacing,
        examDate: data.examDate,
      })) as unknown as Json,
    });
    if (error) {
      if (error.code === "PGRST202")
        throw new Error(
          "Topic ordering is not available yet. Your current plan is unchanged. Please try again later.",
        );
      throw new Error(error.message);
    }
  }

  /**
   * Set a real exam date for one course. Stored verbatim (any weekday) — the
   * pacing math monday-ises internally, so this just moves the horizon the plan
   * flows toward; the next `loadRoadmap` re-flows the spine against it and
   * surfaces the resulting shift for the student to accept. The programme row is
   * seeded by the first `loadRoadmap`, so this is an update, not an upsert.
   */
  static async setExamDate(params: {
    studentId: string;
    subject: SubjectV;
    examDate: string;
  }): Promise<void> {
    const { data: saved, error: readError } = await supabase
      .from("student_program_plan")
      .select("pacing")
      .eq("student_id", params.studentId)
      .eq("subject", params.subject)
      .maybeSingle();
    if (readError) throw readError;
    const stored = (saved?.pacing ?? []) as unknown as PacingBand[];
    const custom = customSchedule(stored);
    if (custom) {
      const from = [custom.from, toDateKey(mondayOf())].sort().at(-1)!;
      const remaining = new Set(
        stored
          .filter((b) =>
            Object.entries(b.pointsByWeek ?? {}).some(([w, points]) => w >= from && points.length),
          )
          .map((b) => b.topicId),
      );
      if (weeksBetween(weekKeyToDate(from), weekKeyToDate(params.examDate)) < remaining.size)
        throw new Error(
          "That exam date leaves too few weeks for your remaining topics. Choose a later date.",
        );
    }
    const { error } = await supabase
      .from("student_program_plan")
      .update({ exam_date: params.examDate, updated_at: new Date().toISOString() })
      .eq("student_id", params.studentId)
      .eq("subject", params.subject);
    if (error) throw error;
  }

  /**
   * Accept the current live pacing as the new acknowledged baseline. Only the
   * spine persists — the focus lane is recomputed from live mastery every load.
   */
  static async acknowledge(params: {
    studentId: string;
    subject: SubjectV;
    bands: PacingBand[];
    programStart: string;
    examDate: string;
  }): Promise<void> {
    const schedule = customSchedule(params.bands);
    if (schedule) {
      const [
        { data: enrolment, error: enrolmentError },
        { data: profile, error: profileError },
        { data: baseline, error: baselineError },
      ] = await Promise.all([
        supabase
          .from("student_enrolments")
          .select("board")
          .eq("student_id", params.studentId)
          .eq("subject", params.subject)
          .single(),
        supabase.from("profiles").select("level").eq("id", params.studentId).single(),
        supabase
          .from("student_program_plan")
          .select("pacing, exam_date")
          .eq("student_id", params.studentId)
          .eq("subject", params.subject)
          .single(),
      ]);
      if (enrolmentError || profileError || baselineError || !profile?.level)
        throw new Error("Could not read your current course. Reload your planner.");
      const course = {
        studentId: params.studentId,
        subject: params.subject,
        board: enrolment!.board,
        level: profile.level,
      };
      const fresh = await this.loadRoadmap(course);
      if (
        !fresh ||
        JSON.stringify(fresh.bands.filter(isTeachBand)) !==
          JSON.stringify(params.bands.filter(isTeachBand))
      )
        throw new Error("Your plan changed. Reload and review the proposal again.");
      const { error } = await supabase.rpc("reorder_student_topics", {
        _subject: params.subject,
        _board: course.board,
        _level: course.level,
        _from: schedule.from,
        _expected_pacing: baseline!.pacing,
        _expected_exam: params.examDate,
        _pacing: params.bands.filter(isTeachBand) as unknown as Json,
        _assessed: fresh.progress.flatMap((t) =>
          t.points.filter((p) => p.reps > 0).map((p) => p.id),
        ),
        _reviews: (await this.reorderedReviews({
          ...course,
          progress: fresh.progress,
          pacing: params.bands,
          examDate: params.examDate,
        })) as unknown as Json,
      });
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from("student_program_plan").upsert(
      {
        student_id: params.studentId,
        subject: params.subject,
        program_start: params.programStart,
        exam_date: params.examDate,
        pacing: params.bands.filter(isTeachBand) as unknown as Json,
        acknowledged_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,subject" },
    );
    if (error) throw error;
  }
}
