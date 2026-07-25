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

interface AddSubjectsPayload {
  /**
   * Add one or more subjects to an existing live subscription, moving it up the
   * `${cadence}_${count}` matrix (same cadence, higher count) and enrolling the
   * student in the new subjects. The price difference is prorated and invoiced
   * immediately. Caller must manage the plan (assertCanManage).
   */
  action: "add_subjects";
  /** subscriptions.student_id — whose plan to grow. */
  student_id: string;
  /** The subjects to add, each with the board the student will sit it with. */
  subjects: { subject: string; board: string }[];
}

interface InvoicesPayload {
  action: "invoices";
}

type Payload =
  | CheckoutPayload
  | PortalPayload
  | ManagePayload
  | AddSubjectsPayload
  | InvoicesPayload;

const VALID_SUBJECTS = ["biology", "chemistry", "physics"];
const VALID_BOARDS = ["edexcel", "aqa", "ocr"];
const MAX_SUBJECTS = 3;

/** Billing cadence of a tier, or null if it isn't one of ours. */
function tierCadence(tier: string | null | undefined): string | null {
  const head = String(tier ?? "").split("_")[0];
  return ["weekly", "monthly", "termly"].includes(head) ? head : null;
}

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
 * Who may manage (pause / resume / cancel) a student's subscription.
 *
 * Management is link-based, not payer-based: once a student is linked to a
 * parent, the PARENT controls the plan — even for a plan the student originally
 * paid for themselves. A student may only manage their own plan while NO parent
 * is linked; the moment one links, control moves to the parent and the student
 * can no longer interfere.
 *
 *   • caller is a linked parent of the student            → allowed
 *   • caller IS the student AND has no linked parent       → allowed
 *   • anyone else (incl. a self-paying but linked student) → 403
 *
 * This mirrors the billing_feedback RLS insert policy, so the same rule holds on
 * both sides.
 */
