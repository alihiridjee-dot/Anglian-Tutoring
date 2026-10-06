-- The practice queue's two writes to its one settings row had no WHERE
-- clause. Supabase runs every API request with pg-safeupdate, which refuses an
-- UPDATE or DELETE without one, even inside a function. So in production
-- fail_practice_job and pause_practice_queue both failed with "UPDATE requires
-- a WHERE clause" (6 Oct 2026: the worker's first three jobs couldn't record
-- why they failed, and stayed claimed). They worked from the SQL editor and in
-- every test, where pg-safeupdate isn't loaded.
--
-- The settings table has exactly one row, keyed by `id = true`, so `where q.id`
-- picks it. Nothing else changes. The bodies are otherwise those of
-- 20261005220000_practice_queue.sql.
--
-- Idempotent. No rollback of its own: going back would bring the failure back.
-- supabase/rollbacks/20261005220000_practice_queue.down.sql removes the queue.

create or replace function public.fail_practice_job(
  _job_id bigint,
  _claim_token uuid,
  _error text,
  _failure text,
  _pause_minutes integer default 0,
  _run_id uuid default null
)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _job private.practice_jobs%rowtype;
  _max_attempts integer;
  _paused_until timestamptz;
begin
  if _failure is null or _failure not in ('retry', 'give_up', 'outage') then
    raise exception 'Unknown failure kind: %', _failure using errcode = '22023';
  end if;

  update public.exam_generation_runs r
     set outcome = 'failed', error = coalesce(left(_error, 2000), 'Save failed')
   where r.id = _run_id and r.job_id = _job_id and r.outcome = 'passed';

  select * into _job from private.practice_jobs j where j.id = _job_id for update;
  if not found or _job.status <> 'generating' or _job.claim_token is distinct from _claim_token then
    return 'lost_claim';
  end if;

  if _failure = 'outage' then
    update private.practice_queue q
       set paused_until = greatest(
             coalesce(q.paused_until, now()),
             now() + make_interval(mins => greatest(_pause_minutes, 1))
           ),
           pause_reason = left(_error, 500)
     where q.id
    returning q.paused_until into _paused_until;

    update private.practice_jobs j
       set status = 'pending', attempts = greatest(j.attempts - 1, 0), run_after = _paused_until,
           claim_token = null, lease_until = null, last_error = left(_error, 2000)
     where j.id = _job.id;
    return 'pending';
  end if;

  select q.max_attempts into _max_attempts from private.practice_queue q;
  if _failure = 'give_up' or _job.attempts >= _max_attempts then
    update private.practice_jobs j
       set status = 'failed', claim_token = null, lease_until = null,
           last_error = left(_error, 2000)
     where j.id = _job.id;
    return 'failed';
  end if;

  update private.practice_jobs j
     set status = 'pending',
         run_after = now() + make_interval(mins => least(120, 10 * 2 ^ (j.attempts - 1))::integer),
         claim_token = null, lease_until = null, last_error = left(_error, 2000)
   where j.id = _job.id;
  return 'pending';
end;
$function$;

revoke all on function public.fail_practice_job(bigint, uuid, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.fail_practice_job(bigint, uuid, text, text, integer, uuid) to service_role;

create or replace function public.pause_practice_queue(_minutes integer, _reason text default null)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _was_until timestamptz;
  _until timestamptz;
begin
  if _minutes is null or _minutes < 0 then
    raise exception 'Pause for a number of minutes, or 0 to resume' using errcode = '22023';
  end if;

  if _minutes = 0 then
    -- Locked first, so an outage can't set a new pause in between.
    select q.paused_until into _was_until from private.practice_queue q for update;
    update private.practice_jobs j
       set run_after = now()
     where j.status = 'pending' and j.run_after > now() and j.run_after <= _was_until;
  end if;

  update private.practice_queue q
     set paused_until = case when _minutes > 0 then now() + make_interval(mins => _minutes) end,
         pause_reason = case when _minutes > 0 then left(_reason, 500) end
   where q.id
  returning q.paused_until into _until;
  return _until;
end;
$function$;

revoke all on function public.pause_practice_queue(integer, text) from public, anon, authenticated;
grant execute on function public.pause_practice_queue(integer, text) to service_role;
