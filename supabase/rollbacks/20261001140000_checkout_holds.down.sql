-- DOWN for migrations/20261001140000_checkout_holds.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20261001140000_checkout_holds.down.sql
--
-- stripe-checkout and stripe-webhook keep working without this table: they
-- log the failed read or write and carry on, without the one-Checkout guard.
-- The webhook's refund of a second plan still applies.

begin;

drop table if exists public.checkout_holds;

commit;
