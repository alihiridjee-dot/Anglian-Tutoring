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
 *
 * Options:
 *   --only=general|igcse|alevel   one price list; the others are not touched
 *   --dry-run                     say what would happen; change nothing
 */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import {
  ALEVEL_PRICE_PENCE,
  GENERAL_PRICE_PENCE,
  type PriceLadder,
} from "../src/lib/billing/entitlements.ts";

// The landing page sells a cadence × subject-count matrix. Each combination is
// its own immutable Stripe price with tier `${cadence}_${count}`, matching the
// tier the checkout function looks up. The prices (pence) come from
// src/lib/billing/entitlements.ts, the same lists the pricing section shows.
const CADENCES = [
  { cadence: "weekly", label: "Weekly Plan", interval: "week" as const, intervalCount: 1 },
  { cadence: "monthly", label: "Monthly Saver", interval: "month" as const, intervalCount: 1 },
  { cadence: "termly", label: "Termly", interval: "month" as const, intervalCount: 3 },
] as const;

// Weeks per billing cycle; one live session per subject per week. Counted the
// landing page's way (4 a month, 12 a term).
const CYCLE_WEEKS: Record<string, number> = { weekly: 1, monthly: 4, termly: 12 };

/**
 * What a plan includes, word for word as packages.description holds it
 * (20261003120000), so Checkout, invoices and the plan step agree.
 */
function planDescription(cadence: string, count: number) {
  const unit = cadence === "termly" ? "term" : cadence === "monthly" ? "month" : "week";
  const sessions = CYCLE_WEEKS[cadence] * count;
  const head = `${sessions} live ${sessions === 1 ? "session" : "sessions"} a ${unit}`;
  return cadence === "weekly" ? `${head}.` : `${head}, ${count} a week.`;
}

// Price lists we maintain. `level: null` is the general ladder everyone falls
// back to; a level entry is an override that only students at that level are
// offered (see resolvePackagesForLevel and the packages table's (tier, level)
// key). iGCSE deliberately starts at the same amounts as the general ladder —
// separate Stripe objects exist so its price can move on its own later without
// disturbing what GCSE students pay. A-Level has its own amounts, 10% above
// (20261108130000_alevel_package_ladder adds its rows, switched off until
// this script attaches their prices).
const PRICE_LISTS: {
  level: string | null;
  suffix: string;
  nameSuffix: string;
  prices: PriceLadder;
}[] = [
  { level: null, suffix: "", nameSuffix: "", prices: GENERAL_PRICE_PENCE },
  { level: "igcse", suffix: "igcse_", nameSuffix: " · iGCSE", prices: GENERAL_PRICE_PENCE },
  { level: "alevel", suffix: "alevel_", nameSuffix: " · A-Level", prices: ALEVEL_PRICE_PENCE },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
if (only && !PRICE_LISTS.some((l) => (l.level ?? "general") === only)) {
  throw new Error(`--only=${only}: expected general, igcse or alevel.`);
}

const PLANS = PRICE_LISTS.filter((l) => !only || (l.level ?? "general") === only).flatMap(
  ({ level, suffix, nameSuffix, prices }) =>
    CADENCES.flatMap(({ cadence, label, interval, intervalCount }) =>
      ([1, 2, 3] as const).map((count) => {
        const subjectWord = count === 1 ? "1 subject" : `${count} subjects`;
        return {
          tier: `${cadence}_${count}`,
          level,
          // The lookup key is what makes this re-runnable, so it has to separate
          // the two ladders — otherwise the iGCSE pass would find the general
          // price and silently reuse it.
          lookupKey: `anglian_${suffix}${cadence}_${count}`,
          name: `Anglia Educate — ${label} (${subjectWord})${nameSuffix}`,
          description: planDescription(cadence, count),
          amount: prices[cadence][count],
          interval,
          intervalCount,
        };
      }),
    ),
);

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
console.log(
  `Seeding Stripe in ${live ? "LIVE" : "TEST"} mode${dryRun ? " (dry run: nothing changes)" : ""}` +
    `${only ? `, ${only} list only` : ""}.\n`,
);
if (live && !dryRun) {
  console.log("⚠️  This is your live key — these products will take real money.\n");
}

// Never mix Stripe accounts or modes. Every price the database already points
// at must exist for this key: a test key run against the live database would
// otherwise re-point live plans (GCSE included) at test prices nobody can pay.
// Checked before anything is created or written.
if (db) {
  const { data: attached, error } = await db
    .from("packages")
    .select("stripe_price_id")
    .not("stripe_price_id", "is", null);
  if (error) throw new Error(`Couldn't read packages: ${error.message}`);
  const ids = [...new Set((attached ?? []).map((r) => String(r.stripe_price_id)))];
  for (const id of ids) {
    try {
      await stripe.prices.retrieve(id);
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") {
        throw new Error(
          `The database's price ${id} doesn't exist for this ${live ? "live" : "test"} key. ` +
            "Use the key its prices were made with. Nothing was created or changed.",
        );
      }
      throw err;
    }
  }
  console.log(`Checked: the database's ${ids.length} prices all belong to this key.\n`);
}

