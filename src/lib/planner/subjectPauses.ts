import { queryOptions } from "@tanstack/react-query";
import type { SubjectV } from "@/lib/curriculum/taxonomy";
import { plannerKey } from "@/lib/planner/queries";
import { SubjectPauseDAL } from "@/lib/planner/pausesDal";

/**
 * A subject the student can't use right now, as the database recorded it
 * (`student_subject_pauses`, kept by `private.sync_subject_pauses`).
 *
 * While a subject is paused nothing is planned for it: no week is built and
 * nothing is added to one. The database refuses those writes itself, so this
 * is what lets the planner say "paused" rather than fail.
 */
export type PauseReason =
  "paused" | "payment" | "cancelled" | "subject_removed" | "not_on_plan" | "break";

export interface SubjectPause {
  reason: PauseReason;
  /** When the stop began (ISO). */
  startedAt: string;
}

export const subjectPauseQuery = (studentId: string, subject: SubjectV) =>
  queryOptions({
    // Under the student's planner key, so every planner refresh re-reads it.
    queryKey: [...plannerKey(studentId), subject, "pause"],
    // A failed read reads as "not paused" (see SubjectPauseDAL), which is safe:
    // the database still refuses to plan a paused subject.
    queryFn: () => SubjectPauseDAL.open(studentId, subject),
    staleTime: 30_000,
  });

/** Every stop of the subject, oldest first: what a past week was paused by. */
export const subjectPauseHistoryQuery = (studentId: string, subject: SubjectV) =>
  queryOptions({
    queryKey: [...plannerKey(studentId), subject, "pause-history"],
    // A failed read reads as "never paused" (see SubjectPauseDAL): the week
    // then says "No plan was set", as it did before.
    queryFn: () => SubjectPauseDAL.history(studentId, subject),
    staleTime: 30_000,
  });
