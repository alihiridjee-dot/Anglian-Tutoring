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
 * Pause, resume, or cancel-at-period-end. Caller must manage the plan (the
 * linked parent, or an unlinked student). Cancelling is the only way to end a
 * plan — there is no immediate delete.
 */
export async function manageSubscription(action: "cancel" | "pause" | "resume", studentId: string) {
  return invokeBilling<{ ok: boolean; status: string }>({ action, student_id: studentId });
}

/** The caller's Stripe payment history (empty if they've never paid). */
export async function fetchInvoices(): Promise<Invoice[]> {
  const { invoices } = await invokeBilling<{ invoices: Invoice[] }>({ action: "invoices" });
  return invoices ?? [];
}
