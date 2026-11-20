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
import { DB, resetDb, table } from "./mock-supabase.ts";
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

// 8. An old plan's events arrive after the family has bought a new one (a
//    Stripe retry, a resend from the dashboard): the old plan's last payment
//    stays paid, and the row keeps following the new plan.
family();
{
  const old = pays(CHILD);
  await deliver(old.completed, old.created);
  const ended = STRIPE.subs.get(subIdOf(old));
  ended.created -= 40 * 86400;
  ended.status = "canceled";
  ended.ended_at = Math.floor(Date.now() / 1000) - 86400;

  const renewed = pays(PARENT);
  await deliver(renewed.completed, renewed.created);
  await deliver(event("customer.subscription.deleted", ended), old.completed, old.created);

  assert.equal(row()?.stripe_subscription_id, subIdOf(renewed));
  assert.equal(row()?.status, "active");
  assert.deepEqual(STRIPE.refunds, [], "the old plan's last real payment was refunded");
  assert.ok(!STRIPE.calls.some((c) => c.startsWith("subscriptions.cancel")));
}

// 9. A duplicate cancelled here whose refund didn't go through is still
//    refunded when Stripe retries: it ended after the kept plan began.
family();
{
  const first = pays(CHILD);
  const second = pays(PARENT);
  await deliver(first.completed, first.created, second.completed);
  STRIPE.refunds = []; // as if refunds.create had failed after the cancel
  const duplicate = STRIPE.subs.get(subIdOf(second));
  assert.equal(duplicate.status, "canceled");
  await deliver(event("customer.subscription.deleted", duplicate));
  assert.equal(STRIPE.refunds.length, 1, "the duplicate was never refunded");
  assert.equal(row()?.stripe_subscription_id, subIdOf(first));
}

const signed = { "stripe-signature": "test" };

// 10. Two deliveries for the same plan overlap, and the one that read Stripe
//     first would write last. It is refused (500, so Stripe retries), the
//     newer state stays, and the retry reads Stripe again.
family();
{
  const paid = pays(CHILD);
  await deliver(paid.completed, paid.created);
  const sub = STRIPE.subs.get(subIdOf(paid));
  const older = event("customer.subscription.updated", sub);
  // A reads Stripe while the plan is active. Before A writes, the renewal
  // fails and B delivers that all the way to the row.
  let newer = 0;
  STRIPE.onRetrieve.set(sub.id, async () => {
    sub.status = "past_due";
    newer = (await webhook(post(event("customer.subscription.updated", sub), signed))).status;
  });
  const res = await webhook(post(older, signed));
  assert.equal(newer, 200, "the newer delivery was refused");
  assert.equal(res.status, 500, "the older read was written over the newer one");
  assert.equal(row()?.status, "past_due", "the plan reads as active again");
  await deliver(older); // Stripe's retry
  assert.equal(row()?.status, "past_due");
}

// 11. The same before the plan has a row: B writes the first row while A is
//     reading Stripe, and A may not write its older copy over it.
family();
{
  const paid = pays(CHILD);
  const id = subIdOf(paid);
  let newer = 0;
  STRIPE.onRetrieve.set(id, async () => {
    STRIPE.subs.get(id).cancel_at_period_end = true; // the student cancels at once
    newer = (await webhook(post(paid.created, signed))).status;
  });
  const res = await webhook(post(paid.completed, signed));
  assert.equal(newer, 200, "the newer delivery was refused");
  assert.equal(res.status, 500, "the older read was written over the first row");
  assert.equal(row()?.cancel_at_period_end, true, "the cancellation was undone");
  await deliver(paid.completed); // Stripe's retry
  assert.equal(row()?.cancel_at_period_end, true);
  assert.equal(table("subscriptions").length, 1);
}

// 12. No row when A looks, but one is written just before A inserts: student_id
//     is unique, so A's insert is refused like a lost update (500), and the
//     retry writes over the row instead.
family();
{
  const paid = pays(CHILD);
  const id = subIdOf(paid);
  // The first read is the one before Stripe's; the row lands after the second.
  DB.onRead.subscriptions = () => {
    DB.onRead.subscriptions = () => {
      table("subscriptions").push({
        student_id: CHILD,
        user_id: CHILD,
        stripe_subscription_id: id,
        status: "incomplete",
        updated_at: "2026-11-20T17:00:00.000001+00:00",
      });
    };
  };
  const res = await webhook(post(paid.completed, signed));
  assert.equal(res.status, 500, "the insert over a row written meanwhile was not refused");
  assert.equal(table("subscriptions").length, 1);
  await deliver(paid.completed); // Stripe's retry
  assert.equal(row()?.status, "active");
}

// 13. One delivery at a time is as before: the first inserts the row, a later
//     one writes Stripe's state over it, and so does a resend.
family();
{
  const paid = pays(CHILD);
  await deliver(paid.created);
  assert.equal(row()?.status, "active");
  assert.equal(table("subscriptions").length, 1);
  const sub = STRIPE.subs.get(subIdOf(paid));
  sub.cancel_at_period_end = true;
  const cancelled = event("customer.subscription.updated", sub);
  const before = row()?.updated_at;
  await deliver(cancelled);
  assert.equal(row()?.cancel_at_period_end, true);
  assert.notEqual(row()?.updated_at, before, "the write did not move updated_at");
  await deliver(cancelled);
  assert.equal(row()?.cancel_at_period_end, true);
  assert.equal(table("subscriptions").length, 1);
}

console.log("one plan per student: all checks passed");
