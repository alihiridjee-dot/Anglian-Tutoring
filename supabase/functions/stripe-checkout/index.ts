// Supabase Edge Function: stripe-checkout
//
// All authenticated Stripe operations: Checkout Sessions, the Billing Portal,
// pause/resume/cancel, adding and removing subjects, switching cadence, and
// invoice history. Together with stripe-webhook this is the only place
// STRIPE_SECRET_KEY exists — it is never shipped to the browser.
//
// Checkout is for a family's FIRST subscription only. Every later change to a
// live plan is an update to the existing Stripe subscription (add_subjects,
// remove_subjects, change_cadence) — never a second Checkout Session. A second
// session would leave the first subscription billing forever, because the
// webhook keys public.subscriptions on student_id and would just overwrite the
// row.
//
// Things this function will not let the client decide:
//
//   • the price — it is looked up from public.packages by tier, so a caller
//     cannot post their own price id and buy the £139.99 plan for £0.
//   • who is paying — the payer is taken from the verified JWT, never the body.
//   • whose subscription is managed — pause/resume/cancel and add/remove
//     subjects run assertCanManage first: the payer, or a linked parent of the
//     student. Invoices are scoped to the caller's billing household.
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

interface RemoveSubjectsPayload {
  /**
   * Drop subject(s) from a live subscription — the mirror of add_subjects, and
   * the answer to "cancel Chemistry without cancelling everything". Moves the
   * plan DOWN the `${cadence}_${count}` matrix, un-enrols the student and
   * shrinks their access grant.
   *
   * Destructive, so it takes the stricter authority (assertCanManage) rather
   * than the looser upgrade check, and it refuses to empty the plan: removing
   * the last subject is cancelling, which has its own gated flow.
   */
  action: "remove_subjects";
  /** subscriptions.student_id — whose plan to shrink. */
  student_id: string;
  /** Subject slugs to drop. */
  subjects: string[];
}

interface ChangeCadencePayload {
  /**
   * Switch how often the family is billed (weekly / monthly / termly) on the
   * subscription they already have.
   *
   * This replaces the old "switch plan" path, which ran a fresh Checkout
   * Session: that charged the full new price with no proration AND left the
   * previous Stripe subscription running, because the webhook keys
   * public.subscriptions on student_id and simply overwrote the row. The family
   * was then billed twice with the app aware of only one.
   *
   * The subject COUNT is deliberately not a parameter — it is read from
   * student_enrolments, so a cadence switch can never silently change what the
   * plan covers (the old picker let someone buy `monthly_3` while enrolled in
   * two subjects). Growing or shrinking coverage goes through
   * add_subjects / remove_subjects, which ask which subjects and enrol properly.
   */
  action: "change_cadence";
  /** subscriptions.student_id — whose plan to re-time. */
  student_id: string;
  /** The cadence to move to. */
  cadence: string;
  /** When true, price it and return without touching Stripe or the database. */
  preview?: boolean;
}

interface InvoicesPayload {
  action: "invoices";
}

type Payload =
  | CheckoutPayload
  | PortalPayload
  | ManagePayload
  | AddSubjectsPayload
  | RemoveSubjectsPayload
  | ChangeCadencePayload
  | InvoicesPayload;

const VALID_SUBJECTS = ["biology", "chemistry", "physics"];
const VALID_BOARDS = ["edexcel", "aqa", "ocr"];
const MAX_SUBJECTS = 3;

/** Billing cadence of a tier, or null if it isn't one of ours. */
function tierCadence(tier: string | null | undefined): string | null {
  const head = String(tier ?? "").split("_")[0];
  return ["weekly", "monthly", "termly"].includes(head) ? head : null;
}

/** The exam level we price a student at, or null if they have none set. */
async function studentLevel(
  db: ReturnType<typeof admin>,
  studentId: string,
): Promise<string | null> {
  const { data } = await db.from("profiles").select("level").eq("id", studentId).maybeSingle();
  return data?.level ?? null;
}

