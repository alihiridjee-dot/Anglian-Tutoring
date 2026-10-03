-- S-24: engagement counts only what was the child's.
--
-- The Parent Portal's and the tutor's Performance tab's "handed in" and
-- "attended" figures were counted in the browser. Homework counted every brief
-- a tutor ever set at the child's level in their subjects: from before they
-- joined, for other exam boards, and not yet due. A child who joined in October
-- read "0 of 12 set homeworks handed in", including sheets they never saw.
-- Sessions had no board filter. And because resources sits behind the paywall,
-- a paused or lapsed child's counts all fell to nothing (S-23).
--
-- student_engagement counts with the child's own list rules, per enrolment:
--   - their level (a student with no level yet isn't filtered by one, as on
--     their own pages);
--   - that subject's board, or no board (open to every board);
--   - since they took that subject up (student_enrolments.created_at, as the
--     homework page decides "due before you joined", M-23);
--   - homework: set by a tutor, visible to students, and its due date passed;
--   - sessions: already started.
-- Handed in and attended are counted against those same briefs and sessions,
-- once each, so they can't pass the totals.
--
-- SECURITY DEFINER, checking the caller itself: the student, a linked parent
-- or a tutor. Anyone else gets no row. It returns four numbers and nothing
-- else.
--
-- Additive and idempotent; apply before merging the app that calls it.

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

revoke all on function public.student_engagement(uuid) from public, anon;
grant execute on function public.student_engagement(uuid) to authenticated;

comment on function public.student_engagement(uuid) is
  'S-24: sessions held/attended and tutor homework set/handed in, counted by the student''s own '
  'list rules (level, board per subject, since enrolling, due date passed). Student, linked parent or tutor.';
