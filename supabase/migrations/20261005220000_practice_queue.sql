-- The practice queue: every quiz and task the AI writes now goes through one
-- queue in the database, one job per spec point and kind.
--
-- What went wrong (5 Oct 2026). Every place that wrote a quiz or a task
-- decided "it's missing, so pay for it, then save it" on its own, with nothing
-- to stop two at once. Two writers both paid, and the save kept the first set
-- and quietly threw the second away. A script asked homework_points_with_sheet
-- which tasks existed. Without a signed-in user it answers nothing, so every
-- task looked missing and 16 were paid for again. Failed calls left no trace:
-- a run was logged only once its questions had passed the checks. One quiz
-- (EDEX 3.12, genetics) could never pass, because the check lower-cased the
-- options and TT, Tt and tt then looked the same, so every retry paid for a
-- full set. And while the credit had run out, every page load retried about
-- ten generations: about 130 refused calls.
--
-- Quizzes and tasks are library content, one per spec point, shared by every
-- student. So now:
--
--   practice_jobs     private. One row per (spec point, quiz or task), unique:
--                     that is the lock. A job is pending, generating (claimed
--                     by a worker, with a token and a lease), completed (with
--                     the content it points at) or failed.
--   practice_queue    private, one row: a pause for outages, a cap on model
--                     calls in any 24 hours, and the worker's limits.
--   the trigger       saving or re-saving a week queues its points. It can
--                     never stop the week saving.
--   the worker        POST /api/practice-worker on the live site. A minute job
--                     wakes it through pg_net, but only when a job is ready.
--   the RPCs          service role only: claim jobs, save what the model
--                     wrote, record a failure, read and steer the queue.
--   the runs          exam_generation_runs gets a row for every model call,
--                     pass or fail, with what became of it.
--
-- "Does this point already have its quiz?" has one answer, in
-- private.practice_content_id(). It is asked when a job is queued, when it is
-- claimed (yes: no call is made) and when the result is saved (yes: what is
-- there is kept, and the run says so). The unique indexes on mcq_sets and
-- resources are the last word. Once a tutor has asked for a point's own AI
-- quiz or task, only that counts for its job, so a tutor can still add the AI
-- quiz to a point that has one of their own, as the button always allowed.
--
-- ensure_generated_mcq_set and ensure_generated_homework are not touched: the
-- deployed site calls them until this change is live.
--
-- Vault holds the worker's address and its secret, as 'practice_worker_url'
-- and 'practice_worker_secret' (the same secret as the site's
-- PRACTICE_WORKER_SECRET). Until both are stored, the minute job sends
-- nothing and jobs wait.
--
-- Idempotent. Rollback: supabase/rollbacks/20261005220000_practice_queue.down.sql

-- ── 1 · The jobs and the queue's settings ─────────────────────────────────

create table if not exists private.practice_jobs (
  id            bigint generated always as identity primary key,
  spec_point_id uuid not null references public.spec_points(id) on delete cascade,
  kind          text not null check (kind in ('quiz', 'task')),
  status        text not null default 'pending'
                  check (status in ('pending', 'generating', 'completed', 'failed')),
  -- Claims in this round. A worker that dies mid-call has used one.
  attempts      integer not null default 0 check (attempts >= 0),
  -- Not before this: a retry waits, and so does a job caught by an outage.
  run_after     timestamptz not null default now(),
  -- Held while generating. Only the worker holding the token can save or fail
  -- the job. A lease that runs out lets another worker take it over.
  claim_token   uuid,
  lease_until   timestamptz,
  last_error    text,
  -- The quiz (mcq_sets.id) or task (resources.id) that covers the point, and
  -- whether the queue wrote it or found it already there.
  result_id     uuid,
  completed_how text check (completed_how in ('written', 'already_existed')),
  -- A tutor asked for the point's own AI quiz or task (the "AI generate MCQs"
  -- button). From then on only the point's own set or task counts as done,
  -- not a tutor's quiz, so the AI one can sit alongside it. Once set, it
  -- stays set.
  requested     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- The lock: one job per point and kind, ever.
  constraint practice_jobs_one_per_point unique (spec_point_id, kind),
  constraint practice_jobs_claim_only_while_generating
    check ((status = 'generating') = (claim_token is not null and lease_until is not null)),
  constraint practice_jobs_claim_token_and_lease
    check ((claim_token is null) = (lease_until is null)),
  constraint practice_jobs_result_only_when_completed
    check ((status = 'completed') = (result_id is not null and completed_how is not null)),
  constraint practice_jobs_result_and_how
    check ((result_id is null) = (completed_how is null))
);

