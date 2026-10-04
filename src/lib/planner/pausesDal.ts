import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isDemoMode } from "@/lib/auth/session";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import type { PacingBand } from "./pacing";
import type { PauseReason, SubjectPause } from "./subjectPauses";

/** One stop of one subject, as recorded. */
export interface PauseRecord {
  id: string;
  reason: PauseReason;
  startedAt: string;
  /** Null while it is still stopped. */
  endedAt: string | null;
  /** When the planner picked the programme up after it. Null = not yet. */
  programmeResumedAt: string | null;
}

/**
 * Reads of `student_subject_pauses`. A failed read reads as "never paused":
 * the planner must not go down because of it, and the database still refuses
 * to plan a paused subject whatever the planner believes.
 */
export class SubjectPauseDAL {
  /** The stop in force now, if any. */
  static async open(studentId: string, subject: SubjectV): Promise<SubjectPause | null> {
    if (isDemoMode()) return null;
    try {
      const { data, error } = await supabase
        .from("student_subject_pauses")
        .select("reason, started_at")
        .eq("student_id", studentId)
        .eq("subject", subject)
        .is("ended_at", null)
        .maybeSingle();
      if (error) throw error;
      return data ? { reason: data.reason as PauseReason, startedAt: data.started_at } : null;
    } catch (e) {
      console.warn("[planner] couldn't read the subject's pause", e);
      return null;
    }
  }

  /** Every stop of the subject, oldest first. */
  static async history(studentId: string, subject: SubjectV): Promise<PauseRecord[]> {
    if (isDemoMode()) return [];
    try {
      const { data, error } = await supabase
        .from("student_subject_pauses")
        .select("id, reason, started_at, ended_at, programme_resumed_at")
        .eq("student_id", studentId)
        .eq("subject", subject)
        .order("started_at");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        reason: r.reason as PauseReason,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        programmeResumedAt: r.programme_resumed_at,
      }));
    } catch (e) {
      console.warn("[planner] couldn't read the subject's pauses", e);
      return [];
    }
  }

  /**
   * Save the programme as picked up after a stop (`resume_programme_after_pause`).
   * `pacing` null means there was nothing to move. The database checks the new
   * calendar and applies each stop once, oldest first.
   */
  static async resumeProgramme(params: {
    pauseId: string;
    expected: PacingBand[];
    pacing: PacingBand[] | null;
  }): Promise<void> {
    const { error } = await supabase.rpc("resume_programme_after_pause", {
      _pause_id: params.pauseId,
      _expected_pacing: params.expected as unknown as Json,
      _pacing: params.pacing as unknown as Json | null,
    });
    if (error) throw error;
  }
}
