import { supabase } from "@/integrations/supabase/client";

/**
 * Free-trial codes on the browser side: asking for one (the landing pop-up),
 * and carrying one from the emailed link to the page where the plan is bought.
 *
 * The code is only remembered here for convenience. Whether it is real, unused
 * and allowed for this student is decided by stripe-checkout, never by this.
 */

/** Days a trial code gives. Mirrors TRIAL_DAYS in supabase/functions/_shared/trialCode.ts. */
export const TRIAL_DAYS = 14;

const KEY = "trial-code";

/** Keep a code from an emailed link so the plan page can offer it. */
export function rememberTrialCode(code: string) {
  try {
    localStorage.setItem(KEY, code.trim().toUpperCase());
  } catch {
    /* Storage unavailable: the code can still be typed on the plan page. */
  }
}

export function readTrialCode(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Forget the code once its Checkout has completed; it can't be used again. */
export function forgetTrialCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Nothing stored, nothing to forget. */
  }
}

/**
 * Email the visitor their code. `website` is the pop-up's honeypot. Resolves
 * the same way whether or not an email actually went — the server never says
 * whether an address has had a trial.
 */
export async function requestTrialCode(email: string, website: string) {
  const { data, error } = await supabase.functions.invoke("trial-code", {
    body: { email, website },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const parsed = await ctx.json().catch(() => null);
      if (parsed?.error) throw new Error(parsed.error);
    }
    throw new Error("We couldn't send the email just now. Please try again.");
  }
  if (data?.error) throw new Error(data.error);
}