comment on table private.practice_jobs is
  'One job per (spec point, quiz or task): the lock on writing that point''s shared quiz or task. Written only by the practice queue functions.';

-- The jobs a worker may take, in the order it takes them.
create index if not exists practice_jobs_ready
  on private.practice_jobs (run_after, id)
  where status in ('pending', 'generating');

create table if not exists private.practice_queue (
  id               boolean primary key default true check (id),
  -- Set by an outage (no credit, a bad key, a rate limit) or by hand. Nothing
  -- is claimed, and the worker isn't woken, until it has passed.
  paused_until     timestamptz,
  pause_reason     text,
  -- Model calls for jobs in any 24 hours, counting the ones in flight.
  daily_call_limit integer not null default 100 check (daily_call_limit >= 0),
  max_in_flight    integer not null default 3 check (max_in_flight between 1 and 10),
  -- Claims a job gets before it fails. An outage gives its claim back.
  max_attempts     integer not null default 3 check (max_attempts between 1 and 10),
  -- Longer than the worker's 300-second limit, so a live call is never taken over.
  lease_seconds    integer not null default 360 check (lease_seconds between 60 and 3600),
  updated_at       timestamptz not null default now()
);

comment on table private.practice_queue is
  'The practice queue''s settings, one row: a pause, the 24-hour cap on model calls and the worker''s limits.';

-- Re-running this keeps whatever the settings are now.
insert into private.practice_queue (id) values (true) on conflict (id) do nothing;

-- Students, parents and the API never read or write either table. Every
-- change goes through the functions below.
alter table private.practice_jobs enable row level security;
alter table private.practice_queue enable row level security;
revoke all on private.practice_jobs, private.practice_queue from public, anon, authenticated;

-- "Failed more than a day ago" is measured from updated_at, so no write may
-- leave it behind.
drop trigger if exists practice_jobs_updated on private.practice_jobs;
create trigger practice_jobs_updated
  before update on private.practice_jobs
  for each row execute function public.update_updated_at_column();

drop trigger if exists practice_queue_updated on private.practice_queue;
create trigger practice_queue_updated
  before update on private.practice_queue
  for each row execute function public.update_updated_at_column();

-- ── 2 · Every model call is a run ─────────────────────────────────────────

-- A run used to be written only after its questions passed the checks, so a
-- refused or broken call left nothing behind. Now every call is a row. The
-- runs already logged passed the checks, so they are 'passed'. Whether each
-- one was kept is not known.
alter table public.exam_generation_runs
  add column if not exists outcome text not null default 'passed'
    check (outcome in ('passed', 'saved', 'discarded', 'failed')),
  add column if not exists error text,
  add column if not exists stop_reason text,
  add column if not exists raw_output text,
  add column if not exists source text not null default 'unknown'
    check (source in ('queue', 'replace', 'builder', 'unknown')),
  add column if not exists job_id bigint references private.practice_jobs(id) on delete set null,
  add column if not exists duration_ms integer;

comment on column public.exam_generation_runs.outcome is
  'passed: written and passed the checks. saved or discarded: a queue job''s questions, kept or not (set by complete_practice_job). failed: an API error, an answer cut off, bad JSON or failed checks.';

-- A call refused outright has neither questions nor usage.
alter table public.exam_generation_runs
  alter column generated_questions drop not null,
  alter column usage drop not null;

alter table public.exam_generation_runs
  drop constraint if exists exam_generation_runs_failure_says_why,
  add constraint exam_generation_runs_failure_says_why
    check (outcome <> 'failed' or error is not null),
  drop constraint if exists exam_generation_runs_questions_unless_failed,
  add constraint exam_generation_runs_questions_unless_failed
    check (outcome = 'failed' or generated_questions is not null);

-- The daily cap counts the last 24 hours of calls made for jobs.
create index if not exists exam_generation_runs_job_id_idx
  on public.exam_generation_runs (job_id);
create index if not exists exam_generation_runs_created_at_idx
  on public.exam_generation_runs (created_at);

-- ── 3 · Does this point already have its quiz, or its task? ───────────────

