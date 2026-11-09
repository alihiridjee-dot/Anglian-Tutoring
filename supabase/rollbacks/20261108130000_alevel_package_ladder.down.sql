-- Rollback for 20261108130000_alevel_package_ladder: A-level students go back
-- to the general ladder. A live A-level subscription keeps its own Stripe price
-- until its next plan change, so archive the A-level prices in Stripe as well
-- if they were created (scripts/stripe-seed.ts, lookup keys anglian_alevel_*).
delete from public.packages where level = 'alevel';