const created: { tier: string; level: string | null; priceId: string }[] = [];

for (const plan of PLANS) {
  const label = `${plan.tier}${plan.level ? ` (${plan.level})` : ""}`;

  // Reuse the price if this has been run before. lookup_key is the stable
  // handle; product ids are not, and searching by name would match loosely.
  const existing = await stripe.prices.list({
    lookup_keys: [plan.lookupKey],
    expand: ["data.product"],
  });
  let price = existing.data[0];

  // A reused price must still be the one the list asks for: prices never
  // change, so a mismatch means the list was edited without a new price.
  if (
    price &&
    (price.unit_amount !== plan.amount ||
      price.currency !== "gbp" ||
      price.recurring?.interval !== plan.interval ||
      price.recurring?.interval_count !== plan.intervalCount)
  ) {
    throw new Error(
      `${label}: Stripe price ${price.id} is ${price.unit_amount} ${price.currency} every ` +
        `${price.recurring?.interval_count} ${price.recurring?.interval}, but the list says ` +
        `${plan.amount} gbp every ${plan.intervalCount} ${plan.interval}. Nothing more was changed.`,
    );
  }

  if (dryRun) {
    console.log(
      price
        ? `• ${label}: would reuse ${price.id} (${plan.amount}p) and put the row on sale`
        : `• ${label}: would create "${plan.name}" at ${plan.amount}p every ` +
            `${plan.intervalCount} ${plan.interval} (${plan.lookupKey}), then put the row on sale`,
    );
    continue;
  }

  if (price) {
    console.log(`• ${label}: reusing existing price ${price.id}`);
    // A price is immutable but its product's description isn't: keep the text
    // families see at Checkout and on invoices in step with the plan.
    const product = price.product;
    if (
      typeof product !== "string" &&
      !product.deleted &&
      product.description !== plan.description
    ) {
      await stripe.products.update(product.id, { description: plan.description });
      console.log(`  updated product ${product.id}: "${plan.description}"`);
    }
  } else {
    const product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { tier: plan.tier, level: plan.level ?? "" },
    });
    price = await stripe.prices.create({
      product: product.id,
      currency: "gbp",
      unit_amount: plan.amount,
      recurring: { interval: plan.interval, interval_count: plan.intervalCount },
      lookup_key: plan.lookupKey,
      metadata: { tier: plan.tier, level: plan.level ?? "" },
    });
    console.log(`• ${label}: created product ${product.id} + price ${price.id}`);
  }

  created.push({ tier: plan.tier, level: plan.level, priceId: price.id });

  if (db) {
    // Scope by level as well as tier: a tier now names two rows, and updating
    // on tier alone would point the level override at the general price.
    // A row is put on sale only once it has its price: checkout skips inactive
    // rows, so until then its students are charged the general row instead.
    const query = db
      .from("packages")
      .update({ stripe_price_id: price.id, active: true })
      .eq("tier", plan.tier);
    const { error } = await (plan.level ? query.eq("level", plan.level) : query.is("level", null));
    if (error) throw new Error(`Couldn't attach ${label} to packages: ${error.message}`);
  }
}

if (dryRun) {
  console.log("\nDry run: nothing was created in Stripe or written to the database.");
} else if (db) {
  console.log("\nDone. Every active package now has a stripe_price_id.");
} else {
  console.log("\nProducts and prices are created in Stripe.");
  console.log("SUPABASE_SERVICE_ROLE_KEY wasn't set, so nothing was written to the database.");
  console.log("Run this SQL to attach them (price ids are not secret):\n");
  for (const { tier, level, priceId } of created) {
    const levelClause = level ? `level = '${level}'` : "level is null";
    console.log(
      `update public.packages set stripe_price_id = '${priceId}', active = true where tier = '${tier}' and ${levelClause};`,
    );
  }
}

console.log("\nNext: set the same STRIPE_SECRET_KEY as a Supabase function secret,");
console.log("then deploy the functions — see docs/STRIPE_SETUP.md.");
