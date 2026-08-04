// Supabase Edge Function: stripe-reconcile
//
// Closes the gap that let a deleted account keep a live Stripe subscription.
//
// Two passes, both idempotent and safe to run repeatedly:
//
//   1. DRAIN — cancel every subscription sitting in
//      public.stripe_cancellation_queue. The profiles BEFORE DELETE trigger
//      writes that queue, because Postgres can't call Stripe itself and a
//      failed HTTP call must never roll back or hang an account deletion.
//
//   2. SWEEP — walk every active/trialing/past_due subscription in Stripe and
//      cancel any whose owner no longer exists in public.profiles. This is the
//      backstop: it catches subscriptions orphaned before the trigger existed,
//      and any deletion that somehow bypasses it (a direct SQL delete on
//      auth.users with triggers disabled, a restore from an older dump).
//
// The sweep is the reason this is a separate function rather than another
// action on stripe-checkout: that function is caller-authenticated and acts on
// one subscription at a time. This one is an operator/cron job with no user.
//
// Auth: service-role only. There is no user context — a caller must present
// the service role key as a Bearer token, so this is never reachable from the
// browser. Invoke from pg_cron, a scheduler, or by hand.
//
// Required function secrets:
//   STRIPE_SECRET_KEY
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Statuses worth acting on. Anything else is already dead or never started. */
const LIVE_STATUSES = ["active", "trialing", "past_due", "unpaid", "paused"];

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(500, "Stripe is not configured on the server.");
  return new Stripe(key, { apiVersion: "2024-12-18.acacia" });
}

/**
 * Service-role gate.
 *
 * Deployed with verify_jwt: true, so the platform gateway has ALREADY verified
 * the token's signature against the project secret before this code runs — a
 * forged or tampered token never reaches us. That makes reading the `role`
 * claim here sound: we are authorising an already-authenticated token, not
 * trusting an unverified one.
 *
 * Claim-based rather than comparing against SUPABASE_SERVICE_ROLE_KEY, because
 * the value the platform injects is not necessarily the same string as the
 * legacy service key an operator holds (projects now also issue sb_secret_*
 * keys), and a string mismatch there locks out the very caller this is for.
 */
function requireServiceRole(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "This endpoint is service-role only.");

  // Fast path: the injected key itself.
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return;

  try {
    const part = token.split(".")[1];
    const json = atob(
      part
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(part.length + ((4 - (part.length % 4)) % 4), "="),
    );
    if (JSON.parse(json)?.role === "service_role") return;
  } catch {
    // fall through to the throw below
  }
  throw new HttpError(401, "This endpoint is service-role only.");
}

/**
 * Cancel a subscription, treating "already gone" as success.
 *
 * Stripe answers 404 resource_missing for a subscription that was deleted by
 * hand, and cancelling an already-cancelled one is a no-op. Both mean the
 * desired end state holds, so both count as done — otherwise a single stale
 * queue row would retry forever.
 */
async function cancelIfPresent(
  stripe: Stripe,
  subscriptionId: string,
): Promise<{ ok: true; outcome: string } | { ok: false; error: string }> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.status === "canceled") return { ok: true, outcome: "already_canceled" };
    await stripe.subscriptions.cancel(subscriptionId);
    return { ok: true, outcome: "canceled" };
  } catch (err) {
    // Only the two fields that decide the outcome are named — "already gone
    // from Stripe" is a success here, anything else is a real failure.
    const e = err as { code?: string; statusCode?: number; message?: string };
    if (e?.code === "resource_missing" || e?.statusCode === 404) {
      return { ok: true, outcome: "not_found_in_stripe" };
    }
    return { ok: false, error: e?.message ?? String(err) };
  }
}

/** Pass 1: cancel everything the deletion trigger queued up. */
async function drainQueue(dryRun: boolean) {
  const db = admin();
  const stripe = stripeClient();

  const { data: pending, error } = await db
    .from("stripe_cancellation_queue")
    .select("id, stripe_subscription_id, subject_user_id, subject_email, plan, attempts")
    .is("processed_at", null)
    .order("enqueued_at", { ascending: true })
    .limit(100);
  if (error) throw new HttpError(500, `Couldn't read the cancellation queue: ${error.message}`);

  const results: unknown[] = [];
  for (const row of pending ?? []) {
    if (dryRun) {
      results.push({
        id: row.id,
        subscription: row.stripe_subscription_id,
        outcome: "would_cancel",
      });
      continue;
    }

    const res = await cancelIfPresent(stripe, row.stripe_subscription_id);
    if (res.ok) {
      await db
        .from("stripe_cancellation_queue")
        .update({
          processed_at: new Date().toISOString(),
          attempts: row.attempts + 1,
          last_error: null,
        })
        .eq("id", row.id);
      results.push({ id: row.id, subscription: row.stripe_subscription_id, outcome: res.outcome });
    } else {
      // Leave processed_at null so the next run retries it.
      await db
        .from("stripe_cancellation_queue")
        .update({ attempts: row.attempts + 1, last_error: res.error })
        .eq("id", row.id);
      results.push({
        id: row.id,
        subscription: row.stripe_subscription_id,
        outcome: "error",
        error: res.error,
      });
    }
  }

  return { considered: pending?.length ?? 0, results };
}