/**
 * The package a given student buys at a given tier.
 *
 * A tier can hold two rows: a level-specific price and the general one. The
 * student's level wins, and everyone else falls back to the general row — the
 * same rule the client applies in resolvePackagesForLevel, kept here because
 * the price charged must never be decided by the browser.
 *
 * Selecting the set and narrowing in code (rather than .maybeSingle()) is
 * deliberate: two rows share a tier by design, so a single-row query would
 * error the moment any level-specific price exists.
 */
async function resolvePackage(
  db: ReturnType<typeof admin>,
  tier: string,
  level: string | null,
): Promise<{ tier: string; name: string; stripe_price_id: string | null } | null> {
  const { data } = await db
    .from("packages")
    .select("tier, name, stripe_price_id, level")
    .eq("tier", tier)
    .eq("active", true);
  const rows = data ?? [];
  return rows.find((r) => r.level === level) ?? rows.find((r) => r.level === null) ?? null;
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
 * Who may manage (pause / resume / cancel / drop a subject from) a student's
 * subscription.
 *
 * Two authorities, either of which is enough:
 *
 *   • the PAYER — whoever's card the plan sits on (subscriptions.user_id). This
 *     is absolute: nobody may be charged with no way to stop it. It is what
 *     rescues the self-paying student who later links a parent — the old
 *     link-only rule left them funding a plan they were locked out of managing.
 *   • a LINKED PARENT of the student — oversight of a child's plan, including
 *     one the child paid for themselves.
 *
 * So the only person refused is a student who neither pays nor is unlinked: a
 * child on a parent-funded plan, who sees status and is pointed at their payer.
 *
 *   • caller is the payer                                  → allowed
 *   • caller is a linked parent of the student             → allowed
 *   • caller IS the student AND no parent is linked        → allowed
 *   • a linked student on someone else's card              → 403
 *
 * Mirrored by the billing_feedback RLS insert policy so the rule holds on both
 * sides. `payerId` comes from the subscription row the caller already loaded;
 * omit it and only the link-based arms apply.
 */
async function assertCanManage(callerId: string, studentId: string, payerId?: string | null) {
  const db = admin();

  if (payerId && callerId === payerId) return; // the payer, always

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

  const pkg = await resolvePackage(db, payload.tier, await studentLevel(db, beneficiary));
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
 * Authority is assertCanManage: the payer, or a linked parent of the student.
 * The subscription is acted on by its Stripe id, so a parent can manage a plan
 * the student originally paid for, and the student who is paying keeps control
 * of their own card either way.
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
  await assertCanManage(user.id, payload.student_id, row.user_id);

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

  // Ladder up within the student's own price list: the tier vocabulary is
  // shared across levels, so the level has to be reapplied here or an upgrade
  // would silently move them onto general pricing.
  const newTier = `${cadence}_${newCount}`;
  const pkg = await resolvePackage(db, newTier, await studentLevel(db, payload.student_id));
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
 * Drop subject(s) from a live subscription — the mirror of handleAddSubjects,
 * and the only way to stop paying for one subject without ending the plan.
 *
 * Moves the plan down its cadence's ladder, swaps the Stripe price, un-enrols
 * the student and shrinks enrolled_courses (the RLS grant) so the material
 * locks the moment the money stops. Unlike an upgrade there is no immediate
 * invoice: a downgrade's proration becomes a CREDIT held against the next bill
 * (`create_prorations`), because Stripe does not refund to the card here and
 * silently issuing a £0 invoice would read as "we took another payment".
 *
 * Refuses to remove the last subject — a plan covering nothing is a cancelled
 * plan, and cancelling has its own gated flow with its own consequences.
 */
async function handleRemoveSubjects(req: Request, payload: RemoveSubjectsPayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  if (!payload.student_id) throw new HttpError(400, "student_id is required.");
  const requested = [...new Set(Array.isArray(payload.subjects) ? payload.subjects : [])];
  if (requested.length === 0) throw new HttpError(400, "Pick at least one subject to remove.");
  for (const s of requested) {
    if (!VALID_SUBJECTS.includes(s)) throw new HttpError(400, "That isn't a subject we offer.");
  }

  const { data: row } = await db
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status, plan, cancel_at_period_end")
    .eq("student_id", payload.student_id)
    .maybeSingle();
  if (!row?.stripe_subscription_id) throw new HttpError(404, "No active plan to change.");

  // Stricter than adding: shrinking the plan takes away access, so it belongs to
  // whoever controls the money, not to anyone who can grow it.
  await assertCanManage(user.id, payload.student_id, row.user_id);

  const live = row.status === "active" || row.status === "trialing";
  if (!live || row.cancel_at_period_end) {
    throw new HttpError(409, "Resume the plan before changing the subjects on it.");
  }

  const cadence = tierCadence(row.plan);
  if (!cadence) throw new HttpError(409, "This plan can't be changed automatically — contact us.");

  const { data: existingRows } = await db
    .from("student_enrolments")
    .select("subject")
    .eq("student_id", payload.student_id);
  const existing = (existingRows ?? []).map((r) => r.subject);
  const toRemove = requested.filter((s) => existing.includes(s));
  if (toRemove.length === 0) throw new HttpError(409, "That subject isn't on the plan.");

  const remaining = existing.filter((s) => !toRemove.includes(s));
  if (remaining.length === 0) {
    throw new HttpError(
      409,
      "That would leave the plan with no subjects — cancel the plan instead.",
    );
  }

  const newTier = `${cadence}_${remaining.length}`;
  const pkg = await resolvePackage(db, newTier, await studentLevel(db, payload.student_id));
  if (!pkg?.stripe_price_id) {
    throw new HttpError(500, `The ${newTier} plan has no Stripe price attached yet.`);
  }

  const stripeSub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new HttpError(500, "Couldn't find the subscription item to change.");

  await stripe.subscriptions.update(row.stripe_subscription_id, {
    items: [{ id: itemId, price: pkg.stripe_price_id }],
    // Credit the unused portion against the next invoice rather than invoicing
    // now — see the note above.
    proration_behavior: "create_prorations",
    metadata: { ...stripeSub.metadata, tier: newTier },
  });

  // Revoke the grant FIRST, then delete the enrolment — the exact inverse of the
  // add path's ordering, and for the same reason: the transient state must be
  // "enrolled but no access" (harmless), never "access with no enrolment".
  const { error: profErr } = await db
    .from("profiles")
    .update({ enrolled_courses: remaining })
    .eq("id", payload.student_id);
  if (profErr) throw new HttpError(500, `Couldn't update access: ${profErr.message}`);

  // The enrolment row carries the board, so it has to go rather than linger:
  // a stale row would make add_subjects reject re-adding the subject later as
  // "already on the plan".
  const { error: enrErr } = await db
    .from("student_enrolments")
    .delete()
    .eq("student_id", payload.student_id)
    .in("subject", toRemove);
  if (enrErr) throw new HttpError(500, `Couldn't remove the enrolment: ${enrErr.message}`);

  await db
    .from("subscriptions")
    .update({ plan: newTier, updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", row.stripe_subscription_id);

  return { ok: true, plan: newTier, removed: toRemove, remaining };
}

/**
 * What Stripe will actually charge for a pending item swap, straight from
 * Stripe rather than guessed at in our own arithmetic.
 *
 * Cadence prices are not comparable by hand — £19.99/week against £55.99/month
 * against £139.99/quarter, part-way through a period, with a credit for unused
 * time. Only Stripe knows the number, so the confirm dialog quotes this instead
 * of inventing one.
 *
 * Returns null rather than throwing: a preview failing must not block the
 * change itself, so the UI degrades to "Stripe will prorate this" instead of
 * showing a wrong figure.
 */
async function previewItemSwap(
  stripe: Stripe,
  subscriptionId: string,
  itemId: string,
  priceId: string,
): Promise<{ amount_due: number; currency: string } | null> {
  // The parameter shape moved from flat `subscription_*` keys to a nested
  // `subscription_details` object partway through the API versions this project
  // has run on. Try the current shape, fall back to the legacy one.
  const nested = {
    subscription: subscriptionId,
    subscription_details: {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "always_invoice",
    },
  };
  const flat = {
    subscription: subscriptionId,
    subscription_items: [{ id: itemId, price: priceId }],
    subscription_proration_behavior: "always_invoice",
  };

  for (const params of [nested, flat]) {
    try {
      const inv = await (stripe.invoices as any).retrieveUpcoming(params);
      return { amount_due: inv.amount_due ?? 0, currency: inv.currency ?? "gbp" };
    } catch (err) {
      console.warn("stripe-checkout: upcoming-invoice preview failed:", (err as Error).message);
    }
  }
  return null;
}

/**
 * Switch billing cadence on the subscription the family already has.
 *
 * Modifies the existing Stripe subscription in place, with proration, rather
 * than selling them a second one — see ChangeCadencePayload for why the old
 * checkout-based "switch plan" was actively harmful.
 *
 * The new tier keeps the subject count from student_enrolments, so switching
 * can only ever change *when* they pay, never *what they get*. That is what
 * makes it safe to offer as a one-click control: there is nothing to ask.
 *
 * `preview: true` prices the move and returns without mutating anything.
 */
async function handleChangeCadence(req: Request, payload: ChangeCadencePayload) {
  const user = await requireUser(req);
  const db = admin();
  const stripe = stripeClient();

  if (!payload.student_id) throw new HttpError(400, "student_id is required.");
  const cadence = tierCadence(payload.cadence);
  if (!cadence || cadence !== payload.cadence) {
    throw new HttpError(400, "That isn't a billing cadence we offer.");
  }

  const { data: row } = await db
    .from("subscriptions")
    .select("user_id, stripe_subscription_id, status, plan, cancel_at_period_end")
    .eq("student_id", payload.student_id)
    .maybeSingle();
  if (!row?.stripe_subscription_id) throw new HttpError(404, "No active plan to change.");

  await assertCanManage(user.id, payload.student_id, row.user_id);

  const live = row.status === "active" || row.status === "trialing";
  if (!live || row.cancel_at_period_end) {
    throw new HttpError(409, "Resume the plan before changing how often you're billed.");
  }

  // Coverage is whatever they're actually enrolled in — never a client-supplied
  // count, so a switch can't quietly buy or drop a subject.
  const { data: enrolRows } = await db
    .from("student_enrolments")
    .select("subject")
    .eq("student_id", payload.student_id);
  const count = Math.min(Math.max((enrolRows ?? []).length, 1), MAX_SUBJECTS);

  const newTier = `${cadence}_${count}`;
  if (newTier === row.plan) throw new HttpError(409, "That's already the current plan.");

  const pkg = await resolvePackage(db, newTier, await studentLevel(db, payload.student_id));
  if (!pkg?.stripe_price_id) {
    throw new HttpError(500, `The ${newTier} plan has no Stripe price attached yet.`);
  }

  const stripeSub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
  const itemId = stripeSub.items.data[0]?.id;
  if (!itemId) throw new HttpError(500, "Couldn't find the subscription item to change.");

  const quote = await previewItemSwap(
    stripe,
    row.stripe_subscription_id,
    itemId,
    pkg.stripe_price_id,
  );

  if (payload.preview) {
    return {
      ok: true,
      preview: true,
      plan: newTier,
      plan_name: pkg.name,
      subjects: count,
      amount_due_now: quote?.amount_due ?? null,
      currency: quote?.currency ?? "gbp",
    };
  }

  // A cadence change resets the billing period, so the proration is invoiced
  // now rather than parked on a future bill: the family is starting a new week
  // / month / term today and the invoice should say so.
  const updated = await stripe.subscriptions.update(row.stripe_subscription_id, {
    items: [{ id: itemId, price: pkg.stripe_price_id }],
    proration_behavior: "always_invoice",
    metadata: { ...stripeSub.metadata, tier: newTier },
  });

  const periodEndTs =
    updated.current_period_end ??
    (updated.items?.data?.[0] as { current_period_end?: number } | undefined)?.current_period_end;
  await db
    .from("subscriptions")
    .update({
      plan: newTier,
      current_period_end: periodEndTs ? new Date(periodEndTs * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", row.stripe_subscription_id);

  return {
    ok: true,
    plan: newTier,
    plan_name: pkg.name,
    subjects: count,
    amount_due_now: quote?.amount_due ?? null,
    currency: quote?.currency ?? "gbp",
  };
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
      case "remove_subjects":
        result = await handleRemoveSubjects(req, payload);
        break;
      case "change_cadence":
        result = await handleChangeCadence(req, payload);
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