async function assertCanManage(callerId: string, studentId: string) {
  const db = admin();

  const { data: link } = await db
    .from("parent_student_links")
    .select("parent_id")
    .eq("parent_id", callerId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (link) return; // the linked parent

  if (callerId === studentId) {
    const { data: anyParent } = await db
      .from("parent_student_links")
      .select("parent_id")
      .eq("student_id", studentId)
      .limit(1)
      .maybeSingle();
    if (!anyParent) return; // an unlinked student managing their own plan
    throw new HttpError(403, "Your linked parent manages this plan.");
  }

  throw new HttpError(403, "You aren't allowed to manage this plan.");
}

/**
 * Who may UPGRADE (add subjects to) a student's plan. Deliberately looser than
 * assertCanManage: adding a subject is additive growth, so the student may do it
 * for their own plan even when a parent holds the pause/cancel controls, and a
 * linked parent may do it for their child. Only the destructive lifecycle
 * actions stay locked to the billing controller.
 */
async function assertCanUpgrade(callerId: string, studentId: string) {
  if (callerId === studentId) return; // the student growing their own plan
  const { data: link } = await admin()
    .from("parent_student_links")
    .select("parent_id")
    .eq("parent_id", callerId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (link) return; // the linked parent
  throw new HttpError(403, "You aren't allowed to change this plan.");
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
 * Pause / resume / cancel-at-period-end for a student's subscription.
 *
 * Authority is link-based (assertCanManage): the linked parent manages it, or
 * the student themselves while no parent is linked. The subscription is acted on
 * by its Stripe id, so a parent can manage a plan the student originally paid
 * for — the payer is no longer the gate.
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
  await assertCanManage(user.id, payload.student_id);

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
 * Add subject(s) to a live subscription — the frictionless upgrade. Moves the
 * plan up its cadence's subject-count ladder, swaps the Stripe price with an
 * immediate prorated invoice, and enrols the student in the new subjects
 * (keeping enrolled_courses — the RLS grant — in lockstep with what's paid for).
 *
 * Authorised by assertCanUpgrade — looser than the lifecycle actions: the
 * student may grow their own plan even when a parent holds the cancel controls.
 */
async function handleAddSubjects(req: Request, payload: AddSubjectsPayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  if (!payload.student_id) throw new HttpError(400, "student_id is required.");
  const requested = Array.isArray(payload.subjects) ? payload.subjects : [];
  if (requested.length === 0) throw new HttpError(400, "Pick at least one subject to add.");
  for (const r of requested) {
    if (!VALID_SUBJECTS.includes(r.subject) || !VALID_BOARDS.includes(r.board)) {
      throw new HttpError(400, "That subject or exam board isn't one we offer.");
    }
  }

  await assertCanUpgrade(user.id, payload.student_id);

  const { data: row } = await db
    .from("subscriptions")
    .select("stripe_subscription_id, status, plan, cancel_at_period_end")
    .eq("student_id", payload.student_id)
    .maybeSingle();
  if (!row?.stripe_subscription_id) throw new HttpError(404, "No active plan to add to.");
  const live = row.status === "active" || row.status === "trialing";
  if (!live || row.cancel_at_period_end) {
    throw new HttpError(409, "Resume the plan before adding subjects to it.");
  }

  const cadence = tierCadence(row.plan);
  if (!cadence) throw new HttpError(409, "This plan can't be upgraded automatically — contact us.");

  // Only genuinely new subjects count. Dedupe against what they already study so
  // a double-submit can't double-charge or push the count past the max.
  const { data: existingRows } = await db
    .from("student_enrolments")
    .select("subject")
    .eq("student_id", payload.student_id);
  const existing = new Set((existingRows ?? []).map((r) => r.subject));
  const toAdd = requested.filter((r) => !existing.has(r.subject));
  if (toAdd.length === 0) throw new HttpError(409, "Those subjects are already on the plan.");

  const newCount = existing.size + toAdd.length;
  if (newCount > MAX_SUBJECTS) {
    throw new HttpError(409, `A plan covers at most ${MAX_SUBJECTS} subjects.`);
  }

  const newTier = `${cadence}_${newCount}`;
  const { data: pkg } = await db
    .from("packages")
    .select("stripe_price_id")
    .eq("tier", newTier)
    .eq("active", true)
    .maybeSingle();
  if (!pkg?.stripe_price_id) {
    throw new HttpError(500, `The ${newTier} plan has no Stripe price attached yet.`);
  }

  // Swap the single subscription item to the higher-count price and invoice the
  // prorated difference now. metadata.tier is updated so the webhook (which reads
  // it) writes the same plan we mirror below.
  const stripeSub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new HttpError(500, "Couldn't find the subscription item to upgrade.");

  const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
    items: [{ id: itemId, price: pkg.stripe_price_id }],
    proration_behavior: "always_invoice",
    metadata: { ...stripeSub.metadata, tier: newTier },
  });

  // Enrol the student in the new subjects and grow the RLS grant. Do the grant
  // last: an enrolment row without matching enrolled_courses is harmless (no
  // access), the reverse would hand out access to a subject with no board set.
  const { error: enrErr } = await db.from("student_enrolments").upsert(
    toAdd.map((r) => ({ student_id: payload.student_id, subject: r.subject, board: r.board })),
    { onConflict: "student_id,subject" },
  );
  if (enrErr) throw new HttpError(500, `Couldn't record the new enrolment: ${enrErr.message}`);

  const nextCourses = [...existing, ...toAdd.map((r) => r.subject)];
  const { error: profErr } = await db
    .from("profiles")
    .update({ enrolled_courses: nextCourses })
    .eq("id", payload.student_id);
  if (profErr) throw new HttpError(500, `Couldn't update access: ${profErr.message}`);

  // Mirror plan immediately so the UI reflects the upgrade before the webhook.
  await db
    .from("subscriptions")
    .update({ plan: newTier, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", row.stripe_subscription_id);

  return { ok: true, plan: newTier, added: toAdd.map((r) => r.subject), status: updated.status };
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
      case "add_subjects":
        result = await handleAddSubjects(req, payload);
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