/**
 * Pass 2: find live Stripe subscriptions whose owner no longer exists.
 *
 * Ownership is read from metadata (student_id / payer_id, both written at
 * checkout) and falls back to the customer's supabase_user_id. A subscription
 * with no identifying metadata at all is REPORTED, never cancelled — it may
 * predate this system or belong to something else entirely, and cancelling a
 * paying customer because we couldn't identify them is the worse failure.
 */
async function sweepOrphans(dryRun: boolean) {
  const db = admin();
  const stripe = stripeClient();

  const orphans: unknown[] = [];
  const unidentified: unknown[] = [];

  for (const status of ["active", "trialing", "past_due", "unpaid"] as const) {
    for await (const sub of stripe.subscriptions.list({
      status,
      limit: 100,
      expand: ["data.customer"],
    })) {
      // Expanded above, so this is an object in practice — but Stripe still
      // types it as id-or-object-or-deleted, and a deleted customer carries no
      // metadata. Narrowed to exactly what the owner lookup below reads.
      const customer = sub.customer as
        string | { id?: string; metadata?: Record<string, string> } | null;
      const ids = [
        sub.metadata?.student_id,
        sub.metadata?.payer_id,
        typeof customer === "object" ? customer?.metadata?.supabase_user_id : undefined,
      ].filter((v): v is string => typeof v === "string" && v.length > 0);

      if (ids.length === 0) {
        unidentified.push({
          subscription: sub.id,
          customer: typeof customer === "object" ? customer?.id : customer,
          status: sub.status,
          note: "no owner metadata — not touched, needs a human",
        });
        continue;
      }

      const { data: found, error } = await db
        .from("profiles")
        .select("id")
        .in("id", Array.from(new Set(ids)));
      if (error) throw new HttpError(500, `Couldn't check profiles: ${error.message}`);
      if ((found ?? []).length > 0) continue; // owner still exists — leave alone

      const record = {
        subscription: sub.id,
        customer: typeof customer === "object" ? customer?.id : customer,
        email: typeof customer === "object" ? customer?.email : null,
        status: sub.status,
        tier: sub.metadata?.tier ?? null,
        missing_user_ids: ids,
      };

      if (dryRun) {
        orphans.push({ ...record, outcome: "would_cancel" });
        continue;
      }

      const res = await cancelIfPresent(stripe, sub.id);
      orphans.push({
        ...record,
        outcome: res.ok ? res.outcome : "error",
        error: res.ok ? undefined : res.error,
      });

      // Record what happened, so an orphan cancelled by the sweep is as
      // auditable as one the trigger caught.
      await db.from("stripe_cancellation_queue").insert({
        stripe_subscription_id: sub.id,
        stripe_customer_id: typeof customer === "object" ? customer?.id : String(customer ?? ""),
        subject_user_id: ids[0],
        subject_email: typeof customer === "object" ? customer?.email : null,
        plan: sub.metadata?.tier ?? null,
        reason: "orphan_sweep",
        processed_at: res.ok ? new Date().toISOString() : null,
        attempts: 1,
        last_error: res.ok ? null : res.error,
      });
    }
  }

  return { orphans, unidentified };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    requireServiceRole(req);

    // `dry_run` reports what would happen without cancelling anything. Default
    // is to act: this is a cron target, and a job that only ever reports would
    // leave the bug unfixed.
    let body: { dry_run?: boolean; skip_sweep?: boolean } = {};
    try {
      body = (await req.json()) ?? {};
    } catch {
      // no body is fine
    }
    const dryRun = body.dry_run === true;

    const queue = await drainQueue(dryRun);
    const sweep = body.skip_sweep === true ? { skipped: true } : await sweepOrphans(dryRun);

    return new Response(JSON.stringify({ ok: true, dry_run: dryRun, queue, sweep }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("stripe-reconcile:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
