import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import type { BreakReason, StudentBreak } from "./breaks";

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
      return (data ?? []).map((r) => ({
        id: r.id,
        startsOn: r.starts_on,
        endsOn: r.ends_on,
        reason: r.reason as BreakReason,
        recordedAt: r.recorded_at,
      }));
    } catch (e) {
      console.warn("[planner] couldn't read the student's breaks", e);
      return [];
    }
  }

  /**
   * Each programme's exam date, for the booking form: how much fuller a break
   * makes the weeks after it, and which weeks are too close to an exam. A
   * failed read reads as none known; `book_break` still checks the exams.
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
