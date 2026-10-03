-- Tutors are never students.
--
-- A tutor or admin account holds no student data at all: no enrolments,
-- learning profile, programme or weekly plans, quiz attempts, homework,
-- subscriptions, parent links, nothing a student's account builds up. The
-- student machinery (the planner, the question generators, the rosters,
-- billing) runs off exactly these rows, so a tutor who held them was half a
-- student. One did: the account was set up as a student, promoted to tutor
-- later, and kept two enrolments, a learning profile and two programme plans
-- until they were removed by hand on 3 Oct 2026.
--
-- "Staff" below is private.is_staff: a tutor or admin row in user_roles, or a
-- profile whose role is 'tutor'.
--
-- Four rules, enforced here so they hold for the app, edge functions, scripts
-- and hand-written SQL alike:
--
-- 1. No student row may name a staff account. Every table holding a student's
--    own data carries the trigger `student_row_not_staff`, given the column(s)
--    that name the student (the list is at the bottom). A new student table
--    goes on that list, and rule 4 checks it from then on with no other change.
-- 2. A tutor's profile has no exam level and no courses, and never keeps a
--    student invite code. The code is cleared rather than refused: it is a
--    lookup key every profile is given at sign-up, not anything the person did.
-- 3. A tutor profile and a tutor grant go together. Granting tutor (or admin)
--    makes the profile follow: role 'tutor', invite code cleared, any 'student'
--    grant dropped. A profile can't claim 'tutor' without the grant or leave it
--    while the grant remains, and a tutor can't also be given 'student'.
-- 4. Becoming staff is refused while the account still holds student data, and
--    the error names the tables. Nothing is ever deleted automatically, so
--    promoting the wrong account by mistake can't wipe a student's history.
--
-- To make a student a tutor: delete their rows in the tables the error names,
-- clear profiles.level and profiles.enrolled_courses, then change their
-- user_roles row from 'student' to 'tutor'. To take tutor access away: delete
-- the tutor row in user_roles, then set profiles.role to what they now are.
--
-- Additive, and safe in either order with the app. The last block refuses to
-- finish if any staff account still holds student data.

create or replace function private.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
           select 1 from public.user_roles r
           where r.user_id = _user_id and r.role in ('tutor', 'admin')
         )
      or exists (
           select 1 from public.profiles p
           where p.id = _user_id and p.role = 'tutor'
         );
$function$;

