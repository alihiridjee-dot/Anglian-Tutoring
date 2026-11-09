-- Rollback for 20261108120000_commercial_ledger: the catalogue and the ledger go.
--
-- Nothing live reads or writes these objects, so dropping them changes nothing
-- in the app. BUT dropping the ledger tables destroys their rows, and the
-- append-only triggers do not stop a DROP. If any real payment has been
-- recorded, export ledger_transactions and ledger_entries first: they are the
-- only copy of that history outside Stripe.
--
--   select count(*) from public.ledger_transactions;   -- 0 = safe to drop

drop function if exists public.ledger_adjust(uuid, integer, text, text);
drop function if exists public.ledger_refund(uuid, text, text, text, text);
drop function if exists public.ledger_grant_credit(uuid, integer, text, text);
drop function if exists public.ledger_record_card_purchase(uuid, uuid, uuid, integer, text, text, text, timestamptz, timestamptz);
drop function if exists public.my_entitlements();
drop function if exists public.my_credit_balance();
drop function if exists public.ledger_purchase_with_credit(uuid, uuid, text);

drop view if exists public.product_entitlements;

drop table if exists public.ledger_entries;
drop table if exists public.ledger_transactions;
drop table if exists public.billing_accounts;
drop table if exists public.product_prices;
drop table if exists public.product_modules;
drop table if exists public.products;
drop table if exists public.access_tiers;

drop function if exists private.ledger_audit(uuid);
drop function if exists private.student_has_module(uuid, public.level, public.subject, public.board);
drop function if exists private.ledger_write(uuid, text, text, text, uuid, uuid, uuid, integer, uuid, text, text, timestamptz, timestamptz, jsonb);
drop function if exists private.ledger_access_window(uuid, uuid, text, integer);
drop function if exists private.ledger_check_student(uuid);
drop function if exists private.ledger_replay(uuid, text, text);
drop function if exists private.ledger_balance(uuid);
drop function if exists private.ledger_lock_student_product(uuid, uuid);
drop function if exists private.ledger_period_length(text, integer);
drop function if exists private.ledger_service_key(text);
drop function if exists private.ledger_lock_account(uuid);
drop function if exists private.billing_account_guard();
drop function if exists private.ledger_insert_guard();
drop function if exists private.ledger_append_only();
drop function if exists private.product_module_guard();
drop function if exists private.product_price_guard();
drop function if exists private.commerce_touch_updated_at();
