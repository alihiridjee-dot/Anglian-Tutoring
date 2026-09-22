// The Stripe customer behind a user, the customers across a billing household,
// and the one guardrail that keeps a family on a single subscription.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";

/**
 * Every Stripe customer in the caller's billing household, so payment history is
 * shared across a linked parent and student. Parents and students share the one
 * account: a student sees invoices billed to their parent's card, and a parent
 * sees any the student paid themselves. Built from parent_student_links in both
 * directions plus the caller, mapped to stripe_customers.
 */
export async function householdCustomerIds(userId: string): Promise<string[]> {
  const db = admin();
  const userIds = new Set<string>([userId]);

  // Children this user pays for (caller is a parent).
  const { data: children } = await db
    .from("parent_student_links")
    .select("student_id")
    .eq("parent_id", userId);
  for (const row of children ?? []) userIds.add(row.student_id);

  // Parents linked to this user (caller is a student).
  const { data: parents } = await db
    .from("parent_student_links")
    .select("parent_id")
    .eq("student_id", userId);
  for (const row of parents ?? []) userIds.add(row.parent_id);

  const { data: customers } = await db
    .from("stripe_customers")
    .select("stripe_customer_id")
    .in("user_id", [...userIds]);

  return [...new Set((customers ?? []).map((c) => c.stripe_customer_id))];
}

/**
 * One Stripe customer per paying account, reused across subscriptions. Without
 * this a parent funding two children would become two customers and see two
 * unrelated billing portals.
 */
export async function resolveCustomer(stripe: Stripe, userId: string, email: string | undefined) {
  const db = admin();
  const { data: existing } = await db
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });
  const { error } = await db
    .from("stripe_customers")
    .insert({ user_id: userId, stripe_customer_id: customer.id });
  if (error) throw new HttpError(500, `Couldn't record the Stripe customer: ${error.message}`);
  return customer.id;
}

/**
 * Stripe statuses that mean the subscription object is finished for good. Any
 * other status — including `paused`, `past_due` and `unpaid` — is a live object
 * that can be resumed or repaired, never replaced.
 */
const DEAD_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * Refuses to open Checkout for a student who already has a Stripe subscription.
 *
 * This is the guardrail behind this file's central rule: Checkout is for a
 * family's FIRST subscription only. A paused or ending plan is still a real
 * Stripe object, and buying a second one on top would be silently destructive —
 * the webhook upserts public.subscriptions on student_id, so the new row
 * overwrites the old and the first subscription bills on forever, invisible to
 * the app and to the family. Pausing is free to undo; paying twice is not.
 *
 * The check is confirmed against Stripe rather than trusting our own row, so a
 * stale row left behind by a subscription deleted in the Stripe dashboard can't
 * lock a genuine customer out of buying.
 */
export async function assertNoLiveSubscription(
  stripe: Stripe,
  db: ReturnType<typeof admin>,
  studentId: string,
) {
  const { data: row } = await db
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!row?.stripe_subscription_id) return;

  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  } catch {
    return; // gone from Stripe — the row is stale, let them buy.
  }
  if (DEAD_STRIPE_STATUSES.has(sub.status)) return;

  // Name the actual way out, which differs by state — a 409 that just says "no"
  // sends people to support, and a failing card is not fixed by resuming.
  throw new HttpError(
    409,
    sub.pause_collection
      ? "This plan is paused, not gone. Resume it from Billing and access comes straight back — there's nothing to pay."
      : sub.cancel_at_period_end
        ? "This plan is already running to the end of its period. Resume it from Billing instead of buying a second one."
        : sub.status === "past_due" || sub.status === "unpaid"
          ? "There's a payment that didn't go through on the existing plan. Update the card under Card & invoices in Billing — buying a second plan won't clear it."
          : "There's already an active plan for this student. Change it from Billing rather than buying a second one.",
  );
}
