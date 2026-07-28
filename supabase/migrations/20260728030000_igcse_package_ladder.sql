-- A level-scoped price list, starting with iGCSE.
--
-- Packages were level-agnostic: one row per (cadence, subject count), with
-- level always null. To price a level differently we keep that tier vocabulary
-- exactly as it is and add *override* rows carrying a level. Resolution is
-- "the row for my level, else the row for everyone" (resolvePackagesForLevel).
--
-- Deliberately NOT renaming tiers to weekly_1_igcse: add_subjects rebuilds the
-- tier as `${cadence}_${count}` when laddering a student up, so a level baked
-- into the tier name would be dropped on the first upgrade and quietly move an
-- iGCSE student onto standard pricing.
--
-- UNIQUE (tier) therefore becomes UNIQUE (tier, level). NULLS NOT DISTINCT
-- matters: without it the two null-level rows for a tier would both be allowed
-- back in, and the fallback lookup would stop being single-valued.
alter table public.packages drop constraint if exists packages_tier_key;
alter table public.packages
  add constraint packages_tier_level_key unique nulls not distinct (tier, level);

-- Clone the live ladder for iGCSE. Prices and Stripe prices are intentionally
-- the same objects as the standard ladder for now: this establishes the seam so
-- iGCSE pricing can move independently later, without inventing new Stripe
-- prices that would be identical today.
insert into public.packages
  (tier, name, description, subjects, level, price_pence, stripe_price_id, active, sort_order, billing_interval)
select
  p.tier,
  p.name || ' · iGCSE',
  p.description,
  p.subjects,
  'igcse',
  p.price_pence,
  p.stripe_price_id,
  true,
  p.sort_order,
  p.billing_interval
from public.packages p
where p.active
  and p.level is null
  and split_part(p.tier, '_', 1) in ('weekly', 'monthly', 'termly')
on conflict (tier, level) do nothing;
