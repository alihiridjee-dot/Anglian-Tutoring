/** One plan per student, from the webhook's side: stripe-webhook keeps the plan
 * a student already has, cancels and refunds a second one, and writes Stripe's
 * current state rather than an event's old copy. Runs the real function code
 * against the in-memory Stripe and Supabase in this folder. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/one-plan-per-student.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { resetDb, table } from "./mock-supabase.ts";
import { STRIPE, completeSession, event, openSession, resetStripe } from "./mock-stripe.ts";

const webhook = await loadHandler("../../supabase/functions/stripe-webhook/index.ts");

const CHILD = "child-C";
const PARENT = "parent-P";
const deliver = async (...events: unknown[]) => {
  for (const e of events) {
    const res = await webhook(post(e, { "stripe-signature": "test" }));
    assert.equal(res.status, 200, `webhook answered ${res.status}`);
  }
};
const row = () => table("subscriptions").find((r) => r.student_id === CHILD);
const pays = (payer: string, trialDays?: number) =>
  completeSession(
    openSession({ student_id: CHILD, payer_id: payer, tier: "monthly_1" }, trialDays),
  );
const subIdOf = (paid: ReturnType<typeof completeSession>) => paid.created.data.object.id as string;

function family() {
  resetDb();
  resetStripe();
  table("profiles").push({ id: CHILD }, { id: PARENT });
}

// 1. Paid twice at the same moment (the child on the plan page, the parent from
//    the Parent Portal): the first plan is kept, the second cancelled and refunded.
family();
{
  const first = pays(CHILD);
  const second = pays(PARENT);
  await deliver(first.completed, first.created, second.completed, second.created);

  const duplicate = subIdOf(second);
  assert.equal(row()?.stripe_subscription_id, subIdOf(first), "the first plan is the one kept");
  assert.equal(row()?.status, "active");
  assert.equal(STRIPE.subs.get(duplicate).status, "canceled");
  const charged = STRIPE.invoices.get(STRIPE.subs.get(duplicate).latest_invoice).payment_intent;
  assert.deepEqual(
    STRIPE.refunds.map((r) => r.payment_intent),
    [charged],
  );

  // Stripe resends, and the cancel produces its own events: nothing happens twice.
  await deliver(
    second.created,
    event("customer.subscription.updated", STRIPE.subs.get(duplicate)),
    event("customer.subscription.deleted", STRIPE.subs.get(duplicate)),
  );
  assert.equal(STRIPE.calls.filter((c) => c === `subscriptions.cancel ${duplicate}`).length, 1);
  assert.equal(STRIPE.refunds.length, 1);
  assert.equal(row()?.stripe_subscription_id, subIdOf(first));
}

// 2. A plan on hold or behind on payment is still the one kept.
family();
{
  const first = pays(CHILD);
  await deliver(first.completed, first.created);
  STRIPE.subs.get(subIdOf(first)).status = "past_due";
  const second = pays(PARENT);
  await deliver(second.completed, second.created);
  assert.equal(row()?.stripe_subscription_id, subIdOf(first));
  assert.equal(STRIPE.subs.get(subIdOf(second)).status, "canceled");
  assert.equal(STRIPE.refunds.length, 1);
}

// 3. Events out of order: the row follows Stripe, not the event's old copy.
family();
{
  const paid = pays(CHILD);
  await deliver(paid.completed, paid.created);
  const sub = STRIPE.subs.get(subIdOf(paid));

  const staleActive = event("customer.subscription.updated", sub);
  sub.status = "past_due";
  await deliver(event("customer.subscription.updated", sub), staleActive);
  assert.equal(row()?.status, "past_due", "a retried old event reopened an unpaid plan");

  const stalePastDue = event("customer.subscription.updated", sub);
  sub.status = "active";
  await deliver(event("customer.subscription.updated", sub), stalePastDue);
  assert.equal(row()?.status, "active", "a retried old event locked out a paying student");
}

// 4. A plan that has ended is replaced, with nothing refunded.
family();
{
  const old = pays(CHILD);
  await deliver(old.completed, old.created);
  const ended = STRIPE.subs.get(subIdOf(old));
  ended.status = "canceled";
  await deliver(event("customer.subscription.deleted", ended));

  const renewed = pays(PARENT);
  await deliver(renewed.completed, renewed.created);
  assert.equal(row()?.stripe_subscription_id, subIdOf(renewed));
  assert.equal(row()?.status, "active");
  assert.equal(STRIPE.refunds.length, 0);
}

// 5. A duplicate trial took nothing: it is cancelled, and there is nothing to refund.
family();
{
  const paid = pays(CHILD);
  await deliver(paid.completed, paid.created);
  const trial = pays(PARENT, 14);
  await deliver(trial.completed, trial.created);
  assert.equal(STRIPE.subs.get(subIdOf(trial)).status, "canceled");
  assert.equal(STRIPE.refunds.length, 0);
  assert.equal(row()?.stripe_subscription_id, subIdOf(paid));
}

// 6. Stripe has no record of the subscription: the event's own copy is used.
family();
{
  const paid = pays(CHILD);
  const copy = STRIPE.subs.get(subIdOf(paid));
  STRIPE.subs.delete(copy.id);
  await deliver(event("customer.subscription.updated", copy));
  assert.equal(row()?.stripe_subscription_id, copy.id);
}

// 7. Stripe briefly unreachable: the webhook answers 500, so Stripe retries it.
family();
{
  const paid = pays(CHILD);
  STRIPE.failRetrieves = 1;
  const res = await webhook(post(paid.created, { "stripe-signature": "test" }));
  assert.equal(res.status, 500);
  assert.equal(row(), undefined, "nothing was written from the stale copy");
  await deliver(paid.created);
  assert.equal(row()?.status, "active");
}

console.log("one plan per student: all checks passed");
