// One open Checkout per student (see migrations/20261001140000_checkout_holds.sql).
//
// assertNoLiveSubscription can only see a plan once stripe-webhook has written
// it, so two Checkouts opened before that both succeeded: a child and a parent
// paying at once, a second tab, a forgotten Checkout page paid later. Holding
// the open session per student closes most of that gap — opening a new
// Checkout expires the last one — and stripe-webhook refunds whatever still
// gets through (two Checkouts opened in the same instant).
//
// Bookkeeping, not a lock: if the table can't be read or written the Checkout
// goes ahead without the guard, and the failure is logged. Refusing to sell
// because of it would be the worse failure.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { HttpError } from "../_shared/http.ts";
import { admin } from "../_shared/clients.ts";

type Db = ReturnType<typeof admin>;

/** A paid session older than this is not "just paid": its webhook has had time. */
const SETTLE_MS = 2 * 60 * 60 * 1000;

/**
 * Clear the way for a new Checkout for this student: expire the one still
 * open, or refuse if it has just been paid and the plan isn't recorded yet.
 */
export async function releaseCheckoutHold(stripe: Stripe, db: Db, studentId: string) {
  const { data: hold, error } = await db
    .from("checkout_holds")
    .select("checkout_session_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) {
    console.error(`stripe-checkout: reading the checkout hold failed: ${error.message}`);
    return;
  }
  if (!hold) return;

  const retrieve = (id: string) =>
    stripe.checkout.sessions.retrieve(id).catch(() => null as Stripe.Checkout.Session | null);

  let session = await retrieve(hold.checkout_session_id);
  if (session?.status === "open") {
    const expired = await stripe.checkout.sessions.expire(session.id).then(
      () => true,
      () => false,
    );
    // Can lose a race with the family paying it this very second; look again.
    if (!expired) session = await retrieve(hold.checkout_session_id);
  }

  if (session?.status === "complete" && Date.now() - session.created * 1000 < SETTLE_MS) {
    const paidFor =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const { data: row } = await db
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("student_id", studentId)
      .maybeSingle();
    if (row?.stripe_subscription_id !== paidFor) {
      throw new HttpError(
        409,
        "A payment for this plan has just gone through. Give it a minute, then refresh the page.",
      );
    }
  }

  await db
    .from("checkout_holds")
    .delete()
    .eq("student_id", studentId)
    .eq("checkout_session_id", hold.checkout_session_id);
}

/** Remember the Checkout just opened, so the next one can expire it. */
export async function recordCheckoutHold(
  db: Db,
  studentId: string,
  sessionId: string,
  payerId: string,
) {
  const { error } = await db.from("checkout_holds").upsert(
    {
      student_id: studentId,
      checkout_session_id: sessionId,
      payer_id: payerId,
      created_at: new Date().toISOString(),
    },
    { onConflict: "student_id" },
  );
  if (error) console.error(`stripe-checkout: recording the checkout hold failed: ${error.message}`);
}
