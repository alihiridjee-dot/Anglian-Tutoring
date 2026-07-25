/**
 * One-off (and re-runnable): lock down the Stripe Billing Portal so customers
 * cannot self-serve cancel from Stripe's hosted page. Cancelling a plan must go
 * through the app's own feedback-gated Cancel flow, so the portal is left for
 * card/VAT/invoice management only.
 *
 * Reads STRIPE_SECRET_KEY from the environment (never pasted into code). Run:
 *
 *   bun --env-file=.env scripts/stripe-portal-config.ts
 *
 * Idempotent: updates the account's default portal configuration in place (or
 * creates one if none exists yet). handlePortal in the stripe-checkout function
 * creates sessions without naming a configuration, so it uses this default.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("STRIPE_SECRET_KEY is not set. Add it to .env.");

const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });

// What the portal MAY do — everything a customer legitimately self-serves,
// minus cancellation.
const features: Stripe.BillingPortal.ConfigurationUpdateParams.Features = {
  subscription_cancel: { enabled: false },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  customer_update: {
    enabled: true,
    allowed_updates: ["email", "address", "phone", "tax_id"],
  },
};

async function main() {
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const target =
    existing.data.find((c) => c.is_default) ?? existing.data.find((c) => c.active) ?? null;

  if (target) {
    const updated = await stripe.billingPortal.configurations.update(target.id, { features });
    console.log(`Updated portal configuration ${updated.id} (default=${updated.is_default}).`);
  } else {
    const created = await stripe.billingPortal.configurations.create({
      features: features as Stripe.BillingPortal.ConfigurationCreateParams.Features,
      business_profile: {},
    });
    console.log(`Created portal configuration ${created.id} (becomes the default).`);
  }
  console.log("subscription_cancel is now DISABLED in the billing portal.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
