/** Brute force for a parent's take-over (stripe-checkout/takeOver.ts and the
 * webhook's take-over rules). Thousands of seeded runs of the real functions
 * against the in-memory Stripe and Supabase in this folder, no network.
 *
 * Each run: a parent takes over a student's own plan, then Stripe's events
 * arrive in any order, get resent, fail and are retried; Stripe calls fail
 * mid-way; two webhook deliveries race (one writes between the other's read
 * and its write); the student cancels or un-cancels at the same moment; and
 * the clock jumps to the day the student's plan would renew. After every step:
 * once the parent's plan has been written, the row stays on it with access
 * live. At the end: the student's plan never bills again, the parent's starts
 * billing, nothing is refunded, and the parent's plan is never cancelled.
 *
 * A second part throws random requests at Checkout: only a linked parent,
 * asking for a take-over of a plan the student pays for, gets a take-over.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/take-over-fuzz.ts [runs]
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";
import { STRIPE, completeSession, event, resetStripe } from "./mock-stripe.ts";

// The functions log every step; a few thousand runs of that drowns the result.
const log = console.log;
console.log = () => {};
console.error = () => {};

const checkout = await loadHandler("../../supabase/functions/stripe-checkout/index.ts");
const webhook = await loadHandler("../../supabase/functions/stripe-webhook/index.ts");

const RUNS = Number(Deno.args[0] ?? 3000);
const CHILD = "child-C";
const PARENT = "parent-P";
const OTHER_PARENT = "parent-Q";
const STRANGER = "stranger-S";
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

/** mulberry32: the same seed gives the same run, so a failure can be replayed. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface World {
  status: "active" | "trialing";
  cancelling: boolean;
  endsIn: number;
  payer: string;
  paused: boolean;
  linked: string[];
}

function family(w: World) {
  resetDb();
  resetStripe();
  for (const id of [CHILD, PARENT, OTHER_PARENT, STRANGER]) {
    DB.users[id] = { id, email: `${id}@test` };
  }
  table("profiles").push(
    { id: CHILD, role: "student", level: "gcse", enrolled_courses: ["biology"] },
    { id: PARENT, role: "parent" },
    { id: OTHER_PARENT, role: "parent" },
    { id: STRANGER, role: "parent" },
  );
  table("student_enrolments").push({ student_id: CHILD, subject: "biology", board: "aqa" });
  for (const p of w.linked) table("parent_student_links").push({ parent_id: p, student_id: CHILD });
  table("stripe_customers").push({ user_id: w.payer, stripe_customer_id: `cus_${w.payer}` });
  for (const tier of ["monthly_1", "weekly_1", "termly_1"]) {
    table("packages").push({
      tier,
      name: tier,
      stripe_price_id: `price_${tier}`,
      level: null,
      active: true,
    });
  }
  const end = now() + w.endsIn;
  STRIPE.subs.set("sub_child", {
    id: "sub_child",
    object: "subscription",
    status: w.status,
    customer: `cus_${w.payer}`,
    created: now() - 10 * DAY,
    ended_at: null,
    metadata: { student_id: CHILD, payer_id: w.payer, tier: "monthly_1" },
    pause_collection: w.paused ? { behavior: "void" } : null,
    cancel_at_period_end: w.cancelling,
    current_period_end: end,
    latest_invoice: "in_child",
    items: {
      data: [{ id: "si_child", price: { id: "price_monthly_1" }, current_period_end: end }],
    },
  });
  STRIPE.invoices.set("in_child", {
    id: "in_child",
    subscription: "sub_child",
    amount_paid: w.status === "trialing" ? 0 : 4999,
    payment_intent: w.status === "trialing" ? null : "pi_child",
  });
  table("subscriptions").push({
    student_id: CHILD,
    user_id: w.payer,
    stripe_customer_id: `cus_${w.payer}`,
    stripe_subscription_id: "sub_child",
    status: w.paused ? "paused" : w.status,
    plan: "monthly_1",
    cancel_at_period_end: w.cancelling,
    current_period_end: new Date(end * 1000).toISOString(),
  });
  DB.rpcs.claim_ai_request = () => ({ data: true, error: null });
}

const row = () => table("subscriptions").find((r) => r.student_id === CHILD);
const call = async (token: string, body: Record<string, unknown>) => {
  const res = await checkout(post(body, { Authorization: `Bearer ${token}` }));
  return { status: res.status, body: await res.json() };
};
const sessionOf = (url: string) => STRIPE.sessions.get(url.split("/").pop()!);
const isLive = (s: string | undefined) => s === "active" || s === "trialing";

// ── Part 1: the webhook under every ordering, resend, failure and race ──────

const failures: string[] = [];
let trace: string[] = [];
let racesThatHit = 0;
let retriesSeen = 0;

async function webhookRun(seed: number) {
  const rand = prng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const w: World = {
    status: rand() < 0.75 ? "active" : "trialing",
    cancelling: rand() < 0.4,
    // From well away down to just past the six-hour lead, and under Stripe's 48 h.
    endsIn: pick([20 * DAY, 6 * DAY, 30 * 3600, 6 * 3600 + 120]),
    payer: CHILD,
    paused: false,
    linked: [PARENT],
  };
  family(w);
  trace = [`world ${JSON.stringify(w)}`];

  const opened = await call(PARENT, {
    action: "checkout",
    tier: pick(["monthly_1", "weekly_1", "termly_1"]),
    student_id: CHILD,
    return_to: "billing",
    take_over: true,
  });
  assert.equal(opened.status, 200, `seed ${seed}: ${JSON.stringify(opened.body)}`);
  // The parent's plan starts billing the day the student's runs out, or at
  // Stripe's 48 h minimum: never over days the student already paid for.
  const childEndAtOpen = STRIPE.subs.get("sub_child").current_period_end;
  const startsAt = sessionOf(opened.body.url).subscription_data.trial_end;
  assert.ok(startsAt >= childEndAtOpen, `seed ${seed}: bills over days already paid for`);
  assert.ok(
    startsAt <= Math.max(childEndAtOpen, now() + 48 * 3600 + 11 * 60),
    `seed ${seed}: starts later than it needs to`,
  );
  const paid = completeSession(sessionOf(opened.body.url).id);
  const takeOverId: string = paid.created.data.object.id;
  const takeOver = () => STRIPE.subs.get(takeOverId);
  const child = () => STRIPE.subs.get("sub_child");

  const queue: unknown[] = [paid.completed, paid.created];
  const delivered: unknown[] = [];
  const charges: string[] = [];
  const fingerprint = (s: { status: string; cancel_at_period_end: boolean }) =>
    `${s.status}|${s.cancel_at_period_end}`;
  const seen = new Map<string, string>();
  for (const [id, s] of STRIPE.subs) seen.set(id, fingerprint(s));
  /** Stripe sends an event for every change to a subscription. */
  const emitChanges = () => {
    for (const [id, s] of STRIPE.subs) {
      const now = fingerprint(s);
      if (seen.get(id) === now) continue;
      seen.set(id, now);
      queue.push(
        event(
          s.status === "canceled"
            ? "customer.subscription.deleted"
            : "customer.subscription.updated",
          s,
        ),
      );
    }
  };

  /** The day the student's period ends: their plan ends or renews; the parent's starts billing. */
  let advanced = false;
  const advance = () => {
    trace.push("advance to the renewal day");
    advanced = true;
    const c = child();
    if (c.status !== "canceled") {
      if (c.cancel_at_period_end) {
        c.status = "canceled";
        c.ended_at = c.current_period_end;
      } else {
        charges.push("student's plan renewed");
        c.current_period_end += 30 * DAY;
      }
    }
    const t = takeOver();
    if (t.status === "trialing") {
      t.status = "active";
      t.current_period_end += 30 * DAY;
      charges.push("parent's first payment");
    }
    emitChanges();
  };

  /** The student acts in the same moment: cancels, or un-cancels in Stripe's portal. */
  const studentActs = () => {
    const c = child();
    if (c.status === "canceled") return;
    c.cancel_at_period_end = !c.cancel_at_period_end;
    trace.push(`student sets cancel_at_period_end=${c.cancel_at_period_end}`);
    emitChanges();
  };
  if (rand() < 0.3) studentActs();

  // Once the parent's plan is written, nothing may move the row off it.
  let taken = false;
  const armRace = () => {
    DB.onRead.subscriptions = () => {
      const r = row();
      if (!r || r.stripe_subscription_id !== "sub_child" || !isLive(takeOver().status)) return;
      // The take-over's own delivery lands between this one's read and write.
      racesThatHit++;
      trace.push("  race: the take-over is written between this read and its write");
      Object.assign(r, {
        user_id: PARENT,
        stripe_subscription_id: takeOverId,
        stripe_customer_id: takeOver().customer,
        status: "active",
        cancel_at_period_end: false,
        plan: takeOver().metadata.tier,
      });
      taken = true;
    };
  };

  const deliver = async (ev: unknown) => {
    const e = ev as { type: string; data: { object: { id: string } } };
    const res = await webhook(post(ev, { "stripe-signature": "test" }));
    trace.push(
      `deliver ${e.type} ${e.data.object.id} -> ${res.status}; row ${row()?.stripe_subscription_id}/${row()?.status}; ` +
        `student ${child().status}/${child().cancel_at_period_end}`,
    );
    if (res.status === 500) {
      retriesSeen++;
      queue.push(ev); // Stripe retries a 500
    } else {
      assert.equal(res.status, 200);
      delivered.push(ev);
    }
    emitChanges();
    const r = row();
    if (r?.stripe_subscription_id === takeOverId) taken = true;
    if (taken) {
      assert.equal(
        r?.stripe_subscription_id,
        takeOverId,
        `seed ${seed}: the row left the parent's plan`,
      );
      assert.equal(r?.user_id, PARENT, `seed ${seed}: the payer moved off the parent`);
      assert.ok(isLive(r?.status), `seed ${seed}: access dropped (${r?.status})`);
    }
  };

  for (let step = 0; step < 60; step++) {
    const roll = rand();
    // The renewal day comes once the take-over has landed and Stripe's retries
    // have caught up: the six-hour lead (TAKE_OVER_LEAD_SECONDS) is there for that.
    if (roll < 0.08 && taken && !advanced && queue.length === 0) advance();
    else if (roll < 0.16 && delivered.length) queue.push(pick(delivered));
    else if (roll < 0.22) {
      STRIPE.failRetrieves = 1;
      trace.push("next retrieve fails");
    } else if (roll < 0.28) {
      STRIPE.failUpdates = 1;
      trace.push("next update or cancel fails");
    } else if (roll < 0.4) armRace();
    else if (roll < 0.44 && taken) studentActs();
    if (queue.length === 0) {
      if (taken && !advanced) advance();
      else if (advanced) break;
      continue;
    }
    const ev = queue.splice(Math.floor(rand() * queue.length), 1)[0];
    await deliver(ev);
  }

  // Settle: no more faults; Stripe delivers what's left and resends once more.
  STRIPE.failRetrieves = 0;
  STRIPE.failUpdates = 0;
  DB.onRead = {};
  for (let i = 0; queue.length && i < 200; i++) await deliver(queue.shift());
  if (!advanced) advance();
  for (let i = 0; queue.length && i < 200; i++) await deliver(queue.shift());
  for (const ev of [...delivered]) await deliver(ev);
  for (let i = 0; queue.length && i < 200; i++) await deliver(queue.shift());

  const r = row();
  assert.equal(r?.stripe_subscription_id, takeOverId, `seed ${seed}: row not on the parent's plan`);
  assert.equal(r?.user_id, PARENT, `seed ${seed}`);
  assert.equal(r?.status, "active", `seed ${seed}: ended ${r?.status}`);
  assert.ok(
    !charges.includes("student's plan renewed"),
    `seed ${seed}: the student's plan billed again after the take-over`,
  );
  assert.ok(charges.includes("parent's first payment"), `seed ${seed}`);
  assert.equal(child().status, "canceled", `seed ${seed}: the student's plan is still live`);
  assert.equal(
    takeOver().status,
    "active",
    `seed ${seed}: the parent's plan is ${takeOver().status}`,
  );
  assert.deepEqual(STRIPE.refunds, [], `seed ${seed}: something was refunded`);
  assert.ok(
    !STRIPE.calls.includes(`subscriptions.cancel ${takeOverId}`),
    `seed ${seed}: the parent's plan was cancelled`,
  );
}

