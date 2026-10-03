-- M-3: one marking run per submission.
--
-- mark-homework stamped ai_marked_at only after the model call, so several
-- calls for the same submission (a double tap, a retry, the student's page and
-- a tutor's re-run) all passed its "already marked?" check, and each paid for
-- an Opus call. The function now claims the submission first, atomically, and
-- only the caller that wins the claim marks it.
--
-- A claim older than ten minutes is treated as a run that crashed, so the work
-- can be marked again; a run that fails cleanly releases its claim at once.
alter table public.homework_submissions
  add column if not exists ai_marking_started_at timestamptz;

comment on column public.homework_submissions.ai_marking_started_at is
  'When mark-homework claimed this submission for marking. Set and cleared only by that function (service role).';

-- True for the one caller that may mark this submission now: it is unmarked,
-- unpublished, and nobody else is marking it (or their claim has gone stale).
create or replace function public.claim_homework_marking(_submission_id uuid)
 returns boolean
 language sql
 volatile security definer
 set search_path to ''
as $function$
  with claimed as (
    update public.homework_submissions
       set ai_marking_started_at = now()
     where id = _submission_id
       and graded_at is null
       and ai_marked_at is null
       and (ai_marking_started_at is null or ai_marking_started_at < now() - interval '10 minutes')
    returning 1
  )
  select exists (select 1 from claimed)
$function$;

revoke all on function public.claim_homework_marking(uuid) from public;
revoke all on function public.claim_homework_marking(uuid) from anon;
revoke all on function public.claim_homework_marking(uuid) from authenticated;
grant execute on function public.claim_homework_marking(uuid) to service_role;
