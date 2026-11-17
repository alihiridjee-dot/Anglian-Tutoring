/** A linked parent takes over the plan a student pays for themselves
 * (stripe-checkout/takeOver.ts, and the webhook's take-over rules). The
 * parent's plan starts billing only when the student's runs out, the student's
 * is set to end then, and nothing is refunded or charged twice. Runs the real
 * function code against the in-memory Stripe and Supabase in this folder.
 * No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/take-over.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";
import { STRIPE, completeSession, event, resetStripe } from "./mock-stripe.ts";

const checkout = await loadHandler("../../supabase/functions/stripe-checkout/index.ts");
const webhook = await loadHandler("../../supabase/functions/stripe-webhook/index.ts");

const CHILD = "child-C";
const PARENT = "parent-P";
const OTHER_PARENT = "parent-Q";
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

const call = async (token: string, body: Record<string, unknown>) => {
  const res = await checkout(post(body, { Authorization: `Bearer ${token}` }));
  return { status: res.status, body: await res.json() };
};
const takeOver = (token = PARENT, extra: Record<string, unknown> = {}) =>
  call(token, {
    action: "checkout",
    tier: "monthly_1",
    student_id: CHILD,
    return_to: "billing",
    take_over: true,
    ...extra,
  });
const deliver = async (...events: unknown[]) => {
  for (const e of events) {
    const res = await webhook(post(e, { "stripe-signature": "test" }));
    assert.equal(res.status, 200, `webhook answered ${res.status}`);
  }
};
const row = () => table("subscriptions").find((r) => r.student_id === CHILD);
const childSub = () => STRIPE.subs.get("sub_child");
const updatesOf = (id: string) => STRIPE.calls.filter((c) => c === `subscriptions.update ${id}`);
const cancelsOf = (id: string) => STRIPE.calls.filter((c) => c === `subscriptions.cancel ${id}`);
const sessionOf = (url: string) => STRIPE.sessions.get(url.split("/").pop()!);

/** A student on their own monthly plan, with a linked parent who has no card on file yet. */
function family({
  payer = CHILD as string,
  status = "active",
  endsIn = 20 * DAY,
  cancelling = false,
  paused = false,
  linked = true,
} = {}) {
  resetDb();
  resetStripe();
  for (const id of [CHILD, PARENT, OTHER_PARENT]) DB.users[id] = { id, email: `${id}@test` };
  table("profiles").push(
    { id: CHILD, role: "student", level: "gcse", enrolled_courses: ["biology"] },
    { id: PARENT, role: "parent" },
    { id: OTHER_PARENT, role: "parent" },
  );
  table("student_enrolments").push({ student_id: CHILD, subject: "biology", board: "aqa" });
  if (linked) table("parent_student_links").push({ parent_id: PARENT, student_id: CHILD });
  table("stripe_customers").push({ user_id: payer, stripe_customer_id: `cus_${payer}` });
  for (const tier of ["monthly_1", "weekly_1"]) {
    table("packages").push({
      tier,
      name: tier,
      stripe_price_id: `price_${tier}`,
      level: null,
      active: true,
    });
  }
  const end = now() + endsIn;
  STRIPE.subs.set("sub_child", {
    id: "sub_child",
    object: "subscription",
    status,
    customer: `cus_${payer}`,
    created: now() - 10 * DAY,
    ended_at: null,
    metadata: { student_id: CHILD, payer_id: payer, tier: "monthly_1" },
    pause_collection: paused ? { behavior: "void" } : null,
    cancel_at_period_end: cancelling,
    current_period_end: end,
    latest_invoice: "in_child",
    items: {
      data: [{ id: "si_child", price: { id: "price_monthly_1" }, current_period_end: end }],
    },
  });
  STRIPE.invoices.set("in_child", {
    id: "in_child",
    subscription: "sub_child",
    amount_paid: 4999,
    payment_intent: "pi_child",
  });
  table("subscriptions").push({
    student_id: CHILD,
    user_id: payer,
    stripe_customer_id: `cus_${payer}`,
    stripe_subscription_id: "sub_child",
    status: paused ? "paused" : status,
    plan: "monthly_1",
    cancel_at_period_end: cancelling,
    current_period_end: new Date(end * 1000).toISOString(),
  });
  DB.rpcs.claim_ai_request = () => ({ data: true, error: null });
}