-- The one answer, asked when a job is queued, claimed and saved. It follows
-- what a student's planner shows (src/lib/planner/weeklyActivityDal.ts, read
-- through the read policies), with one deliberate difference: the point's own
-- quiz set or task counts whatever a tutor has done with it. A generated set
-- a tutor unpublished, or a task they held back, is never paid for again.
--
-- With _own_only, only the point's own item counts: its generated set, or its
-- own task. That is the question for a job a tutor asked for
-- (practice_jobs.requested), so the AI quiz can sit alongside one of theirs.
-- Returns the content's id (the first match, in a fixed order), or null.
create or replace function private.practice_content_id(
  _spec_point_id uuid,
  _kind text,
  _own_only boolean default false
)
 returns uuid
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  _id uuid;
begin
  if _kind = 'quiz' then
    -- The point's generated set, published or not.
    select s.id into _id
    from public.mcq_sets s
    where s.origin = 'generated' and s.spec_point_id = _spec_point_id
    order by s.created_at, s.id
    limit 1;
    if _id is not null or _own_only then
      return _id;
    end if;

    -- A published set for the point, such as one a tutor built.
    select s.id into _id
    from public.mcq_sets s
    where s.spec_point_id = _spec_point_id and s.published
    order by s.created_at, s.id
    limit 1;
    if _id is not null then
      return _id;
    end if;

    -- A published set holding a question on the point.
    select s.id into _id
    from public.mcq_questions q
    join public.mcq_sets s on s.id = q.set_id
    where q.spec_point_id = _spec_point_id and s.published
    order by s.created_at, s.id
    limit 1;
    return _id;
  end if;

  if _kind = 'task' then
    -- The point's own task, whoever wrote it and whatever its review status.
    select r.id into _id
    from public.resources r
    where r.kind = 'homework' and r.spec_point_id = _spec_point_id
    order by r.created_at, r.id
    limit 1;
    if _id is not null or _own_only then
      return _id;
    end if;

    -- A task linked to the point that students can open: approved, or waiting
    -- for review and already live. A held one doesn't count.
    select r.id into _id
    from public.resource_spec_points l
    join public.resources r on r.id = l.resource_id
    where l.spec_point_id = _spec_point_id
      and r.kind = 'homework'
      and (r.review_status = 'approved'
           or (r.review_status = 'to_review' and (r.publish_at is null or r.publish_at <= now())))
    order by r.created_at, r.id
    limit 1;
    return _id;
  end if;

  raise exception 'Unknown practice kind: %', _kind using errcode = '22023';
end;
$function$;

revoke all on function private.practice_content_id(uuid, text, boolean) from public, anon, authenticated;

-- ── 4 · Saving what the model wrote ───────────────────────────────────────

