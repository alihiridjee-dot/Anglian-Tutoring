-- S-23: a lapsed family still sees their child's marked work.
--
-- The Parent Portal, the student's dashboard and the tutor's Performance tab
-- read each quiz attempt's subject through mcq_sets and each submission's
-- through resources. Both sit behind the paywall: a parent sees them only while
-- the child's own plan is live. When a plan is paused, past due or cancelled,
-- the attempts and submissions still load, but their subjects come back empty,
-- so every piece of work was dropped and each subject said "No marked work
-- yet". The paywall migration promised that a lapsed student keeps their
-- history.
--
-- student_scored_work returns the child's own scored work, one row per quiz
-- attempt and per marked homework: its subject, its percentage and when it was
-- scored, plus a homework's title for the feedback list. A quiz with no
-- questions (total 0) has no percentage: pct is null. Nothing else: no
-- questions, answers, mark schemes or content.
--
-- SECURITY DEFINER so it reads past the paywall, and so it checks the caller
-- itself: the student, a linked parent or a tutor. Anyone else gets no rows.
-- Each kind returns its newest 500, newest first; _since narrows to a window.
--
-- Additive and idempotent; apply before or after the app that calls it (the
-- app now live doesn't).

create or replace function public.student_scored_work(
  _student_id uuid,
  _since timestamptz default null
)
returns table (
  kind text,
  item_id uuid,
  subject public.subject,
  pct numeric,
  scored_at timestamptz,
  title text
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
  )
  (
    select 'quiz'::text,
           a.id,
           s.subject,
           case when a.total > 0 then a.score::numeric * 100 / a.total end,
           a.created_at,
           null::text
      from public.mcq_attempts a
      join public.mcq_sets s on s.id = a.set_id
     where a.user_id = _student_id
       and exists (select 1 from allowed)
       and (_since is null or a.created_at >= _since)
     order by a.created_at desc
     limit 500
  )
  union all
  (
    select 'homework'::text,
           h.id,
           r.subject,
           h.score_pct,
           coalesce(h.graded_at, h.submitted_at),
           r.title
      from public.homework_submissions h
      join public.resources r on r.id = h.resource_id
     where h.student_id = _student_id
       and h.score_pct is not null
       and exists (select 1 from allowed)
       and (_since is null or coalesce(h.graded_at, h.submitted_at) >= _since)
     order by h.graded_at desc nulls last
     limit 500
  )
$$;

revoke all on function public.student_scored_work(uuid, timestamptz) from public, anon;
grant execute on function public.student_scored_work(uuid, timestamptz) to authenticated;

comment on function public.student_scored_work(uuid, timestamptz) is
  'S-23: a student''s scored quizzes and marked homework (subject, %, date, homework title), '
  'for the student, a linked parent or a tutor, whether or not the plan is live.';
