-- Signing up again with an email address that was never verified.
--
-- GoTrue keeps the first attempt's account as it was and only sends a new
-- code, and handle_new_user runs once, on that first insert. So the profile's
-- role and any invite-code link come from the first attempt.
-- Once the code is accepted, the app calls this with the role on the form that
-- sent the code (src/lib/auth/settleSignUp.ts); the password and the name it
-- puts right itself.
--
-- Narrow, like claim_parent_role: an email account whose address was confirmed
-- in the last 15 minutes and that has done nothing yet. An email account
-- cannot sign in at all before it is confirmed, so this is still the moment of
-- sign-up. It moves only between student and parent. It never grants tutor or
-- admin, and never touches an account with a staff grant.

create or replace function public.settle_sign_up_role(_role text, _invite_code text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_want text := lower(btrim(coalesce(_role, '')));
  v_code text := upper(btrim(coalesce(_invite_code, '')));
  v_role public.profile_role;
  v_provider text;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if v_want not in ('student', 'parent') then
    raise exception 'The role must be student or parent' using errcode = '22023';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role is null
     or v_role not in ('student'::public.profile_role, 'parent'::public.profile_role) then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  select u.raw_app_meta_data->>'provider', u.email_confirmed_at
    into v_provider, v_confirmed
  from auth.users u
  where u.id = v_uid;

  -- Google and Microsoft sign-ups have claim_parent_role. Anything with
  -- history (set up, enrolled, paying, a parent's child, or staff) is left
  -- exactly as it is.
  if v_provider is distinct from 'email'
     or v_confirmed is null
     or v_confirmed < now() - interval '15 minutes'
     or exists (
       select 1 from public.profiles p
       where p.id = v_uid and p.onboarding_completed_at is not null
     )
     or exists (select 1 from public.student_enrolments e where e.student_id = v_uid)
     or exists (
       select 1 from public.subscriptions s
       where s.user_id = v_uid or s.student_id = v_uid
     )
     or exists (select 1 from public.parent_student_links l where l.student_id = v_uid)
     or exists (
       select 1 from public.user_roles r
       where r.user_id = v_uid and r.role in ('tutor', 'admin')
     )
  then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  -- Links an earlier attempt made as a parent, except to the child whose code
  -- is on the form now. Each one removed gives that child a new invite code
  -- (psl_rotate_invite_code), as any unlink does. Linking the code on the form
  -- is left to link_child_by_code, with its rate limit.
  delete from public.parent_student_links l
   where l.parent_id = v_uid
     and (
       v_want = 'student'
       or v_code = ''
       or not exists (
         select 1 from public.profiles s
         where s.id = l.student_id and s.student_invite_code = v_code
       )
     );

  update public.profiles
     set role = v_want::public.profile_role
   where id = v_uid
     and role is distinct from v_want::public.profile_role;

  return jsonb_build_object('status', 'settled', 'role', v_want);
end;
$function$;

revoke all on function public.settle_sign_up_role(text, text) from public, anon;
grant execute on function public.settle_sign_up_role(text, text) to authenticated;
