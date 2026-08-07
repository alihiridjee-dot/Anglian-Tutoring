-- Sign-up metadata must never be able to hand out a staff role.
--
-- `handle_new_user` read `raw_user_meta_data->>'role'` and, if it said "tutor",
-- inserted a `tutor` row into `user_roles`. That column is not ours: it is the
-- `options.data` bag of `supabase.auth.signUp()`, which any anonymous visitor
-- controls completely. A single request —
--
--   signUp({ email, password, options: { data: { role: 'tutor' } } })
--
-- — therefore minted a real tutor, and `private.has_role(uid,'tutor')` is the
-- predicate behind almost every policy in the schema: read every profile (names,
-- phone numbers, schools, invite codes), every homework submission and its
-- files, every chat thread between a student and their tutor, every quiz
-- attempt, every lead, plus write access to curriculum and to
-- `parent_student_links`. In other words, the whole platform's data about
-- children, from the public sign-up form.
--
-- The role a visitor claims at sign-up is now only ever a *profile* role, and
-- only 'student' or 'parent'. `user_roles` — the table the policies actually
-- consult — is never written from metadata again. Staff access is granted
-- out of band, deliberately, by someone who already has it.
--
-- The one exception is the bootstrap address, kept so the project is not left
-- with no way to create its first tutor. It is safe for the same reason it
-- always was: that account already exists and is confirmed, so the unique
-- constraint on auth.users.email means this branch can no longer be reached by
-- anyone signing up.

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
    coalesce(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
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
