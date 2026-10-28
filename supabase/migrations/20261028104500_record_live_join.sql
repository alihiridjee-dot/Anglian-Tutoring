-- Live lesson attendance, as parents are shown it (PT-01).
--
-- The parent dashboard shows "Live class attendance N of M", counted by
-- public.student_engagement from session_attendees. Nothing in the app ever
-- wrote a row there (none exist, checked live 28 Oct 2026), so every child
-- would have read "0 of M". And the nightly purge deleted each lesson a week
-- after it ran, and its attendance rows with it (the foreign key cascades), so
-- a count described as "since joining" only ever covered the last week.
--
-- 1. public.record_live_join(_resource_id): every Join button calls it. It
--    files the caller as at the lesson when they are a student who can join
--    it (the same rule public.live_session_join_urls hands the link out by),
--    and only while the lesson is on: from 15 minutes before the start (the
--    Join button shows from 10) until 90 minutes after it, the app's
--    LIVE_TAIL_MS. Pressing Join twice files it once. Anyone else, or a press
--    outside the lesson, gets false and changes nothing.
-- 2. The function is the only way in: a student could file their own
--    attendance directly, so the browser's write privileges and the
--    "attendees self insert" policy go, and a row means a Join pressed during
--    the lesson. Reads are unchanged: the student, a linked parent and tutors.
-- 3. The purge stops, so past lessons and their attendance stay. The app lists
--    a lesson for 8 days after it starts (PAST_SHOWN_MS in liveSessions.ts),
--    as long as the purge left it, so the Live page looks the same. A tutor
--    deleting a lesson still takes its attendance with it.
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
       and now() >= r.starts_at - interval '15 minutes'
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

do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-stale-live-sessions') then
    perform cron.unschedule('purge-stale-live-sessions');
  end if;
end;
$$;
drop function if exists public.purge_stale_live_sessions();