// 1. The parent opens a take-over: the new plan bills from the day the
//    student's runs out, names the plan it replaces, and changes nothing yet.
family();
{
  const r = await takeOver();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = sessionOf(r.body.url);
  assert.equal(s.subscription_data.trial_end, childSub().current_period_end);
  assert.equal(s.subscription_data.trial_period_days, undefined);
  assert.equal(s.subscription_data.metadata.replaces, "sub_child");
  assert.equal(s.subscription_data.metadata.payer_id, PARENT);
  assert.notEqual(s.customer, "cus_child", "the parent paid on the student's customer");
  assert.match(s.custom_text.submit.message, /Nothing is taken today/);
  assert.ok(s.expires_at - now() <= 31 * 60 && s.expires_at - now() > 30 * 60);
  assert.deepEqual(updatesOf("sub_child"), [], "the student's plan changed before anyone paid");
  assert.deepEqual(cancelsOf("sub_child"), [], "the student's plan ended before anyone paid");
  assert.equal(row()?.stripe_subscription_id, "sub_child");

  // 2. Paid: the row follows the parent's plan, whose trial covers the days
  //    the student already paid for, and the student's plan is cancelled so
  //    it can never bill again. Nothing is refunded.
  const paid = completeSession(s.id);
  await deliver(paid.completed, paid.created);
  const taken = paid.created.data.object.id;
  assert.equal(row()?.stripe_subscription_id, taken);
  assert.equal(row()?.user_id, PARENT);
  assert.equal(row()?.status, "active", "a take-over read as a free trial");
  assert.equal(childSub().status, "canceled");
  assert.equal(STRIPE.subs.get(taken).current_period_end, s.subscription_data.trial_end);
  assert.deepEqual(STRIPE.refunds, []);
  assert.deepEqual(cancelsOf(taken), [], "the parent's plan was cancelled");

  // 3. The student's plan's own events (its cancellation) and Stripe's
  //    resends leave the row on the parent's plan, and touch nothing.
  await deliver(
    event("customer.subscription.deleted", childSub()),
    paid.created,
    paid.completed,
    event("customer.subscription.updated", childSub()),
  );
  assert.equal(row()?.stripe_subscription_id, taken);
  assert.equal(row()?.user_id, PARENT);
  assert.equal(cancelsOf("sub_child").length, 1, "the student's plan was cancelled twice");
  assert.deepEqual(updatesOf("sub_child"), []);
  assert.deepEqual(STRIPE.refunds, [], "the student's last real payment was refunded");
  assert.deepEqual(cancelsOf(taken), []);

  // 4. The parent's plan starts billing: the row stays theirs, and active.
  const live = STRIPE.subs.get(taken);
  live.status = "active";
  await deliver(event("customer.subscription.updated", live));
  assert.equal(row()?.stripe_subscription_id, taken);
  assert.equal(row()?.status, "active");

  // 5. Once taken over, the parent can't take it over again.
  const again = await takeOver();
  assert.equal(again.status, 409);
}

// 6. Robert's case: the student had already cancelled. The plan moves, and
//    the student's ends now; the parent's covers the days left.
family({ cancelling: true });
{
  const r = await takeOver();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const paid = completeSession(sessionOf(r.body.url).id);
  await deliver(paid.completed, paid.created);
  assert.equal(row()?.user_id, PARENT);
  assert.equal(row()?.cancel_at_period_end, false);
  assert.equal(childSub().status, "canceled");
  assert.deepEqual(STRIPE.refunds, []);
}

// 7. Fewer than 48 hours left: Stripe's shortest trial, so the family gets the
//    difference free rather than paying twice.
family({ endsIn: 30 * 3600 });
{
  const r = await takeOver();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const startsIn = sessionOf(r.body.url).subscription_data.trial_end - now();
  assert.ok(startsIn >= 48 * 3600 && startsIn < 49 * 3600, `starts in ${startsIn}s`);
}

