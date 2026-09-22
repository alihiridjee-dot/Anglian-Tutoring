import { customSchedule, reorderTopics } from "./topicOrder";
import { supabase } from "@/integrations/supabase/client";
import { getSessionUserId } from "@/lib/auth/session";
import { type SubjectV, type BoardV, type LevelV } from "../curriculum/taxonomy";
import { type Json } from "@/integrations/supabase/types";
import { mondayOf, addWeeks, toDateKey, weekKeyToDate } from "./week";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import {
  type PacingBand,
  examMondayFor,
  isTeachBand,
  projectReviews,
  weeksBetween,
} from "./pacing";
import { spineReach } from "./admissibility";
import { WeeklyPlanDAL, type PlanPoint } from "./weeklyPlanDal";
import { WeeklyActivityDAL } from "./weeklyActivityDal";
import { PlanOverridesDAL } from "./planOverridesDal";
import { blockedBy, indexOverrides, programmeMayAssign, type PlanOverride } from "./overrides";
import { buildRoadmap, focusInputs, type RoadmapResult } from "./roadmap";
import { mergeWeek, selectWeek, unsupportedReviews, type WeekSelection } from "./weekCut";

export { handPicked } from "./weekCut";

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

    const { data: baseline, error: baselineError } = await supabase
      .from("student_program_plan")
      .select("program_start, exam_date, pacing")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .maybeSingle();

    if (baselineError) throw baselineError;

    const thisMonday = mondayOf();
    const thisWeek = toDateKey(thisMonday);

    // One figure for the year, computed once from the same candidates both the
    // roadmap and the week are about to be cut from.
    const examMonday = baseline ? weekKeyToDate(baseline.exam_date) : examMondayFor();

    const savedWeek = params.projectOnly
      ? null
      : await WeeklyPlanDAL.getPlan(studentId, subject, thisWeek);
    // Read even under `projectOnly` — that flag suppresses reading back the
    // *saved week* so projection isn't doubled, and this is a different fact.
    // Skipping it would hand the generation path an empty ledger and chase the
    // student for work they had already done.
    const ledger = await WeeklyActivityDAL.getDeliveryLedger(studentId, subject, thisWeek);
    // The tutor's standing decisions against the programme, read every load
    // for the same reason the ledger is: every lane below projects around them.
    const overrides = await PlanOverridesDAL.list(studentId, subject);
    // Generation suppresses saved review bands, but must still reserve catch-up
    // capacity already used by this week's assignments, including completed ones.
    const catchUpWeek =
      savedWeek ??
      (params.projectOnly ? await WeeklyPlanDAL.getPlan(studentId, subject, thisWeek) : null);

    const roadmap = buildRoadmap({
      progress,
      baseline: baseline && { ...baseline, pacing: baseline.pacing as unknown as PacingBand[] },
      savedWeek,
      catchUpWeek,
      ledger,
      thisMonday,
      examMonday,
      overrides,
    });

    if (!baseline) {
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
            program_start: roadmap.programStart,
            exam_date: roadmap.examDate,
            pacing: roadmap.baselineBands as unknown as Json,
          },
          { onConflict: "student_id,subject" },
        );
        if (seedError) throw seedError;
      }
    }
    return roadmap;
  }

  /**
   * Top up only the catch-up allowance; never replace a saved assignment.
   * Returns whether anything was actually added.
   *
   * `points` must include the week's withheld rows as well as its active ones.
   * A catch-up point already in the plan but withheld on read-back would
   * otherwise look missing on every load, be re-sent, be ignored as a
   * duplicate, and still report a change — re-reading the week and invalidating
   * the roadmap each time for nothing.
   */
  static async ensureCatchUp(params: {
    planId: string;
    weekStart: string;
    points: PlanPoint[];
    roadmap: RoadmapResult | null;
  }): Promise<boolean> {
    const existing = new Set(params.points.map((p) => p.spec_point_id));
    // The schedule was projected around the tutor's overrides already; the
    // test is repeated here so a roadmap handed in from elsewhere cannot top
    // the week up with a point the tutor took out of it.
    const overrides = indexOverrides(params.roadmap?.overrides);
    const missing = (params.roadmap?.catchUpSchedule?.weeks[params.weekStart] ?? [])
      .filter(
        (p) =>
          !existing.has(p.specPointId) &&
          programmeMayAssign(
            overrides,
            { specPointId: p.specPointId, origin: "core" },
            params.weekStart,
          ),
      )
      .map((p) => p.specPointId);
    if (!missing.length) return false;
    return (await WeeklyPlanDAL.addPoints(params.planId, missing, "core")) > 0;
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
  }): Promise<WeekSelection> {
    const { studentId, subject, board, level, weekStart } = params;
    const roadmap =
      params.roadmap !== undefined
        ? params.roadmap
        : await this.loadRoadmap({ studentId, subject, board, level, projectOnly: true });
    return selectWeek(roadmap, weekStart);
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
    const repair = unsupportedReviews(existing, roadmap);
    if (params.repairUnsupportedReviews && !repair.saved.some(repair.unsupported)) return false;
    const fresh = await this.planForWeek({ ...params, roadmap });

    const coverage = await WeeklyActivityDAL.getCoverage(
      studentId,
      repair.saved.map((p) => p.spec_point_id),
      weekStart,
    );

    const merged = mergeWeek({
      existing,
      fresh,
      coverage,
      roadmap,
      repair,
      repairUnsupportedReviews: params.repairUnsupportedReviews,
      expectedPointIds: params.expectedPointIds,
    });
    if (!merged) return false;

    await WeeklyPlanDAL.savePlan({
      studentId,
      subject,
      board,
      level,
      weekStart,
      specPointIds: merged.specPointIds,
      source: "ai",
      rationale: fresh.rationale,
      origins: merged.origins,
      carriedFroms: merged.carriedFroms,
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
    /** The tutor's overrides: skipped points are not reviewed, closed weeks are stepped past. */
    overrides?: PlanOverride[];
  }) {
    const monday = mondayOf();
    const saved = await WeeklyPlanDAL.getPlan(p.studentId, p.subject, toDateKey(monday));
    const assigned = new Set(saved?.points.map((point) => point.spec_point_id) ?? []);
    const overrides = indexOverrides(p.overrides);
    return projectReviews({
      candidates: focusInputs(p.progress).candidates.filter(
        (c) =>
          !overrides.skipped.has(c.specPointId) &&
          (!assigned.has(c.specPointId) || new Date(c.lastReviewedAt) >= monday),
      ),
      topicOpenings: spineReach(p.pacing, true),
      currentMonday: saved ? addWeeks(monday, 1) : monday,
      examMonday: weekKeyToDate(p.examDate),
      isBlocked: blockedBy(overrides),
    }).bands;
  }

  /**
   * One transaction updates the spine and every already-saved affected week.
   *
   * The student reorders their own plan; a tutor reorders it on their behalf,
   * naming the student, and the database checks the tutor's role. Either way
   * the re-cut weeks keep the student's pins, work and the tutor's overrides.
   */
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
    const viewer = await getSessionUserId();
    if (!viewer) throw new Error("Not signed in");
    // Only named when acting for someone else, so a database without the
    // parameter still serves the student's own reorder.
    const onBehalf = viewer !== studentId ? { _student_id: studentId } : {};
    if (data.needsAck)
      throw new Error("The plan is still updating. Open the planner, then try again.");
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
        overrides: data.overrides,
      })) as unknown as Json,
      ...onBehalf,
    });
    if (error) {
      if (error.code === "PGRST202")
        throw new Error(
          viewer !== studentId
            ? "Reordering a student's topics needs the planner override update installed. The plan is unchanged."
            : "Topic ordering is not available yet. Your current plan is unchanged. Please try again later.",
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
   * Make the re-flowed plan the plan, with no accept step.
   *
   * A spine only re-flows when the exam date or the course itself changes, and
   * neither is a choice the student can decline — so asking them to review and
   * accept the result was a chore with one possible answer. Reads fresh rather
   * than from the cache, because the caller has usually just changed the date.
   */
  static async applyPending(course: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
  }): Promise<RoadmapResult | null> {
    const fresh = await this.loadRoadmap(course);
    if (fresh?.needsAck)
      await this.acknowledge({
        studentId: course.studentId,
        subject: course.subject,
        bands: fresh.bands,
        programStart: fresh.programStart,
        examDate: fresh.examDate,
      });
    return fresh;
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
        throw new Error("Your plan changed. Reload your planner and try again.");
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
          overrides: fresh.overrides,
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
