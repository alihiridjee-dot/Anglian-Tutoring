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
 *
 * Our row is not enough on its own, though: it only exists once the webhook has
 * landed. A plan paid a moment ago in another tab, by the other parent, or
 * while the webhook is failing and retrying, is live in Stripe with no row
 * here. So Stripe is also asked directly, across every customer in the
 * student's household, for any live subscription that names this student.
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
  if (row?.stripe_subscription_id) {
    let sub: Stripe.Subscription | null = null;
    try {
      sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    } catch {
      // Gone from Stripe — the row is stale. Fall through to the wider check.
    }
    if (sub && !DEAD_STRIPE_STATUSES.has(sub.status)) {
      throw new HttpError(409, liveSubscriptionMessage(sub));
    }
  }

  // `list`, not `search`: search results lag by up to a minute, which is the
  // exact window this check exists to cover.
  for (const customer of await householdCustomerIds(studentId)) {
    for await (const sub of stripe.subscriptions.list({ customer, status: "all", limit: 100 })) {
      if (sub.metadata?.student_id !== studentId || DEAD_STRIPE_STATUSES.has(sub.status)) continue;
      throw new HttpError(409, liveSubscriptionMessage(sub));
    }
  }
}

/**
 * Expires every other open Checkout Session for this student, across the
 * household, so only the newest one can ever be paid. Without this, two tabs —
 * or a student and a parent — could each hold an open Checkout and pay both.
 * An expired session also frees any trial code it held.
 */
export async function expireOpenCheckouts(stripe: Stripe, studentId: string) {
  for (const customer of await householdCustomerIds(studentId)) {
    for await (const session of stripe.checkout.sessions.list({
      customer,
      status: "open",
      limit: 100,
    })) {
      if (session.metadata?.student_id !== studentId) continue;
      // Already completed in the meantime: the subscription check that runs
      // next sees the plan it created and refuses.
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
    }
  }
}

/**
 * Name the actual way out, which differs by state — a 409 that just says "no"
 * sends people to support, and a failing card is not fixed by resuming.
 */
function liveSubscriptionMessage(sub: Stripe.Subscription): string {
  if (sub.pause_collection)
    return "This plan is paused, not gone. Resume it from Billing and access comes straight back — there's nothing to pay.";
  if (sub.cancel_at_period_end)
    return "This plan is already running to the end of its period. Resume it from Billing instead of buying a second one.";
  if (sub.status === "past_due" || sub.status === "unpaid")
    return "There's a payment that didn't go through on the existing plan. Update the card under Card & invoices in Billing — buying a second plan won't clear it.";
  if (sub.status === "incomplete")
    return "A payment for this student is still being confirmed. Give it a minute, then check Billing before trying again.";
  return "There's already an active plan for this student. Change it from Billing rather than buying a second one.";
}
