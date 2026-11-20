-- Rollback for 20261120105655_practice_retry_rounds_cap.sql: a failed job is
-- given a fresh round every day again, for as long as its point is on a
-- week. The four bodies are those of 20261005220000_practice_queue.sql and
-- 20261109170711_student_practice_requests.sql exactly (production's before
-- the change); then the column goes. Idempotent.

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
        continue when _job.updated_at >= now() - interval '24 hours';
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
          run_after = now(),
          claim_token = null,
          lease_until = null,
          result_id = null,
          completed_how = null
      -- The same test as above, now under the row's lock.
      where (j.status = 'completed'
             and private.practice_content_id(j.spec_point_id, j.kind, j.requested) is null)
         or (j.status = 'failed' and j.updated_at < now() - interval '24 hours');

    get diagnostics _changed = row_count;
    _total := _total + _changed;
  end loop;

  return _total;
end;
$function$;

revoke all on function private.enqueue_practice(uuid, text) from public, anon, authenticated;

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
  if _job.status = 'failed' and _job.updated_at >= now() - interval '24 hours' then
    return 'failed';
  end if;
  return 'missing';
end;
$function$;

revoke all on function private.practice_state(uuid, text) from public, anon, authenticated;

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
         set status = 'pending', attempts = 0, run_after = now(),
             claim_token = null, lease_until = null, result_id = null, completed_how = null
       where j.id = _job.id;
    elsif _rearm and _job.status = 'pending' then
      update private.practice_jobs j
         set run_after = now()
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
     set status = 'pending', attempts = 0, run_after = now()
   where j.status = 'failed'
     and (_spec_point_ids is null or j.spec_point_id = any (_spec_point_ids));
  get diagnostics _count = row_count;
  return _count;
end;
$function$;

revoke all on function public.rearm_failed_practice_jobs(uuid[]) from public, anon, authenticated;
grant execute on function public.rearm_failed_practice_jobs(uuid[]) to service_role;

alter table private.practice_jobs drop column if exists rounds;
