/** One plan per student: stripe-checkout's open-Checkout hold and
 * stripe-webhook's refund of a second plan, run on the real function code
 * against the in-memory Stripe and Supabase in this folder. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/one-plan-per-student.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";
import { STRIPE, completeSession, event, resetStripe } from "./mock-stripe.ts";

const checkout = await loadHandler("../../supabase/functions/stripe-checkout/index.ts");
const webhook = await loadHandler("../../supabase/functions/stripe-webhook/index.ts");

type Reply = { status: number; body: { url?: string; error?: string } };
const call = async (token: string, body: Record<string, unknown>): Promise<Reply> => {
  const res = await checkout(post(body, { Authorization: `Bearer ${token}` }));
  return { status: res.status, body: await res.json() };
};
const deliver = async (...events: unknown[]) => {
  for (const e of events) {
    const res = await webhook(post(e, { "stripe-signature": "test" }));
    assert.equal(res.status, 200, `webhook answered ${res.status}`);
  }
};
const sessionOf = (reply: Reply) => reply.body.url!.split("/").pop()!;
const statusOf = (sessionId: string) => STRIPE.sessions.get(sessionId).status as string;
const row = () => table("subscriptions").find((r) => r.student_id === CHILD);
const holds = () => table("checkout_holds").map((h) => h.checkout_session_id);

const CHILD = "child-C";
const PARENT = "parent-P";
const childBuys = () => call("tok-C", { action: "checkout", tier: "monthly_1" });
const parentBuys = () =>
  call("tok-P", { action: "checkout", tier: "monthly_1", student_id: CHILD, return_to: "parent" });

function family() {
  resetDb();
  resetStripe();
  DB.users["tok-C"] = { id: CHILD, email: "child@example.test" };
  DB.users["tok-P"] = { id: PARENT, email: "parent@example.test" };
  table("profiles").push({ id: CHILD, level: "gcse" }, { id: PARENT, level: null });
  table("parent_student_links").push({ parent_id: PARENT, student_id: CHILD });
  table("student_enrolments").push({ student_id: CHILD, subject: "biology", board: "aqa" });
  table("packages").push({
    tier: "monthly_1",
    name: "Monthly (1 subject)",
    stripe_price_id: "price_m1",
    level: null,
    active: true,
  });
}

// 1. A second tab: the first Checkout is expired, and only the new one can be paid.
family();
{
  const first = await childBuys();
  const second = await childBuys();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(statusOf(sessionOf(first)), "expired");
  assert.equal(statusOf(sessionOf(second)), "open");
  assert.deepEqual(holds(), [sessionOf(second)]);
  const expiresIn = STRIPE.sessions.get(sessionOf(second)).expires_at - Date.now() / 1000;
  assert.ok(expiresIn > 30 * 60 && expiresIn <= 31 * 60, "every Checkout expires after 31 minutes");
}

// 2. The child starts paying, the parent pays: the child's page can no longer take money.
family();
{
  const child = await childBuys();
  const parent = await parentBuys();
  assert.equal(statusOf(sessionOf(child)), "expired");
  assert.throws(() => completeSession(sessionOf(child)), /not open/);
  const paid = completeSession(sessionOf(parent));
  await deliver(paid.completed, paid.created);
  assert.equal(row()?.user_id, PARENT);
  assert.deepEqual(holds(), [], "the webhook clears the hold");
}

// 3. Paid, but the webhook hasn't landed: a second Checkout is refused, then the live plan is.
family();
{
  const child = await childBuys();
  const paid = completeSession(sessionOf(child));
  const tooSoon = await parentBuys();
  assert.equal(tooSoon.status, 409);
  assert.match(tooSoon.body.error!, /just gone through/);
  await deliver(paid.completed, paid.created);
  const after = await parentBuys();
  assert.equal(after.status, 409);
  assert.match(after.body.error!, /already an active plan/);
  assert.equal(STRIPE.refunds.length, 0);
}

// 4. Two Checkouts opened in the same instant, both paid: the second is cancelled and refunded.
family();
{
  const [child, parent] = await Promise.all([childBuys(), parentBuys()]);
  assert.equal(statusOf(sessionOf(child)), "open", "the race was not reproduced");
  assert.equal(statusOf(sessionOf(parent)), "open", "the race was not reproduced");
  const first = completeSession(sessionOf(child));
  const second = completeSession(sessionOf(parent));
  await deliver(first.completed, first.created, second.completed, second.created);

  const kept = first.created.data.object.id;
  const duplicate = second.created.data.object.id;
  assert.equal(row()?.stripe_subscription_id, kept, "the first plan is the one kept");
  assert.equal(STRIPE.subs.get(duplicate).status, "canceled");
  assert.deepEqual(
    STRIPE.refunds.map((r) => r.payment_intent),
    [STRIPE.invoices.get(STRIPE.subs.get(duplicate).latest_invoice).payment_intent],
  );

  // Stripe resends, and the cancel produces its own events: nothing happens twice.
  const cancels = () =>
    STRIPE.calls.filter((c) => c === `subscriptions.cancel ${duplicate}`).length;
  await deliver(
    second.created,
    event("customer.subscription.updated", STRIPE.subs.get(duplicate)),
    event("customer.subscription.deleted", STRIPE.subs.get(duplicate)),
  );
  assert.equal(cancels(), 1);
  assert.equal(STRIPE.refunds.length, 1);
  assert.equal(row()?.stripe_subscription_id, kept);
  assert.equal(row()?.status, "active");
}

// 5. Events out of order: the row follows Stripe, not the event's old copy.
family();
{
  const paid = completeSession(sessionOf(await childBuys()));
  await deliver(paid.completed, paid.created);
  const sub = STRIPE.subs.get(paid.created.data.object.id);
  const staleActive = event("customer.subscription.updated", sub);
  sub.status = "past_due";
  await deliver(event("customer.subscription.updated", sub), staleActive);
  assert.equal(row()?.status, "past_due", "a retried old event reopened an unpaid plan");

  const stalePastDue = event("customer.subscription.updated", sub);
  sub.status = "active";
  await deliver(event("customer.subscription.updated", sub), stalePastDue);
  assert.equal(row()?.status, "active", "a retried old event locked out a paying student");
}

// 6. A plan that has ended is replaced, with nothing refunded.
family();
{
  const old = completeSession(sessionOf(await childBuys()));
  await deliver(old.completed, old.created);
  const ended = STRIPE.subs.get(old.created.data.object.id);
  ended.status = "canceled";
  await deliver(event("customer.subscription.deleted", ended));

  const renewed = completeSession(sessionOf(await parentBuys()));
  await deliver(renewed.completed, renewed.created);
  assert.equal(row()?.stripe_subscription_id, renewed.created.data.object.id);
  assert.equal(row()?.status, "active");
  assert.equal(STRIPE.refunds.length, 0);
}

// 7. A duplicate trial took nothing: it is cancelled, and there is nothing to refund.
family();
{
  const paid = completeSession(sessionOf(await childBuys()));
  await deliver(paid.completed, paid.created);
  STRIPE.sessions.set("cs_trial", {
    id: "cs_trial",
    status: "open",
    customer: "cus_other",
    line_items: [{ price: "price_m1" }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { student_id: CHILD, payer_id: PARENT, tier: "monthly_1" },
    },
  });
  const trial = completeSession("cs_trial");
  await deliver(trial.completed, trial.created);
  assert.equal(STRIPE.subs.get(trial.created.data.object.id).status, "canceled");
  assert.equal(STRIPE.refunds.length, 0);
  assert.equal(row()?.stripe_subscription_id, paid.created.data.object.id);
}

// 8. A Checkout paid hours ago whose webhook never landed doesn't lock the family out.
family();
{
  const child = await childBuys();
  completeSession(sessionOf(child));
  STRIPE.sessions.get(sessionOf(child)).created -= 3 * 60 * 60;
  assert.equal((await parentBuys()).status, 200);
}

// 9. Without the hold table the functions carry on: no guard, but no outage either.
family();
{
  DB.broken.checkout_holds = { code: "42P01", message: 'relation "checkout_holds" does not exist' };
  const bought = await childBuys();
  assert.equal(bought.status, 200);
  const paid = completeSession(sessionOf(bought));
  await deliver(paid.completed, paid.created);
  assert.equal(row()?.status, "active");
}

console.log("one plan per student: all checks passed");