-- The student tables holding rows that name this account. It reads the list
-- off the triggers themselves, so it can't drift from what rule 1 guards.
create or replace function private.student_rows_held(_user_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  _t record;
  _found boolean;
  _held text[] := '{}';
begin
  for _t in
    select t.tgrelid::regclass as tbl, c.relname, a.col
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    cross join lateral unnest(string_to_array(encode(t.tgargs, 'escape'), E'\\000')) as a(col)
    where t.tgname = 'student_row_not_staff' and a.col <> ''
    order by c.relname, a.col
  loop
    execute format('select exists (select 1 from %s where %I = $1)', _t.tbl, _t.col)
      into _found
      using _user_id;
    if _found then
      _held := _held || (_t.relname || '.' || _t.col);
    end if;
  end loop;
  return _held;
end;
$function$;

-- Rule 1. The trigger's arguments are the columns that name the student.
create or replace function private.refuse_student_row_for_staff()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _row jsonb := to_jsonb(new);
  _col text;
  _id uuid;
begin
  foreach _col in array tg_argv loop
    -- A renamed column would otherwise read as null and wave every row through.
    if not (_row ? _col) then
      raise exception 'student_row_not_staff on % names a missing column %.', tg_table_name, _col;
    end if;
    _id := (_row ->> _col)::uuid;
    if _id is not null and private.is_staff(_id) then
      raise exception 'A tutor account can''t hold student data (%.%).', tg_table_name, _col
        using errcode = '23514',
              hint = 'Tutors and students are separate accounts. See docs/AUTHENTICATION.md.';
    end if;
  end loop;
  return new;
end;
$function$;

-- Rules 2 and 3, on the profile.
create or replace function private.keep_tutor_profile_clean()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _granted boolean := exists (
    select 1 from public.user_roles r
    where r.user_id = new.id and r.role in ('tutor', 'admin')
  );
  _becoming_tutor boolean;
  _held text[];
begin
  if new.role = 'tutor' and not _granted then
    raise exception 'Only an account with the tutor role can have a tutor profile.'
      using errcode = '23514',
            hint = 'Change the account''s user_roles row to tutor; the profile follows.';
  end if;
  if _granted and new.role is distinct from 'tutor' then
    raise exception 'This account has the tutor role, so its profile stays a tutor profile.'
      using errcode = '23514',
            hint = 'Delete the tutor row in user_roles first.';
  end if;

  if new.role = 'tutor' then
    if new.level is not null or cardinality(new.enrolled_courses) > 0 then
      raise exception 'A tutor''s profile can''t have an exam level or courses.'
        using errcode = '23514';
    end if;

    if tg_op = 'INSERT' then
      _becoming_tutor := true;
    else
      _becoming_tutor := old.role is distinct from 'tutor';
    end if;
    if _becoming_tutor then
      _held := private.student_rows_held(new.id);
      if cardinality(_held) > 0 then
        raise exception 'This account still has student data in: %.', array_to_string(_held, ', ')
          using errcode = '23514',
                hint = 'Remove it before making the account a tutor.';
      end if;
    end if;

    new.student_invite_code := null;
  end if;
  return new;
end;
$function$;

-- Rules 3 and 4, on the grant: refuse a tutor grant over student data, and a
-- student grant for a tutor.
create or replace function private.check_staff_grant()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  _held text[];
begin
  if new.role in ('tutor', 'admin') then
    _held := private.student_rows_held(new.user_id);
    if exists (
      select 1 from public.profiles p
      where p.id = new.user_id
        and (p.level is not null or cardinality(p.enrolled_courses) > 0)
    ) then
      _held := _held || 'profiles.level/enrolled_courses'::text;
    end if;
    if cardinality(_held) > 0 then
      raise exception 'This account still has student data in: %.', array_to_string(_held, ', ')
        using errcode = '23514',
              hint = 'Remove it before making the account a tutor.';
    end if;
  elsif new.role = 'student' and private.is_staff(new.user_id) then
    raise exception 'A tutor account can''t also have the student role.'
      using errcode = '23514',
            hint = 'To take tutor access away, delete the tutor row in user_roles, then change profiles.role.';
  end if;
  return new;
end;
$function$;

-- Rule 3: once the grant is in, the profile follows it.
create or replace function private.sync_staff_profile()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.profiles
     set role = 'tutor', student_invite_code = null
   where id = new.user_id
     and (role is distinct from 'tutor' or student_invite_code is not null);
  delete from public.user_roles
   where user_id = new.user_id and role = 'student';
  return null;
end;
$function$;

revoke all on function private.is_staff(uuid) from public, anon, authenticated;
revoke all on function private.student_rows_held(uuid) from public, anon, authenticated;
revoke all on function private.refuse_student_row_for_staff() from public, anon, authenticated;
revoke all on function private.keep_tutor_profile_clean() from public, anon, authenticated;
revoke all on function private.check_staff_grant() from public, anon, authenticated;
revoke all on function private.sync_staff_profile() from public, anon, authenticated;

-- Sorts after t_profiles_invite_code, so a code generated on insert is the one
-- this clears.
drop trigger if exists tutor_profile_not_student on public.profiles;
create trigger tutor_profile_not_student
  before insert or update of role, level, enrolled_courses, student_invite_code on public.profiles
  for each row execute function private.keep_tutor_profile_clean();

drop trigger if exists staff_grant_not_student on public.user_roles;
create trigger staff_grant_not_student
  before insert or update of role, user_id on public.user_roles
  for each row execute function private.check_staff_grant();

drop trigger if exists staff_grant_syncs_profile on public.user_roles;
create trigger staff_grant_syncs_profile
  after insert or update of role, user_id on public.user_roles
  for each row when (new.role in ('tutor', 'admin'))
  execute function private.sync_staff_profile();

-- Rule 1: every table holding a student's own data, with the column(s) that
-- name the student. A row whose column is null is left alone.
do $$
declare
  _t record;
begin
  for _t in
    select * from (values
      ('billing_change_leases',         array['student_id']),
      ('billing_feedback',              array['student_id']),
      ('chat_threads',                  array['student_id', 'about_student_id']),
      ('homework_drafts',               array['student_id']),
      ('homework_submissions',          array['student_id']),
      ('mcq_attempts',                  array['user_id']),
      ('parent_link_invites',           array['student_id']),
      ('parent_student_links',          array['student_id']),
      ('session_attendees',             array['user_id']),
      ('student_enrolments',            array['student_id']),
      ('student_group_members',         array['student_id']),
      ('student_learning_profile',      array['student_id']),
      ('student_plan_overrides',        array['student_id']),
      ('student_program_plan',          array['student_id']),
      ('student_spec_point_confidence', array['student_id']),
      ('student_spec_point_reviews',    array['student_id']),
      ('student_spec_point_schedule',   array['student_id']),
      ('student_term_plans',            array['student_id']),
      ('student_topic_confidence',      array['student_id']),
      ('student_tutor_notes',           array['student_id']),
      ('student_weekly_checkins',       array['student_id']),
      ('student_weekly_plans',          array['student_id']),
      ('student_weekly_tutor_notes',    array['student_id']),
      ('subscriptions',                 array['student_id']),
      ('trial_codes',                   array['student_id'])
    ) as v(tbl, cols)
  loop
    execute format('drop trigger if exists student_row_not_staff on public.%I', _t.tbl);
    execute format(
      'create trigger student_row_not_staff before insert or update of %s on public.%I '
      'for each row execute function private.refuse_student_row_for_staff(%s)',
      (select string_agg(format('%I', c), ', ') from unnest(_t.cols) as c),
      _t.tbl,
      (select string_agg(quote_literal(c), ', ') from unnest(_t.cols) as c)
    );
  end loop;
end;
$$;

-- Bring today's tutors in line: both were given an invite code at sign-up.
update public.profiles
   set student_invite_code = null
 where role = 'tutor' and student_invite_code is not null;

delete from public.user_roles s
 where s.role = 'student'
   and exists (
     select 1 from public.user_roles r
     where r.user_id = s.user_id and r.role in ('tutor', 'admin')
   );

-- Refuse to finish over a staff account that is still half a student.
do $$
declare
  _u record;
  _held text[];
begin
  for _u in
    select r.user_id as id from public.user_roles r where r.role in ('tutor', 'admin')
    union
    select p.id from public.profiles p where p.role = 'tutor'
  loop
    if not exists (
      select 1 from public.user_roles r
      where r.user_id = _u.id and r.role in ('tutor', 'admin')
    ) then
      raise exception 'Profile % is a tutor profile without the tutor role.', _u.id;
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = _u.id
        and (p.role is distinct from 'tutor'
             or p.level is not null
             or cardinality(p.enrolled_courses) > 0
             or p.student_invite_code is not null)
    ) then
      raise exception 'Staff account % has a student profile, level, courses or invite code.', _u.id;
    end if;
    _held := private.student_rows_held(_u.id);
    if cardinality(_held) > 0 then
      raise exception 'Staff account % still has student data in: %.', _u.id, array_to_string(_held, ', ');
    end if;
  end loop;
end;
$$;
