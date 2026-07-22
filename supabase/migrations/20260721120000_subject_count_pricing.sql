-- Pricing moves from three flat cadence plans to a cadence × subject-count
-- matrix. The parent chooses level/subjects/board on the landing page; price is
-- driven only by how many subjects (1–3, Combined Trilogy = 3). Board and level
-- never change the price.
--
-- Old single-tier plans are retired (deactivated, not deleted, so historical
-- subscriptions referencing them by tier still resolve). The nine new tiers are
-- `${cadence}_${count}` to match the checkout lookup and stripe-seed.ts.
--
-- stripe_price_id is intentionally left null here: run scripts/stripe-seed.ts to
-- create the Stripe prices and attach them.

update public.packages set active = false
where tier in ('weekly', 'monthly', 'tri_monthly');

insert into public.packages
  (tier, name, description, subjects, level, price_pence, billing_interval, active, sort_order)
values
  ('weekly_1',  'Weekly Plan (1 subject)',   '2 live sessions a week.',    '{}', null, 1999,  'week',    true, 11),
  ('weekly_2',  'Weekly Plan (2 subjects)',  '4 live sessions a week.',    '{}', null, 2239,  'week',    true, 12),
  ('weekly_3',  'Weekly Plan (3 subjects)',  '6 live sessions a week.',    '{}', null, 2399,  'week',    true, 13),
  ('monthly_1', 'Monthly Saver (1 subject)', '8 live sessions a month.',   '{}', null, 4999,  'month',   true, 21),
  ('monthly_2', 'Monthly Saver (2 subjects)','16 live sessions a month.',  '{}', null, 5599,  'month',   true, 22),
  ('monthly_3', 'Monthly Saver (3 subjects)','24 live sessions a month.',  '{}', null, 5999,  'month',   true, 23),
  ('termly_1',  'Termly (1 subject)',        '24 live sessions a term.',   '{}', null, 13999, 'quarter', true, 31),
  ('termly_2',  'Termly (2 subjects)',       '48 live sessions a term.',   '{}', null, 15699, 'quarter', true, 32),
  ('termly_3',  'Termly (3 subjects)',       '72 live sessions a term.',   '{}', null, 16799, 'quarter', true, 33)
on conflict (tier) do update set
  name = excluded.name,
  description = excluded.description,
  price_pence = excluded.price_pence,
  billing_interval = excluded.billing_interval,
  active = true,
  sort_order = excluded.sort_order;
