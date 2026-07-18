-- The plans the landing page actually sells. The four content bundles
-- (ks3/gcse_single/gcse_triple/aqa_trilogy) were never on the public pricing
-- page; they are retired rather than deleted so existing rows referencing
-- them by tier still resolve.
update public.packages set active = false
where tier in ('ks3', 'gcse_single', 'gcse_triple', 'aqa_trilogy');

-- subjects stays empty: these plans are time-based, so the student's subjects
-- come from their onboarding choice, not from the plan they buy.
insert into public.packages (tier, name, description, subjects, level, price_pence, billing_interval, active, sort_order)
values
  ('weekly', 'Weekly Plan', 'Two live sessions a week. Ideal flexibility — cancel anytime.', '{}', null, 1999, 'week', true, 10),
  ('monthly', 'Monthly Saver', 'Eight live sessions a month. Best value.', '{}', null, 4999, 'month', true, 20),
  ('tri_monthly', 'Tri-monthly', 'Twenty-four live sessions a term, plus premium onboarding.', '{}', null, 13999, 'quarter', true, 30)
on conflict (tier) do update set
  name = excluded.name,
  description = excluded.description,
  price_pence = excluded.price_pence,
  billing_interval = excluded.billing_interval,
  active = true,
  sort_order = excluded.sort_order;
