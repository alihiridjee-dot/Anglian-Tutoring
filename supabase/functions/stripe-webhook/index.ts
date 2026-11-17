// Supabase Edge Function: stripe-webhook
//
// The single writer of public.subscriptions, and therefore the single thing
// that grants or revokes access. RLS gives `authenticated` no INSERT or UPDATE
// on that table precisely so this is true: a client that could write it could
// grant itself a free subscription.
//
// Every request is verified against STRIPE_WEBHOOK_SECRET before it is trusted.
// The endpoint is public by necessity (Stripe calls it unauthenticated), so the
// signature is the only thing standing between a stranger and free access —
// deploy with --no-verify-jwt, and never skip constructEventAsync.
//
// Required function secrets (set with `supabase secrets set ...`):
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-12-18.acacia",
});

/**
 * Stripe's status vocabulary, mapped to ours.
 *
 * private.student_has_access() only counts 'active' and 'trialing'. Everything
 * else — past_due, unpaid, canceled, incomplete — is written through verbatim
 * and therefore denies access, which is the behaviour we want: a failed renewal
 * should close the door, not leave it ajar.
 *
 * A paused subscription stays 'active' in Stripe's vocabulary (only collection
 * is paused), so it is written as 'paused' here — which fails the access check,
 * matching what the family asked for when they paused.
 */
/**
 * Newer Stripe API versions moved current_period_end off the subscription onto
 * its items, and webhook events arrive in the account's default version — so
 * read both places or renewal dates get nulled on every update event.
 */