for (let seed = 1; seed <= RUNS; seed++) {
  try {
    await webhookRun(seed);
  } catch (err) {
    failures.push(err instanceof Error ? err.message.split("\n")[0] : String(err));
    if (failures.length === 1 && Deno.env.get("FUZZ_TRACE"))
      failures.push(...trace.map((t) => "    " + t));
    if (failures.length >= 8) break;
  }
}

// ── Part 2: random requests at Checkout ─────────────────────────────────────

let checkoutRuns = 0;
let takeOversOpened = 0;
for (let seed = 1; seed <= RUNS && failures.length < 8; seed++) {
  const rand = prng(seed * 7919);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const w: World = {
    status: pick([
      "active",
      "active",
      "active",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
    ] as World["status"][]),
    cancelling: rand() < 0.3,
    endsIn: pick([20 * DAY, 20 * DAY, 30 * 3600, 6 * 3600 + 60, 5 * 3600, 40 * 60, -DAY]),
    payer: pick([CHILD, CHILD, CHILD, OTHER_PARENT, PARENT]),
    paused: rand() < 0.1,
    linked: pick([[PARENT], [PARENT], [PARENT, OTHER_PARENT], [], [OTHER_PARENT]]),
  };
  family(w);
  const caller = pick([PARENT, PARENT, PARENT, OTHER_PARENT, STRANGER, CHILD, "nobody"]);
  const body: Record<string, unknown> = {
    action: "checkout",
    tier: pick(["monthly_1", "weekly_1", "monthly_3", "bogus", ""]),
    take_over: pick([true, true, true, true, "true", 1, false, undefined, null]),
  };
  if (rand() < 0.85)
    body.student_id = pick([CHILD, CHILD, CHILD, CHILD, PARENT, "someone-else", ""]);
  if (rand() < 0.2) body.trial_code = "AE-AAAA-BBBB";
  const subsBefore = JSON.stringify([...STRIPE.subs.values()]);
  const rowBefore = JSON.stringify(row());
  checkoutRuns++;
  try {
    const r = await call(caller, body);
    const replacing = [...STRIPE.sessions.values()].filter(
      (s) => s.subscription_data?.metadata?.replaces,
    );
    if (replacing.length > 0) {
      takeOversOpened++;
      const s = replacing[0];
      const childEnd = STRIPE.subs.get("sub_child").current_period_end;
      assert.equal(r.status, 200, `checkout seed ${seed}`);
      assert.equal(body.take_over, true, `checkout seed ${seed}: take-over without asking`);
      assert.ok(w.linked.includes(caller), `checkout seed ${seed}: ${caller} isn't linked`);
      assert.equal(body.student_id, CHILD, `checkout seed ${seed}`);
      assert.equal(w.payer, CHILD, `checkout seed ${seed}: took over a plan someone else pays`);
      assert.ok(["active", "trialing"].includes(w.status), `checkout seed ${seed}: ${w.status}`);
      assert.ok(!w.paused, `checkout seed ${seed}: paused`);
      assert.equal(s.subscription_data.metadata.payer_id, caller);
      assert.equal(s.subscription_data.metadata.replaces, "sub_child");
      assert.equal(
        s.subscription_data.trial_period_days,
        undefined,
        `checkout seed ${seed}: a trial code rode along`,
      );
      assert.ok(
        s.subscription_data.trial_end >= childEnd,
        `checkout seed ${seed}: starts before the student's plan ends`,
      );
      assert.ok(
        s.subscription_data.trial_end <= Math.max(childEnd, now() + 48 * 3600 + 11 * 60),
        `checkout seed ${seed}: starts later than it needs to`,
      );
      assert.ok(
        s.subscription_data.trial_end >= now() + 48 * 3600,
        `checkout seed ${seed}: under Stripe's 48 h`,
      );
      assert.ok(
        childEnd - now() >= 6 * 3600,
        `checkout seed ${seed}: opened within 6 h of renewal`,
      );
    } else if (r.status === 200) {
      // A plain Checkout for this student only once their plan is over.
      const beneficiary = body.student_id ?? caller;
      if (beneficiary === CHILD) {
        assert.equal(
          w.status,
          "canceled",
          `checkout seed ${seed}: a second plan was sold for a student with one (${w.status})`,
        );
      }
    }
    // Checkout opens sessions; it never changes a plan.
    assert.equal(
      JSON.stringify([...STRIPE.subs.values()]),
      subsBefore,
      `checkout seed ${seed}: a plan changed`,
    );
    assert.equal(JSON.stringify(row()), rowBefore, `checkout seed ${seed}: the row changed`);
  } catch (err) {
    failures.push(err instanceof Error ? err.message.split("\n")[0] : String(err));
  }
}

console.log = log;
if (failures.length) {
  console.log(`take-over fuzz: ${failures.length} failure(s)`);
  for (const f of failures) console.log("  " + f);
  Deno.exit(1);
}
console.log(
  `take-over fuzz: all checks passed — ${RUNS} webhook runs (${racesThatHit} races, ${retriesSeen} retries), ` +
    `${checkoutRuns} checkout requests (${takeOversOpened} take-overs opened)`,
);
