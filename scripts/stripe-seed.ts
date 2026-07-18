/**
 * One-off (and re-runnable): create the Stripe products and recurring prices
 * for the three plans the landing page sells, then write each price id back
 * onto public.packages.stripe_price_id.
 *
 * Reads STRIPE_SECRET_KEY straight from your environment, so the key never has
 * to be pasted into a SQL statement, a migration, or a chat window.
 *
 * Usage — put STRIPE_SECRET_KEY and SUPABASE_SERVICE_ROLE_KEY in .env first
 * (Stripe dashboard → Developers → API keys; use the sk_test_… key until you
 * are ready to take real money), then:
 *
 *   bun add stripe
 *   bun --env-file=.env scripts/stripe-seed.ts
 *
 * Safe to run twice: products and prices are looked up by lookup_key and
 * reused, so a second run attaches the same ids rather than creating
 * duplicates. Stripe prices are immutable — to change what a plan costs, make
 * a new price in the dashboard and re-point stripe_price_id at it. Editing
 * price_pence here only changes the number the app displays.
 */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const PLANS = [
  {
    tier: "weekly",
    name: "Anglian Learning — Weekly Plan",
    description: "Two live sessions a week. Cancel anytime.",
    amount: 1999,
    interval: "week" as const,
    intervalCount: 1,
  },
  {
    tier: "monthly",
    name: "Anglian Learning — Monthly Saver",
    description: "Eight live sessions a month. Best value.",
    amount: 4999,
    interval: "month" as const,
    intervalCount: 1,
  },
  {
    tier: "tri_monthly",
    name: "Anglian Learning — Tri-monthly",
    description: "Twenty-four live sessions a term, plus premium onboarding.",
    amount: 13999,
    interval: "month" as const,
    intervalCount: 3,
  },
];

const stripeKey = process.env.STRIPE_SECRET_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.");

const stripe = new Stripe(stripeKey);

// packages is tutor-only for writes, so attaching the price ids needs the
// service role. It's optional: without it the script still creates everything
// in Stripe and prints the SQL to finish the job by hand, so you don't have to
// put a second secret on disk just to run this once.
const db =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;

const live = stripeKey.startsWith("sk_live_");
console.log(`Seeding Stripe in ${live ? "LIVE" : "TEST"} mode.\n`);
if (live) {
  console.log("⚠️  This is your live key — these products will take real money.\n");
}

const created: { tier: string; priceId: string }[] = [];

for (const plan of PLANS) {
  const lookupKey = `anglian_${plan.tier}`;

  // Reuse the price if this has been run before. lookup_key is the stable
  // handle; product ids are not, and searching by name would match loosely.
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], expand: ["data.product"] });
  let price = existing.data[0];

  if (price) {
    console.log(`• ${plan.tier}: reusing existing price ${price.id}`);
  } else {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { tier: plan.tier },
    });
    price = await stripe.prices.create({
      product: product.id,
      currency: "gbp",
      unit_amount: plan.amount,
      recurring: { interval: plan.interval, interval_count: plan.intervalCount },
      lookup_key: lookupKey,
      metadata: { tier: plan.tier },
    });
    console.log(`• ${plan.tier}: created product ${product.id} + price ${price.id}`);
  }

  created.push({ tier: plan.tier, priceId: price.id });

  if (db) {
    const { error } = await db
      .from("packages")
      .update({ stripe_price_id: price.id })
      .eq("tier", plan.tier);
    if (error) throw new Error(`Couldn't attach ${plan.tier} to packages: ${error.message}`);
  }
}

if (db) {
  console.log("\nDone. Every active package now has a stripe_price_id.");
} else {
  console.log("\nProducts and prices are created in Stripe.");
  console.log("SUPABASE_SERVICE_ROLE_KEY wasn't set, so nothing was written to the database.");
  console.log("Run this SQL to attach them (price ids are not secret):\n");
  for (const { tier, priceId } of created) {
    console.log(
      `update public.packages set stripe_price_id = '${priceId}' where tier = '${tier}';`,
    );
  }
}

console.log("\nNext: set the same STRIPE_SECRET_KEY as a Supabase function secret,");
console.log("then deploy the functions — see docs/STRIPE_SETUP.md.");
