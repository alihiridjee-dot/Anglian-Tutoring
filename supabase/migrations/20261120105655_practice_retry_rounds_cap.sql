-- A job that keeps failing stops being given fresh rounds on its own.
--
-- Audit finding L8 (18 Nov 2026). private.enqueue_practice gave a failed job
-- a fresh round (attempts back to 0) once it had failed more than a day ago,
-- every day, for as long as its point was on someone's week. A point the
-- model can never write cost up to three calls a day for ever.
--
-- Now a failed job gets three fresh rounds on its own, then waits for a
-- person:
--
--   practice_jobs.rounds         fresh rounds a failed job has had on its own
--                                since it was queued or last set going by hand
--   enqueue_practice             gives a failed job another round only while
--                                rounds < 3, and counts it
--   practice_state               a job that has had its three rounds reads
--                                'failed' at any age, as enqueue_practice now
--                                won't take it: a student is not offered a
--                                Request that would queue nothing
--   request_practice_job         a tutor's press (_rearm) sets rounds to 0
--   rearm_failed_practice_jobs   (practice-queue.ts retry-failed) sets it to 0
--
-- A student's request goes through enqueue_practice, so it follows the same
-- rule. claim_practice_jobs, practice_queue_status and
-- request_practice_for_point are not touched: PR #376 holds their live
-- definitions.
--
-- The bodies are otherwise those of 20261005220000_practice_queue.sql
-- (enqueue_practice, request_practice_job, rearm_failed_practice_jobs) and
-- 20261109170711_student_practice_requests.sql (practice_state), which are
-- production's on 20 Nov 2026. Signatures, security and grants unchanged.
--
-- Idempotent. Rollback: supabase/rollbacks/20261120105655_practice_retry_rounds_cap.down.sql

alter table private.practice_jobs add column if not exists rounds integer not null default 0;

comment on column private.practice_jobs.rounds is
  'Fresh rounds a failed job has had on its own (private.enqueue_practice, at most 3) since it was queued or last set going by hand.';