-- Write the point's shared quiz, as ensure_generated_mcq_set does, and return
-- its id. Returns null when the point already has its generated set. It never
-- returns another writer's id, so losing a race can't pass for a save.
--
-- The questions are checked again here, whoever sent them:
-- [{ question, options: [4 strings], correct_index, explanation }]. Options
-- are compared the way the generator compares them: case matters (TT, Tt and
-- tt are three genotypes), extra spaces don't.
create or replace function private.save_generated_quiz(_spec_point_id uuid, _questions jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _title text;
  _subject public.subject;
  _q jsonb;
  _n bigint;
  _set_id uuid;
begin
  select sp.code || ' ' || sp.title, t.subject
    into _title, _subject
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to save a quiz with no questions';
  end if;
  for _q, _n in
    select t.q, t.ord from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  loop
    if jsonb_typeof(_q -> 'question') is distinct from 'string' or btrim(_q ->> 'question') = '' then
      raise exception 'Question % has no text', _n;
    end if;
    if jsonb_typeof(_q -> 'options') is distinct from 'array' then
      raise exception 'Question % needs four options', _n;
    end if;
    if jsonb_array_length(_q -> 'options') <> 4
       or exists (
         select 1 from jsonb_array_elements(_q -> 'options') o
         where jsonb_typeof(o) <> 'string'
            or btrim(regexp_replace(o #>> '{}', '\s+', ' ', 'g')) = ''
       ) then
      raise exception 'Question % needs four options, each with text', _n;
    end if;
    if (select count(distinct btrim(regexp_replace(o #>> '{}', '\s+', ' ', 'g')))
        from jsonb_array_elements(_q -> 'options') o) <> 4 then
      raise exception 'Question % has two identical options', _n;
    end if;
    if jsonb_typeof(_q -> 'correct_index') is distinct from 'number'
       or _q ->> 'correct_index' not in ('0', '1', '2', '3') then
      raise exception 'Question %''s answer key is not one of its four options', _n;
    end if;
    if jsonb_typeof(_q -> 'explanation') is distinct from 'string'
       or btrim(_q ->> 'explanation') = '' then
      raise exception 'Question % has no explanation', _n;
    end if;
  end loop;

  insert into public.mcq_sets
    (spec_point_id, title, description, published, subject, created_by, origin)
  values
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, null,
     'generated')
  on conflict (spec_point_id) where origin = 'generated' and spec_point_id is not null
  do nothing
  returning id into _set_id;

  -- Someone else's set got there first.
  if _set_id is null then
    return null;
  end if;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    btrim(t.q ->> 'explanation'),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$function$;

revoke all on function private.save_generated_quiz(uuid, jsonb) from public, anon, authenticated;

-- Write the point's shared task, as ensure_generated_homework does, and
-- return its id. Returns null when the point already has a task. The title,
-- subject, board and level come from the point's topic, never from a caller.
-- It waits for a tutor's review, and students can open it at once.
--
-- The questions are checked again here, whoever sent them:
-- [{ prompt, marks: 1-30, answer_type: short|long|numeric, mark_scheme }].
create or replace function private.save_generated_task(_spec_point_id uuid, _questions jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _title text;
  _subject public.subject;
  _board public.board;
  _level public.level;
  _q jsonb;
  _n bigint;
  _resource_id uuid;
begin
  select sp.code || ' ' || sp.title, t.subject, t.board, t.level
    into _title, _subject, _board, _level
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to save a task with no questions';
  end if;
  for _q, _n in
    select t.q, t.ord from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  loop
    if jsonb_typeof(_q -> 'prompt') is distinct from 'string' or btrim(_q ->> 'prompt') = '' then
      raise exception 'Question % has no prompt', _n;
    end if;
    if jsonb_typeof(_q -> 'marks') is distinct from 'number'
       or _q ->> 'marks' !~ '^[0-9]{1,2}$'
       or (_q ->> 'marks')::int not between 1 and 30 then
      raise exception 'Question % must be worth a whole number of marks from 1 to 30', _n;
    end if;
    if coalesce(_q ->> 'answer_type', '') not in ('short', 'long', 'numeric') then
      raise exception 'Question %''s answer type must be short, long or numeric', _n;
    end if;
    if jsonb_typeof(_q -> 'mark_scheme') is distinct from 'string'
       or btrim(_q ->> 'mark_scheme') = '' then
      raise exception 'Question % has no mark scheme', _n;
    end if;
  end loop;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, null, 'generated',
     'to_review', now())
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Someone else's task got there first.
  if _resource_id is null then
    return null;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    (t.q ->> 'marks')::int,
    t.q ->> 'answer_type',
    btrim(t.q ->> 'mark_scheme'),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$function$;

revoke all on function private.save_generated_task(uuid, jsonb) from public, anon, authenticated;

-- ── 5 · Queueing ──────────────────────────────────────────────────────────

-- Make sure a point has its jobs: both kinds, or only _kind when one is named.
-- A point that already has its content gets a job that is completed from the
-- start, so nothing is ever paid for it. A job that exists is left alone,
-- except to give it another go in two cases:
--   * it was completed, but its content has since been removed (only its own
--     content counts, for a job a tutor asked for)
--   * it failed more than a day ago: one fresh round a day while the point is
--     in someone's week, and the daily cap still bounds what that costs
-- A job being generated is never touched. Returns how many jobs it created or
-- gave another go.
create or replace function private.enqueue_practice(_spec_point_id uuid, _kind text default null)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _k text;
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

-- Saving or re-saving a week queues its points.
--
-- AFTER, so it sees only rows really written: the BEFORE triggers refuse a
-- paused subject or a break week, and drop a point a tutor took out. Any
-- column: save_weekly_plan re-saves a point that is already there through
-- ON CONFLICT DO UPDATE, which doesn't touch spec_point_id. SECURITY DEFINER
-- because a student's own save fires it, and students can't reach the queue.
-- The queue must never stop a week saving, so anything that goes wrong here
-- is only a warning.
create or replace function private.enqueue_practice_for_plan_point()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  begin
    perform private.enqueue_practice(new.spec_point_id);
  exception when others then
    raise warning 'practice queue: could not enqueue %: %', new.spec_point_id, sqlerrm;
  end;
  return null;
end;
$function$;

revoke all on function private.enqueue_practice_for_plan_point() from public, anon, authenticated;

drop trigger if exists plan_point_enqueues_practice on public.student_weekly_plan_points;
create trigger plan_point_enqueues_practice
  after insert or update on public.student_weekly_plan_points
  for each row execute function private.enqueue_practice_for_plan_point();

-- ── 6 · Waking the worker ─────────────────────────────────────────────────

-- Knock on the worker's door, but only when there is work for it: a job is
-- ready (pending and due, or generating on a lease that ran out), the queue
-- isn't paused, and Vault holds both the address and the secret. No knock
-- otherwise, so an idle queue costs nothing. The worker checks the secret and
-- claims what the limits allow. pg_net sends the request once this
-- transaction ends, and waits up to the worker's 300 seconds for it.
create or replace function private.kick_practice_worker()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _url text;
  _secret text;
begin
  if not exists (
    select 1 from private.practice_jobs j
    where (j.status = 'pending' and j.run_after <= now())
       or (j.status = 'generating' and j.lease_until <= now())
  ) then
    return;
  end if;
  if exists (select 1 from private.practice_queue q where q.paused_until > now()) then
    return;
  end if;

  select nullif(btrim(s.decrypted_secret), '') into _url
  from vault.decrypted_secrets s where s.name = 'practice_worker_url';
  select nullif(btrim(s.decrypted_secret), '') into _secret
  from vault.decrypted_secrets s where s.name = 'practice_worker_secret';
  if _url is null or _secret is null then
    return;
  end if;

  perform net.http_post(
    url := _url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _secret
    ),
    timeout_milliseconds := 300000
  );
end;
$function$;

revoke all on function private.kick_practice_worker() from public, anon, authenticated;

select cron.unschedule('practice-worker')
 where exists (select 1 from cron.job where jobname = 'practice-worker');

select cron.schedule(
  'practice-worker',
  '* * * * *',
  $cron$ select private.kick_practice_worker(); $cron$
);

-- ── 7 · The worker's calls (service role only) ────────────────────────────

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
-- after its retry delay. Returns the job.
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

-- Take up to _limit ready jobs (1 to 10), the longest-due first, and
-- optionally only one point or kind. Claimers queue on the settings row, so
-- the counts below can't race. Nothing is taken while the queue is paused,
-- past the in-flight limit, or past the 24-hour call cap (which counts the
-- calls still in flight).
--
-- Each ready job is checked before it is handed out. One whose point has its
-- content now (only its own, for a job a tutor asked for) is completed, with
-- no call and no budget used. One out of attempts is failed. Every job
-- returned is generating, under a new token and lease, and the attempt is
-- counted.
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
  _in_flight integer;
  _calls integer;
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

  select count(*) into _in_flight
  from private.practice_jobs j
  where j.status = 'generating' and j.lease_until > now();

  select count(*) into _calls
  from public.exam_generation_runs r
  where r.job_id is not null and r.created_at > now() - interval '24 hours';

  _budget := least(greatest(coalesce(_limit, 1), 1), 10);
  _budget := least(
    _budget,
    _queue.max_in_flight - _in_flight,
    _queue.daily_call_limit - _calls - _in_flight
  );

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

-- Save what a worker's model call wrote and complete the job, but only while
-- that worker still holds the claim. The point is checked once more first
-- (only for its own content, for a job a tutor asked for): content that
-- turned up meanwhile is kept, and the new questions are thrown away, loudly,
-- in the run's outcome. Returns 'written' or 'already_existed' with the
-- content's id, or 'lost_claim'.
--
-- Only a run still marked passed is given its outcome here: saved and
-- discarded are final. Questions that fail the checks raise, the job keeps
-- its claim, and the worker records a retry.
create or replace function public.complete_practice_job(
  _job_id bigint,
  _claim_token uuid,
  _questions jsonb,
  _run_id uuid default null
)
 returns table(status text, result_id uuid)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  _job private.practice_jobs%rowtype;
  _content uuid;
  _written uuid;
begin
  select * into _job from private.practice_jobs j where j.id = _job_id for update;
  if not found or _job.status <> 'generating' or _job.claim_token is distinct from _claim_token then
    update public.exam_generation_runs r
       set outcome = 'discarded', error = 'Claim lost before saving'
     where r.id = _run_id and r.outcome = 'passed';
    return query select 'lost_claim'::text, null::uuid;
    return;
  end if;

  _content := private.practice_content_id(_job.spec_point_id, _job.kind, _job.requested);
  if _content is null then
    if _job.kind = 'quiz' then
      _written := private.save_generated_quiz(_job.spec_point_id, _questions);
    else
      _written := private.save_generated_task(_job.spec_point_id, _questions);
    end if;
    if _written is null then
      -- Another writer saved the point's content between the check and the save.
      _content := private.practice_content_id(_job.spec_point_id, _job.kind, _job.requested);
      if _content is null then
        raise exception 'Another writer saved this point''s content and it was removed again';
      end if;
    end if;
  end if;

  if _written is not null then
    update private.practice_jobs j
       set status = 'completed', result_id = _written, completed_how = 'written',
           claim_token = null, lease_until = null, last_error = null
     where j.id = _job.id;
    update public.exam_generation_runs r
       set outcome = 'saved'
     where r.id = _run_id and r.outcome = 'passed';
    return query select 'written'::text, _written;
    return;
  end if;

  update private.practice_jobs j
     set status = 'completed', result_id = _content, completed_how = 'already_existed',
         claim_token = null, lease_until = null, last_error = null
   where j.id = _job.id;
  update public.exam_generation_runs r
     set outcome = 'discarded', error = 'Content already existed when saving'
   where r.id = _run_id and r.outcome = 'passed';
  return query select 'already_existed'::text, _content;
end;
$function$;

revoke all on function public.complete_practice_job(bigint, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.complete_practice_job(bigint, uuid, jsonb, uuid) to service_role;

-- Record a failed model call for a job the worker still holds. _failure says
-- what kind of failure it was:
--   retry    this attempt went wrong (cut off, bad JSON, failed checks): try
--            again 10, 20, 40, 80 minutes on, then every two hours
--   give_up  it can never work (a request the API refuses as it stands)
--   outage   not the job's fault (no credit, a bad key, a rate limit, the API
--            down): pause the whole queue for _pause_minutes (at least one),
--            and give the job its attempt back
-- A job out of attempts fails. Returns the job's new status, or 'lost_claim'
-- when the worker no longer holds it.
create or replace function public.fail_practice_job(
  _job_id bigint,
  _claim_token uuid,
  _error text,
  _failure text,
  _pause_minutes integer default 0
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

revoke all on function public.fail_practice_job(bigint, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.fail_practice_job(bigint, uuid, text, text, integer) to service_role;

-- What the queue is doing, for scripts/practice-queue.ts: its settings, the
-- pause (null when not paused), calls in the last 24 hours, jobs by status,
-- the ready jobs in the order they'll be claimed, and the failed ones, newest
-- first. 50 of each at most.
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
    'calls_24h', (
      select count(*) from public.exam_generation_runs r
      where r.job_id is not null and r.created_at > now() - interval '24 hours'
    ),
    'in_flight', (
      select count(*) from private.practice_jobs j
      where j.status = 'generating' and j.lease_until > now()
    ),
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

-- Pause the queue by hand for _minutes, or resume it with 0. Returns when the
-- pause ends, or null when the queue is running.
--
-- Resuming also frees the jobs the pause held back. An outage set its job to
-- wait until the pause ended, so every waiting job due by then goes now. A
-- retry that waits longer than the pause keeps its delay.
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
  returning q.paused_until into _until;
  return _until;
end;
$function$;

revoke all on function public.pause_practice_queue(integer, text) from public, anon, authenticated;
grant execute on function public.pause_practice_queue(integer, text) to service_role;

-- Give failed jobs a fresh round now: all of them, or those for the points
-- named. Returns how many.
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

-- ── 8 · The weeks already planned ─────────────────────────────────────────

-- The trigger only sees weeks saved from now on, so queue the points of this
-- week and later ones now. (On 5 Oct: 13 points, of which 2 need a quiz and 1
-- a task.) Nothing is sent until the Vault secrets exist.
select private.enqueue_practice(p.spec_point_id)
from (
  select distinct pp.spec_point_id
  from public.student_weekly_plan_points pp
  join public.student_weekly_plans w on w.id = pp.plan_id
  where w.week_start >= date_trunc('week', now() at time zone 'Europe/London')::date
) p;
