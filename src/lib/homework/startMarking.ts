import { supabase } from "@/integrations/supabase/client";

/**
 * Starting the AI marker for a submission, from the student's page.
 *
 * The page used to start it only after a successful reply to the submit. When
 * the submission was saved but its reply was lost, the retry said "already
 * submitted", nothing started the marker, and the page promised marks
 * "shortly" until a tutor marked the work by hand. So the marker now also
 * starts when the page finds a recent submission that was never marked.
 */

/**
 * How long after hand-in the page will still start marking itself.
 *
 * A lost reply is noticed within minutes, by a student still on the page. The
 * limit stops a submission the marker keeps failing on from costing a fresh
 * AI call every time someone opens it, days later. Past this, it waits for a
 * tutor, as unmarked work always has.
 */
export const RESTART_WINDOW_MS = 60 * 60 * 1000;

/** Submissions this tab has already asked to be marked. */
const asked = new Set<string>();

/**
 * Ask mark-homework to mark a submission, once per tab, without waiting.
 *
 * Its failure is never surfaced: the work is safely handed in either way, and
 * a submission that goes unmarked waits for a tutor.
 */
export function startMarking(
  submissionId: string,
  invoke: (submissionId: string) => Promise<unknown> = (id) =>
    supabase.functions.invoke("mark-homework", { body: { submissionId: id } }),
): void {
  if (asked.has(submissionId)) return;
  asked.add(submissionId);
  void invoke(submissionId).catch(() => undefined);
}

/** A submission the marker hasn't reached: not marked, not staged, and recent. */
export function needsMarkingStart(
  submission: { submitted_at: string; graded_at: string | null; release_at: string | null },
  now = Date.now(),
): boolean {
  if (submission.graded_at || submission.release_at) return false;
  return now - new Date(submission.submitted_at).getTime() < RESTART_WINDOW_MS;
}

/** The refusal submit_homework_answers gives when the work is already in. */
export function isAlreadySubmitted(err: unknown): boolean {
  const message =
    err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
  return /already submitted/i.test(message);
}
