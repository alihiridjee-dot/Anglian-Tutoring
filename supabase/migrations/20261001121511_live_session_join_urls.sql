-- S-20, first step: hand out live-session join links through a function that
-- checks who is asking.
--
-- resources.join_url is an ordinary column, and "resources read scoped" lets
-- anyone with content access read the whole row: a linked parent, and students
-- of every level and board in that subject. The Parent Portal never selects
-- the link, but a parent could still fetch it straight from the API, and Zoom
-- links can carry the passcode.
--
-- This migration only adds the function. Withdrawing the column is the
-- separate 20261001121512_withhold_live_session_join_urls.sql, applied once the
-- app that reads links through this function is live: the app before it still
-- selects the column, and would break in between.

-- Join links for the given sessions: every link for a tutor, and for a student
-- only the sessions on their own course — their level, a subject their plan
-- pays for, and that subject's exam board (a session with no board is open to
-- every board). A parent, an anonymous caller and a student on another course
-- get nothing. The client applies the same course rule to decide which
-- sessions to list (src/lib/live/liveSessions.ts, sessionsOnCourse).
create or replace function public.live_session_join_urls(_ids uuid[])
 returns table(id uuid, join_url text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select r.id, r.join_url
  from public.resources r
  where r.id = any (_ids)
    and r.kind = 'live_session'::public.resource_kind
    and r.join_url is not null
    and (
      private.has_role((select auth.uid()), 'tutor'::public.app_role)
      or exists (
        select 1
        from public.profiles p
        join public.student_enrolments e on e.student_id = p.id and e.subject = r.subject
        where p.id = (select auth.uid())
          and p.role = 'student'::public.profile_role
          and p.level = r.level
          and (r.board is null or r.board = e.board)
          and (r.subject)::text = any (private.student_paid_subjects(p.id))
          and (
            r.review_status = 'approved'
            or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now()))
          )
      )
    )
$function$;

revoke all on function public.live_session_join_urls(uuid[]) from public;
revoke all on function public.live_session_join_urls(uuid[]) from anon;
grant execute on function public.live_session_join_urls(uuid[]) to authenticated;
