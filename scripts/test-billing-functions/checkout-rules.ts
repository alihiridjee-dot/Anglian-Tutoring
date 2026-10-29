/** stripe-checkout's rules, end to end: a child can't manage or grow a plan on
 * the card of a parent they've unlinked (S-2), boards are checked against the
 * curriculum (S-3), only our own messages reach families (S-10), two changes
 * to one plan can't interleave (M-5), and Checkout refuses a student with no
 * subjects (M-6). Runs the real function against the in-memory Stripe and
 * Supabase in this folder. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/checkout-rules.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";
import Stripe, { STRIPE, resetStripe } from "./mock-stripe.ts";
import { resolveCustomer } from "../../supabase/functions/stripe-checkout/customers.ts";

const checkout = await loadHandler("../../supabase/functions/stripe-checkout/index.ts");

const CHILD = "child-C";
const PARENT = "parent-P";
const call = async (token: string, body: Record<string, unknown>) => {
  const res = await checkout(post(body, { Authorization: `Bearer ${token}` }));
  return { status: res.status, body: await res.json() };
};
const updates = () => STRIPE.calls.filter((c) => c.startsWith("subscriptions.update"));

let leaseHeld = false;
const rpcCalls: string[] = [];
function world({ payer = PARENT as string | null, linked = false, level = "gcse" } = {}) {
  resetDb();
  resetStripe();
  leaseHeld = false;
  rpcCalls.length = 0;
  DB.users[CHILD] = { id: CHILD, email: "c@test" };
  DB.users[PARENT] = { id: PARENT, email: "p@test" };
  table("profiles").push(
    { id: CHILD, role: "student", level, enrolled_courses: ["biology"] },
    { id: PARENT, role: "parent" },
  );
  table("student_enrolments").push({ student_id: CHILD, subject: "biology", board: "aqa" });
  if (linked) table("parent_student_links").push({ parent_id: PARENT, student_id: CHILD });
  table("subscriptions").push({
    student_id: CHILD,
    user_id: payer,
    stripe_subscription_id: "sub_1",
    status: "active",
    plan: "monthly_1",
    cancel_at_period_end: false,
  });
  for (const tier of ["monthly_1", "monthly_2", "monthly_3"]) {
    table("packages").push({
      tier,
      name: tier,
      stripe_price_id: `price_${tier}`,
      level: null,
      active: true,
    });
  }
  STRIPE.subs.set("sub_1", {
    id: "sub_1",
    status: "active",
    customer: `cus_${payer}`,
    metadata: { student_id: CHILD, tier: "monthly_1" },
    pause_collection: null,
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20,
    items: { data: [{ id: "si_1", price: { id: "price_monthly_1" } }] },
  });
  DB.rpcs.curriculum_coverage = () => ({
    data: [
      { level: "gcse", board: "aqa", subject: "chemistry" },
      { level: "igcse", board: "cambridge", subject: "chemistry" },
    ],
    error: null,
  });
  DB.rpcs.claim_ai_request = () => ({ data: true, error: null });
  DB.rpcs.take_billing_lease = () => {
    rpcCalls.push("take");
    if (leaseHeld) return { data: false, error: null };
    leaseHeld = true;
    return { data: true, error: null };
  };
  DB.rpcs.release_billing_lease = () => {
    rpcCalls.push("release");
    leaseHeld = false;
    return { data: null, error: null };
  };
  DB.rpcs.apply_enrolment_change = ({ _student_id, _add, _remove }) => {
    rpcCalls.push(
      `enrol +${_add.map((a: { subject: string; board: string }) => `${a.subject}/${a.board}`).join(",")} -${_remove.join(",")}`,
    );
    const rows = table("student_enrolments");
    DB.tables.student_enrolments = rows.filter(
      (r) => !(r.student_id === _student_id && _remove.includes(r.subject)),
    );
    for (const a of _add) table("student_enrolments").push({ student_id: _student_id, ...a });
    return { data: [], error: null };
  };
}

// ── S-2: who manages a plan ───────────────────────────────────────────────
// The child unlinked the parent who pays: they may no longer pause, cancel,
// drop subjects, switch cadence or add to the parent's bill.
world({ payer: PARENT, linked: false });
for (const body of [
  { action: "pause", student_id: CHILD },
  { action: "cancel", student_id: CHILD },
  { action: "change_cadence", student_id: CHILD, cadence: "weekly" },
  { action: "add_subjects", student_id: CHILD, subjects: [{ subject: "chemistry", board: "aqa" }] },
]) {
  const r = await call(CHILD, body);
  assert.equal(r.status, 403, `${body.action}: ${JSON.stringify(r.body)}`);
}
assert.deepEqual(updates(), [], "A refused child still changed the parent's plan");

// The parent still pays, linked or not, so they keep control.
let r = await call(PARENT, { action: "pause", student_id: CHILD });
assert.equal(r.status, 200, JSON.stringify(r.body));

// While linked, the child still grows a plan their parent pays for, but can't
// pause it.
world({ payer: PARENT, linked: true });
r = await call(CHILD, { action: "pause", student_id: CHILD });
assert.equal(r.status, 403);
assert.equal(r.body.error, "Your linked parent manages this plan.");
r = await call(CHILD, {
  action: "add_subjects",
  student_id: CHILD,
  subjects: [{ subject: "chemistry", board: "aqa" }],
});
assert.equal(r.status, 200, JSON.stringify(r.body));

// A legacy plan with no payer recorded, and no parent: the student keeps control.
world({ payer: null, linked: false });
r = await call(CHILD, { action: "pause", student_id: CHILD });
assert.equal(r.status, 200, JSON.stringify(r.body));

// ── S-3: boards come from the curriculum ──────────────────────────────────
world({ payer: CHILD, level: "igcse" });
r = await call(CHILD, {
  action: "add_subjects",
  student_id: CHILD,
  subjects: [{ subject: "chemistry", board: "cambridge" }],
});
assert.equal(r.status, 200, `Cambridge was refused: ${JSON.stringify(r.body)}`);
assert.ok(
  rpcCalls.includes("enrol +chemistry/cambridge -"),
  "The Cambridge enrolment wasn't written",
);
world({ payer: CHILD, level: "igcse" });
r = await call(CHILD, {
  action: "add_subjects",
  student_id: CHILD,
  subjects: [{ subject: "chemistry", board: "ocr" }],
});
assert.equal(r.status, 400, "A board we hold no curriculum for was sold");
assert.deepEqual(updates(), []);

// ── M-5: one change at a time ─────────────────────────────────────────────
world({ payer: CHILD });
leaseHeld = true; // another change is running
r = await call(CHILD, {
  action: "add_subjects",
  student_id: CHILD,
  subjects: [{ subject: "chemistry", board: "aqa" }],
});
assert.equal(r.status, 409);
assert.deepEqual(updates(), [], "A change ran alongside another");
world({ payer: CHILD });
await call(CHILD, {
  action: "add_subjects",
  student_id: CHILD,
  subjects: [{ subject: "chemistry", board: "aqa" }],
});
assert.deepEqual(
  rpcCalls,
  ["take", "enrol +chemistry/aqa -", "release"],
  "The lease wasn't held around the change",
);
// …and it is let go when the change fails, too.
world({ payer: CHILD });
STRIPE.subs.delete("sub_1");
await call(CHILD, { action: "remove_subjects", student_id: CHILD, subjects: ["biology"] });
assert.equal(leaseHeld, false, "A failed change kept the lease");

// ── S-10: only our own messages reach families ────────────────────────────
world({ payer: CHILD });
STRIPE.subs.delete("sub_1"); // Stripe will say "No such subscription: 'sub_1'"
r = await call(CHILD, { action: "change_cadence", student_id: CHILD, cadence: "weekly" });
assert.equal(r.status, 500);
assert.ok(
  !/sub_1|No such/i.test(r.body.error),
  `Stripe's text reached the family: ${r.body.error}`,
);
assert.match(r.body.error, /Something went wrong on our side/);

// ── M-6: no subjects, no plan ─────────────────────────────────────────────
world({ payer: CHILD });
DB.tables.subscriptions = [];
DB.tables.student_enrolments = [];
r = await call(CHILD, { action: "checkout", tier: "monthly_1" });
assert.equal(r.status, 409);
assert.equal(r.body.error, "Pick at least one subject first.");
assert.ok(
  !STRIPE.calls.some((c) => c.startsWith("checkout.sessions.create")),
  "A session was opened",
);

// ── A refused card changes nothing ────────────────────────────────────────
// Adding a subject or switching cadence charges the difference now. When the
// card is refused, the plan, the enrolments and the access stay as they were,
// and the family is told why, instead of "added" followed by a locked plan.
for (const body of [
  { action: "add_subjects", student_id: CHILD, subjects: [{ subject: "chemistry", board: "aqa" }] },
  { action: "change_cadence", student_id: CHILD, cadence: "weekly" },
]) {
  world({ payer: CHILD });
  table("packages").push({
    tier: "weekly_1",
    name: "weekly_1",
    stripe_price_id: "price_weekly_1",
    level: null,
    active: true,
  });
  STRIPE.declineCharges = true;
  r = await call(CHILD, body);
  assert.equal(r.status, 402, `${body.action}: ${JSON.stringify(r.body)}`);
  assert.match(r.body.error, /didn't go through, so nothing has changed/);
  assert.match(r.body.error, /Card & invoices/);
  assert.equal(STRIPE.subs.get("sub_1").status, "active", `${body.action} left the plan past due`);
  assert.ok(!rpcCalls.some((c) => c.startsWith("enrol")), `${body.action} enrolled anyway`);
  assert.equal(table("subscriptions")[0].plan, "monthly_1");
  assert.equal(leaseHeld, false, `${body.action} kept the lease`);
}
// Only the payer has the Card & invoices tile. A child growing a plan their
// parent pays for, or a parent switching one the child pays for, is told to
// ask whoever pays instead.
for (const [caller, payer, body] of [
  [
    CHILD,
    PARENT,
    {
      action: "add_subjects",
      student_id: CHILD,
      subjects: [{ subject: "chemistry", board: "aqa" }],
    },
  ],
  [PARENT, CHILD, { action: "change_cadence", student_id: CHILD, cadence: "weekly" }],
] as const) {
  world({ payer, linked: true });
  table("packages").push({
    tier: "weekly_1",
    name: "weekly_1",
    stripe_price_id: "price_weekly_1",
    level: null,
    active: true,
  });
  STRIPE.declineCharges = true;
  r = await call(caller, body);
  assert.equal(r.status, 402, `${body.action}: ${JSON.stringify(r.body)}`);
  assert.match(r.body.error, /Ask whoever pays for this plan to update the card/);
  assert.doesNotMatch(r.body.error, /Card & invoices/);
  assert.equal(table("subscriptions")[0].plan, "monthly_1");
}

// ── Two first checkouts at once share one customer ────────────────────────
// Both find no customer row and both ask Stripe for one. Before, that made two
// live Stripe customers and the second checkout failed on the duplicate row.
world({ payer: CHILD });
{
  const both = await Promise.all([
    resolveCustomer(new Stripe("k") as never, CHILD, "c@test"),
    resolveCustomer(new Stripe("k") as never, CHILD, "c@test"),
  ]);
  assert.equal(both[0], both[1]);
  assert.equal(STRIPE.customers.size, 1, "a second Stripe customer was made");
  assert.equal(table("stripe_customers").length, 1);
}

// ── Opening payment pages is budgeted per account ─────────────────────────
// Over budget, Checkout and the portal refuse before Stripe is touched. The
// budget is claimed as the caller, so it counts against them.
world({ payer: CHILD });
DB.tables.subscriptions = [];
{
  const claims: string[] = [];
  DB.rpcs.claim_ai_request = (args, caller) => {
    claims.push(`${caller}:${args._endpoint}`);
    return { data: false, error: null };
  };
  r = await call(CHILD, { action: "checkout", tier: "monthly_1" });
  assert.equal(r.status, 429, JSON.stringify(r.body));
  table("stripe_customers").push({ user_id: CHILD, stripe_customer_id: "cus_C" });
  r = await call(CHILD, { action: "portal" });
  assert.equal(r.status, 429, JSON.stringify(r.body));
  assert.deepEqual(claims, [`${CHILD}:stripe_checkout`, `${CHILD}:stripe_checkout`]);
  assert.deepEqual(STRIPE.calls, [], "Stripe was called over budget");
  assert.equal(STRIPE.customers.size, 0);

  // Invoice reads have their own budget, and over it Stripe isn't asked.
  r = await call(CHILD, { action: "invoices" });
  assert.equal(r.status, 429, JSON.stringify(r.body));
  assert.equal(claims.at(-1), `${CHILD}:stripe_invoices`);
  assert.deepEqual(STRIPE.calls, [], "Stripe was called over budget");

  // A claim that fails (its quota row not applied yet) lets the family through.
  DB.rpcs.claim_ai_request = () => ({ data: null, error: { message: "Unknown request type" } });
  r = await call(CHILD, { action: "portal" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await call(CHILD, { action: "invoices" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok((STRIPE.calls as string[]).includes("invoices.list cus_C"));
}

// An account with no Stripe customer reads no invoices and spends no budget.
world({ payer: CHILD });
{
  let claimed = 0;
  DB.rpcs.claim_ai_request = () => (claimed++, { data: true, error: null });
  r = await call(CHILD, { action: "invoices" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.invoices, []);
  assert.equal(claimed, 0);
}

// ── APP_URL: no return address, no checkout ───────────────────────────────
// Stripe sends the payer back to APP_URL. It was localhost until 6 Oct 2026,
// so every payer landed on "can't connect". Missing, it's refused before
// Stripe is touched, rather than guessed.
world({ payer: CHILD });
DB.tables.subscriptions = [];
Deno.env.delete("APP_URL");
r = await call(CHILD, { action: "checkout", tier: "monthly_1" });
assert.equal(r.status, 500);
assert.equal(r.body.error, "Payments aren't set up on the server yet.");
assert.deepEqual(STRIPE.calls, [], "Stripe was touched with no return address");
assert.equal(STRIPE.customers.size, 0, "A customer was made with no return address");
// Set, the payer comes back to it, however it was typed.
Deno.env.set("APP_URL", "https://app.test/");
r = await call(CHILD, { action: "checkout", tier: "monthly_1" });
assert.equal(r.status, 200);
const opened = [...STRIPE.sessions.values()].at(-1);
assert.equal(
  opened.success_url,
  "https://app.test/onboarding/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}",
);
Deno.env.set("APP_URL", "https://app.test");

// ── A body that isn't a JSON object is refused ─────────────────────────────
// Each of these used to reach a cast and come back as a 500.
for (const raw of ["{not json", "", "null", "[]", '"checkout"']) {
  world({ payer: CHILD });
  const res = await checkout(
    new Request("http://fn.test/", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${CHILD}` },
      body: raw,
    }),
  );
  assert.equal(res.status, 400, `${JSON.stringify(raw)} came back ${res.status}`);
  assert.equal((await res.json()).error, "That request couldn't be read.");
}
// A subject that isn't an object is refused like one we don't offer.
world({ payer: CHILD });
r = await call(CHILD, { action: "add_subjects", student_id: CHILD, subjects: [null] });
assert.equal(r.status, 400);
// return_to names one of our pages. "constructor" used to find Object's own
// and put its source in the return address.
world({ payer: CHILD });
DB.tables.subscriptions = [];
r = await call(CHILD, { action: "checkout", tier: "monthly_1", return_to: "constructor" });
assert.equal(r.status, 200);
assert.equal(
  [...STRIPE.sessions.values()].at(-1).success_url,
  "https://app.test/onboarding/plan?checkout=success&session_id={CHECKOUT_SESSION_ID}",
);

console.log("checkout rules: all checks passed");
