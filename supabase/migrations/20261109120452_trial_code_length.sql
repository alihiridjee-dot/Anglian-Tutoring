-- Free-trial codes of their own length (Ali, 9 Nov 2026: ten nine-month codes,
-- no card). Until now every code gave TRIAL_DAYS (14) and took a card.
--
--   trial_days   the trial this code starts, in days. Null = the standard
--                TRIAL_DAYS in supabase/functions/_shared/trialCode.ts, so the
--                landing pop-up's codes are unchanged and 14 lives in one place.
--                Stripe allows at most 730.
--   needs_card   false = Checkout asks for no card, and the plan stops when the
--                trial ends (progress kept). True = the standard rule.
--
-- Additive: every existing row keeps working as before.
--
-- Idempotent. Rollback: supabase/rollbacks/20261109120452_trial_code_length.down.sql

begin;

alter table public.trial_codes
  add column if not exists trial_days int
    constraint trial_codes_trial_days_range check (trial_days between 1 and 730),
  add column if not exists needs_card boolean not null default true;

commit;
