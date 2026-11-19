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