// 8. Who and what can be taken over.
const refusals: [string, () => void, string, number?][] = [
  ["renewing in 20 minutes", () => family({ endsIn: 20 * 60 }), "renews in the next few hours"],
  ["renewing in 5 hours", () => family({ endsIn: 5 * 3600 }), "renews in the next few hours"],
  ["already ended", () => family({ status: "canceled" }), "no plan to move"],
  ["paused", () => family({ paused: true }), "paused"],
  ["payment overdue", () => family({ status: "past_due" }), "didn't go through"],
  ["another parent pays", () => family({ payer: OTHER_PARENT }), "pays for themselves"],
  ["not linked", () => family({ linked: false }), "aren't linked", 403],
];
for (const [what, setUp, message, status = 409] of refusals) {
  setUp();
  const r = await takeOver();
  assert.equal(r.status, status, `${what}: ${JSON.stringify(r.body)}`);
  assert.match(r.body.error, new RegExp(message), what);
  assert.equal(STRIPE.sessions.size, 0, `${what}: a Checkout was opened`);
}

// 9. The student can't "take over" their own plan.
family();
{
  const r = await call(CHILD, { action: "checkout", tier: "monthly_1", take_over: true });
  assert.equal(r.status, 403, JSON.stringify(r.body));
}

// 10. Without take_over, a parent is still refused a second plan.
family();
{
  const r = await call(PARENT, { action: "checkout", tier: "monthly_1", student_id: CHILD });
  assert.equal(r.status, 409, JSON.stringify(r.body));
}

// 11. A trial code doesn't ride along on a take-over.
family();
{
  table("trial_codes").push({ code: "AE-AAAA-BBBB", email_hash: "x", redeemed_at: null });
  const r = await takeOver(PARENT, { trial_code: "AE-AAAA-BBBB" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = sessionOf(r.body.url);
  assert.equal(s.subscription_data.trial_period_days, undefined);
  assert.equal(s.metadata.trial_code, undefined);
}

// 12. A take-over of a plan the row no longer holds is an ordinary duplicate:
//     cancelled (it took nothing), and the plan the row holds is left alone.
family();
{
  const r = await takeOver();
  const paid = completeSession(sessionOf(r.body.url).id);
  row()!.stripe_subscription_id = "sub_newer";
  STRIPE.subs.set("sub_newer", { ...childSub(), id: "sub_newer", created: now() });
  await deliver(paid.completed, paid.created);
  assert.equal(row()?.stripe_subscription_id, "sub_newer");
  assert.equal(STRIPE.subs.get(paid.created.data.object.id).status, "canceled");
  assert.deepEqual(STRIPE.refunds, []);
  assert.deepEqual(cancelsOf("sub_child"), []);
  assert.equal(childSub().status, "active");
}

// 13. Stripe fails while ending the student's plan: the webhook answers 500,
//     and Stripe's retry finishes the job, so nobody is billed twice.
family();
{
  const r = await takeOver();
  const paid = completeSession(sessionOf(r.body.url).id);
  STRIPE.failUpdates = 1;
  const res = await webhook(post(paid.created, { "stripe-signature": "test" }));
  assert.equal(res.status, 500);
  assert.equal(childSub().status, "active");
  await deliver(paid.created);
  assert.equal(childSub().status, "canceled");
  assert.equal(row()?.user_id, PARENT);
}

// 14. Two deliveries race: the student's own event reads the row, the
//     take-over is written, then the student's event would write the old plan
//     back. It may not: it answers 500, and Stripe's retry leaves the row alone.
family();
{
  const r = await takeOver();
  const paid = completeSession(sessionOf(r.body.url).id);
  const taken = paid.created.data.object.id;
  childSub().cancel_at_period_end = true; // the student cancels in the same moment
  const studentEvent = event("customer.subscription.updated", childSub());
  DB.onRead.subscriptions = () => {
    Object.assign(row()!, { user_id: PARENT, stripe_subscription_id: taken, status: "active" });
  };
  const res = await webhook(post(studentEvent, { "stripe-signature": "test" }));
  assert.equal(res.status, 500, "the stale write went through");
  assert.equal(row()?.stripe_subscription_id, taken);
  await deliver(paid.created, studentEvent);
  assert.equal(row()?.stripe_subscription_id, taken);
  assert.equal(row()?.user_id, PARENT);
  assert.equal(childSub().status, "canceled");
}

console.log("take-over: all checks passed");
