-- Rollback for 20260927120000_trial_codes.sql. Drops every issued code.
begin;
drop table if exists public.trial_codes;
commit;
