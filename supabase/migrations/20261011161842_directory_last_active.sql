-- "Last active" on the tutor's Students page read auth.users.last_sign_in_at,
-- which only moves when a student signs in again. Students stay signed in for
-- weeks, so one who hands in work every day still showed the day they last
-- typed a password (Finley, 11 Oct: signed in 1 Oct, handed in two tasks on
-- 10 Oct, shown as "1 week ago").
--
-- last_active_at is the latest thing the student did themselves:
--   · signed in
--   · had the app open (the session refreshes about hourly in an open tab)
--   · handed in a task, saved a task draft, took a quiz, sent a message
-- Nothing a tutor or a background job writes counts. last_sign_in_at stays as
-- it was, so an app still reading it keeps working while this rolls out.
--
-- Adding a column changes the return type, which `create or replace` cannot
-- do, so the function is dropped and recreated (with its grants) in one go.

drop function if exists public.tutor_student_directory();

create function public.tutor_student_directory()
returns table (
  id                      uuid,
  email                   text,
  display_name            text,
  level                   public.level,
  school                  text,
  student_invite_code     text,
  created_at              timestamptz,
  last_sign_in_at         timestamptz,
  onboarding_completed_at timestamptz,
  last_active_at          timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role)
  ) then
    raise exception 'Tutor access required' using errcode = '42501';
  end if;

  return query
    select p.id, u.email::text, p.display_name, p.level, p.school,
           p.student_invite_code, p.created_at, u.last_sign_in_at,
           p.onboarding_completed_at,
           -- greatest() skips nulls: a student who has never taken a quiz
           -- still gets their latest hand-in.
           greatest(
             u.last_sign_in_at,
             (select max(s.updated_at) from auth.sessions s where s.user_id = p.id),
             (select max(h.submitted_at) from public.homework_submissions h where h.student_id = p.id),
             (select max(d.updated_at) from public.homework_drafts d where d.student_id = p.id),
             (select max(a.created_at) from public.mcq_attempts a where a.user_id = p.id),
             (select max(m.created_at) from public.chat_messages m where m.sender_id = p.id)
           )
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'student'::public.profile_role
    order by coalesce(nullif(btrim(p.display_name), ''), u.email);
end;
$$;

revoke all on function public.tutor_student_directory() from public, anon;
grant execute on function public.tutor_student_directory() to authenticated, service_role;
