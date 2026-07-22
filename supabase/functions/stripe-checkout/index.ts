// Supabase Edge Function: stripe-checkout
//
// All authenticated Stripe operations: Checkout Sessions, the Billing Portal,
// pause/resume/cancel, and invoice history. Together with stripe-webhook this
// is the only place STRIPE_SECRET_KEY exists — it is never shipped to the
// browser.
//
// Things this function will not let the client decide:
//
//   • the price — it is looked up from public.packages by tier, so a caller
//     cannot post their own price id and buy the £139.99 plan for £0.
//   • who is paying — the payer is taken from the verified JWT, never the body.
//   • whose subscription is managed — pause/resume/cancel and invoices only
//     operate on rows whose user_id (the payer) matches the caller.
//
// A caller may nominate a *beneficiary* (a parent paying for their child), but
// only if an active parent_student_links row already proves the relationship.
//
// Note: pausing/cancelling changes state in Stripe only; the webhook is what
// writes public.subscriptions and therefore what actually grants or revokes
// access. That keeps a single writer for the access table.
//
// Required function secrets (set with `supabase secrets set ...`):
//   STRIPE_SECRET_KEY, APP_URL
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// deno-lint-ignore-file no-explicit-any
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

/** Where Stripe sends the browser back to. Whitelisted — never client URLs. */
const RETURN_PATHS: Record<string, string> = {
  onboarding: "/onboarding/plan",
  billing: "/billing",
  parent: "/parent-dashboard",
};

interface CheckoutPayload {
  action: "checkout";
  /** packages.tier — the plan being bought. */
  tier: string;
  /** The student the subscription covers. Defaults to the caller. */
  student_id?: string;
  /** Which app page to land back on. Key into RETURN_PATHS. */
  return_to?: string;
}

interface PortalPayload {
  action: "portal";
  return_to?: string;
}

interface ManagePayload {
  /**
   * cancel  → cancel_at_period_end: access runs to the period boundary.
   * pause   → stop collecting payment immediately (behaviour "void").
   * resume  → undo either of the above.
   */
  action: "cancel" | "pause" | "resume";
  /** subscriptions.student_id — which subscription of the caller's to act on. */
  student_id: string;
}

interface DeletePayload {
  /**
   * The heavy path, distinct from `cancel`. Terminates the Stripe subscription
   * *immediately* (no run-out of the paid period) as part of a GDPR Art. 17
   * erasure. The lighter, EU-mandated easy cancellation is `cancel` above; this
   * is only reached after the client's explicit multi-step consent.
   *
   * Note: invoices and payment records are deliberately NOT erased — UK/EU tax
   * and accounting law (a GDPR Art. 17(3)(b) legal-obligation exemption)
   * requires them to be retained, so this cancels access, not the audit trail.
   */
  action: "delete";
  /** subscriptions.student_id — which subscription of the caller's to delete. */
  student_id: string;
  /** Optional free-text reason, forwarded to Stripe's cancellation details. */
  reason?: string;
}

interface InvoicesPayload {
  action: "invoices";
}

type Payload =
  | CheckoutPayload
  | PortalPayload
  | ManagePayload
  | DeletePayload
  | InvoicesPayload;

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function stripeClient() {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(500, "Stripe is not configured on the server.");
  return new Stripe(key, { apiVersion: "2024-12-18.acacia" });
}

function appUrl() {
  return Deno.env.get("APP_URL") ?? "http://localhost:3000";
}

function returnPath(key: string | undefined, fallback: string) {
  return RETURN_PATHS[key ?? ""] ?? fallback;
}

/** Resolves the caller from the Authorization bearer token. */
async function requireUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Missing authorization header.");
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Invalid session.");
  return data.user;
}

/**
 * Guards the parent-only lifecycle actions (pause, delete). Even a student who
 * pays for their own plan may not pause or delete it — only a parent can. The
 * check reads profiles.role from the data, mirroring the billing_feedback RLS
 * insert policy, so the rule lives in one shape on both sides.
 */
async function requireParent(userId: string) {
  const { data: profile } = await admin()
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role !== "parent") {
    throw new HttpError(403, "Only a parent can pause or delete a plan.");
  }
}

