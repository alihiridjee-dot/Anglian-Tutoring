// A linked parent taking over the plan a student pays for themselves.
//
// The case it exists for: a student's trial ends, the paywall goes up, and the
// quickest way past it is a parent's card typed into the STUDENT's Checkout.
// The plan then sits on the student's account, where the parent can't see its
// invoices or change its card, and the parent's own Billing tab can't sell
// them a plan, because one per student is the rule (customers.ts).
//
// So the parent buys a second plan that starts billing only when the
// student's current one runs out: a Stripe trial up to that day, which takes
// nothing. The webhook moves the student's row onto the new plan and sets the
// old one to end at its period end, so nobody pays twice for the same days
// (stripe-webhook, "take-over"). Checkout only opens it; nothing changes until
// the parent pays.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";

/**
 * Stripe refuses a Checkout trial that ends less than 48 hours away. A plan
 * with less than that left is taken over from 48 hours (and a few minutes,
 * for the clock) from now: the family gets those hours free.
 */
const MIN_TRIAL_SECONDS = 48 * 3600 + 10 * 60;

/**
 * How long a take-over Checkout stays open (Stripe's minimum is 30 minutes).
 * Short, so the start date it was opened with is still right when it's paid.
 */
export const TAKE_OVER_CHECKOUT_SECONDS = 31 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Newer API versions keep the period end on the items, so read both. */
function periodEndSeconds(sub: Stripe.Subscription): number | null {
  return (
    sub.current_period_end ??
    (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ??
    null
  );
}

/**
 * The student's own plan a parent may take over, and the moment the parent's
 * plan should start billing. Refuses, naming the way out, anything else: no
 * plan, a plan someone else already pays for, or one that is paused or behind
 * on payment (those have their own fixes in Billing).
 */
export async function takeOverTarget(
  stripe: Stripe,
  db: ReturnType<typeof admin>,
  studentId: string,
): Promise<{ subscriptionId: string; startsAt: number }> {
  const { data: row, error } = await db
    .from("subscriptions")
    .select("user_id, stripe_subscription_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw new Error(`subscriptions: ${error.message}`);
  if (!row?.stripe_subscription_id) {
    throw new HttpError(409, "There's no plan to move. Pick how often to pay instead.");
  }
  if (row.user_id !== studentId) {
    throw new HttpError(
      409,
      "Only a plan the student pays for themselves can be moved to your card.",
    );
  }

  const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id).catch(() => null);
  if (!sub || sub.metadata?.student_id !== studentId) {
    throw new HttpError(409, "There's no plan to move. Pick how often to pay instead.");
  }
  if (sub.pause_collection) {
    throw new HttpError(
      409,
      "This plan is paused. It can move to your card once it's running again.",
    );
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    throw new HttpError(
      409,
      "A payment on this plan didn't go through, so it can't be moved yet. Contact us and we'll sort it out.",
    );
  }

  const ends = periodEndSeconds(sub);
  if (!ends) throw new Error(`subscription ${sub.id} has no period end`);
  // Renewing while the Checkout is open would charge the student for a new
  // period that the parent's plan then pays for again.
  if (ends - nowSeconds() < TAKE_OVER_CHECKOUT_SECONDS + 5 * 60) {
    throw new HttpError(409, "This plan is renewing right now. Try again in an hour.");
  }

  return {
    subscriptionId: sub.id,
    startsAt: Math.max(ends, nowSeconds() + MIN_TRIAL_SECONDS),
  };
}

/** What the parent reads under Stripe's pay button. */
export function takeOverNote(startsAt: number): string {
  const day = new Date(startsAt * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  });
  return `Nothing is taken today. The current plan is already covered until ${day}. Your first payment is on ${day}, and the plan carries on with your card from then.`;
}
