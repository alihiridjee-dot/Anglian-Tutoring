-- A-Level gets its own price ladder, 10% above the general one.
--
-- Same seam as iGCSE (20260728030000_igcse_package_ladder): nine override rows
-- with level = 'alevel', the same tiers, so add_subjects and change_cadence
-- keep an A-level student on A-level prices. The amounts match
-- ALEVEL_PRICE_PENCE in src/lib/billing/entitlements.ts.
--
-- The rows go in SWITCHED OFF and without a Stripe price. Checkout and the plan
-- step read active rows only, so until scripts/stripe-seed.ts creates the
-- A-level prices in Stripe, attaches them and switches the rows on, A-level
-- students are priced exactly as today (the general ladder). Applying this
-- alone changes nothing anyone sees or pays.
insert into public.packages
  (tier, name, description, subjects, level, price_pence, stripe_price_id, active, sort_order, billing_interval)
select
  p.tier,
  p.name || ' · A-Level',
  p.description,
  p.subjects,
  'alevel',
  v.price_pence,
  null,
  false,
  p.sort_order,
  p.billing_interval
from public.packages p
join (values
  ('weekly_1', 2199), ('weekly_2', 2463), ('weekly_3', 2639),
  ('monthly_1', 5499), ('monthly_2', 6159), ('monthly_3', 6599),
  ('termly_1', 15399), ('termly_2', 17269), ('termly_3', 18479)
) as v (tier, price_pence) on v.tier = p.tier
where p.active
  and p.level is null
on conflict (tier, level) do nothing;

-- Nine rows, or stop: a missing general row would leave a tier without an
-- A-level price, and that student would quietly fall back to GCSE pricing.
do $$
begin
  if (select count(*) from public.packages where level = 'alevel') <> 9 then
    raise exception 'Expected 9 A-level package rows, found %.',
      (select count(*) from public.packages where level = 'alevel');
  end if;
end;
$$;
