-- Live lesson attendance, as parents are shown it (PT-01).
--
-- The parent dashboard shows "Live class attendance N of M", counted by
-- public.student_engagement from session_attendees. Nothing in the app ever
-- wrote a row there (none exist, checked live 28 Oct 2026), so every child
-- would have read "0 of M".
--
-- 1. public.record_live_join(_resource_id): every Join button calls it. It
--    files the caller as at the lesson when they are a student who can join
--    it (the same rule public.live_session_join_urls hands the link out by),
--    and only around the lesson: from 30 minutes before the start until 90
--    minutes after it, the app's LIVE_TAIL_MS. The Join buttons show from 10
--    minutes before by the device's own clock; the extra 20 cover a clock
--    that runs fast. Pressing Join twice files it once. Anyone else, or a
--    press outside that window, gets false and changes nothing.
-- 2. Attendance is written only through that function, so a row means a Join
--    pressed around the lesson: the browser's own write access to the table
--    goes. Reads are unchanged: the student, a linked parent and tutors.
-- 3. public.student_engagement counts a lesson as held only when a student
--    could have joined it: it has a join link, and it is live (approved, or
--    to review and published), the same two things record_live_join needs.
--    A lesson booked without a link counted as missed for every child, with
--    no way for them to join it. The body is the live one (read 28 Oct 2026,
--    the same as 20261005162000's) with those two checks added.
--
-- The nightly purge stays: a lesson, and its attendance with it, still goes 7
-- days after it ran, as /privacy says.
--
-- The app's Join buttons call the function before this is applied; until then
-- the call fails quietly and the link opens as before. Idempotent.

create or replace function public.record_live_join(_resource_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  if _uid is null or not exists (
    select 1
      from public.resources r
     where r.id = _resource_id
       and r.kind = 'live_session'::public.resource_kind
       and r.join_url is not null
       and r.starts_at is not null
       and now() >= r.starts_at - interval '30 minutes'
       and now() < r.starts_at + interval '90 minutes'
       and exists (
         select 1
           from public.profiles p
           join public.student_enrolments e on e.student_id = p.id and e.subject = r.subject
          where p.id = _uid
            and p.role = 'student'::public.profile_role
            and p.level = r.level
            and (r.board is null or r.board = e.board)
            and (r.subject)::text = any (private.student_paid_subjects(p.id))
            and (
              r.review_status = 'approved'
              or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
            )
       )
  ) then
    return false;
  end if;

  insert into public.session_attendees (resource_id, user_id)
  values (_resource_id, _uid)
  on conflict (resource_id, user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.record_live_join(uuid) from public, anon;
grant execute on function public.record_live_join(uuid) to authenticated;

drop policy if exists "attendees self insert" on public.session_attendees;
revoke insert, update, delete, truncate on public.session_attendees from anon, authenticated;

create or replace function public.student_engagement(_student_id uuid)
returns table (
  sessions_held integer,
  sessions_attended integer,
  homework_set integer,
  homework_submitted integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select 1
     where (select auth.uid()) = _student_id
        or private.has_role((select auth.uid()), 'tutor'::public.app_role)
        or exists (
          select 1
            from public.parent_student_links l
           where l.parent_id = (select auth.uid())
             and l.student_id = _student_id
        )
  ),
  course as (
    select e.subject, e.board, e.created_at as joined, p.level
      from public.student_enrolments e
      join public.profiles p on p.id = e.student_id
     where e.student_id = _student_id
       and exists (select 1 from allowed)
  ),
  sessions as (
    select r.id
      from public.resources r
      join course c on c.subject = r.subject
     where r.kind = 'live_session'
       and (c.level is null or r.level = c.level)
       and (r.board is null or r.board = c.board)
       and r.starts_at >= c.joined
       and r.starts_at < now()
       and r.join_url is not null
       and (
         r.review_status = 'approved'
         or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
       )
       and not exists (
         select 1
           from public.student_breaks b
          where b.student_id = _student_id
            and b.cancelled_at is null
            and (r.starts_at at time zone 'Europe/London')::date between b.starts_on and b.ends_on
       )
  ),
  homework as (
    select r.id
      from public.resources r
      join course c on c.subject = r.subject
     where r.kind = 'homework'
       and r.origin = 'tutor'
       and (c.level is null or r.level = c.level)
       and (r.board is null or r.board = c.board)
       and r.due_at >= c.joined
       and r.due_at < now()
       and not exists (
         select 1
           from public.student_breaks b
          where b.student_id = _student_id
            and b.cancelled_at is null
            and (r.due_at at time zone 'Europe/London')::date between b.starts_on and b.ends_on
       )
       and (
         r.review_status = 'approved'
         or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
       )
  )
  select (select count(*) from sessions)::integer,
         (select count(distinct a.resource_id)
            from public.session_attendees a
           where a.user_id = _student_id
             and a.resource_id in (select id from sessions))::integer,
         (select count(*) from homework)::integer,
         (select count(distinct s.resource_id)
            from public.homework_submissions s
           where s.student_id = _student_id
             and s.resource_id in (select id from homework))::integer
   where exists (select 1 from allowed)
$$;

comment on function public.student_engagement(uuid) is
  'S-24: sessions held/attended and tutor homework set/handed in, counted by the student''s own '
  'list rules (level, board per subject, since enrolling, due date passed), leaving out anything '
  'that fell in a break the student took, and any session that had no join link or was not live. '
  'Student, linked parent or tutor.';
