// Free-trial codes at Checkout: is this code good for this student, and hold it
// for the one Checkout Session it is about to start.
//
// A code is held by recording the session on its row. Only one Checkout can
// hold a code; an abandoned one expires (we open trial sessions with a short
// expiry) and the code can be claimed again. It is spent when stripe-webhook
// sees that session complete.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";
import { normaliseTrialCode, TRIAL_DAYS, trialNeedsCard } from "../_shared/trialCode.ts";

type Db = ReturnType<typeof admin>;

/** What a code gives: its length in days, and whether Checkout asks for a card. */
export interface TrialTerms {
  days: number;
  needsCard: boolean;
}

/** A row's terms. No length of its own and a card are the standard trial. */
function termsOf(row: { trial_days: number | null; needs_card: boolean | null }): TrialTerms {
  return {
    days: row.trial_days ?? TRIAL_DAYS,
    needsCard: row.needs_card !== false && trialNeedsCard(),
  };
}

export interface TrialCheck extends TrialTerms {
  code: string;
  /** The session holding the code before this Checkout, for the claim's guard. */
  heldBy: string | null;
}

/**
 * Throws a message a family can act on if the code can't start a trial here.
 * The payer may re-open their own abandoned Checkout; the old one is expired.
 */
export async function checkTrialCode(
  stripe: Stripe,
  db: Db,
  raw: unknown,
  payerId: string,
  studentId: string,
): Promise<TrialCheck> {
  const code = normaliseTrialCode(raw);
  const invalid = new HttpError(400, "That trial code isn't valid. Check it and try again.");
  if (!code) throw invalid;

  const { data: row } = await db
    .from("trial_codes")
    .select("code, checkout_session_id, claimed_by, redeemed_at, trial_days, needs_card")
    .eq("code", code)
    .maybeSingle();
  if (!row) throw invalid;

  const used = new HttpError(409, "That trial code has already been used.");
  if (row.redeemed_at) throw used;

  // Trials are for new students. The webhook keeps a student's subscription row
  // after it ends, so any row at all means they have had a plan.
  const { data: past } = await db
    .from("subscriptions")
    .select("student_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (past) {
    throw new HttpError(
      409,
      "Free trials are for new students, and this student has had a plan before.",
    );
  }

  if (row.checkout_session_id) {
    let session: Stripe.Checkout.Session | null = null;
    try {
      session = await stripe.checkout.sessions.retrieve(row.checkout_session_id);
    } catch {
      // Gone from Stripe: nothing holds the code.
    }
    if (session?.status === "complete") {
      // The webhook normally stamps this; catch it up if it hasn't yet.
      await db
        .from("trial_codes")
        .update({ redeemed_at: new Date().toISOString() })
        .eq("code", code)
        .is("redeemed_at", null);
      throw used;
    }
    if (session?.status === "open") {
      if (row.claimed_by !== payerId) {
        throw new HttpError(409, "That trial code is being used in another checkout right now.");
      }
      await stripe.checkout.sessions.expire(session.id).catch(() => {});
    }
  }

  return { code, heldBy: row.checkout_session_id, ...termsOf(row) };
}

/**
 * What a code would give, so the plan page can state it before Checkout. Tells
 * no more than Checkout itself does: not valid, used, or these terms. Whether
 * this student may use it is still checked at Checkout.
 */
export async function trialTerms(db: Db, raw: unknown): Promise<TrialTerms> {
  const code = normaliseTrialCode(raw);
  const invalid = new HttpError(400, "That trial code isn't valid. Check it and try again.");
  if (!code) throw invalid;

  const { data: row } = await db
    .from("trial_codes")
    .select("redeemed_at, trial_days, needs_card")
    .eq("code", code)
    .maybeSingle();
  if (!row) throw invalid;
  if (row.redeemed_at) throw new HttpError(409, "That trial code has already been used.");
  return termsOf(row);
}

/**
 * Record the new session on the code — only if nothing else claimed it since
 * checkTrialCode looked. If something did, the new session is expired unused.
 */
export async function claimTrialCode(
  stripe: Stripe,
  db: Db,
  check: TrialCheck,
  sessionId: string,
  payerId: string,
  studentId: string,
) {
  let query = db
    .from("trial_codes")
    .update({ checkout_session_id: sessionId, claimed_by: payerId, student_id: studentId })
    .eq("code", check.code)
    .is("redeemed_at", null);
  query = check.heldBy
    ? query.eq("checkout_session_id", check.heldBy)
    : query.is("checkout_session_id", null);

  const { data } = await query.select("code");
  if (!data?.length) {
    await stripe.checkout.sessions.expire(sessionId).catch(() => {});
    throw new HttpError(409, "That trial code was just used in another checkout.");
  }
}