function periodEnd(sub: Stripe.Subscription): string | null {
  const ts =
    sub.current_period_end ??
    (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function subscriptionRow(sub: Stripe.Subscription) {
  const studentId = sub.metadata?.student_id;
  const payerId = sub.metadata?.payer_id;
  if (!studentId || !payerId) return null;

  return {
    user_id: payerId,
    student_id: studentId,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripe_subscription_id: sub.id,
    // Stripe leaves pause_collection set on a subscription it cancels, so a
    // paused plan that ends would otherwise read as "paused" for ever. A
    // take-over's trial is the time the student's plan already covers, not a
    // free trial, so it reads as active.
    status:
      sub.status !== "canceled" && sub.pause_collection
        ? "paused"
        : sub.status === "trialing" && sub.metadata?.replaces
          ? "active"
          : sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    plan: sub.metadata?.tier ?? null,
    current_period_end: periodEnd(sub),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Stripe statuses of a plan worth keeping: paid for, or one the family can
 * still put right (a failed renewal, a pause). A second subscription for a
 * student who has one of these is a duplicate, not a replacement.
 */
const KEEPABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

const isMissing = (err: unknown) => (err as { code?: string })?.code === "resource_missing";

/**
 * Cancel a second subscription for a student who already has a plan, and
 * refund what it took. stripe-checkout refuses a second Checkout when it can
 * see the first; this catches what it can't, such as two Checkouts opened in
 * the same instant. Every step is safe to repeat: Stripe resends events, and
 * the duplicate produces several (completed, created, deleted after the cancel).
 */
async function refundDuplicate(sub: Stripe.Subscription, keptId: string) {
  console.error(
    `stripe-webhook: ${sub.id} duplicates ${keptId} for student ${sub.metadata?.student_id}; cancelling and refunding it`,
  );
  if (sub.status !== "canceled" && sub.status !== "incomplete_expired") {
    await stripe.subscriptions.cancel(sub.id);
  }

  const invoiceId =
    typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
  if (!invoiceId) return;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const paymentIntent =
    typeof invoice.payment_intent === "string"
      ? invoice.payment_intent
      : invoice.payment_intent?.id;
  // A trial took nothing, so there is nothing to give back.
  if (!paymentIntent || invoice.amount_paid <= 0) return;

  const { data: refunds } = await stripe.refunds.list({ payment_intent: paymentIntent, limit: 1 });
  if (refunds.length > 0) return;
  await stripe.refunds.create(
    { payment_intent: paymentIntent, reason: "duplicate", metadata: { duplicate_of: keptId } },
    { idempotencyKey: `refund-duplicate-${sub.id}` },
  );
}

const isEnded = (status: string) => status === "canceled" || status === "incomplete_expired";

/** A subscription's period end in seconds (see periodEnd). */
function periodEndSeconds(sub: Stripe.Subscription): number | null {
  return (
    sub.current_period_end ??
    (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end ??
    null
  );
}

/**
 * Cancel the student's own plan, now, once a parent's take-over
 * (stripe-checkout/takeOver.ts) has replaced it. Now rather than at its
 * period end: the take-over takes nothing until that day, so the student
 * keeps every day already paid for, and a cancelled plan can't be un-cancelled
 * in Stripe's portal or renew. No refund and no proration: those days are
 * still used. Safe to repeat, and two deliveries may both get here.
 *
 * If the student's plan was paid up further than the take-over expected (it
 * renewed, or moved to a longer cadence, before this landed), the take-over's
 * start moves back to match first, so the parent doesn't pay for those days
 * as well. A take-over already billing by then can't be moved: that is logged
 * for a person to refund, never refunded here.
 */
async function endReplacedPlan(
  replacedId: string,
  studentId: string,
  takeOver: Stripe.Subscription,
) {
  const old = await stripe.subscriptions.retrieve(replacedId).catch((err: unknown) => {
    if (isMissing(err)) return null;
    throw err;
  });
  if (!old || old.metadata?.student_id !== studentId || isEnded(old.status)) return;

  const paidUntil = periodEndSeconds(old);
  const startsAt = takeOver.trial_end ?? periodEndSeconds(takeOver);
  if (paidUntil && startsAt && paidUntil > startsAt) {
    if (takeOver.status === "trialing") {
      await stripe.subscriptions.update(takeOver.id, {
        trial_end: paidUntil,
        proration_behavior: "none",
      });
      console.log(`stripe-webhook: ${takeOver.id} now starts when ${replacedId} was paid up to`);
    } else {
      console.error(
        `stripe-webhook: NEEDS A PERSON: ${replacedId} was paid up to ${new Date(paidUntil * 1000).toISOString()}, ` +
          `after take-over ${takeOver.id} began billing; the family paid twice for those days`,
      );
    }
  }

  try {
    await stripe.subscriptions.cancel(replacedId, { invoice_now: false, prorate: false });
  } catch (err) {
    const again = await stripe.subscriptions.retrieve(replacedId).catch(() => null);
    if (again && isEnded(again.status)) return; // the other delivery won
    throw err;
  }
  console.log(`stripe-webhook: ${replacedId} cancelled; ${studentId} was taken over`);
}

/**
 * Write a subscription's state to public.subscriptions.
 *
 * Reads the subscription back from Stripe rather than trusting the event's
 * copy: events arrive out of order and Stripe retries failed ones for days,
 * so writing a snapshot could put back a status the subscription has since
 * left (an old "active" over a newer "past_due"). `snapshot` is used only if
 * Stripe no longer has the subscription at all.
 */
async function upsertSubscription(subscriptionId: string, snapshot?: Stripe.Subscription) {
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    if (!snapshot || !isMissing(err)) throw err;
    sub = snapshot;
  }

  const row = subscriptionRow(sub);
  if (!row) {
    // Without metadata we cannot tell who this covers, and guessing would mean
    // granting access to the wrong account. Loud failure over silent mis-grant.
    console.error(`stripe-webhook: subscription ${sub.id} has no student_id/payer_id metadata`);
    return;
  }

  // student_id is unique: one plan per student, whoever pays. A new
  // subscription replaces the row only once the one it holds has ended — a
  // parent buying for a child whose own plan lapsed, say. While that plan is
  // still worth keeping, the newcomer is a duplicate: overwriting the row would
  // leave the first one billing with nothing in the app pointing at it.
  const { data: tracked, error: trackedError } = await db
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("student_id", row.student_id)
    .maybeSingle();
  if (trackedError) throw new Error(`subscriptions read failed: ${trackedError.message}`);
  if (tracked?.stripe_subscription_id && tracked.stripe_subscription_id !== sub.id) {
    const kept = await stripe.subscriptions
      .retrieve(tracked.stripe_subscription_id)
      .catch((err: unknown) => {
        if (isMissing(err)) return null;
        throw err;
      });
    // The student's own plan, which a parent's take-over has replaced: it is
    // ended (if it isn't yet), and the row stays on the parent's.
    if (kept && kept.metadata?.replaces === sub.id && KEEPABLE_STATUSES.has(kept.status)) {
      await endReplacedPlan(sub.id, row.student_id, kept);
      console.log(`stripe-webhook: ${sub.id} was taken over by ${kept.id}; row left as it is`);
      return;
    }
    // A parent's take-over of the plan the row holds replaces it: no duplicate.
    const takingOver = sub.metadata?.replaces === tracked.stripe_subscription_id;
    // A late or resent event for the plan the tracked one replaced: it had
    // ended before the tracked one began, so it is no duplicate. Its last
    // invoice was a real payment, and the row already follows the newer plan.
    if (!takingOver && kept && sub.ended_at && sub.ended_at < kept.created) {
      console.log(`stripe-webhook: ${sub.id} ended before ${kept.id} began; row left as it is`);
      return;
    }
    if (!takingOver && kept && KEEPABLE_STATUSES.has(kept.status)) {
      await refundDuplicate(sub, kept.id);
      return;
    }
  }

  // Written only over the row read above. Two deliveries can run at once, and
  // one that read the row before the other moved it (a take-over landing in
  // the same instant) would put back the plan it replaced. The loser answers
  // 500; Stripe retries it, and the retry reads the row as it now is.
  let error: { code?: string; message: string } | null;
  if (!tracked) {
    ({ error } = await db.from("subscriptions").insert(row));
    if (error?.code === "23505") {
      throw new Error(`a row for ${row.student_id} was written meanwhile; Stripe will retry`);
    }
  } else {
    const held = tracked.stripe_subscription_id;
    const same = db.from("subscriptions").update(row).eq("student_id", row.student_id);
    const { data: written, error: updateError } = await (
      held ? same.eq("stripe_subscription_id", held) : same.is("stripe_subscription_id", null)
    ).select("student_id");
    error = updateError;
    if (!error && (written ?? []).length === 0) {
      throw new Error(`the row for ${row.student_id} moved meanwhile; Stripe will retry`);
    }
  }
  // 23503: the student's profile is gone. The account was deleted and this is
  // Stripe reporting the cancellation that went with it — there is no row left
  // to update, and failing would only make Stripe retry it for days.
  if (error?.code === "23503") {
    console.log(`stripe-webhook: ${sub.id} → student ${row.student_id} no longer exists`);
    return;
  }
  if (error) throw new Error(`subscriptions write failed: ${error.message}`);

  console.log(`stripe-webhook: ${sub.id} → student ${row.student_id} is ${row.status}`);

  // Only after the row follows the take-over: the old plan's own events then
  // find the new one tracked, and leave the row alone. A failure here answers
  // 500, so Stripe retries until the old plan is cancelled.
  const replaced = sub.metadata?.replaces;
  if (replaced && KEEPABLE_STATUSES.has(sub.status)) {
    await endReplacedPlan(replaced, row.student_id, sub);
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) {
    return new Response("Missing signature.", { status: 400 });
  }

  // The raw body is required — parsing it first would break the signature.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (err) {
    console.error("stripe-webhook: signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        // The session tells us a payment happened; the subscription carries the
        // authoritative status and period end, which upsertSubscription fetches.
        if (session.subscription) {
          const id =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          await upsertSubscription(id);
        }
        // A free-trial code is spent once its Checkout completes (see
        // stripe-checkout/trialCodes.ts).
        if (session.metadata?.trial_code) {
          await db
            .from("trial_codes")
            .update({ redeemed_at: new Date().toISOString() })
            .eq("code", session.metadata.trial_code)
            .is("redeemed_at", null);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // 'deleted' still upserts: the row's status becomes 'canceled', which
        // fails the access check. Removing the row would lose the billing
        // history, so we keep it and let status gate access instead.
        const snapshot = event.data.object as Stripe.Subscription;
        await upsertSubscription(snapshot.id, snapshot);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry with backoff. Swallowing the error would leave a
    // paying student locked out with no second chance.
    console.error(`stripe-webhook: handling ${event.type} failed:`, err);
    return new Response("Handler failed.", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
