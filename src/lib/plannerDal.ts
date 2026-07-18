import { supabase } from "@/integrations/supabase/client";
import { type LevelV, type BoardV, type SubjectV } from "./taxonomy";
import { CurriculumDAL, type Topic, type SpecPoint } from "./curriculumDal";
import { isDemoStudent } from "./demo/studentDemo";
import { ScheduleDAL } from "./scheduleDal";
import { confidenceToRating } from "./planner/scheduler";

export type TopicWithConfidence = Topic & {
  /** 0-100, or null when the student has not rated this topic group yet. */
  confidence: number | null;
  sort_index: number;
};

export type SpecPointWithConfidence = SpecPoint & {
  confidence: number | null;
};

/**
 * Data Access Layer for the personalized planner's confidence layer.
 *
 * Confidence rows are per-student and RLS-scoped to `auth.uid() = student_id`,
 * so writes never pass a student id — the row belongs to whoever is signed in.
 * Reads take an explicit `studentId` so a tutor/parent view can pass a child's
 * id (their SELECT policies allow it). The public showcase has no session, so
 * every call short-circuits to empty — the planner is a real-account surface.
 */
export class PlannerDAL {
  /** Topic groups for a course, each merged with the student's confidence. */
  static async getTopicsWithConfidence(
    studentId: string,
    level: LevelV,
    board: BoardV,
    subject: SubjectV,
  ): Promise<TopicWithConfidence[]> {
    if (isDemoStudent()) return [];

    const topics = await CurriculumDAL.getTopics(level, board, subject);
    if (topics.length === 0) return [];

    const { data, error } = await supabase
      .from("student_topic_confidence")
      .select("topic_id, confidence, sort_index")
      .eq("student_id", studentId)
      .in(
        "topic_id",
        topics.map((t) => t.id),
      );
    if (error) {
      console.error("Error loading topic confidence:", error);
    }

    const byTopic = new Map<string, { confidence: number; sort_index: number }>();
    for (const row of data ?? []) {
      byTopic.set(row.topic_id, { confidence: row.confidence, sort_index: row.sort_index });
    }

    return topics.map((t) => {
      const c = byTopic.get(t.id);
      return {
        ...t,
        confidence: c ? c.confidence : null,
        sort_index: c ? c.sort_index : 0,
      };
    });
  }

  /** Spec points under a topic, each merged with the student's slider value. */
  static async getSpecPointsWithConfidence(
    studentId: string,
    topicId: string,
  ): Promise<SpecPointWithConfidence[]> {
    if (isDemoStudent()) return [];

    const points = await CurriculumDAL.getSpecPoints(topicId);
    if (points.length === 0) return [];

    const { data, error } = await supabase
      .from("student_spec_point_confidence")
      .select("spec_point_id, confidence")
      .eq("student_id", studentId)
      .in(
        "spec_point_id",
        points.map((p) => p.id),
      );
    if (error) {
      console.error("Error loading spec-point confidence:", error);
    }

    const byPoint = new Map<string, number>();
    for (const row of data ?? []) byPoint.set(row.spec_point_id, row.confidence);

    return points.map((p) => ({ ...p, confidence: byPoint.get(p.id) ?? null }));
  }

  /** Upsert one topic-group confidence (and optional manual order). */
  static async setTopicConfidence(
    topicId: string,
    confidence: number,
    sortIndex?: number,
  ): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("Not signed in");

    const row: {
      student_id: string;
      topic_id: string;
      confidence: number;
      updated_at: string;
      sort_index?: number;
    } = {
      student_id: uid,
      topic_id: topicId,
      confidence: clamp(confidence),
      updated_at: new Date().toISOString(),
    };
    if (sortIndex !== undefined) row.sort_index = sortIndex;

    const { error } = await supabase
      .from("student_topic_confidence")
      .upsert(row, { onConflict: "student_id,topic_id" });
    if (error) throw error;
  }

  /** Upsert one spec-point slider value; also nudges the topic aggregate. */
  static async setSpecPointConfidence(specPointId: string, confidence: number): Promise<void> {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) throw new Error("Not signed in");

    const conf = clamp(confidence);
    const { error } = await supabase.from("student_spec_point_confidence").upsert(
      {
        student_id: uid,
        spec_point_id: specPointId,
        confidence: conf,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,spec_point_id" },
    );
    if (error) throw error;

    // Feed the spaced-repetition engine: a confidence self-rating is a (soft)
    // review, so the schedule seeds/updates from the termly board too. Best-effort
    // — a scheduling hiccup must never block the confidence save itself.
    try {
      await ScheduleDAL.recordReview({
        specPointId,
        rating: confidenceToRating(conf),
        source: "confidence",
      });
    } catch (e) {
      console.error("SR confidence review failed:", e);
    }
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
