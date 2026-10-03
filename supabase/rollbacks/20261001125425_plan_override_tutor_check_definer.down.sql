-- DOWN for migrations/20261001125425_plan_override_tutor_check_definer.sql.
--
-- Kept out of supabase/migrations on purpose: the CLI applies everything in
-- that folder, in order, and a rollback must only ever run by hand.
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/rollbacks/20261001125425_plan_override_tutor_check_definer.down.sql
--
-- Returns the helper to SECURITY INVOKER, as 20260922104641 defined it. That
-- brings back the bug: every tutor override fails with "permission denied for
-- schema private".

begin;

create or replace function public.plan_override_caller_is_tutor()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select private.has_role(auth.uid(), 'tutor'::app_role)
      or private.has_role(auth.uid(), 'admin'::app_role);
$$;

commit;
