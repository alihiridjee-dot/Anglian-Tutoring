-- A student's level stays put while their plan is live.
--
-- Audit finding M2 (18 Nov 2026). Checkout prices a plan by profiles.level
-- alone (stripe-checkout), A-level costs more than GCSE, and authenticated
-- may update that column on its own row (the 20260806232240 column grants).
-- So a paying A-level student could set their own level to GCSE, and the
-- next checkout or plan change would charge the GCSE price.
--
-- No screen lets a student with a live plan change their level. Onboarding's
-- first step saves it, but onboarding is closed to a student who has finished
-- it and has access, and paying is its last step. The profile page leaves the
-- level with the tutor (tutor_set_student_level). This trigger makes the
-- database say the same.
--
-- Refused: a real change of value, made by the row's own user, who is not
-- staff, while that student has a subscription that is active or trialing.
-- subscriptions.student_id names the student, so a plan a parent pays for
-- counts. The function is a definer because a student cannot read that row.
--
-- Let through: the same level saved again (onboarding's first step does
-- that), staff (tutor_set_student_level runs as the tutor), the service role
-- and the database owner (no auth.uid()), and a student with no live plan
-- (still onboarding, or a plan that lapsed: the next checkout prices the
-- level they chose).
--
-- Idempotent. Nothing else changes: no grant, no other trigger.
--
-- Rollback: supabase/rollbacks/20261120000319_level_set_by_plan.down.sql

create or replace function private.keep_level_while_plan_live()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.level is distinct from old.level
     and auth.uid() is not null
     and auth.uid() = new.id
     and not private.is_staff(auth.uid())
     and exists (
       select 1 from public.subscriptions s
       where s.student_id = new.id
         and s.status in ('active', 'trialing')
     ) then
    raise exception 'Your level is set by your plan. Message your tutor to change it.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function private.keep_level_while_plan_live() from public, anon, authenticated;

drop trigger if exists level_set_by_plan on public.profiles;
create trigger level_set_by_plan
  before update of level on public.profiles
  for each row execute function private.keep_level_while_plan_live();
