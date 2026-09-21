import { supabase } from "@/integrations/supabase/client";

/**
 * Feedback captured when a manager pauses, cancels, or shrinks a plan.
 *
 * All three are gated behind a short form — the client won't fire the Stripe
 * action until a reason is chosen. That friction is the point: cancelling is the
 * only way to end a plan (deletion was removed), so we always capture why. The
 * row lands in public.billing_feedback (manager-only, enforced by RLS) so the
 * reason survives even for pause and subject removal, neither of which has
 * anywhere to live in Stripe.
 */

export type BillingFeedbackAction = "pause" | "cancel" | "remove_subject";

/** The fixed reason buckets offered in the form, shared by every action. */
export const BILLING_FEEDBACK_REASONS: { value: string; label: string }[] = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "taking_a_break", label: "Just taking a break" },
  { value: "exams_finished", label: "Exams / course finished" },
  { value: "not_using", label: "Not using it enough" },
  { value: "missing_features", label: "Missing something we need" },
  { value: "found_alternative", label: "Found an alternative" },
  { value: "other", label: "Other" },
];

export interface BillingFeedbackInput {
  studentId: string;
  action: BillingFeedbackAction;
  category: string;
  comment?: string;
}

/**
 * Records the feedback for a pause / cancel / subject removal. Best-effort by
 * design: the RLS insert policy already limits this to the plan's manager, and
 * the caller runs the Stripe action right after — a lost feedback row must never
 * block the family from managing their plan, so failures are surfaced but not
 * thrown.
 */
export async function recordBillingFeedback(input: BillingFeedbackInput) {
  const { error } = await supabase.from("billing_feedback").insert({
    student_id: input.studentId,
    action: input.action,
    reason_category: input.category,
    reason: input.comment?.trim() || null,
  });
  if (error) console.error("billing_feedback insert failed:", error.message);
}
