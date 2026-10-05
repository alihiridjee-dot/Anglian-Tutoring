-- Breaks don't count against the student (PR 3 of the break work).
--
-- Ali's rule (4 Oct 2026): while a student is on a break, nothing in those
-- weeks counts as missed. The parent's and tutor's "handed in" and "attended"
-- figures (student_engagement, 20261003111000) counted a task due during a
-- break, and a live session held during one, as set but not done. Now
-- neither counts at all: a task due in a break that is handed in anyway isn't
-- counted as handed in either, so the figures can't pass their totals.
--
-- A day is in a break when its UK date falls from the break's Monday to its
-- Sunday, the same rule the planner uses. A called-off break never counts.
--
-- The body below is 20261003111000's, with the two "not in a break" checks
-- added. Additive and idempotent.

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
  'that fell in a break the student took. Student, linked parent or tutor.';
