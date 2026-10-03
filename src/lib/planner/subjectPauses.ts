import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/lib/auth/session";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { plannerKey } from "@/lib/planner/queries";

/**
 * A subject the student can't use right now, as the database recorded it
 * (`student_subject_pauses`, kept by `private.sync_subject_pauses`).
 *
 * While a subject is paused nothing is planned for it: no week is built and
 * nothing is added to one. The database refuses those writes itself, so this
 * is what lets the planner say "paused" rather than fail.
 */
export type PauseReason = "paused" | "payment" | "cancelled" | "subject_removed" | "not_on_plan";

export interface SubjectPause {
  reason: PauseReason;
  /** When the stop began (ISO). */
  startedAt: string;
}

export const subjectPauseQuery = (studentId: string, subject: SubjectV) =>
  queryOptions({
    // Under the student's planner key, so every planner refresh re-reads it.
    queryKey: [...plannerKey(studentId), subject, "pause"],
    queryFn: async (): Promise<SubjectPause | null> => {
      // The showcase has no session and never plans anything.
      if (isDemoMode()) return null;
      const { data, error } = await supabase
        .from("student_subject_pauses")
        .select("reason, started_at")
        .eq("student_id", studentId)
        .eq("subject", subject)
        .is("ended_at", null)
        .maybeSingle();
      // A failed read must not take the planner down with it. Reading "not
      // paused" is safe: the database still refuses to plan a paused subject.
      if (error) {
        console.warn("[planner] couldn't read the subject's pause", error);
        return null;
      }
      return data ? { reason: data.reason as PauseReason, startedAt: data.started_at } : null;
    },
    staleTime: 30_000,
  });
