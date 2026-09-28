/** Stripe TEST-MODE check: does pausing (behavior "void") across a renewal and
 * then resuming give that period away? Runs the scenario twice — resuming the
 * old way, and with stripe-checkout's chargeSkippedRenewal — and prints what
 * Stripe charged. Everything lives under test clocks, deleted at the end.
 * Refuses to run on anything but a test-mode key.
 *
 *   bun scripts/stripe-pause-renewal-check.ts
 */
const env = await Bun.file(new URL("../.env", import.meta.url)).text();
const key = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim() ?? "";
if (!key.startsWith("sk_test_")) throw new Error("Refusing: not a test-mode key.");

const DAY = 86_400;
async function api(method: string, path: string, body?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.error)}`);
  return json;
}
async function advance(clock: string, to: number) {
  await api("POST", `test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(to) });
  for (let i = 0; i < 120; i++) {
    const c = await api("GET", `test_helpers/test_clocks/${clock}`);
    if (c.status === "ready") return;
    await Bun.sleep(2000);
  }
  throw new Error("clock did not settle");
}
const periodEnd = (s: {
  current_period_end?: number;
  items: { data: { current_period_end?: number }[] };
}) => s.current_period_end ?? s.items.data[0].current_period_end!;
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const product = await api("POST", "products", { name: "fix-first pause check (delete me)" });
const clocks: string[] = [];

async function scenario(label: string, fixed: boolean) {
  const t0 = Math.floor(Date.now() / 1000);
  const clock = await api("POST", "test_helpers/test_clocks", {
    frozen_time: String(t0),
    name: `pause-check ${label}`,
  });
  clocks.push(clock.id);
  const customer = await api("POST", "customers", {
    test_clock: clock.id,
    payment_method: "pm_card_visa",
    "invoice_settings[default_payment_method]": "pm_card_visa",
  });
  const sub = await api("POST", "subscriptions", {
    customer: customer.id,
    "items[0][price_data][currency]": "gbp",
    "items[0][price_data][product]": product.id,
    "items[0][price_data][unit_amount]": "1000",
    "items[0][price_data][recurring][interval]": "month",
  });
  const firstEnd = periodEnd(sub);

  await advance(clock.id, t0 + 20 * DAY);
  await api("POST", `subscriptions/${sub.id}`, { "pause_collection[behavior]": "void" });
  await advance(clock.id, firstEnd + 2 * DAY); // just past the renewal
  const paused = await api("GET", `subscriptions/${sub.id}?expand[]=latest_invoice`);

  const resumed = await api("POST", `subscriptions/${sub.id}`, {
    pause_collection: "",
    cancel_at_period_end: "false",
  });
  if (fixed) {
    // Mirrors chargeSkippedRenewal: invoice the rest of the period, pro rata.
    if (paused.pause_collection && paused.latest_invoice?.status === "void") {
      const now = firstEnd + 2 * DAY; // the clock's "now"
      let amount = 0;
      let currency = "gbp";
      for (const item of paused.items.data) {
        const start = item.current_period_start ?? paused.current_period_start;
        const end = item.current_period_end ?? paused.current_period_end;
        amount += Math.round(
          ((item.price.unit_amount ?? 0) * (item.quantity ?? 1) * (end - now)) / (end - start),
        );
        currency = item.price.currency;
      }
      await api("POST", "invoiceitems", {
        customer: customer.id,
        subscription: sub.id,
        amount: String(amount),
        currency,
        description: "Rest of the current period, after resuming",
      });
      const inv = await api("POST", "invoices", {
        customer: customer.id,
        subscription: sub.id,
        auto_advance: "true",
      });
      await api("POST", `invoices/${inv.id}/finalize`);
      await api("POST", `invoices/${inv.id}/pay`).catch((e) => console.log("pay:", e.message));
    }
  }
  await advance(clock.id, firstEnd + 3 * DAY); // let any invoice finalise and pay
  const invoices = await api("GET", `invoices?subscription=${sub.id}&limit=20`);
  const after = await api("GET", `subscriptions/${sub.id}`);

  const rows = (invoices.data as { status: string; amount_paid: number; created: number }[])
    .sort((a, b) => a.created - b.created)
    .map((i) => `${iso(i.created)} ${i.status} paid £${(i.amount_paid / 100).toFixed(2)}`);
  console.log(`\n── ${label}`);
  console.log(
    `first period ended ${iso(firstEnd)}; renewal invoice while paused: ${paused.latest_invoice?.status}`,
  );
  console.log(
    `resumed ${iso(firstEnd + 2 * DAY)} → status ${after.status}, paid through ${iso(periodEnd(after))}`,
  );
  console.log(`invoices:\n  ${rows.join("\n  ")}`);
  const paidAfterResume = (invoices.data as { status: string; created: number }[]).filter(
    (i) => i.status === "paid" && i.created >= firstEnd + 2 * DAY - 60,
  ).length;
  return { paidAfterResume, access: after.status, resumedEnd: periodEnd(resumed) };
}

try {
  const today = await scenario("resume the old way", false);
  const fixed = await scenario("resume with the fix", true);
  console.log("\nRESULT");
  console.log(
    `today: ${today.paidAfterResume} charge(s) on resume, status ${today.access} → ${today.paidAfterResume === 0 ? "period given away (bug confirmed)" : "charged"}`,
  );
  console.log(
    `fixed: ${fixed.paidAfterResume} charge(s) on resume, status ${fixed.access} → ${fixed.paidAfterResume === 1 ? "rest of the period charged on resume" : "UNEXPECTED"}`,
  );
} finally {
  for (const c of clocks) await api("DELETE", `test_helpers/test_clocks/${c}`).catch(() => {});
  await api("POST", `products/${product.id}`, { active: "false" }).catch(() => {});
  console.log(`\ncleaned up ${clocks.length} test clock(s) and archived the test product`);
}