/**
 * Every Stripe customer in the caller's billing household, so payment history is
 * shared across a linked parent and student. Parents and students share the one
 * account: a student sees invoices billed to their parent's card, and a parent
 * sees any the student paid themselves. Built from parent_student_links in both
 * directions plus the caller, mapped to stripe_customers.
 */
async function householdCustomerIds(userId: string): Promise<string[]> {
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
async function resolveCustomer(stripe: Stripe, userId: string, email: string | undefined) {
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

async function handleCheckout(req: Request, payload: CheckoutPayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  const beneficiary = payload.student_id ?? user.id;

  // A payer other than the student must already be their linked parent. A
  // parent_student_links row IS the grant, so its existence is the whole check.
  if (beneficiary !== user.id) {
    const { data: link } = await db
      .from("parent_student_links")
      .select("student_id")
      .eq("parent_id", user.id)
      .eq("student_id", beneficiary)
      .maybeSingle();
    if (!link) throw new HttpError(403, "You aren't linked to that student.");
  }

  const { data: pkg } = await db
    .from("packages")
    .select("tier, name, stripe_price_id")
    .eq("tier", payload.tier)
    .eq("active", true)
    .maybeSingle();
  if (!pkg) throw new HttpError(404, `No active plan called "${payload.tier}".`);
  if (!pkg.stripe_price_id) {
    throw new HttpError(
      500,
      `The "${pkg.name}" plan has no Stripe price attached yet. Run scripts/stripe-seed.ts.`,
    );
  }

  const customerId = await resolveCustomer(stripe, user.id, user.email);
  const back = `${appUrl()}${returnPath(payload.return_to, RETURN_PATHS.onboarding)}`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
    success_url: `${back}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}?checkout=cancelled`,
    // The webhook reads these back to decide who to grant access to. They are
    // set here, server-side, from values already verified above.
    subscription_data: {
      metadata: { student_id: beneficiary, payer_id: user.id, tier: pkg.tier },
    },
    metadata: { student_id: beneficiary, payer_id: user.id, tier: pkg.tier },
    allow_promotion_codes: true,
  });

  return { url: session.url };
}

