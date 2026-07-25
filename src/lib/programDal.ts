import { supabase } from "@/integrations/supabase/client";
import { type SubjectV, type BoardV, type LevelV } from "./taxonomy";
import { type Json } from "@/integrations/supabase/types";
import { mondayOf, toDateKey, weekKeyToDate } from "./week";
import { ScheduleDAL, type TopicProgress } from "./scheduleDal";
import {
  type FocusCandidate,
  type PacingBand,
  type PacingChange,
  type PacingInput,
  computeLivePacing,
  diffPacing,
  examMondayFor,
  isTeachBand,
  mergeFocus,
  scheduleFocusPoints,
} from "./planner/pacing";
import { SETTLED_THRESHOLD } from "./planner/scheduler";

/**
 * The weak spec points (mastery below settled) of not-yet-settled topics, and
 * the settled topics that get a light review pass — the two inputs the focus
 * scheduler needs. Built from the same per-point progress the roadmap shows.
 */
function focusInputs(progress: TopicProgress[]): {
  candidates: FocusCandidate[];
  coveredTopics: { topicId: string; title: string }[];
} {
  const candidates: FocusCandidate[] = [];
  const coveredTopics: { topicId: string; title: string }[] = [];
  for (const t of progress) {
    if (t.settled) {
      coveredTopics.push({ topicId: t.topicId, title: t.title });
      continue;
    }
    for (const p of t.points) {
      if (p.mastery < SETTLED_THRESHOLD) {
        candidates.push({
          specPointId: p.id,
          topicId: t.topicId,
          topicTitle: t.title,
          code: p.code,
          pointTitle: p.title,
          mastery: p.mastery,
        });
      }
    }
  }
  return { candidates, coveredTopics };
}

export interface RoadmapResult {
  /** The live curriculum bands (past/current/future), most-recent first order. */
  bands: PacingBand[];
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
 * The year-long curriculum programme ([[pacing]]) with persistence. On first
 * view it lays the whole course from this week to the exam and stores that as
 * the acknowledged baseline; thereafter it re-flows from real progress and, when
 * a slip shifts future topics, surfaces the diff for the student to accept —
 * nothing about their programme changes silently.
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
      .select("topic_id")
      .in(
        "topic_id",
        topicRows.map((t) => t.id),
      );
    const countByTopic = new Map<string, number>();
    for (const p of pts ?? [])
      countByTopic.set(p.topic_id, (countByTopic.get(p.topic_id) ?? 0) + 1);
    const topics: PacingInput[] = topicRows.map((t) => ({
      topicId: t.id,
      title: t.title,
      pointCount: countByTopic.get(t.id) ?? 1,
    }));

    const progress = await ScheduleDAL.getTopicProgress({ studentId, subject, board, level });
    // "Covered" now means the FSRS engine reads the topic as settled — which folds
    // in confidence, homework and MCQ alike, so the termly board feeds the roadmap.
    const coveredTopicIds = new Set(progress.filter((t) => t.settled).map((t) => t.topicId));
    const focus = focusInputs(progress);

    const { data: baseline } = await supabase
      .from("student_program_plan")
      .select("program_start, exam_date, pacing")
      .eq("student_id", studentId)
      .eq("subject", subject)
      .maybeSingle();

    const thisMonday = mondayOf();

    if (!baseline) {
      const examMonday = examMondayFor();
      const live = computeLivePacing({
        topics,
        programStart: thisMonday,
        examMonday,
        currentMonday: thisMonday,
        coveredTopicIds,
      });
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
        bands: mergeFocus(
          live,
          scheduleFocusPoints({ ...focus, currentMonday: thisMonday, examMonday }),
        ),
        changes: [],
        needsAck: false,
        programStart,
        examDate,
        coveredTopicIds: [...coveredTopicIds],
        progress,
      };
    }

    const live = computeLivePacing({
      topics,
      programStart: weekKeyToDate(baseline.program_start),
      examMonday: weekKeyToDate(baseline.exam_date),
      currentMonday: thisMonday,
      coveredTopicIds,
    });
    const changes = diffPacing(baseline.pacing as unknown as PacingBand[], live);
    return {
      bands: mergeFocus(
        live,
        scheduleFocusPoints({
          ...focus,
          currentMonday: thisMonday,
          examMonday: weekKeyToDate(baseline.exam_date),
        }),
      ),
      changes,
      needsAck: changes.length > 0,
      programStart: baseline.program_start,
      examDate: baseline.exam_date,
      coveredTopicIds: [...coveredTopicIds],
      progress,
    };
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
