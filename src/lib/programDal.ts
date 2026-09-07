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
import { WeeklyPlanDAL, type PlanPointOrigin } from "./weeklyPlanDal";
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
  unscheduledTopicTitles: string[];
  /** Exam-horizon backlog reporting for the roadmap and weekly plan. */
  focusLoad: FocusLoad;
}

/**
 * The year-long curriculum programme ([[pacing]]) with persistence. The core
 * spine is FIXED: laid once, sequentially, from the student's enrolment week
 * (their first view of the programme) to the agreed exam date, weeks allocated
 * by weight — and it never re-flows from progress. The whole course is spread
 * evenly over that personal runway: enrol early and the weeks run light, join
 * late and each week carries more. The only spine-moving event is the exam date
 * changing, and that shift surfaces as a diff for the student to accept. The
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
    const live = computePacing(topics, start, examMonday);
    // The acknowledged spine, not the live recomputation, so this agrees with
    // the `plan_point_admissible` trigger — which reads the same stored pacing.
    // Two enforcement layers answering the same question differently is worse
    // than either answer. Falls back to `live` only before a baseline exists.
    const reach = spineReach(baseline ? (baseline.pacing as unknown as PacingBand[]) : live);
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
      topicOpenings: reach,
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
        progress,
        reviewBacklog: projection.backlog,
        inadmissible,
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
      progress,
      reviewBacklog: projection.backlog,
      inadmissible,
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
      const { specPointIds, lanes, teachTitle, focusCount, teachCount } = selectWeekPoints({
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
        topics: roadmap.progress,
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
      return {
        specPointIds,
        origins: lanes,
        rationale: `From your programme: ${listSentence(parts)}. Reviews follow assessed practice and are assigned when eligible.`,
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
  }): Promise<boolean> {
    const { studentId, subject, board, level, weekStart } = params;
    const existing = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
    if (!existing) return false; // nothing saved yet — the normal build path owns this

    const roadmap = await this.loadRoadmap({
      studentId,
      subject,
      board,
      level,
      projectOnly: true,
    });
    const fresh = await this.planForWeek({ ...params, roadmap });

    const coverage = await WeeklyPlanDAL.getCoverage(
      studentId,
      existing.points.map((p) => p.spec_point_id),
      weekStart,
    );

    // Completed attempts remain visible too: re-planning must not erase progress.
    const inFlight = (id: string): boolean => !!coverage.get(id)?.attempted;
    // getPlan exposes only admissible work here. Withheld history is preserved
    // by save_weekly_plan itself; resubmitting it would re-trigger admission.
    const keep = existing.points.filter(
      (p) =>
        handPicked(p.origin) || hasStudentHistory({ ...p, attempted: inFlight(p.spec_point_id) }),
    );

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
      origins[p.spec_point_id] = p.origin;
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
    const unchanged =
      specPointIds.length === before.size && specPointIds.every((id) => before.has(id));
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
