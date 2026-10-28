import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import type { BreakReason, StudentBreak } from "./breaks";
import { isTeachBand, type PacingBand } from "./pacing";
import { spineMatchesExam, type OrderTopic } from "./topicOrder";

/** One `student_breaks` row, as the planner holds it. */
export const toBreak = (r: {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
  recorded_at: string | null;
}): StudentBreak => ({
  id: r.id,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  reason: r.reason as BreakReason,
  recordedAt: r.recorded_at,
});

/**
 * Reads and writes of `student_breaks`. Writes go through `book_break` and
 * `end_break`, which check who is asking and every rule; nobody writes the
 * table directly.
 */
export class BreakDAL {
  /**
   * Every break that stands, oldest first. A failed read reads as "no break":
   * the planner must not go down because of it, and the database still refuses
   * to plan a break week whatever the planner believes.
   */
  static async list(studentId: string): Promise<StudentBreak[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await supabase
        .from("student_breaks")
        .select("id, starts_on, ends_on, reason, recorded_at")
        .eq("student_id", studentId)
        .is("cancelled_at", null)
        .order("starts_on");
      if (error) throw error;
      return (data ?? []).map(toBreak);
    } catch (e) {
      console.warn("[planner] couldn't read the student's breaks", e);
      return [];
    }
  }

  /**
   * The breaks that stand for several students at once, by student: a tutor's
   * marking queue. A failed read reads as none, so work is shown as it was.
   */
  static async listFor(studentIds: string[]): Promise<Record<string, StudentBreak[]>> {
    if (isDemoMode() || !studentIds.length) return {};
    try {
      const { data, error } = await supabase
        .from("student_breaks")
        .select("id, student_id, starts_on, ends_on, reason, recorded_at")
        .in("student_id", studentIds)
        .is("cancelled_at", null)
        .order("starts_on");
      if (error) throw error;
      const by: Record<string, StudentBreak[]> = {};
      for (const r of data ?? [])
        (by[r.student_id] ??= []).push({
          id: r.id,
          startsOn: r.starts_on,
          endsOn: r.ends_on,
          reason: r.reason as BreakReason,
          recordedAt: r.recorded_at,
        });
      return by;
    } catch (e) {
      console.warn("[planner] couldn't read the students' breaks", e);
      return {};
    }
  }

  /**
   * Whether the week starting `weekStart` falls in a break that stands.
   *
   * Unlike {@link list}, a failed read throws instead of reading as "no
   * break". A tutor's move takes a point out of one week before it puts it in
   * the other, and the database refuses a break week only at that second
   * step, so the move has to know the week is open before it starts.
   */
  static async isBreakWeek(studentId: string, weekStart: string): Promise<boolean> {
    if (isDemoMode()) return false;
    const { data, error } = await supabase
      .from("student_breaks")
      .select("id")
      .eq("student_id", studentId)
      .is("cancelled_at", null)
      .lte("starts_on", weekStart)
      .gte("ends_on", weekStart)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data ?? []).length > 0;
  }

  /**
   * Each programme's exam date, for the booking form: which weeks are too
   * close to an exam to pick. A failed read reads as none known; `book_break`
   * still checks the exams.
   */
  static async examDates(studentId: string): Promise<{ subject: string; examDate: string }[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await supabase
        .from("student_program_plan")
        .select("subject, exam_date")
        .eq("student_id", studentId);
      if (error) throw error;
      return (data ?? []).map((r) => ({ subject: r.subject, examDate: r.exam_date }));
    } catch (e) {
      console.warn("[planner] couldn't read the student's exam dates", e);
      return [];
    }
  }

  /**
   * Each programme as a new break would be laid over it (`breakFits`): its
   * stored spine, its exam date, and its topics' points in course order. A
   * failed read reads as no programme, so the booking form checks the other
   * rules only, as it did before.
   */
  static async courses(
    studentId: string,
  ): Promise<{ subject: string; examDate: string; bands: PacingBand[]; topics: OrderTopic[] }[]> {
    if (isDemoMode()) return [];
    try {
      const { data: plans, error } = await supabase
        .from("student_program_plan")
        .select("subject, exam_date, pacing")
        .eq("student_id", studentId);
      if (error) throw error;
      const spines = (plans ?? [])
        .map((p) => ({
          subject: p.subject,
          examDate: p.exam_date,
          bands: ((p.pacing ?? []) as unknown as PacingBand[]).filter(isTeachBand),
        }))
        // An exam date just moved: the planner re-spreads before it lays any
        // break, so there is nothing to check against until it has.
        .filter((s) => spineMatchesExam(s.bands, s.examDate));
      const topicIds = [...new Set(spines.flatMap((s) => s.bands.map((b) => b.topicId)))];
      if (!topicIds.length) return [];
      const { data: points, error: pointsError } = await supabase
        .from("spec_points")
        .select("id, code, title, weight, topic_id, sort_order")
        .in("topic_id", topicIds);
      if (pointsError) throw pointsError;
      // The planner's own order (ScheduleDAL): sort order, then code.
      const byTopic = new Map<string, NonNullable<typeof points>>();
      for (const p of [...(points ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.code.localeCompare(b.code),
      ))
        byTopic.set(p.topic_id, [...(byTopic.get(p.topic_id) ?? []), p]);
      return spines.map((s) => ({
        ...s,
        topics: [...new Map(s.bands.map((b) => [b.topicId, b.title])).entries()].map(
          ([topicId, title]) => ({
            topicId,
            title,
            points: (byTopic.get(topicId) ?? []).map((p) => ({
              specPointId: p.id,
              code: p.code,
              title: p.title,
              weight: p.weight,
            })),
          }),
        ),
      }));
    } catch (e) {
      console.warn("[planner] couldn't read the student's programmes for a break", e);
      return [];
    }
  }

  /** Book a break of `weeks` whole weeks from the Monday `startsOn`. Returns its id. */
  static async book(params: {
    studentId: string;
    startsOn: string;
    weeks: number;
    reason: BreakReason;
  }): Promise<string> {
    const { data, error } = await supabase.rpc("book_break", {
      _student_id: params.studentId,
      _starts_on: params.startsOn,
      _weeks: params.weeks,
      _reason: params.reason,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  /** Call a break off, or end it early by coming back. */
  static async end(breakId: string): Promise<"cancelled" | "ended_early"> {
    const { data, error } = await supabase.rpc("end_break", { _break_id: breakId });
    if (error) throw new Error(error.message);
    return data as "cancelled" | "ended_early";
  }
}
