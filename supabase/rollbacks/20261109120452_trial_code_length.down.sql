-- Rollback for 20261109120452_trial_code_length.sql. Every code goes back to
-- the standard length and card rule, including any long codes already handed out.
-- Roll back stripe-checkout first: it reads these columns.
begin;
alter table public.trial_codes
  drop column if exists trial_days,
  drop column if exists needs_card;
commit;
