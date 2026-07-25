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
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

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
    status: sub.pause_collection ? "paused" : sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    plan: sub.metadata?.tier ?? null,
    current_period_end: periodEnd(sub),
    updated_at: new Date().toISOString(),
  };
}

async function upsertSubscription(sub: Stripe.Subscription) {
  const row = subscriptionRow(sub);
  if (!row) {
    // Without metadata we cannot tell who this covers, and guessing would mean
    // granting access to the wrong account. Loud failure over silent mis-grant.
    console.error(`stripe-webhook: subscription ${sub.id} has no student_id/payer_id metadata`);
    return;
  }

  // student_id is unique: one live subscription per student, whoever pays. A
  // parent buying a plan for a child who already had their own replaces it
  // rather than stacking a second.
  const { error } = await db.from("subscriptions").upsert(row, { onConflict: "student_id" });
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);

  console.log(`stripe-webhook: ${sub.id} → student ${row.student_id} is ${row.status}`);
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
        // authoritative status and period end, so fetch it rather than infer.
        if (session.subscription) {
          const id =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          await upsertSubscription(await stripe.subscriptions.retrieve(id));
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // 'deleted' still upserts: the row's status becomes 'canceled', which
        // fails the access check. Removing the row would lose the billing
        // history, so we keep it and let status gate access instead.
        await upsertSubscription(event.data.object as Stripe.Subscription);
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
