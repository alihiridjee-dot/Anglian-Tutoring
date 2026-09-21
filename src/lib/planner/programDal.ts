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
  selectWeekPoints,
  withWeeklyPoints,
} from "./pacing";
import { hasStudentHistory, spineReach } from "./admissibility";
import { catchUpBudget, trickle } from "./backlog";
import { WeeklyPlanDAL, type PlanPoint, type PlanPointOrigin } from "./weeklyPlanDal";
import { buildRoadmap, focusInputs, type RoadmapResult } from "./roadmap";

/** "a", "a and b", "a, b and c" — for the plan's one-line rationale. */
function listSentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
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
    const ledger = await WeeklyPlanDAL.getDeliveryLedger(studentId, subject, thisWeek);
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
    const missing = (params.roadmap?.catchUpSchedule?.weeks[params.weekStart] ?? [])
      .filter((p) => !existing.has(p.specPointId))
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
      throw new Error("Your plan is still updating. Open your planner, then try again.");
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
