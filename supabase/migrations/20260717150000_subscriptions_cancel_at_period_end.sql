-- Whether the subscription is set to end at the current period boundary.
-- Written only by the stripe-webhook function; lets the UI show "ends on X"
-- instead of "renews on X" without a live Stripe call.
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;
