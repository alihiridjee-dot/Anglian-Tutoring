-- Sign up with Google or Microsoft.
--
-- An SSO sign-up arrives with whatever the provider sends as metadata, which
-- never includes the role picked on our form or a display name of ours. Two
-- consequences, two fixes:
--
--   1. handle_new_user fell back to the email prefix for the display name.
--      Providers do send the person's name (`full_name` / `name`), so use it.
--      This is the same data the email form asks for as "Full name".
--
--   2. Every SSO account is created as a student (handle_new_user's default).
--      A parent who picked "Parent" and then "Continue with Google" needs a way
--      to become one. claim_parent_role() is that way, and it is deliberately
--      narrow: an SSO account, created minutes ago, that has done nothing as a
--      student. It moves student → parent only; it can never grant tutor or
--      admin, which are only ever granted out of band in user_roles.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  meta_role text;
  final_role public.profile_role;
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));

  -- Self-declared identity, and nothing more. 'tutor' is deliberately absent:
  -- an unrecognised value falls back to 'student' rather than being honoured.
  final_role := case
    when meta_role in ('student', 'parent') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;

  insert into public.profiles (id, display_name, role, phone)
  values (
    NEW.id,
    -- Our form's name first, then the name a Google / Microsoft sign-up brings.
    coalesce(
      nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    final_role,
    NEW.raw_user_meta_data->>'phone'
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor')
    on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student')
    on conflict do nothing;
  end if;

  if final_role = 'parent' and NEW.raw_user_meta_data->>'parent_invite_code' is not null then
    insert into public.parent_student_links (parent_id, student_id)
    select NEW.id, p.id from public.profiles p
    where p.student_invite_code = upper(NEW.raw_user_meta_data->>'parent_invite_code');
  end if;

  return NEW;
end;
$function$;

create or replace function public.claim_parent_role()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_provider text;
  v_created timestamptz;
  v_role public.profile_role;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_uid;
  if v_role = 'parent'::public.profile_role then
    return jsonb_build_object('status', 'already_parent');
  end if;
  if v_role is distinct from 'student'::public.profile_role then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  select u.raw_app_meta_data->>'provider', u.created_at
    into v_provider, v_created
  from auth.users u
  where u.id = v_uid;

  -- Email sign-ups choose their role on the form, and the trigger honours it.
  -- Only an account that came in through a provider arrives without one.
  if v_provider is null or v_provider = 'email' then
    return jsonb_build_object('status', 'not_eligible');
  end if;

  -- A brand-new, untouched account only. A student with any history — set up,
  -- enrolled, paying, linked to a parent, or holding a staff grant — stays a
  -- student whatever this is called with.
  if v_created < now() - interval '30 minutes'
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

  update public.profiles set role = 'parent' where id = v_uid;
  return jsonb_build_object('status', 'claimed');
end;
$function$;

revoke all on function public.claim_parent_role() from public, anon;
grant execute on function public.claim_parent_role() to authenticated;
