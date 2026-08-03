-- The 2026-07-09 launch packages bundled subjects into the plan. The current
-- model takes subjects from onboarding and prices by count (*_1/*_2/*_3), so
-- these are a second, competing vocabulary for the same purchase.
--
-- Safe to delete outright: no FK references packages.tier, subscriptions.plan
-- is written from Stripe metadata (not resolved against this table), and both
-- readers (useBilling.useRawPackages, stripe-checkout.resolvePackage) filter
-- active = true. None of these rows ever had a Stripe product or price.
--
-- 'ks3' is deliberately kept as a placeholder: it is a real product intention
-- with no curriculum behind it yet, not billing debt. See the comment below.
delete from packages
where tier in ('gcse_single', 'gcse_triple', 'aqa_trilogy')
  and active = false
  and stripe_price_id is null;

comment on table packages is
  'Purchasable plans. Only active = true rows are ever read by the app. '
  'NOTE: packages.level is plain text, not the level enum, so it is not '
  'validated against the taxonomy — the ks3 row points at a level that does '
  'not exist in the enum (gcse, alevel, gcse_trilogy, igcse). That row is an '
  'intentional placeholder for a future KS3 product and must stay inactive '
  'until a KS3 level, curriculum and onboarding path exist.';
