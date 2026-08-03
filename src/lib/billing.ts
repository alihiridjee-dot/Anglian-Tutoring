import { supabase } from "@/integrations/supabase/client";

/**
 * Client seam for the stripe-checkout edge function.
 *
 * Everything money-related goes through here: the browser never talks to
 * Stripe directly and never decides prices or payers — it only names a tier /
 * student and follows the redirect the server hands back.
 */

export interface SubscriptionRow {
  user_id: string;
  student_id: string;
  status: string;
  plan: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /**
   * Every plan is a real Stripe subscription, so this is populated in practice.
   * Kept nullable defensively: a row momentarily without one has no Stripe
   * object to pause or cancel, so no controls should render.
   */
  stripe_subscription_id: string | null;
}

export interface Invoice {
  id: string;
  number: string | null;
  created: number;
  status: string | null;
  currency: string;
  amount_paid: number;
  amount_due: number;
  description: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

export interface PackageRow {
  id: string;
  tier: string;
  name: string;
  description: string | null;
  price_pence: number;
  billing_interval: string | null;
  /**
   * The exam level this price is for, or null when it applies to everyone.
   *
   * Plain text rather than the level enum: a price list outlives any one
   * taxonomy value, and a row for a level that no longer exists should go
   * unused rather than break the column.
   */
  level: string | null;
}

/**
 * Narrows the price list to what one student should actually be offered.
 *
 * Packages are keyed by tier (cadence + subject count). A tier may carry a
 * level-specific override row alongside the general one; the override wins for
 * a student at that level, and everyone else falls back to the general row.
 * This is what lets iGCSE be priced apart from GCSE without forking the tier
 * vocabulary that the upgrade ladder depends on.
 *
 * Input order is preserved, so the caller's sort_order still drives display.
 */
export function resolvePackagesForLevel(
  packages: PackageRow[],
  level: string | null | undefined,
): PackageRow[] {
  const overriddenTiers = new Set(
    level ? packages.filter((p) => p.level === level).map((p) => p.tier) : [],
  );
  return packages.filter((p) =>
    p.level === null ? !overriddenTiers.has(p.tier) : p.level === level,
  );
}

/** Pages Stripe may send the browser back to (validated server-side). */
export type BillingReturnTo = "onboarding" | "billing" | "parent";

/** Statuses that mean the plan currently grants access. */
export function isSubscriptionLive(status: string | undefined | null) {
  return status === "active" || status === "trialing";
}

export function formatPence(pence: number, currency = "gbp") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(pence / 100);
}

/** Human name for a subscription's plan tier, whatever its origin. */
export function planLabel(plan: string | null | undefined, packages: PackageRow[]): string {
  if (!plan) return "Subscription";
  const pkg = packages.find((p) => p.tier === plan);
  if (pkg) return pkg.name;
  return plan;
}

export function billingIntervalLabel(interval: string | null) {
  if (interval === "week") return "per week";
  if (interval === "month") return "per month";
  if (interval === "quarter") return "every 3 months";
  return "";
}

async function invokeBilling<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("stripe-checkout", { body });
  if (error) {
    // FunctionsHttpError hides the server's message inside the response body;
    // surface it so the user sees "You aren't linked to that student" rather
    // than "Edge Function returned a non-2xx status code".
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const parsed = await ctx.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

/** Sends the browser to Stripe Checkout for a plan purchase. */
export async function startCheckout(opts: {
  tier: string;
  studentId?: string;
  returnTo?: BillingReturnTo;
}) {
  const { url } = await invokeBilling<{ url: string }>({
    action: "checkout",
    tier: opts.tier,
    student_id: opts.studentId,
    return_to: opts.returnTo,
  });
  if (!url) throw new Error("Stripe didn't return a checkout link.");
  window.location.href = url;
}

/** Sends the browser to the Stripe billing portal (cards, invoices, VAT…). */
export async function openBillingPortal(returnTo: BillingReturnTo = "billing") {
  const { url } = await invokeBilling<{ url: string }>({ action: "portal", return_to: returnTo });
  if (!url) throw new Error("Couldn't open the billing portal.");
  window.location.href = url;
}

/**
 * Pause, resume, or cancel-at-period-end. Caller must manage the plan — the
 * payer, or a linked parent. Cancelling is the only way to end a plan; there is
 * no immediate delete, so access always runs to the period boundary.
 */
export async function manageSubscription(action: "cancel" | "pause" | "resume", studentId: string) {
  return invokeBilling<{ ok: boolean; status: string }>({ action, student_id: studentId });
}

/**
 * Add subject(s) to a live subscription — the in-app upgrade. Bumps the plan up
 * its cadence's subject-count ladder and enrols the student, with the prorated
 * difference charged immediately. Caller must manage the plan.
 */
export async function addSubjects(
  studentId: string,
  subjects: { subject: string; board: string }[],
) {
  return invokeBilling<{ ok: boolean; plan: string; added: string[] }>({
    action: "add_subjects",
    student_id: studentId,
    subjects,
  });
}

/**
 * Drop subject(s) from a live plan — the downgrade, and the way to stop paying
 * for one subject without ending the plan. Steps down the cadence's ladder,
 * un-enrols the student, and credits the unused portion against the next bill.
 * Caller must MANAGE the plan (stricter than adding, which any student may do
 * for themselves). The server refuses to remove the last subject.
 */
export async function removeSubjects(studentId: string, subjects: string[]) {
  return invokeBilling<{ ok: boolean; plan: string; removed: string[]; remaining: string[] }>({
    action: "remove_subjects",
    student_id: studentId,
    subjects,
  });
}

export interface CadenceQuote {
  ok: boolean;
  /** The tier they'd land on, e.g. "monthly_2". */
  plan: string;
  plan_name: string;
  /** How many subjects it covers — unchanged by a cadence switch. */
  subjects: number;
  /** Pence Stripe will charge today, or null if the preview couldn't be got. */
  amount_due_now: number | null;
  currency: string;
}

/**
 * Change how often the family is billed, on the subscription they already have.
 *
 * Note what this does NOT take: a subject count. The new tier keeps whatever
 * the student is enrolled in, so switching cadence can never change what the
 * plan covers — that's what add/removeSubjects are for. It also never opens
 * Checkout: this edits the live subscription, so there's exactly one.
 *
 * `preview` prices the move without committing to it.
 */
export async function changeCadence(
  studentId: string,
  cadence: string,
  opts: { preview?: boolean } = {},
) {
  return invokeBilling<CadenceQuote>({
    action: "change_cadence",
    student_id: studentId,
    cadence,
    preview: opts.preview ?? false,
  });
}

/** The caller's Stripe payment history (empty if they've never paid). */
export async function fetchInvoices(): Promise<Invoice[]> {
  const { invoices } = await invokeBilling<{ invoices: Invoice[] }>({ action: "invoices" });
  return invoices ?? [];
}
