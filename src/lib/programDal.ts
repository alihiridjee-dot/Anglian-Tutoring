import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Json } from "@/integrations/supabase/types";
import { mondayOf, sundayOf, toDateKey, weekKeyToDate } from "./week";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import {
  type FocusCandidate,
  type PacingBand,
  type PacingChange,
  type PacingInput,
  DEFAULT_FOCUS_BUDGET,
  bandsForWeek,
  computePacing,
  diffPacing,
  examMondayFor,
  isTeachBand,
  mergeFocus,
  scheduleFocusPoints,
  selectWeekPoints,
  withWeeklyPoints,
} from "./planner/pacing";
import { SETTLED_THRESHOLD } from "./planner/scheduler";
import { WeeklyPlanDAL, type PlanPointOrigin } from "./weeklyPlanDal";
import { STRONG_THRESHOLD, type PointCoverage } from "./planner/coverage";

/** "a", "a and b", "a, b and c" — for the plan's one-line rationale. */
function listSentence(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The weak spec points to bring back round, and the settled topics that get a
 * light pre-exam review pass — the two inputs the focus scheduler needs.
 *
 * The focus lane's ordering signal is the student's confidence rating, and
 * nothing else — deliberately. It used to rank by blended FSRS mastery (which
 * folds in homework and quiz marks), but for now the lane should answer only to
 * what the student said about themselves on the termly board; performance-based
 * adjustment is a future capability, not a current input. So a point qualifies
 * when the student has rated it below the settled line, and weaker ratings come
 * back sooner. FSRS still owns the *cadence* (revisit gaps, weekly budget) —
 * confidence owns the order. Unrated points don't qualify: first contact is the
 * teach spine's job.
 *
 * **Candidacy is per spec point, never per topic.** A settled topic's points
 * used to be skipped wholesale, so a student who said they were shaky on one
 * point of an otherwise-strong topic never got it back — the topic average
 * outvoted the answer they actually gave. It also left weeks with nothing in the
 * focus lane at all, which is how a fully-covered week ended up in the hands of
 * the fallback planner. A topic mean is a summary; it is not a reason to discard
 * the individual answers underneath it. A settled topic can therefore appear in
 * both lists — weak points revisited now, the topic reviewed again before the
 * exam — and those windows never overlap ({@link scheduleFocusPoints}).
 */
export function focusInputs(progress: TopicProgress[]): {
  candidates: FocusCandidate[];
  coveredTopics: { topicId: string; title: string }[];
} {
  const candidates: FocusCandidate[] = [];
  const coveredTopics: { topicId: string; title: string }[] = [];
  for (const t of progress) {
    if (t.settled) coveredTopics.push({ topicId: t.topicId, title: t.title });
    for (const p of t.points) {
      if (p.confidence != null && p.confidence < SETTLED_THRESHOLD) {
        candidates.push({
          specPointId: p.id,
          topicId: t.topicId,
          topicTitle: t.title,
          code: p.code,
          pointTitle: p.title,
          // The rating IS the ranking signal — see the note above.
          mastery: p.confidence,
          weight: p.weight,
        });
      }
    }
  }
  return { candidates, coveredTopics };
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
  /** Topic ids whose FSRS mastery is high enough to read as on-track. */
  coveredTopicIds: string[];
  /** Per-topic mastery + spec-point breakdown, for the expandable timeline. */
  progress: TopicProgress[];
}

/**
 * The year-long curriculum programme ([[pacing]]) with persistence. The core
 * spine is FIXED: laid once, sequentially, from the student's enrolment week
 * (their first view of the programme) to the agreed exam date, weeks allocated
 * by weight — and it never re-flows from progress. The whole course is spread
 * evenly over that personal runway: enrol early and the weeks run light, join
 * late and each week carries more. The only spine-moving event is the exam date
 * changing, and that shift surfaces as a diff for the student to accept. The
 * focus lane is the moving part: recomputed from confidence every load and
 * overlaid on the spine.
 */
export class ProgramDAL {
  static async loadRoadmap(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
  }): Promise<RoadmapResult | null> {
    const { studentId, subject, board, level } = params;

    const { data: topicRows } = await supabase
      .from("topics")
      .select("id, title, sort_order")
      .eq("subject", subject)
      .eq("board", board)
      .eq("level", level);
    if (!topicRows || topicRows.length === 0) return null;
    topicRows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const { data: pts } = await supabase
      .from("spec_points")
      .select("topic_id, weight")
      .in(
        "topic_id",
        topicRows.map((t) => t.id),
      );
    // A topic's share of the year is the work it holds, not the number of rows:
    // `weight` defaults to 1, so a course with none measured still gets exactly
    // the old point-count behaviour.
    const weightByTopic = new Map<string, number>();
    for (const p of pts ?? []) {
      const w = Number(p.weight) > 0 ? Number(p.weight) : 1;
      weightByTopic.set(p.topic_id, (weightByTopic.get(p.topic_id) ?? 0) + w);
    }
    const topics: PacingInput[] = topicRows.map((t) => ({
      topicId: t.id,
      title: t.title,
      weight: weightByTopic.get(t.id) ?? 1,
    }));

    const progress = await ScheduleDAL.getTopicProgress({ studentId, subject, board, level });
    // "Covered" now means the FSRS engine reads the topic as settled — which folds
    // in confidence, homework and MCQ alike, so the termly board feeds the roadmap.
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

    const { data: baseline } = await supabase
      .from("student_program_plan")
      .select("program_start, exam_date, pacing")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .maybeSingle();

    const thisMonday = mondayOf();

    if (!baseline) {
      const examMonday = examMondayFor();
      // First view = enrolment: this Monday becomes the student's permanent
      // spine anchor, and their runway to the exam sets the weekly pace.
      const live = computePacing(topics, thisMonday, examMonday);
      const programStart = toDateKey(thisMonday);
      const examDate = toDateKey(examMonday);
      // Seed the acknowledged baseline so the first view is calm (no diff).
      await supabase.from("student_program_plan").upsert(
        {
          student_id: studentId,
          subject,
          program_start: programStart,
          exam_date: examDate,
          pacing: live as unknown as Json,
        },
        { onConflict: "student_id,subject" },
      );
      return {
        // Weekly points are added for display only — `live` stays clean, so the
        // stored baseline and its diff never see them.
        bands: mergeFocus(
          withWeeklyPoints(live, pointsByTopic),
          scheduleFocusPoints({ ...focus, currentMonday: thisMonday, examMonday }),
        ),
        baselineBands: live,
        changes: [],
        needsAck: false,
        programStart,
        examDate,
        coveredTopicIds: [...coveredTopicIds],
        progress,
      };
    }

    // The spine is a pure function of (enrolment week, exam date, topic
    // weights) — recomputing it here only ever differs from the stored baseline
    // when the exam date moved or the curriculum itself changed.
    const live = computePacing(
      topics,
      weekKeyToDate(baseline.program_start),
      weekKeyToDate(baseline.exam_date),
    );
    const changes = diffPacing(baseline.pacing as unknown as PacingBand[], live);
    return {
      bands: mergeFocus(
        withWeeklyPoints(live, pointsByTopic),
        scheduleFocusPoints({
          ...focus,
          currentMonday: thisMonday,
          examMonday: weekKeyToDate(baseline.exam_date),
        }),
      ),
      baselineBands: (baseline.pacing as unknown as PacingBand[]).filter(isTeachBand),
      changes,
      needsAck: changes.length > 0,
      programStart: baseline.program_start,
      examDate: baseline.exam_date,
      coveredTopicIds: [...coveredTopicIds],
      progress,
    };
  }

  /**
   * The spec points one week should cover — read straight off the year plan.
   *
   * The weekly plan used to rank the whole course from scratch every time you
   * pressed the button, which meant two planners disagreeing about the same
   * student: the roadmap spread a weak topic's revisits across the months to the
   * exam, while the week picked whatever FSRS happened to call due. Now the
   * programme decides and the week reads its slice, so "balanced across the year"
   * is enforced in one place — {@link scheduleFocusPoints} — and the week the
   * student sees is the week the roadmap promised them.
   *
   * Three things can land in a week:
   *  1. the focus points the year plan allocated to it (weakest-first, already
   *     capped at the weekly budget and cascaded so no week is flooded);
   *  2. this week's share of the topic currently on the teach spine — a big
   *     topic's points are split across the weeks its band spans rather than
   *     dumped into the first one;
   *  3. in the pre-exam revision window, the weakest points of settled topics.
   *
   * (1) and (2) both have to happen and are budgeted separately — see
   * {@link selectWeekPoints}.
   *
   * **The programme's answer stands, including an empty one.** It falls back to
   * the raw scheduler only when the programme has no band covering the week at
   * all — no curriculum, or a week past the exam horizon. "Bands, but nothing
   * left to do in them" is a real answer: it means the topic on the spine is
   * already covered and nothing is due back, and the week should say so. Testing
   * for an empty point list instead is what put students on the fallback in the
   * middle of a perfectly healthy term, and the fallback then labelled the whole
   * week as revision.
   */
  static async planForWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    /** Monday date-key of the week being planned. */
    weekStart: string;
    /** Cap on the revisit lane only; the spine's share is added on top. */
    focusBudget?: number;
  }): Promise<{
    specPointIds: string[];
    /** Spec-point id → `core` or `focus`, persisted as the point's origin. */
    origins: Record<string, PlanPointOrigin>;
    rationale: string;
  }> {
    const { studentId, subject, board, level, weekStart } = params;
    const focusBudget = Math.max(1, params.focusBudget ?? DEFAULT_FOCUS_BUDGET);
    const roadmap = await this.loadRoadmap({ studentId, subject, board, level });

    if (roadmap && bandsForWeek(roadmap.bands, weekStart).length > 0) {
      const { specPointIds, lanes, teachTitle, focusCount, teachCount, refreshCount, reviewCount } =
        selectWeekPoints({
          bands: roadmap.bands,
          weekStart,
          topics: roadmap.progress,
          focusBudget,
          settledThreshold: SETTLED_THRESHOLD,
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
      // Named for what it is, so a refresher week never reads as new material.
      if (refreshCount > 0) {
        parts.push(`${refreshCount} to keep ${teachTitle} fresh — you're ahead on it`);
      }
      if (reviewCount > 0) parts.push(`${reviewCount} for pre-exam review`);
      return {
        specPointIds,
        origins: lanes,
        rationale: `From your programme: ${listSentence(parts)}. The rest of what you flagged is spread over the weeks ahead so it never lands all at once.`,
      };
    }

    // No programme for this week — fall back to the raw scheduler, which labels
    // each pick by whether the student has met it before (see `suggestForWeek`).
    const weekEnd = sundayOf(weekKeyToDate(weekStart));
    weekEnd.setHours(23, 59, 59, 999);
    const { specPointIds, lanes } = await ScheduleDAL.suggestForWeek({
      studentId,
      subject,
      board,
      level,
      weekEnd,
      targetCount: focusBudget,
    });
    return {
      specPointIds,
      origins: lanes,
      rationale: specPointIds.length
        ? "Led with your weakest and due-for-review topics, and went lighter on the ones that are already sticking."
        : "",
    };
  }

  /**
   * Re-cut an already-saved week from the current programme, keeping the work
   * the student has already started.
   *
   * A saved week is normally sticky — {@link useWeekPlan} reads the stored row
   * and only builds one when it's missing, so the week can't shift under
   * somebody halfway through it. That stickiness had no escape hatch: re-rating
   * a topic on the confidence board moved the roadmap but never the current
   * week, so the two views disagreed and the new rating didn't take effect
   * until the following Monday — the student's clearest signal about themselves
   * being the slowest to land.
   *
   * So the board's writes call this. It's a merge, not a replacement:
   *  • points the student has started but not yet nailed stay, at their original
   *    lane — pulling those out would delete visible progress and orphan work
   *    that's still mid-flight;
   *  • points they added themselves (`origin: "student"`) stay, because the
   *    programme never chose them and must not un-choose them;
   *  • everything else is replaced by what the programme now says.
   *
   * "Started but not nailed" rather than merely "attempted", because a point
   * already scoring at {@link STRONG_THRESHOLD} has nothing left to protect. The
   * blunter test held finished work in the week permanently — the rule re-runs on
   * every re-cut, so a nailed point was re-kept forever and the week drifted
   * back out of step with the roadmap, which is the very thing this exists to
   * prevent.
   *
   * Returns true when the point set actually changed, so callers can skip a
   * pointless reload.
   */
  static async refreshWeek(params: {
    studentId: string;
    subject: SubjectV;
    board: BoardV;
    level: LevelV;
    weekStart: string;
    focusBudget?: number;
  }): Promise<boolean> {
    const { studentId, subject, board, level, weekStart } = params;
    const existing = await WeeklyPlanDAL.getPlan(studentId, subject, weekStart);
    if (!existing) return false; // nothing saved yet — the normal build path owns this

    const fresh = await this.planForWeek(params);
    if (fresh.specPointIds.length === 0) return false; // never empty a week

    const coverage = await WeeklyPlanDAL.getCoverage(
      studentId,
      existing.points.map((p) => p.spec_point_id),
    ).catch(() => new Map<string, PointCoverage>());

    const inFlight = (id: string): boolean => {
      const c = coverage.get(id);
      if (!c?.attempted) return false;
      // Attempted but ungraded counts as in-flight: there's work in it, we just
      // can't judge it yet.
      return c.bestScore == null || c.bestScore < STRONG_THRESHOLD;
    };
    const keep = existing.points.filter((p) => p.origin === "student" || inFlight(p.spec_point_id));

    // Kept points first so their original lane wins the merge. Both planners
    // label every point they return, so the default below is unreachable — it is
    // `ai` ("generated, lane unknown") rather than `focus` because guessing
    // `focus` is exactly how a point the student never flagged ends up presented
    // to them as revision.
    const origins: Record<string, PlanPointOrigin> = {};
    for (const p of keep) origins[p.spec_point_id] = p.origin;
    for (const id of fresh.specPointIds) origins[id] ??= fresh.origins[id] ?? "ai";
    const specPointIds = Object.keys(origins);

    const before = new Set(existing.points.map((p) => p.spec_point_id));
    const unchanged =
      specPointIds.length === before.size && specPointIds.every((id) => before.has(id));
    if (unchanged) return false;

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
