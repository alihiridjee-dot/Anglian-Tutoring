-- Undo 20261116200000_practice_requests_first: the queue goes back to
-- longest-due first, and requests stop marking jobs. The bodies are the ones
-- 20261005220000 and 20261109170711 made live.

create or replace function public.request_practice_for_point(_spec_point_id uuid)
 returns table(kind text, state text, requests_left integer)
 language plpgsql
 volatile
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _limit integer := private.practice_request_daily_limit();
  _used integer;
  _k text;
  _changed integer;
  _queued integer := 0;
begin
  if _uid is null then
    raise exception 'Not signed in';
  end if;
  if not private.can_request_practice(_uid, _spec_point_id) then
    raise exception 'You can only ask for practice on your own course'
      using errcode = '42501';
  end if;

  -- One request at a time per student, so two quick clicks can't both see
  -- the last free request. Released at commit.
  perform pg_advisory_xact_lock(hashtextextended('request_practice_for_point:' || _uid, 0));
  _used := private.practice_requests_used_today(_uid);

  foreach _k in array array['quiz', 'task']
  loop
    continue when private.practice_state(_spec_point_id, _k) <> 'missing';
    exit when _used >= _limit;
    -- Counted only when this call queued it. If another student's request
    -- (or this week's plan) got there first, it is theirs, and free here.
    -- Two statements: one statement's subquery can't see the job its own
    -- call to enqueue_practice has just written.
    _changed := private.enqueue_practice(_spec_point_id, _k);
    if _changed > 0
       and exists (
         select 1 from private.practice_jobs j
         where j.spec_point_id = _spec_point_id and j.kind = _k and j.status = 'pending'
       ) then
      insert into public.ai_request_log (user_id, endpoint) values (_uid, 'practice_request');
      _used := _used + 1;
      _queued := _queued + 1;
    end if;
  end loop;

  -- The minute job would wake it anyway. This only saves the wait, so it can
  -- never undo the request.
  if _queued > 0 then
    begin
      perform private.kick_practice_worker();
    exception when others then
      raise warning 'practice request: could not wake the worker: %', sqlerrm;
    end;
  end if;

  return query
    select k.name, private.practice_state(_spec_point_id, k.name), greatest(_limit - _used, 0)
    from unnest(array['quiz', 'task']) with ordinality as k(name, ord)
    order by k.ord;
end;
$function$;

revoke all on function public.request_practice_for_point(uuid) from public, anon;
grant execute on function public.request_practice_for_point(uuid) to authenticated;

create or replace function public.claim_practice_jobs(
  _limit integer default 1,
  _spec_point_id uuid default null,
  _kind text default null
)
 returns table(job_id bigint, claim_token uuid, spec_point_id uuid, kind text, attempt integer)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _queue private.practice_queue%rowtype;
  _budget integer;
  _job private.practice_jobs%rowtype;
  _content uuid;
begin
  select * into _queue from private.practice_queue q for update;
  if not found then
    -- Never claim without limits.
    raise exception 'The practice queue has no settings row';
  end if;
  if _queue.paused_until > now() then
    return;
  end if;

  -- _limit, kept to 1..10, and no more than the limits allow.
  _budget := least(least(greatest(coalesce(_limit, 1), 1), 10), private.practice_call_budget());

  while _budget > 0 loop
    select * into _job
    from private.practice_jobs j
    where ((j.status = 'pending' and j.run_after <= now())
           or (j.status = 'generating' and j.lease_until <= now()))
      and (_spec_point_id is null or j.spec_point_id = _spec_point_id)
      and (_kind is null or j.kind = _kind)
    order by j.run_after, j.id
    limit 1
    for update skip locked;
    exit when not found;

    _content := private.practice_content_id(_job.spec_point_id, _job.kind, _job.requested);
    if _content is not null then
      update private.practice_jobs j
         set status = 'completed', result_id = _content, completed_how = 'already_existed',
             claim_token = null, lease_until = null, last_error = null
       where j.id = _job.id;
    elsif _job.attempts >= _queue.max_attempts then
      update private.practice_jobs j
         set status = 'failed', claim_token = null, lease_until = null,
             last_error = 'Gave up after ' || _job.attempts || ' attempts: '
                          || coalesce(_job.last_error, 'the worker stopped before finishing')
       where j.id = _job.id;
    else
      update private.practice_jobs j
         set status = 'generating',
             attempts = j.attempts + 1,
             claim_token = gen_random_uuid(),
             lease_until = now() + make_interval(secs => _queue.lease_seconds)
       where j.id = _job.id
      returning j.id, j.claim_token, j.spec_point_id, j.kind, j.attempts
           into job_id, claim_token, spec_point_id, kind, attempt;
      return next;
      _budget := _budget - 1;
    end if;
  end loop;
end;
$function$;

revoke all on function public.claim_practice_jobs(integer, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_practice_jobs(integer, uuid, text) to service_role;

create or replace function public.practice_queue_status()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select jsonb_build_object(
    'paused_until', case when q.paused_until > now() then q.paused_until end,
    'pause_reason', case when q.paused_until > now() then q.pause_reason end,
    'daily_call_limit', q.daily_call_limit,
    'calls_24h', private.practice_calls_24h(),
    'in_flight', private.practice_in_flight(),
    'max_in_flight', q.max_in_flight,
    'max_attempts', q.max_attempts,
    'counts', (
      select jsonb_build_object(
        'pending', count(*) filter (where j.status = 'pending'),
        'generating', count(*) filter (where j.status = 'generating'),
        'completed', count(*) filter (where j.status = 'completed'),
        'failed', count(*) filter (where j.status = 'failed')
      )
      from private.practice_jobs j
    ),
    'ready', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'job_id', r.id, 'spec_point_id', r.spec_point_id, 'code', r.code,
               'title', r.title, 'kind', r.kind, 'attempts', r.attempts
             ) order by r.run_after, r.id), '[]'::jsonb)
      from (
        select j.id, j.spec_point_id, sp.code, sp.title, j.kind, j.attempts, j.run_after
        from private.practice_jobs j
        join public.spec_points sp on sp.id = j.spec_point_id
        where (j.status = 'pending' and j.run_after <= now())
           or (j.status = 'generating' and j.lease_until <= now())
        order by j.run_after, j.id
        limit 50
      ) r
    ),
    'failed', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'job_id', f.id, 'spec_point_id', f.spec_point_id, 'code', f.code,
               'title', f.title, 'kind', f.kind, 'attempts', f.attempts,
               'last_error', f.last_error, 'updated_at', f.updated_at
             ) order by f.updated_at desc, f.id desc), '[]'::jsonb)
      from (
        select j.id, j.spec_point_id, sp.code, sp.title, j.kind, j.attempts, j.last_error,
               j.updated_at
        from private.practice_jobs j
        join public.spec_points sp on sp.id = j.spec_point_id
        where j.status = 'failed'
        order by j.updated_at desc, j.id desc
        limit 50
      ) f
    )
  )
  from private.practice_queue q;
$function$;

revoke all on function public.practice_queue_status() from public, anon, authenticated;
grant execute on function public.practice_queue_status() to service_role;

drop function if exists private.practice_asked_first(timestamptz);
alter table private.practice_jobs drop column if exists student_asked_at;
