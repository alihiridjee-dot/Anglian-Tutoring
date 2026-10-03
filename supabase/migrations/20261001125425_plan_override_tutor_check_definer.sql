-- Tutor overrides have refused every tutor since 20260922104641.
--
-- `plan_override_caller_is_tutor()` was a SECURITY INVOKER SQL function whose
-- body calls `private.has_role`. A SQL function body is parsed when it runs, as
-- the caller, and `authenticated` has no USAGE on schema `private` — so the
-- first line of `remove_plan_point`, `skip_plan_point` and the tutor path of
-- `reorder_student_topics` failed with "permission denied for schema private"
-- before it could answer. (RLS policies that call `private.has_role` are not
-- affected: a policy is stored already parsed, so only EXECUTE is checked.)
--
-- The fix runs the helper as its owner, like `private.has_role` itself. It
-- still asks about `auth.uid()` — the caller's JWT, which SECURITY DEFINER does
-- not change — so it answers only "is the person calling a tutor or admin".
--
-- Idempotent. Rollback: supabase/rollbacks/20261001125425_plan_override_tutor_check_definer.down.sql

create or replace function public.plan_override_caller_is_tutor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select private.has_role(auth.uid(), 'tutor'::app_role)
      or private.has_role(auth.uid(), 'admin'::app_role);
$$;

revoke all on function public.plan_override_caller_is_tutor() from public, anon;
grant execute on function public.plan_override_caller_is_tutor() to authenticated, service_role;
