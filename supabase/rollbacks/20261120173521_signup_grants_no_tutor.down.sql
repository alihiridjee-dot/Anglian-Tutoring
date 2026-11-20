-- Rollback for 20261120173521_signup_grants_no_tutor.sql. Run by hand.
--
-- Puts handle_new_user back as it was live on 20 Nov 2026 (md5 of prosrc
-- 514345c3e643c0f7f69584bbc109f04e, the definition in 20261028110000_size_and_flood_limits.sql),
-- including the branch that gives one address the tutor role at sign-up.
-- Same signature, security and search_path, so the grants carry over.

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  meta_role text;
  final_role public.profile_role;
  v_code text := upper(btrim(coalesce(NEW.raw_user_meta_data->>'parent_invite_code', '')));
  v_student uuid;
  v_parent_name text;
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
    -- Clipped to profiles_display_name_length.
    left(coalesce(
      nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ), 80),
    final_role,
    left(NEW.raw_user_meta_data->>'phone', 32)
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor')
    on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student')
    on conflict do nothing;
  end if;

  -- A parent who signs up with their child's invite code is linked by the
  -- rules link_child_by_code uses later on: the code trimmed and upper-cased,
  -- only a student's code counts, a repeat is a no-op, and the child is told,
  -- so an unexpected link is visible rather than silent.
  if final_role = 'parent' and v_code <> '' then
    select p.id into v_student
    from public.profiles p
    where p.student_invite_code = v_code
      and p.role = 'student'::public.profile_role;

    if v_student is not null then
      insert into public.parent_student_links (parent_id, student_id)
      values (NEW.id, v_student)
      on conflict (parent_id, student_id) do nothing;

      select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
        into v_parent_name
      from public.profiles p where p.id = NEW.id;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_student, 'parent_invite', 'Parent linked to your account',
        v_parent_name || ' linked to your account using your invite code.', '/parents'
      );
    end if;
  end if;

  return NEW;
end;
$function$;
