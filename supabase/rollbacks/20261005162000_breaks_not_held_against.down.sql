-- Rollback for 20261005162000_breaks_not_held_against.sql. Run by hand.
--
-- Puts student_engagement back as 20261003111000 left it: tasks due and
-- sessions held during a break count again.

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
  'list rules (level, board per subject, since enrolling, due date passed). Student, linked parent or tutor.';
