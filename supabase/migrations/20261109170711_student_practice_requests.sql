-- A student can ask for any spec point's quiz and task.
--
-- Ali (9 Nov 2026): every spec point in the curriculum gets a button a student
-- presses to have its quiz and task written, whatever week it falls in. What
-- gets written is library content: the one quiz and one task per point that
-- every student shares. A point asked for once is there for everyone after,
-- and a point that already has them just shows them.
--
-- This is the one exception to the 7 Oct rule (20261007111000: the queue
-- writes only this week's points). A request goes through the same queue: one
-- job per point and kind, the same checks before anything is paid for, and the
-- same 100 calls a day for the whole site.
--
-- Limits (Ali, 9 Nov):
--   - 10 a day for each student, counted from midnight in London. A quiz and
--     a task are two. Asking for one that exists, or is being written, is free.
--   - Only points on the student's own course: a paid subject, the board they
--     sit it with, their level. The same test as reorder_student_plan.
--   - Students only. Tutors have their own "AI generate MCQs" button.
--
-- Requests are counted in ai_request_log (endpoint 'practice_request'), which
-- keeps a day: prune_ai_request_log drops rows older than 24 hours at 03:40
-- UTC, and today in London never started more than 25 hours ago, so nothing
-- counted today is pruned before the day ends.
--
--   practice_for_point(point)          per kind (quiz, task): ready, writing,
--                                      failed or missing, and requests left today.
--   request_practice_for_point(point)  queues what is missing, within today's
--                                      10, wakes the worker, and answers as above.
--
-- A job a student asks for is an ordinary job (requested stays false: that
-- flag is the tutor's "the point's own AI quiz" and changes what counts).
--
-- Idempotent. Rollback: supabase/rollbacks/20261109170711_student_practice_requests.down.sql

-- ── 1 · The day's allowance ───────────────────────────────────────────────

create or replace function private.practice_request_daily_limit()
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select 10;
$function$;

revoke all on function private.practice_request_daily_limit() from public, anon, authenticated;

-- Requests a student has made since midnight in London.
create or replace function private.practice_requests_used_today(_uid uuid)
 returns integer
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select count(*)::integer
  from public.ai_request_log l
  where l.user_id = _uid
    and l.endpoint = 'practice_request'
    and l.created_at >= (date_trunc('day', now() at time zone 'Europe/London')
                         at time zone 'Europe/London');
$function$;

revoke all on function private.practice_requests_used_today(uuid) from public, anon, authenticated;

-- ── 2 · Whose point it is ─────────────────────────────────────────────────

-- A student (not staff) asking about a point on their own course: a subject
-- they pay for, sat with that point's board, at their level.
create or replace function private.can_request_practice(_uid uuid, _spec_point_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select _uid is not null
     and not private.is_staff(_uid)
     and exists (
       select 1
       from public.spec_points sp
       join public.topics t on t.id = sp.topic_id
       join public.profiles p on p.id = _uid
       where sp.id = _spec_point_id
         and p.role = 'student'
         and p.level = t.level
         and t.subject::text = any (private.student_paid_subjects(_uid))
         and exists (
           select 1 from public.student_enrolments e
           where e.student_id = _uid and e.subject = t.subject and e.board = t.board
         )
     );
$function$;

revoke all on function private.can_request_practice(uuid, uuid) from public, anon, authenticated;

-- ── 3 · Where a point's quiz or task stands ───────────────────────────────

-- ready    the point has it (private.practice_content_id: the one answer the
--          queue itself uses, so "ready" here is never paid for again).
-- writing  its job is waiting or being written.
-- failed   its job gave up in the last 24 hours. The queue won't take it again
--          until then (private.enqueue_practice), so neither does a request.
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
  if _job.status = 'failed' and _job.updated_at >= now() - interval '24 hours' then
    return 'failed';
  end if;
  return 'missing';
end;
$function$;

revoke all on function private.practice_state(uuid, text) from public, anon, authenticated;

-- ── 4 · What the student calls ────────────────────────────────────────────

-- Where the point's quiz and task stand, for the signed-in student. No rows
-- for anyone who couldn't ask for them (a tutor, a parent, a point off their
-- course, a lapsed subscription), so the page shows no button.
create or replace function public.practice_for_point(_spec_point_id uuid)
 returns table(kind text, state text, requests_left integer)
 language plpgsql
 volatile
 security definer
 set search_path to ''
as $function$
declare
  _uid uuid := auth.uid();
  _left integer;
begin
  if not private.can_request_practice(_uid, _spec_point_id) then
    return;
  end if;
  _left := greatest(private.practice_request_daily_limit()
                    - private.practice_requests_used_today(_uid), 0);
  return query
    select k.name, private.practice_state(_spec_point_id, k.name), _left
    from unnest(array['quiz', 'task']) with ordinality as k(name, ord)
    order by k.ord;
end;
$function$;

revoke all on function public.practice_for_point(uuid) from public, anon;
grant execute on function public.practice_for_point(uuid) to authenticated;

-- Queue the point's missing quiz and task, quiz first, while today's requests
-- last, and wake the worker. Each one queued is one request. Returns where the
-- two stand afterwards, as practice_for_point does.
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