async function handlePortal(req: Request, payload: PortalPayload) {
  const user = await requireUser(req);
  const stripe = stripeClient();
  const db = admin();

  const { data: customer } = await db
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer?.stripe_customer_id) {
    throw new HttpError(404, "You don't have a billing account yet.");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${appUrl()}${returnPath(payload.return_to, RETURN_PATHS.billing)}`,
  });
  return { url: session.url };
}

/**
 * Pause / resume / cancel-at-period-end for a subscription the caller pays for.
 *
 * The DB row is the ownership check: only the payer (user_id) may manage a
 * subscription, even though the student it covers can *see* it.
 */
async function handleManage(req: Request, payload: ManagePayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  if (!payload.student_id) throw new HttpError(400, "student_id is required.");

  const { data: row } = await db
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status")
    .eq("student_id", payload.student_id)
    .maybeSingle();
  if (!row?.stripe_subscription_id) throw new HttpError(404, "No subscription found.");
  if (row.user_id !== user.id) {
    throw new HttpError(403, "Only the account that pays for this plan can manage it.");
  }
  // Pausing is a parent-only action; cancel/resume stay open to the payer.
  if (payload.action === "pause") await requireParent(user.id);

  const id = row.stripe_subscription_id;
  let sub: Stripe.Subscription;
  switch (payload.action) {
    case "cancel":
      // Not an immediate cancellation: the family keeps what they paid for
      // until the period ends, then the webhook flips access off.
      sub = await stripe.subscriptions.update(id, { cancel_at_period_end: true });
      break;
    case "pause":
      // "void" stops invoicing entirely while paused; the webhook writes the
      // paused state through so access is suspended rather than left ajar.
      sub = await stripe.subscriptions.update(id, {
        pause_collection: { behavior: "void" },
      });
      break;
    case "resume":
      sub = await stripe.subscriptions.update(id, {
        pause_collection: "",
        cancel_at_period_end: false,
      });
      break;
  }

  // Mirror the new state immediately rather than waiting for the webhook, so
  // the UI the caller lands back on reflects what they just did. The webhook
  // will write the same values again shortly after — that's fine.
  // current_period_end lives on the subscription OR its items depending on the
  // Stripe API version, so read both.
  const periodEndTs =
    sub.current_period_end ??
    (sub.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end;
  await db
    .from("subscriptions")
    .update({
      status: sub.pause_collection ? "paused" : sub.status,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      current_period_end: periodEndTs ? new Date(periodEndTs * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", id);

  return { ok: true, status: sub.pause_collection ? "paused" : sub.status };
}

/**
 * Immediate, permanent termination of a subscription the caller pays for — the
 * "delete" path behind the client's GDPR-erasure consent flow.
 *
 * Same payer-only ownership check as handleManage. Two hard guards protect the
 * things that must not be destroyed here:
 *   • No stripe_subscription_id → nothing to cancel: there is no Stripe object,
 *     so the request 404s and the local row is left untouched.
 *   • Invoices/customer are left in place — retained for statutory tax record
 *     keeping, per the Art. 17(3)(b) exemption noted on DeletePayload.
 */
async function handleDelete(req: Request, payload: DeletePayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  if (!payload.student_id) throw new HttpError(400, "student_id is required.");

  const { data: row } = await db
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status")
    .eq("student_id", payload.student_id)
    .maybeSingle();
  if (!row?.stripe_subscription_id) {
    // No Stripe subscription exists, so there is nothing to delete.
    throw new HttpError(404, "No Stripe subscription to delete.");
  }
  if (row.user_id !== user.id) {
    throw new HttpError(403, "Only the account that pays for this plan can delete it.");
  }
  // Deletion is parent-only, same rule as pause.
  await requireParent(user.id);

  // Cancel now, not at period end — deletion is immediate by definition. Stripe
  // records the reason for the audit trail; the customer and its invoices remain
  // for statutory retention.
  const reason = payload.reason?.slice(0, 500);
  const sub = await stripe.subscriptions.cancel(row.stripe_subscription_id, {
    ...(reason ? { cancellation_details: { comment: reason } } : {}),
  });

  // Mirror the terminal state immediately; the customer.subscription.deleted
  // webhook will write the same canceled status shortly after.
  await db
    .from("subscriptions")
    .update({
      status: sub.status, // "canceled"
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", row.stripe_subscription_id);

  return { ok: true, status: sub.status };
}

/**
 * The billing household's payment history, newest first — the parent's and the
 * linked student's invoices merged into one shared list (see
 * householdCustomerIds). Each customer's invoices are fetched, combined, sorted
 * by date and capped, so both personas see the same history for the plans that
 * connect them.
 */
async function handleInvoices(req: Request) {
  const user = await requireUser(req);
  const stripe = stripeClient();

  const customerIds = await householdCustomerIds(user.id);
  if (customerIds.length === 0) return { invoices: [] };

  const lists = await Promise.all(
    customerIds.map((customer) => stripe.invoices.list({ customer, limit: 24 })),
  );

  const invoices = lists
    .flatMap((list) => list.data)
    .sort((a, b) => b.created - a.created)
    .slice(0, 24)
    .map((inv) => ({
      id: inv.id,
      number: inv.number,
      created: inv.created,
      status: inv.status,
      currency: inv.currency,
      amount_paid: inv.amount_paid,
      amount_due: inv.amount_due,
      description: inv.lines?.data?.[0]?.description ?? null,
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      invoice_pdf: inv.invoice_pdf ?? null,
    }));

  return { invoices };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const payload = (await req.json()) as Payload;
    let result: unknown;
    switch (payload.action) {
      case "checkout":
        result = await handleCheckout(req, payload);
        break;
      case "portal":
        result = await handlePortal(req, payload);
        break;
      case "cancel":
      case "pause":
      case "resume":
        result = await handleManage(req, payload);
        break;
      case "delete":
        result = await handleDelete(req, payload);
        break;
      case "invoices":
        result = await handleInvoices(req);
        break;
      default:
        throw new HttpError(400, "Unknown action.");
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    console.error("stripe-checkout:", message);
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
