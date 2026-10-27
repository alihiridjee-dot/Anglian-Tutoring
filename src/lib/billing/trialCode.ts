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

/** Until then a trial takes no card. Mirrors NO_CARD_TRIALS_UNTIL in the same file under supabase/. */
export const NO_CARD_TRIALS_UNTIL = Date.parse("2026-10-12T00:00:00+01:00");

export function trialNeedsCard(now = Date.now()): boolean {
  return now >= NO_CARD_TRIALS_UNTIL;
}

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

/** How long a closed trial pop-up stays closed. */
const OFFER_QUIET_MS = 7 * 24 * 60 * 60_000;

/**
 * Whether the landing page may offer a free trial. Never to someone signed in
 * (they have an account; Ali, 3 Oct 2026), never again once a code has been
 * sent or is held, and not for a week after the pop-up was closed.
 */
export function mayOfferTrial(v: {
  signedIn: boolean;
  codeSent: boolean;
  heldCode: string;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (v.signedIn || v.codeSent || v.heldCode) return false;
  return !v.dismissedAt || v.now - v.dismissedAt >= OFFER_QUIET_MS;
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
