-- Hand-run rollback for 20261001173000_signup_link_rules.sql: handle_new_user
-- as it was live on 1 Oct 2026.

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