-- Make sure a spec point has its jobs, and bring a job that needs it up to
-- date. With _kind null, both the quiz and the task. A job gets another go
-- when
--   * it was completed, but its content has since been removed (only its own
--     content counts, for a job a tutor asked for)
--   * it failed more than a day ago and has had fewer than three such rounds:
--     one fresh round a day while the point is in someone's week, three times
-- A job being generated is never touched. Returns how many jobs it created or
-- gave another go.
--
-- Most calls find every job there and in order. Those are left without a
-- write or a lock, so two students saving the same points at once can't
-- deadlock on them. Only a missing job, or one that may need another go,
-- takes the insert below, which decides again under the row's lock.
create or replace function private.enqueue_practice(_spec_point_id uuid, _kind text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _k text;
  _job private.practice_jobs%rowtype;
  _content uuid;
  _changed integer;
  _total integer := 0;
begin
  if not exists (select 1 from public.spec_points sp where sp.id = _spec_point_id) then
    raise exception 'Unknown spec point';
  end if;
  if _kind is not null and _kind not in ('quiz', 'task') then
    raise exception 'Unknown practice kind: %', _kind using errcode = '22023';
  end if;

  foreach _k in array case when _kind is null then array['quiz', 'task'] else array[_kind] end
  loop
    select * into _job
    from private.practice_jobs j
    where j.spec_point_id = _spec_point_id and j.kind = _k;
    if found then
      if _job.status = 'completed' then
        continue when private.practice_content_id(_spec_point_id, _k, _job.requested) is not null;
      elsif _job.status = 'failed' then
        continue when _job.updated_at >= now() - interval '24 hours' or _job.rounds >= 3;
      else
        continue; -- pending or generating: nothing to do
      end if;
    end if;

    -- For a new job, which nobody has asked for yet.
    _content := private.practice_content_id(_spec_point_id, _k);

    insert into private.practice_jobs as j (spec_point_id, kind, status, result_id, completed_how)
    values (
      _spec_point_id,
      _k,
      case when _content is null then 'pending' else 'completed' end,
      _content,
      case when _content is null then null else 'already_existed' end
    )
    on conflict (spec_point_id, kind) do update
      set status = 'pending',
          attempts = 0,
          rounds = case when j.status = 'failed' then j.rounds + 1 else j.rounds end,
          run_after = now(),
          claim_token = null,
          lease_until = null,
          result_id = null,
          completed_how = null
      -- The same test as above, now under the row's lock.
      where (j.status = 'completed'
             and private.practice_content_id(j.spec_point_id, j.kind, j.requested) is null)
         or (j.status = 'failed' and j.updated_at < now() - interval '24 hours'
             and j.rounds < 3);

    get diagnostics _changed = row_count;
    _total := _total + _changed;
  end loop;

  return _total;
end;
$function$;

revoke all on function private.enqueue_practice(uuid, text) from public, anon, authenticated;

-- ready    the point has it (private.practice_content_id: the one answer the
--          queue itself uses, so "ready" here is never paid for again).
-- writing  its job is waiting or being written.
-- failed   its job gave up in the last 24 hours, or has had its three fresh
--          rounds. The queue won't take it again (private.enqueue_practice),
--          so neither does a request.
-- missing  none of these: a request would queue it.
--
-- Volatile, like practice_content_id: each look must see what is saved by then.
create or replace function private.practice_state(_spec_point_id uuid, _kind text)
 returns text
 language plpgsql
 volatile
 security definer
 set search_path to ''
as $function$
declare
  _job private.practice_jobs%rowtype;
begin
  if private.practice_content_id(_spec_point_id, _kind) is not null then
    return 'ready';
  end if;

  select * into _job
  from private.practice_jobs j
  where j.spec_point_id = _spec_point_id and j.kind = _kind;
  if not found then
    return 'missing';
  end if;
  if _job.status in ('pending', 'generating') then
    return 'writing';
  end if;
  if _job.status = 'failed'
     and (_job.updated_at >= now() - interval '24 hours' or _job.rounds >= 3) then
    return 'failed';
  end if;
  return 'missing';
end;
$function$;

revoke all on function private.practice_state(uuid, text) from public, anon, authenticated;

-- The tutor's "AI generate MCQs" button, through the server. Makes sure the
-- point has this one job (never the other kind's), then brings it up to date.
--
-- A press (_rearm) records that the tutor wants the point's own AI quiz or
-- task. From then on only that counts: a quiz of their own no longer does,
-- so the AI one is written alongside it. A job being generated is left alone
-- apart from noting the press: a worker has it. Otherwise content already
-- there completes the job, pointing at it (written stays written). With
-- _rearm, a job without its content gets a fresh round (a failed one, or one
-- completed against a tutor's quiz), and a waiting one is due now rather than
-- after its retry delay. Either way the press gives it its three rounds on
-- its own again. Returns the job.
create or replace function public.request_practice_job(
  _spec_point_id uuid,
  _kind text,
  _rearm boolean default false
)
 returns table(job_id bigint, status text, result_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _job private.practice_jobs%rowtype;
  _content uuid;
begin
  if _kind is null or _kind not in ('quiz', 'task') then
    raise exception 'Unknown practice kind: %', _kind using errcode = '22023';
  end if;

  perform private.enqueue_practice(_spec_point_id, _kind);

  select * into _job
  from private.practice_jobs j
  where j.spec_point_id = _spec_point_id and j.kind = _kind
  for update;

  if _rearm and not _job.requested then
    update private.practice_jobs j
       set requested = true
     where j.id = _job.id;
    _job.requested := true;
  end if;

  if _job.status <> 'generating' then
    _content := private.practice_content_id(_spec_point_id, _kind, _job.requested);
    if _content is not null then
      -- Point it there, unless it already does: a job that wrote its own set
      -- stays written. (A job not yet completed points nowhere.)
      if _job.result_id is distinct from _content then
        update private.practice_jobs j
           set status = 'completed', result_id = _content, completed_how = 'already_existed',
               last_error = null
         where j.id = _job.id;
      end if;
    elsif _rearm and _job.status in ('completed', 'failed') then
      update private.practice_jobs j
         set status = 'pending', attempts = 0, rounds = 0, run_after = now(),
             claim_token = null, lease_until = null, result_id = null, completed_how = null
       where j.id = _job.id;
    elsif _rearm and _job.status = 'pending' then
      update private.practice_jobs j
         set run_after = now(), rounds = 0
       where j.id = _job.id;
    end if;
  end if;

  return query
    select j.id, j.status, j.result_id
    from private.practice_jobs j
    where j.id = _job.id;
end;
$function$;

revoke all on function public.request_practice_job(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.request_practice_job(uuid, text, boolean) to service_role;

-- Give failed jobs a fresh round now: all of them, or those for the points
-- named, each with its three rounds on its own again. Returns how many.
create or replace function public.rearm_failed_practice_jobs(_spec_point_ids uuid[] default null)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _count integer;
begin
  update private.practice_jobs j
     set status = 'pending', attempts = 0, rounds = 0, run_after = now()
   where j.status = 'failed'
     and (_spec_point_ids is null or j.spec_point_id = any (_spec_point_ids));
  get diagnostics _count = row_count;
  return _count;
end;
$function$;

revoke all on function public.rearm_failed_practice_jobs(uuid[]) from public, anon, authenticated;
grant execute on function public.rearm_failed_practice_jobs(uuid[]) to service_role;
