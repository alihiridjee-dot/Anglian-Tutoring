/** End-to-end check of the practice queue: the real worker
 * (src/lib/practice/practiceQueue.server.ts, over the real
 * src/lib/homework/examGeneration.server.ts) run against the real migration
 * (supabase/migrations/20261005220000_practice_queue.sql) in PGlite.
 *
 * `fetch` is replaced by a stand-in that answers as PostgREST would (named-
 * argument RPCs run as the service role, the run-log insert) and as the
 * Anthropic API would (a scripted model). So a mismatch between the
 * TypeScript and SQL halves (a function or argument name, a JSON shape, an
 * outcome, a claim) fails here instead of in production. The minute job's
 * knock (pg_net, stubbed) is handed to the worker route's real handler.
 * Nothing leaves the process: no network, no production data, no paid call.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-practice-queue-e2e.ts
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

// Set before the worker loads, over whatever Bun read from .env (the live
// project's keys): every request below is answered in-process.
const SUPABASE_URL = "https://practice-queue-e2e.invalid";
const SERVICE_KEY = "sb_secret_test";
const ANTHROPIC_KEY = "test";
const WORKER_URL = "https://practice-queue-e2e.invalid/api/practice-worker";
const WORKER_SECRET = "e2e-worker-secret-at-least-32-characters";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
process.env.PRACTICE_WORKER_SECRET = WORKER_SECRET;
// The SDK would send its calls there instead of to the stand-in.
delete process.env.ANTHROPIC_BASE_URL;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const MIGRATION = new URL(
  "../supabase/migrations/20261005220000_practice_queue.sql",
  import.meta.url,
);
// Its follow-up (a WHERE clause pg-safeupdate needs), applied after it as in production.
const FIX = new URL(
  "../supabase/migrations/20261006110000_practice_queue_safeupdate.sql",
  import.meta.url,
);
// Only this week's plan queues (7 Oct), as in production.
const THIS_WEEK_ONLY = new URL(
  "../supabase/migrations/20261007111000_practice_queue_this_week_only.sql",
  import.meta.url,
);
const WORKER = new URL("../src/lib/practice/practiceQueue.server.ts", import.meta.url);
const GENERATION = new URL("../src/lib/homework/examGeneration.ts", import.meta.url);
const absent: string[] = [];
for (const file of [MIGRATION, FIX, THIS_WEEK_ONLY, WORKER])
  await access(file).catch(() => absent.push(fileURLToPath(file)));
if (absent.length) {
  console.error(`practice queue e2e: harness ready, waiting for ${absent.join(" and ")}`);
  process.exit(1);
}

type Rows<T> = { rows: T[] };
interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Rows<T>>;
  exec(sql: string): Promise<unknown>;
}
interface Database extends Sql {
  transaction<T>(run: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db: Database = new PGlite();

const STUDENT = "00000000-0000-0000-0000-000000000001";
const TOPIC = "00000000-0000-0000-0000-000000000010";
const PLAN = "00000000-0000-0000-0000-000000000020";

// The shape of production the queue touches, copied from
// scripts/test-practice-queue-db.ts (copied, not imported, so the two tests
// stay independent), less its rival-writer test machinery: the live bodies of
// has_role, update_updated_at_column, enforce_plan_overrides,
// plan_point_has_work, save_weekly_plan, the read policies and both legacy
// writers, Supabase's default grants, and pg_cron, pg_net and Vault stubbed.
await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth; create schema private; create schema cron; create schema net; create schema vault;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- Supabase's default privileges in public (pg_default_acl, 5 Oct): anything
-- new goes to every API role, so the migration has to take it back itself.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create type public.app_role as enum ('student', 'tutor', 'admin');
create type public.subject as enum ('biology', 'chemistry', 'physics');
create type public.board as enum ('edexcel', 'aqa', 'ocr', 'cambridge', 'oxford_aqa');
create type public.level as enum ('gcse', 'alevel', 'gcse_trilogy', 'igcse');
create type public.plan_source as enum ('ai', 'student', 'tutor');
create type public.plan_point_origin as enum ('ai', 'student', 'tutor', 'carried_over', 'core', 'focus');
create type public.resource_kind as enum ('video', 'download', 'live_session', 'homework');
create type public.resource_origin as enum ('tutor', 'generated');
create table public.user_roles(user_id uuid, role public.app_role);

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id = auth.uid() THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'tutor'::public.app_role) THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSE
    RETURN false;
  END IF;
END;
$function$;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

create table public.topics(
  id uuid primary key default gen_random_uuid(), subject public.subject not null,
  board public.board not null, level public.level not null, title text not null);
create table public.spec_points(
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  code text not null, title text not null);

create table public.mcq_sets(
  id uuid primary key default gen_random_uuid(),
  spec_point_id uuid references public.spec_points(id) on delete cascade,
  title text not null, description text, published boolean not null default false,
  created_by uuid, subject public.subject,
  origin public.resource_origin not null default 'tutor',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index mcq_sets_one_generated_per_spec_point on public.mcq_sets (spec_point_id)
  where origin = 'generated' and spec_point_id is not null;
create trigger t_mcq_sets_updated before update on public.mcq_sets
  for each row execute function update_updated_at_column();
create table public.mcq_questions(
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.mcq_sets(id) on delete cascade,
  position integer not null default 0, question text not null, options jsonb not null,
  correct_index integer not null, explanation text,
  created_at timestamptz not null default now(),
  spec_point_id uuid references public.spec_points(id) on delete set null);
create table public.resources(
  id uuid primary key default gen_random_uuid(), kind public.resource_kind not null,
  title text not null, subject public.subject not null, board public.board, level public.level not null,
  created_by uuid, created_at timestamptz not null default now(),
  spec_point_id uuid references public.spec_points(id) on delete set null,
  origin public.resource_origin not null default 'tutor',
  review_status text not null default 'approved' check (review_status in ('to_review', 'approved', 'held')),
  publish_at timestamptz);
create unique index resources_one_homework_per_spec_point on public.resources (spec_point_id)
  where kind = 'homework' and spec_point_id is not null;
create table public.homework_questions(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  position integer not null, prompt text not null,
  marks integer not null default 1 check (marks >= 1 and marks <= 30),
  answer_type text not null default 'short' check (answer_type in ('short', 'long', 'numeric')),
  mark_scheme text, spec_point_id uuid references public.spec_points(id) on delete set null,
  created_at timestamptz not null default now(), unique (resource_id, position));
create table public.resource_spec_points(
  resource_id uuid not null references public.resources(id) on delete cascade,
  spec_point_id uuid not null references public.spec_points(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (resource_id, spec_point_id));

create table public.exam_generation_runs (
  id uuid primary key default gen_random_uuid(),
  spec_point_id uuid references public.spec_points(id) on delete set null,
  framework_version text not null,
  model text not null,
  format text not null check (format in ('written', 'mcq')),
  grounding text not null,
  exemplar_ids uuid[] not null,
  generated_questions jsonb not null,
  usage jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.exam_generation_runs enable row level security;
grant all on public.exam_generation_runs to service_role;
grant select on public.exam_generation_runs to authenticated;
create policy "generation runs tutors read" on public.exam_generation_runs
  for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role));

create table public.student_weekly_plans(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject public.subject not null, board public.board not null, level public.level not null,
  week_start date not null, source public.plan_source not null default 'ai', ai_rationale text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (student_id, subject, week_start));
create table public.student_weekly_plan_points(
  plan_id uuid not null references public.student_weekly_plans(id) on delete cascade,
  spec_point_id uuid not null references public.spec_points(id) on delete cascade,
  origin public.plan_point_origin not null default 'student',
  created_at timestamptz not null default now(), carried_from date, done_at timestamptz,
  primary key (plan_id, spec_point_id));
alter table public.student_weekly_plans enable row level security;
alter table public.student_weekly_plan_points enable row level security;
create policy "wp own" on public.student_weekly_plans for all to authenticated
  using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "wpp own" on public.student_weekly_plan_points for all to authenticated
  using (exists (select 1 from public.student_weekly_plans p
    where p.id = student_weekly_plan_points.plan_id and p.student_id = (select auth.uid())))
  with check (exists (select 1 from public.student_weekly_plans p
    where p.id = student_weekly_plan_points.plan_id and p.student_id = (select auth.uid())));

create table public.student_plan_overrides(
  student_id uuid, subject public.subject, spec_point_id uuid, kind text, week_start date);
CREATE OR REPLACE FUNCTION public.enforce_plan_overrides()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _plan record;
begin
  if new.origin in ('student'::plan_point_origin, 'tutor'::plan_point_origin) then
    return new;
  end if;
  select p.student_id, p.subject, p.week_start into _plan
  from student_weekly_plans p where p.id = new.plan_id;
  if not found then
    return new;
  end if;
  if exists (
    select 1 from student_plan_overrides o
    where o.student_id = _plan.student_id
      and o.subject = _plan.subject
      and o.spec_point_id = new.spec_point_id
      and (o.kind = 'skip' or (o.kind = 'remove' and o.week_start = _plan.week_start))
  ) then
    return null;
  end if;
  return new;
end
$function$;
create trigger plan_point_overrides
  before insert or update of origin, spec_point_id, plan_id on public.student_weekly_plan_points
  for each row execute function public.enforce_plan_overrides();

-- Stands in for refuse_planning_while_paused and refuse_planning_on_a_break: a
-- refused point raises 23514, as they do.
create table public.test_paused_subjects(subject public.subject primary key);
create function private.refuse_planning_while_paused() returns trigger
 language plpgsql security definer set search_path to '' as $$
begin
  if exists (select 1 from public.student_weekly_plans w
             join public.test_paused_subjects p on p.subject = w.subject
             where w.id = new.plan_id) then
    raise exception using errcode = '23514',
      message = 'This subject is paused, so nothing new can be planned for it.', hint = 'subject_paused';
  end if;
  return new;
end $$;
create trigger plan_point_not_while_paused
  before insert or update of plan_id on public.student_weekly_plan_points
  for each row execute function private.refuse_planning_while_paused();

create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(), student_id uuid, resource_id uuid, submitted_at timestamptz);
create table public.mcq_attempts(
  id uuid primary key default gen_random_uuid(), user_id uuid, set_id uuid,
  created_at timestamptz not null default now(), point_scores jsonb);

CREATE OR REPLACE FUNCTION public.plan_point_has_work(_student_id uuid, _spec_point_id uuid, _week_start date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
      select 1 from homework_submissions h
      join resources r on r.id = h.resource_id
      where h.student_id = _student_id and r.kind = 'homework'
        and h.submitted_at >= (_week_start::timestamp at time zone 'Europe/London')
        and h.submitted_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (r.spec_point_id = _spec_point_id or exists (
          select 1 from resource_spec_points l
          where l.resource_id = r.id and l.spec_point_id = _spec_point_id))
    )
    or exists (
      select 1 from mcq_attempts a
      where a.user_id = _student_id
        and a.created_at >= (_week_start::timestamp at time zone 'Europe/London')
        and a.created_at < ((_week_start + 7)::timestamp at time zone 'Europe/London')
        and (a.point_scores ? _spec_point_id::text or exists (
          select 1 from mcq_sets m where m.id = a.set_id and m.spec_point_id = _spec_point_id
        ) or exists (
          select 1 from mcq_questions q where q.set_id = a.set_id and q.spec_point_id = _spec_point_id
        ))
    );
$function$;

CREATE OR REPLACE FUNCTION public.save_weekly_plan(_student_id uuid, _subject subject, _board board, _level level, _week_start date, _source plan_source, _rationale text, _points jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  _plan_id uuid;
  _count int;
  _incoming jsonb;
begin
  if jsonb_typeof(coalesce(_points, '[]'::jsonb)) <> 'array' then
    raise exception 'points must be an array';
  end if;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into _incoming
  from jsonb_array_elements(coalesce(_points, '[]'::jsonb)) e
  where coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin)
        in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
     or not exists (
      select 1 from student_plan_overrides o
      where o.student_id = _student_id and o.subject = _subject
        and o.spec_point_id = (e->>'spec_point_id')::uuid
        and (o.kind = 'skip' or (o.kind = 'remove' and o.week_start = _week_start))
    );

  _count := jsonb_array_length(_incoming);
  if _count > 200 then
    raise exception 'a week cannot hold more than 200 spec points';
  end if;

  insert into student_weekly_plans
    (student_id, subject, board, level, week_start, source, ai_rationale, updated_at)
  values
    (_student_id, _subject, _board, _level, _week_start, _source, _rationale, now())
  on conflict (student_id, subject, week_start) do update
    set board        = excluded.board,
        level        = excluded.level,
        source       = excluded.source,
        ai_rationale = excluded.ai_rationale,
        updated_at   = now()
  returning id into _plan_id;

  delete from student_weekly_plan_points p where p.plan_id = _plan_id
    and p.done_at is null and p.carried_from is null
    and p.origin not in ('student'::plan_point_origin, 'tutor'::plan_point_origin)
    and not plan_point_has_work(_student_id, p.spec_point_id, _week_start)
    and not exists (select 1 from jsonb_array_elements(_incoming) e
      where (e->>'spec_point_id')::uuid = p.spec_point_id);

  insert into student_weekly_plan_points (plan_id, spec_point_id, origin, carried_from)
  select
    _plan_id,
    (e->>'spec_point_id')::uuid,
    coalesce((e->>'origin')::plan_point_origin, 'ai'::plan_point_origin),
    nullif(e->>'carried_from', '')::date
  from jsonb_array_elements(_incoming) e
  on conflict (plan_id, spec_point_id) do update
    set origin = excluded.origin, carried_from = excluded.carried_from;

  return _plan_id;
end
$function$;
revoke all on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) from public;
grant execute on function public.save_weekly_plan(uuid, subject, board, level, date, plan_source, text, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.ensure_generated_homework(_spec_point_id uuid, _title text, _subject subject, _level level, _questions jsonb, _created_by uuid DEFAULT NULL::uuid, _board board DEFAULT NULL::board, _publish_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _resource_id uuid;
begin
  -- \`_created_by\` is accepted and ignored: a library sheet belongs to nobody.

  -- Already generated, possibly by another student moments ago.
  select r.id into _resource_id
  from public.resources r
  where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
  if _resource_id is not null then
    return _resource_id;
  end if;

  if not exists (select 1 from public.spec_points sp where sp.id = _spec_point_id) then
    raise exception 'Unknown spec point';
  end if;

  if _questions is null or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a task with no questions';
  end if;

  insert into public.resources
    (kind, title, subject, board, level, spec_point_id, created_by, origin,
     review_status, publish_at)
  values
    ('homework', _title, _subject, _board, _level, _spec_point_id, null, 'generated',
     'to_review', coalesce(_publish_at, now()))
  on conflict (spec_point_id) where kind = 'homework' and spec_point_id is not null
  do nothing
  returning id into _resource_id;

  -- Lost the race: the winner's sheet is the one everybody uses.
  if _resource_id is null then
    select r.id into _resource_id
    from public.resources r
    where r.kind = 'homework' and r.spec_point_id = _spec_point_id;
    return _resource_id;
  end if;

  insert into public.homework_questions
    (resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id)
  select
    _resource_id,
    (t.ord - 1)::int,
    t.q ->> 'prompt',
    greatest(1, least(30, coalesce((t.q ->> 'marks')::int, 2))),
    case when t.q ->> 'answer_type' in ('short', 'long', 'numeric')
         then t.q ->> 'answer_type' else 'short' end,
    nullif(btrim(coalesce(t.q ->> 'mark_scheme', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord)
  where nullif(btrim(coalesce(t.q ->> 'prompt', '')), '') is not null;

  insert into public.resource_spec_points (resource_id, spec_point_id)
  values (_resource_id, _spec_point_id)
  on conflict do nothing;

  return _resource_id;
end;
$function$;
revoke all on function public.ensure_generated_homework(uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz) to service_role;

CREATE OR REPLACE FUNCTION public.ensure_generated_mcq_set(_spec_point_id uuid, _questions jsonb, _created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _set_id uuid;
  _title text;
  _subject public.subject;
begin
  -- \`_created_by\` is accepted and ignored: a library quiz belongs to nobody.

  -- Already generated, possibly by another student moments ago. With no
  -- questions this is only a lookup, and says so by returning null.
  select s.id into _set_id
  from public.mcq_sets s
  where s.origin = 'generated' and s.spec_point_id = _spec_point_id;
  if _set_id is not null or _questions is null then
    return _set_id;
  end if;

  select sp.code || ' ' || sp.title, t.subject
    into _title, _subject
  from public.spec_points sp
  join public.topics t on t.id = sp.topic_id
  where sp.id = _spec_point_id;
  if _title is null then
    raise exception 'Unknown spec point';
  end if;

  if jsonb_typeof(_questions) is distinct from 'array' or jsonb_array_length(_questions) = 0 then
    raise exception 'Refusing to create a quiz with no questions';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_questions) q
    where nullif(btrim(coalesce(q ->> 'question', '')), '') is null
       or jsonb_typeof(q -> 'options') is distinct from 'array'
       or jsonb_array_length(q -> 'options') <> 4
       or jsonb_typeof(q -> 'correct_index') is distinct from 'number'
       or (q ->> 'correct_index')::numeric not in (0, 1, 2, 3)
  ) then
    raise exception 'A question is missing its text, four options or a valid answer';
  end if;

  insert into public.mcq_sets
    (spec_point_id, title, description, published, subject, created_by, origin)
  values
    (_spec_point_id, _title, 'Practice questions for this spec point', true, _subject, null,
     'generated')
  on conflict (spec_point_id) where origin = 'generated' and spec_point_id is not null
  do nothing
  returning id into _set_id;

  -- Lost the race: the winner's set is the one everybody uses.
  if _set_id is null then
    select s.id into _set_id
    from public.mcq_sets s
    where s.origin = 'generated' and s.spec_point_id = _spec_point_id;
    return _set_id;
  end if;

  insert into public.mcq_questions
    (set_id, position, question, options, correct_index, explanation, spec_point_id)
  select
    _set_id,
    (t.ord - 1)::int,
    btrim(t.q ->> 'question'),
    t.q -> 'options',
    (t.q ->> 'correct_index')::int,
    nullif(btrim(coalesce(t.q ->> 'explanation', '')), ''),
    _spec_point_id
  from jsonb_array_elements(_questions) with ordinality as t(q, ord);

  return _set_id;
end;
$function$;
revoke all on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) to service_role;
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d) $$;
create table net.requests(
  id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer);
create function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into net.requests(url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds) returning id $$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
`);
await db.exec(`
insert into auth.users values ('${STUDENT}');
insert into public.topics (id, subject, board, level, title)
  values ('${TOPIC}', 'biology', 'edexcel', 'gcse', 'Inheritance, variation and evolution');
insert into public.student_weekly_plans (id, student_id, subject, board, level, week_start, source)
  values ('${PLAN}', '${STUDENT}', 'biology', 'edexcel', 'gcse',
          date_trunc('week', now() at time zone 'Europe/London')::date, 'ai');

-- This test's own: while a point is listed, the database refuses to save a
-- quiz for it, as any failing save would.
create table public.test_refused_saves(spec_point_id uuid primary key);
create function public.test_refuse_save() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.test_refused_saves r where r.spec_point_id = new.spec_point_id) then
    raise exception 'The database refused this save';
  end if;
  return new;
end $$;
create trigger test_refuse_save before insert on public.mcq_sets
  for each row execute function public.test_refuse_save();
`);

try {
  await db.exec(await readFile(MIGRATION, "utf8"));
  await db.exec(await readFile(FIX, "utf8"));
  await db.exec(await readFile(THIS_WEEK_ONLY, "utf8"));
} catch (error) {
  throw new Error(`the migration did not load on the fixture: ${(error as Error).message}`, {
    cause: error,
  });
}

// ── PostgREST, as the worker's service credential reaches it ──────────────
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** One request the stand-in answered. */
type Served = { path: string; body: unknown; status: number; answer: string; byHarness: boolean };
const served: Served[] = [];
/** Failed requests a scenario caused on purpose, so the after-checks let them by. */
const expectedFailures = new Set<Served>();
/**
 * Paths whose next answer never arrives: the database runs the request, then
 * the connection drops, so the caller can't tell whether it took effect.
 */
const loseNextAnswer = new Set<string>();
/** Requests for anything but the two services played here. There must be none. */
const strays: string[] = [];
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

const pgrstError = (status: number, code: string, message: string, details: string | null = null) =>
  Response.json({ code, details, hint: null, message }, { status });

/** The HTTP status PostgREST gives a database error (its docs, "HTTP status codes"). */
function statusFor(code: string): number {
  if (code === "23503" || code === "23505") return 409;
  if (code === "42883" || code === "42P01") return 404;
  if (code === "42501") return 403;
  if (code === "P0001") return 400;
  if (/^(08|53)/.test(code)) return 503;
  if (/^(09|25|2D|38|39|3B|40|54|55|57|58|F0|HV|P0|XX)/.test(code)) return 500;
  return 400;
}
function databaseError(error: unknown): Response {
  const e = error as { code?: string; message?: string; detail?: string; hint?: string };
  const code = e.code ?? "XX000";
  return Response.json(
    { code, details: e.detail ?? null, hint: e.hint ?? null, message: e.message ?? String(error) },
    { status: statusFor(code) },
  );
}

/** One statement in its own transaction as the service role: how PostgREST runs a request. */
function asServiceRole<T>(sql: string, params: unknown[]): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    return (await tx.query<T>(sql, params)).rows;
  });
}

type Signature = {
  args: { name: string; type: string }[];
  defaults: number;
  returnsSet: boolean;
  returnsVoid: boolean;
};
const signatures = new Map<string, Signature[]>();
/** Every public function of this name, with its input arguments in order. */
async function signaturesOf(name: string): Promise<Signature[]> {
  if (!signatures.has(name)) {
    const { rows } = await db.query<{
      args: Signature["args"] | null;
      defaults: number;
      returns_set: boolean;
      returns: string;
    }>(
      `select p.pronargdefaults::int as defaults, p.proretset as returns_set,
              p.prorettype::regtype::text as returns,
              (select json_agg(json_build_object('name', a.name, 'type', format_type(a.typ, null)) order by a.ord)
                 from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]),
                             coalesce(p.proargmodes, array_fill('i'::"char", array[p.pronargs::int])),
                             p.proargnames) with ordinality as a(typ, mode, name, ord)
                where a.mode in ('i', 'b', 'v')) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1 and p.prokind = 'f'`,
      [name],
    );
    signatures.set(
      name,
      rows.map((r) => ({
        args: r.args ?? [],
        defaults: r.defaults,
        returnsSet: r.returns_set,
        returnsVoid: r.returns === "void",
      })),
    );
  }
  return signatures.get(name)!;
}

/**
 * POST /rpc/<name>: the function whose argument names match the body's keys
 * (every key one of its arguments, every argument without a default given),
 * each value cast to its argument's type, called by name. A set comes back
 * as an array of rows, anything else as the bare value.
 */
async function callFunction(name: string, body: unknown): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return pgrstError(400, "PGRST102", "An RPC body must be a JSON object of named arguments");
  const given = Object.keys(body);
  const fits = (await signaturesOf(name)).filter(
    (s) =>
      given.every((key) => s.args.some((a) => a.name === key)) &&
      s.args.slice(0, s.args.length - s.defaults).every((a) => given.includes(a.name)),
  );
  if (fits.length > 1)
    return pgrstError(
      300,
      "PGRST203",
      `Could not choose the best candidate function public.${name}`,
    );
  if (!fits.length)
    return pgrstError(
      404,
      "PGRST202",
      `Could not find the function public.${name}(${[...given].sort().join(", ")}) in the schema cache`,
      `Searched for the function public.${name} with parameters ${given.join(", ") || "(none)"}`,
    );
  const [fn] = fits;
  const args = fn.args.filter((a) => given.includes(a.name));
  const call = `public.${quote(name)}(${args.map((a) => `${quote(a.name)} => _a.${quote(a.name)}`).join(", ")})`;
  const from = args.length
    ? `json_to_record($1::json) as _a(${args.map((a) => `${quote(a.name)} ${a.type}`).join(", ")}), lateral ${call} as _r`
    : `${call} as _r`;
  const value = fn.returnsVoid
    ? "null::json"
    : fn.returnsSet
      ? "coalesce(json_agg(_r), '[]'::json)"
      : "to_json(_r)";
  try {
    const [row] = await asServiceRole<{ body: Json }>(
      `select ${value} as body from ${from}`,
      args.length ? [JSON.stringify(body)] : [],
    );
    return fn.returnsVoid ? new Response(null, { status: 204 }) : Response.json(row?.body ?? null);
  } catch (error) {
    return databaseError(error);
  }
}

/** POST /<table>: the rows inserted with the first row's keys as the columns; 201, no body. */
async function insertRows(table: string, body: unknown, prefer: string | null): Promise<Response> {
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.length || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r)))
    return pgrstError(400, "PGRST102", "Empty or invalid json");
  const columns = Object.keys(rows[0] as object);
  const { rows: known } = await db.query<{ name: string }>(
    "select attname as name from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped",
    [`public.${table}`],
  );
  const unknown = columns.find((c) => !known.some((k) => k.name === c));
  if (unknown)
    return pgrstError(
      400,
      "PGRST204",
      `Could not find the '${unknown}' column of '${table}' in the schema cache`,
    );
  const list = columns.map(quote).join(", ");
  const representation = /return=representation/.test(prefer ?? "");
  try {
    const inserted = await asServiceRole<Json>(
      `insert into public.${quote(table)} (${list})
       select ${list} from json_populate_recordset(null::public.${quote(table)}, $1::json)
       ${representation ? "returning *" : ""}`,
      [JSON.stringify(rows)],
    );
    return representation
      ? Response.json(inserted, { status: 201 })
      : new Response(null, { status: 201 });
  } catch (error) {
    return databaseError(error);
  }
}

/** The exemplar retrieval RPC, canned: the point as the library would describe it, no exemplars. */
async function generationContext(body: unknown): Promise<Response> {
  const given = Object.keys((body as object | null) ?? {});
  if (given.length !== 1 || given[0] !== "_spec_point_id")
    return pgrstError(
      404,
      "PGRST202",
      `Could not find the function public.exam_generation_context(${given.join(", ")}) in the schema cache`,
    );
  const { rows } = await db.query<Record<string, string | null>>(
    `select sp.id, sp.code, sp.title, null::text as description, sp.topic_id, t.title as topic_title,
            t.board::text as board, t.level::text as level, t.subject::text as subject,
            null::text as specification_version, null::text as tier, null::text as assessment_context
       from public.spec_points sp join public.topics t on t.id = sp.topic_id where sp.id = $1`,
    [(body as { _spec_point_id: unknown })._spec_point_id],
  );
  return Response.json(rows[0] ? { point: rows[0], examples: [], guidance: [] } : null);
}

async function postgrest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
  const text = await request.text();
  let body: unknown = null;
  let answer: Response;
  if (request.headers.get("apikey") !== SERVICE_KEY)
    answer = Response.json({ message: "Invalid API key" }, { status: 401 });
  else if (request.method !== "POST")
    answer = pgrstError(405, "PGRST117", `Unsupported HTTP method: ${request.method}`);
  else if (!request.headers.get("content-type")?.startsWith("application/json"))
    answer = pgrstError(415, "PGRST107", "The request body must be application/json");
  else {
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = undefined;
    }
    if (body === undefined) answer = pgrstError(400, "PGRST102", "Empty or invalid json");
    else if (path === "rpc/exam_generation_context") answer = await generationContext(body);
    else if (path.startsWith("rpc/")) answer = await callFunction(path.slice(4), body);
    else if (path === "exam_generation_runs")
      answer = await insertRows(path, body, request.headers.get("prefer"));
    else
      answer = pgrstError(
        404,
        "PGRST205",
        `Could not find the table 'public.${path}' in the schema cache`,
      );
  }
  served.push({
    path,
    body,
    status: answer.status,
    answer: await answer.clone().text(),
    byHarness: request.headers.get("x-e2e-harness") === "1",
  });
  if (loseNextAnswer.delete(path))
    throw new TypeError("fetch failed: the connection closed before the answer arrived");
  return answer;
}

// ── The Anthropic API: a scripted model ────────────────────────────────────
type Reply =
  | "valid"
  | "credit"
  | "rate_limit"
  | "bad_request"
  | "overloaded"
  | "dropped"
  | "timeout"
  | "invalid_json"
  | "duplicate_options"
  | "max_tokens";
/**
 * The API's status for each reply it refuses. A refused call isn't billed, so
 * the daily cap leaves it out. Every other call counts: an answer has usage,
 * and a call that got none ("dropped", "timeout") may have been billed.
 */
const REFUSED: Partial<Record<Reply, number>> = {
  credit: 400,
  bad_request: 400,
  rate_limit: 429,
  overloaded: 529,
};
type Question = Record<string, unknown>;
type ModelCall = {
  point: string;
  format: "mcq" | "written";
  count: number;
  reply: Reply;
  /** The text the model answered with; null when the API refused the call or never answered. */
  text: string | null;
  questions: Question[];
};
const model = {
  calls: [] as ModelCall[],
  /** The replies to give, in order; a valid set once it runs out. */
  script: [] as Reply[],
  /** Holds the next call open until released, to change the database meanwhile. */
  hold: null as null | { arrive: () => void; released: Promise<void> },
  /** Anything a call carried that the real API would refuse, or the contract forbids. */
  faults: [] as string[],
};

const ORDINALS = (
  "first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth " +
  "thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth"
).split(" ");
const LABELS = {
  assessment_objectives: ["AO1"],
  mathematical_demand: false,
  practical_demand: false,
};
/** Letters for a call's number, so saved questions show which call wrote them. Digits would meet the notation fixer. */
const replyTag = (n: number) =>
  [...n.toString(26)].map((d) => String.fromCharCode(97 + parseInt(d, 26))).join("");

function mcqSet(count: number, tag: string): Question[] {
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? // Case is meaning (three genotypes); the padding is the worker's to trim.
        {
          question: "  Which genotype is heterozygous?  ",
          options: ["TT", "Tt", "tt", "  T "],
          correct_index: 1,
          explanation: ` Tt carries two different alleles (reply ${tag}). `,
          ...LABELS,
        }
      : {
          question: `Which is the ${ORDINALS[i]} statement about alleles?`,
          options: ["alpha", "beta", "gamma", "delta"].map((w) => `${ORDINALS[i]} ${w}`),
          correct_index: i % 4,
          explanation: `The ${ORDINALS[i]} statement is the keyed one (reply ${tag}).`,
          ...LABELS,
        },
  );
}
function writtenSet(count: number, tag: string): Question[] {
  const types = ["short", "long", "numeric"];
  return Array.from({ length: count }, (_, i) => ({
    prompt:
      i === 0
        ? "  Explain why two siblings can look different.  "
        : `Describe the ${ORDINALS[i]} source of variation.`,
    marks: i + 1,
    answer_type: types[i % types.length],
    mark_scheme:
      i === 0
        ? ` Award a mark for each different allele combination (reply ${tag}). `
        : `Award a mark for naming the ${ORDINALS[i]} source (reply ${tag}).`,
    ...LABELS,
  }));
}

function apiError(status: number, type: string, message: string): Response {
  // retry-after 0: were the SDK allowed to retry, the extra calls would show at once.
  return Response.json(
    { type: "error", error: { type, message }, request_id: "req_e2e" },
    { status, headers: { "request-id": "req_e2e", "retry-after": "0" } },
  );
}

async function anthropic(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    model?: string;
    messages?: { content?: unknown }[];
    output_config?: { format?: { type?: string } };
  };
  const content = body.messages?.[0]?.content;
  const user = typeof content === "string" ? content : "";
  const ask = /Write exactly (\d+) (MCQs|written questions)\./.exec(user);
  const curriculum = /<curriculum>\n(.*)\n<\/curriculum>/.exec(user);
  if (request.headers.get("x-api-key") !== ANTHROPIC_KEY)
    model.faults.push("a call without the configured ANTHROPIC_API_KEY");
  if (body.model !== "claude-sonnet-5-5") model.faults.push(`a call to model ${body.model}`);
  if (body.output_config?.format?.type !== "json_schema")
    model.faults.push("a call without the JSON schema");
  if (!ask || !curriculum) {
    model.faults.push("a call that asks for no set on no curriculum point");
    return apiError(400, "invalid_request_error", "unrecognised request");
  }
  const call: ModelCall = {
    point: (JSON.parse(curriculum[1]) as { id: string }).id,
    format: ask[2] === "MCQs" ? "mcq" : "written",
    count: Number(ask[1]),
    reply: model.script.shift() ?? "valid",
    text: null,
    questions: [],
  };
  model.calls.push(call);
  const tag = replyTag(model.calls.length - 1);
  const hold = model.hold;
  model.hold = null;
  if (hold) {
    hold.arrive();
    await hold.released;
  }
  // A real call takes a while: let concurrent drains reach the database meanwhile.
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (call.reply === "credit")
    return apiError(
      400,
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    );
  if (call.reply === "rate_limit")
    return apiError(429, "rate_limit_error", "This request would exceed your rate limit.");
  if (call.reply === "bad_request")
    return apiError(
      400,
      "invalid_request_error",
      "messages: text content blocks must be non-empty",
    );
  if (call.reply === "overloaded") return apiError(529, "overloaded_error", "Overloaded");
  // No answer at all, so no status: the connection fails, or the call runs out
  // of time (the SDK reads "timed out" as its own timer, APIConnectionTimeoutError).
  if (call.reply === "dropped") throw new TypeError("fetch failed: the connection was reset");
  if (call.reply === "timeout") throw new TypeError("fetch failed: the request timed out");
  call.questions = call.format === "mcq" ? mcqSet(call.count, tag) : writtenSet(call.count, tag);
  if (call.reply === "duplicate_options")
    call.questions[2] = { ...call.questions[2], options: ["same", "Same", "same", "other"] };
  const json = JSON.stringify({ questions: call.questions });
  call.text =
    call.reply === "invalid_json"
      ? "I could not write these questions as JSON."
      : call.reply === "max_tokens"
        ? json.slice(0, 300)
        : json;
  return Response.json(
    {
      id: `msg_e2e_${tag}`,
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: call.text }],
      stop_reason: call.reply === "max_tokens" ? "max_tokens" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 2400,
        output_tokens: 1800,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 2000,
      },
    },
    { headers: { "request-id": `req_e2e_${tag}` } },
  );
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === SUPABASE_URL && url.pathname.startsWith("/rest/v1/"))
    return postgrest(request);
  if (url.origin === "https://api.anthropic.com" && url.pathname === "/v1/messages")
    return anthropic(request);
  strays.push(`${request.method} ${request.url}`);
  throw new TypeError(`This test has no network: ${request.method} ${request.url}`);
}) as unknown as typeof fetch;

// ── The worker, as the cron route and the tutor's button call it ──────────
type Kind = "quiz" | "task";
type Outcome = {
  job_id: number;
  spec_point_id: string;
  kind: Kind;
  result: "written" | "already_existed" | "lost_claim" | "failed";
  result_id?: string;
  failure?: string;
  error?: string;
  status_after?: string;
};
type RunNow = { status: string; resultId?: string; created?: boolean };
const worker = (await import(fileURLToPath(WORKER))) as {
  QUESTIONS: Record<Kind, number>;
  drainPracticeQueue: (opts?: {
    maxJobs?: number;
    only?: { specPointId: string; kind: Kind };
  }) => Promise<Outcome[]>;
  runPracticeJobNow: (specPointId: string, kind: Kind) => Promise<RunNow>;
  handlePracticeWorkerRequest: (request: Request) => Promise<Response>;
};
const { validateQuestions } = (await import(fileURLToPath(GENERATION))) as {
  validateQuestions: (value: unknown, count: number, format: "mcq" | "written") => unknown[];
};

// The worker's own logging, kept for a failure report instead of mixed into the results.
const workerLog: string[] = [];
for (const level of ["log", "info", "warn", "error", "debug"] as const)
  console[level] = (...args: unknown[]) =>
    void workerLog.push(
      `[${level}] ${args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: 4 }))).join(" ")}`,
    );
const say = (line: string) => process.stdout.write(`${line}\n`);
const watchdog = setTimeout(() => {
  process.stderr.write(`e2e: timed out\n${workerLog.join("\n")}\n`);
  process.exit(1);
}, 120_000);

// ── Helpers ────────────────────────────────────────────────────────────────
type Point = { id: string; code: string; title: string };
type Job = {
  id: number;
  kind: Kind;
  status: string;
  attempts: number;
  claim_token: string | null;
  lease_until: Date | null;
  last_error: string | null;
  result_id: string | null;
  completed_how: string | null;
  /** Seconds until it may be claimed: negative once it is ready. */
  wait_s: number;
};
type Run = {
  job_id: number | null;
  source: string;
  outcome: string;
  format: string;
  error: string | null;
  raw_output: string | null;
  stop_reason: string | null;
  questions: number | null;
  has_usage: boolean;
  /** The API's error status for a refused call, else null. */
  api_status: number | null;
  model: string;
  grounding: string;
  timed: boolean;
};
type QueueStatus = Record<string, unknown> & {
  paused_until: string | null;
  pause_reason: string | null;
  calls_24h: number;
  counts: Record<string, number>;
};

let points = 0;
async function newPoint(title: string): Promise<Point> {
  points += 1;
  const code = `3.${points}`;
  const { rows } = await db.query<{ id: string }>(
    "insert into public.spec_points (topic_id, code, title) values ($1, $2, $3) returning id",
    [TOPIC, code, title],
  );
  return { id: rows[0].id, code, title };
}

/** A write by the signed-in student, through RLS, as the planner makes it. */
const asStudent = (sql: string, params: unknown[]) =>
  db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [STUDENT]);
    await tx.query(sql, params);
  });
/** A point the student adds to this week, as addPoints does (an upsert ignoring duplicates). */
const addToWeek = (point: Point) =>
  asStudent(
    `insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'student')
     on conflict (plan_id, spec_point_id) do nothing`,
    [PLAN, point.id],
  );
/** The week saved again through the live save_weekly_plan, which re-saves a point by DO UPDATE. */
const resaveWeek = (point: Point) =>
  asStudent(
    `select public.save_weekly_plan(w.student_id, w.subject, w.board, w.level, w.week_start, 'ai', null, $2::jsonb)
       from public.student_weekly_plans w where w.id = $1`,
    [PLAN, JSON.stringify([{ spec_point_id: point.id, origin: "student" }])],
  );

/** A tutor's published quiz: on the point itself, or holding a question tagged with it. */
async function tutorQuiz(point: Point, how: "own" | "tagged"): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.mcq_sets (spec_point_id, title, published, subject, origin) values ($1, 'Tutor quiz', true, 'biology', 'tutor') returning id",
    [how === "own" ? point.id : null],
  );
  await db.query(
    `insert into public.mcq_questions (set_id, position, question, options, correct_index, explanation, spec_point_id)
     values ($1, 0, 'A tutor''s question', '["a", "b", "c", "d"]', 0, 'Because.', $2)`,
    [rows[0].id, point.id],
  );
  return rows[0].id;
}
/** A tutor's task: on the point itself, or linked to it through resource_spec_points. */
async function tutorTask(point: Point, how: "own" | "linked", status = "approved") {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.resources (kind, title, subject, board, level, spec_point_id, origin, review_status)
     values ('homework', 'Tutor task', 'biology', 'edexcel', 'gcse', $1, 'tutor', $2) returning id`,
    [how === "own" ? point.id : null, status],
  );
  if (how === "linked")
    await db.query(
      "insert into public.resource_spec_points (resource_id, spec_point_id) values ($1, $2)",
      [rows[0].id, point.id],
    );
  return rows[0].id;
}

const jobs = async (point: Point) =>
  (
    await db.query<Job>(
      `select id::int as id, kind, status, attempts, claim_token, lease_until, last_error, result_id,
              completed_how, extract(epoch from run_after - now())::float8 as wait_s
         from private.practice_jobs where spec_point_id = $1 order by kind`,
      [point.id],
    )
  ).rows;
async function job(point: Point, kind: Kind): Promise<Job> {
  const found = (await jobs(point)).find((j) => j.kind === kind);
  assert.ok(found, `${point.title}: there is a ${kind} job`);
  return found;
}
const state = (j: Job) => ({
  status: j.status,
  completed_how: j.completed_how,
  attempts: j.attempts,
  claim_token: j.claim_token,
  lease_until: j.lease_until,
  last_error: j.last_error,
  result_id: j.result_id,
});
const completed = (how: "written" | "already_existed", attempts: number, result_id: string) => ({
  status: "completed",
  completed_how: how,
  attempts,
  claim_token: null,
  lease_until: null,
  last_error: null,
  result_id,
});
/** Lets a job waiting out a retry delay be claimed now. */
const makeReady = (point: Point, kind: Kind) =>
  db.query(
    "update private.practice_jobs set run_after = now() - interval '1 second' where spec_point_id = $1 and kind = $2",
    [point.id, kind],
  );
const queue = async () =>
  (
    await db.query<{ paused_s: number | null; pause_reason: string | null }>(
      "select extract(epoch from paused_until - now())::float8 as paused_s, pause_reason from private.practice_queue",
    )
  ).rows[0];
const runs = async (point: Point) =>
  (
    await db.query<Run>(
      `select job_id::int as job_id, source, outcome, format, error, raw_output, stop_reason,
              case when jsonb_typeof(generated_questions) = 'array' then jsonb_array_length(generated_questions) end as questions,
              coalesce(jsonb_typeof(usage) = 'object', false) as has_usage, api_status, model,
              grounding, coalesce(duration_ms >= 0, false) as timed
         from public.exam_generation_runs where spec_point_id = $1 order by created_at, id`,
      [point.id],
    )
  ).rows;
const generatedSets = async (point: Point) =>
  (
    await db.query<{ id: string }>(
      "select id from public.mcq_sets where origin = 'generated' and spec_point_id = $1",
      [point.id],
    )
  ).rows.map((r) => r.id);
const homeworkSheets = async (point: Point) =>
  (
    await db.query<{ id: string }>(
      "select id from public.resources where kind = 'homework' and spec_point_id = $1",
      [point.id],
    )
  ).rows.map((r) => r.id);
const setQuestions = async (set: string) =>
  (
    await db.query(
      "select position, question, options, correct_index, explanation, spec_point_id from public.mcq_questions where set_id = $1 order by position",
      [set],
    )
  ).rows;

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : v);
/** The rows a call's quiz must be saved as: the worker trims, the database stores. */
const savedQuiz = (call: ModelCall, point: Point) =>
  call.questions.map((q, i) => ({
    position: i,
    question: trim(q.question),
    options: (q.options as string[]).map(trim),
    correct_index: q.correct_index,
    explanation: trim(q.explanation),
    spec_point_id: point.id,
  }));
const savedTask = (call: ModelCall, point: Point) =>
  call.questions.map((q, i) => ({
    position: i,
    prompt: trim(q.prompt),
    marks: q.marks,
    answer_type: q.answer_type,
    mark_scheme: trim(q.mark_scheme),
    spec_point_id: point.id,
  }));
/** What the validator says about a reply, word for word. */
function validatorSays(call: ModelCall): string {
  try {
    validateQuestions(JSON.parse(call.text ?? ""), call.count, call.format);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("the scripted bad set passed the validator");
}

/** A point already covered by a tutor's task, so only its quiz is waiting. */
async function quizOnly(title: string): Promise<Point> {
  const point = await newPoint(title);
  const task = await tutorTask(point, "own");
  await addToWeek(point);
  assert.deepEqual(state(await job(point, "task")), completed("already_existed", 0, task));
  assert.equal((await job(point, "quiz")).status, "pending");
  return point;
}

async function counted<T>(run: () => Promise<T>): Promise<{ value: T; calls: ModelCall[] }> {
  const from = model.calls.length;
  const value = await run();
  return { value, calls: model.calls.slice(from) };
}
/** Holds the next model call open; resolves `arrived` once the worker is waiting on it. */
function holdNextModelCall() {
  let arrive = () => {};
  let release = () => {};
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  model.hold = { arrive, released };
  return { arrived, release };
}
function untilCalled(arrived: Promise<void>, drain: Promise<unknown>, who: string) {
  return Promise.race([
    arrived,
    drain.then((value) => {
      throw new Error(`${who} finished without calling the model: ${JSON.stringify(value)}`);
    }),
  ]);
}
/** One call per job, on this point: a quiz and a task, never a second of either. */
function oneCallPerJob(calls: ModelCall[], point: Point, label: string) {
  assert.deepEqual(
    calls.map((c) => `${c.point === point.id ? "this point" : c.point} ${c.format}`).sort(),
    ["this point mcq", "this point written"],
    label,
  );
}
async function oneOfEach(point: Point, label: string) {
  assert.equal((await generatedSets(point)).length, 1, `${label}: one quiz`);
  assert.equal((await homeworkSheets(point)).length, 1, `${label}: one task`);
}
const near = (actual: number | null | undefined, expected: number, within: number, label: string) =>
  assert.ok(
    actual !== null && actual !== undefined && Math.abs(actual - expected) <= within,
    `${label}: expected about ${expected}, got ${actual}`,
  );
const byKind = (a: Outcome, b: Outcome) => a.kind.localeCompare(b.kind);
const withoutError = ({ error, ...rest }: Outcome) => {
  assert.ok(typeof error === "string" && error.trim(), "a failed outcome says why");
  return rest;
};

/** The harness's own calls, as the service role: through the same stand-in, kept apart. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json", "x-e2e-harness": "1" },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  assert.ok(response.ok, `rpc ${name}: ${response.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}
const resume = () => rpc("pause_practice_queue", { _minutes: 0 });
const calls24h = async () => (await rpc<QueueStatus>("practice_queue_status", {})).calls_24h;
const setDailyCap = (calls: number) =>
  db.query("update private.practice_queue set daily_call_limit = $1", [calls]);
/** Every model call so far the daily cap should count: all but the ones the API refused. */
const billable = () => model.calls.filter((c) => !(c.reply in REFUSED)).length;

type Knock = {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  timeout_milliseconds: number;
};
/** The minute job, as pg_cron runs it: the request it queued in pg_net, or null for none. */
async function knock(): Promise<Knock | null> {
  const before = await db.query<{ last: number }>(
    "select coalesce(max(id), 0)::int as last from net.requests",
  );
  await db.query("select private.kick_practice_worker()");
  const { rows } = await db.query<Knock>(
    "select url, body, headers, timeout_milliseconds from net.requests where id > $1 order by id",
    [before.rows[0].last],
  );
  assert.ok(rows.length <= 1, "one knock at a time");
  return rows[0] ?? null;
}
/** pg_net delivering a knock to the worker route's handler. */
async function answer(sent: Knock): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await worker.handlePracticeWorkerRequest(
    new Request(sent.url, {
      method: "POST",
      headers: sent.headers,
      body: JSON.stringify(sent.body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const workerRequests = () => served.filter((s) => !s.byHarness);
const describe = (s: Served) =>
  `${s.path} ${JSON.stringify(s.body).slice(0, 240)} -> ${s.status} ${s.answer.slice(0, 400)}`;
const claimCalls = () =>
  workerRequests().filter((s) => s.path === "rpc/claim_practice_jobs").length;

/** What must hold after every scenario, whatever it did. */
async function settled(label: string) {
  const { rows } = await db.query<{
    generating: number;
    ready: number;
    unresolved: number;
    runs: number;
  }>(
    `select (select count(*) from private.practice_jobs where status = 'generating')::int as generating,
            (select count(*) from private.practice_jobs where status = 'pending' and run_after <= now())::int as ready,
            (select count(*) from public.exam_generation_runs where source = 'queue' and outcome = 'passed')::int as unresolved,
            (select count(*) from public.exam_generation_runs where source = 'queue')::int as runs`,
  );
  const [s] = rows;
  assert.deepEqual(
    workerRequests()
      .filter((r) => r.status >= 400 && !expectedFailures.has(r))
      .map(describe),
    [],
    `${label}: every request the worker made succeeded`,
  );
  assert.deepEqual(model.faults, [], `${label}: every model call was well formed`);
  assert.deepEqual(strays, [], `${label}: nothing left the process`);
  assert.equal(s.runs, model.calls.length, `${label}: one queue run row per model call`);
  assert.equal(
    await calls24h(),
    billable(),
    `${label}: the daily cap counts every call but the ones the API refused`,
  );
  assert.equal(s.unresolved, 0, `${label}: every run that passed was then saved or discarded`);
  assert.equal(s.generating, 0, `${label}: no job is left generating`);
  assert.equal(s.ready, 0, `${label}: no job is left ready`);
  say(`e2e ok: ${label}`);
}

try {
  // ── 1. A week saved by the student queues the point's quiz and task ────────
  const p1 = await newPoint("Alleles and inherited differences");
  await addToWeek(p1);
  assert.deepEqual(
    (await jobs(p1)).map((j) => [j.kind, j.status, j.attempts, j.wait_s <= 0]),
    [
      ["quiz", "pending", 0, true],
      ["task", "pending", 0, true],
    ],
    "the student's own insert queues a quiz and a task, ready now",
  );
  await resaveWeek(p1);
  assert.equal((await jobs(p1)).length, 2, "re-saving the week adds no job");
  say("e2e ok: a week insert queues a quiz job and a task job; a re-save adds none");

  // ── 2. One drain writes both, exactly as specified ─────────────────────────
  {
    const first = await counted(() => worker.drainPracticeQueue());
    assert.deepEqual({ ...worker.QUESTIONS }, { quiz: 8, task: 5 }, "today's sizes");
    assert.deepEqual(
      first.calls.map((c) => [c.point, c.format, c.count]).sort(),
      [
        [p1.id, "mcq", 8],
        [p1.id, "written", 5],
      ],
      "one call per job, at today's sizes",
    );
    const [quizJob, taskJob] = await jobs(p1);
    const [set] = await generatedSets(p1);
    const [sheet] = await homeworkSheets(p1);
    assert.ok(set && sheet, "a quiz and a task were written");
    assert.deepEqual(first.value.sort(byKind), [
      { job_id: quizJob.id, spec_point_id: p1.id, kind: "quiz", result: "written", result_id: set },
      {
        job_id: taskJob.id,
        spec_point_id: p1.id,
        kind: "task",
        result: "written",
        result_id: sheet,
      },
    ]);
    const mcqCall = first.calls.find((c) => c.format === "mcq")!;
    const writtenCall = first.calls.find((c) => c.format === "written")!;
    const title = `${p1.code} ${p1.title}`;
    assert.deepEqual(
      (
        await db.query(
          "select spec_point_id, title, description, published, subject::text as subject, created_by, origin::text as origin from public.mcq_sets where id = $1",
          [set],
        )
      ).rows,
      [
        {
          spec_point_id: p1.id,
          title,
          description: "Practice questions for this spec point",
          published: true,
          subject: "biology",
          created_by: null,
          origin: "generated",
        },
      ],
    );
    assert.deepEqual(
      await setQuestions(set),
      savedQuiz(mcqCall, p1),
      "the quiz's questions are the model's, trimmed, case kept (TT/Tt/tt)",
    );
    assert.deepEqual(
      (
        await db.query(
          `select kind::text as kind, title, subject::text as subject, board::text as board, level::text as level,
                  spec_point_id, created_by, origin::text as origin, review_status, publish_at <= now() as visible
             from public.resources where id = $1`,
          [sheet],
        )
      ).rows,
      [
        {
          kind: "homework",
          title,
          subject: "biology",
          board: "edexcel",
          level: "gcse",
          spec_point_id: p1.id,
          created_by: null,
          origin: "generated",
          review_status: "to_review",
          visible: true,
        },
      ],
    );
    assert.deepEqual(
      (
        await db.query(
          "select position, prompt, marks, answer_type, mark_scheme, spec_point_id from public.homework_questions where resource_id = $1 order by position",
          [sheet],
        )
      ).rows,
      savedTask(writtenCall, p1),
      "the task's questions are the model's, trimmed",
    );
    assert.deepEqual(
      (
        await db.query<{ spec_point_id: string }>(
          "select spec_point_id from public.resource_spec_points where resource_id = $1",
          [sheet],
        )
      ).rows.map((r) => r.spec_point_id),
      [p1.id],
    );
    assert.deepEqual(
      (await runs(p1)).sort((a, b) => a.format.localeCompare(b.format)),
      [
        {
          job_id: quizJob.id,
          source: "queue",
          outcome: "saved",
          format: "mcq",
          error: null,
          raw_output: null,
          stop_reason: "end_turn",
          questions: 8,
          has_usage: true,
          api_status: null,
          model: "claude-sonnet-5-5",
          grounding: "curriculum_only",
          timed: true,
        },
        {
          job_id: taskJob.id,
          source: "queue",
          outcome: "saved",
          format: "written",
          error: null,
          raw_output: null,
          stop_reason: "end_turn",
          questions: 5,
          has_usage: true,
          api_status: null,
          model: "claude-sonnet-5-5",
          grounding: "curriculum_only",
          timed: true,
        },
      ],
    );
    assert.deepEqual(state(quizJob), completed("written", 1, set));
    assert.deepEqual(state(taskJob), completed("written", 1, sheet));
    await settled("one drain writes the quiz and the task as specified; runs saved; jobs written");

    // ── 3. Nothing is paid for twice ─────────────────────────────────────────
    const claimsBefore = claimCalls();
    const second = await counted(() => worker.drainPracticeQueue());
    assert.deepEqual(second.value, []);
    assert.equal(second.calls.length, 0, "a second drain makes no model call");
    assert.equal(claimCalls() - claimsBefore, 1, "a drain claims once");
    await resaveWeek(p1);
    assert.deepEqual(
      (await jobs(p1)).map(state),
      [completed("written", 1, set), completed("written", 1, sheet)],
      "re-saving the week leaves written jobs alone",
    );
    const quizNow = await counted(() => worker.runPracticeJobNow(p1.id, "quiz"));
    const taskNow = await counted(() => worker.runPracticeJobNow(p1.id, "task"));
    assert.deepEqual(quizNow.value, { status: "completed", resultId: set, created: false });
    assert.deepEqual(taskNow.value, { status: "completed", resultId: sheet, created: false });
    assert.equal(quizNow.calls.length + taskNow.calls.length, 0);
    await settled(
      "a second drain, a re-saved week and runPracticeJobNow on written content make no call",
    );
  }

  // ── 4. Drains at once: one call per job, one quiz and one task per point ───
  {
    const p2 = await newPoint("Variation within a species");
    await addToWeek(p2);
    const pair = await counted(() =>
      Promise.all([worker.drainPracticeQueue(), worker.drainPracticeQueue()]),
    );
    oneCallPerJob(pair.calls, p2, "two drains started together");
    assert.deepEqual(
      pair.value
        .flat()
        .map((o) => `${o.kind} ${o.result}`)
        .sort(),
      ["quiz written", "task written"],
    );
    await oneOfEach(p2, "two drains started together");

    const p3 = await newPoint("Genetic and environmental variation");
    await addToWeek(p3);
    const four = await counted(() =>
      Promise.all(Array.from({ length: 4 }, () => worker.drainPracticeQueue({ maxJobs: 1 }))),
    );
    oneCallPerJob(four.calls, p3, "four one-job drains started together");
    assert.deepEqual(four.value.map((o) => o.length).sort(), [0, 0, 1, 1]);
    await oneOfEach(p3, "four one-job drains started together");

    // The cron drain and a tutor pressing "generate" for both, all at once.
    const p4 = await newPoint("Mutation and phenotype");
    await addToWeek(p4);
    const race = await counted(() =>
      Promise.all([
        worker.drainPracticeQueue(),
        worker.runPracticeJobNow(p4.id, "quiz"),
        worker.runPracticeJobNow(p4.id, "task"),
      ]),
    );
    oneCallPerJob(race.calls, p4, "the cron drain racing a tutor's presses");
    await oneOfEach(p4, "the cron drain racing a tutor's presses");
    const [set4] = await generatedSets(p4);
    const [sheet4] = await homeworkSheets(p4);
    for (const [pressed, id] of [
      [race.value[1], set4],
      [race.value[2], sheet4],
    ] as const)
      assert.ok(
        pressed.status === "busy" || (pressed.status === "completed" && pressed.resultId === id),
        `a press during a drain is busy, or the one write: ${JSON.stringify(pressed)}`,
      );
    await settled("drains and tutor presses at once make one call per job, one quiz and task each");
  }

  // ── 5. A tutor's content: automatic jobs never pay for it, before or after the week ─
  {
    const p5 = await newPoint("Selective breeding");
    const tutorSet = await tutorQuiz(p5, "own");
    const linkedTask = await tutorTask(p5, "linked");
    await addToWeek(p5);
    assert.deepEqual(
      (await jobs(p5)).map(state),
      [completed("already_existed", 0, tutorSet), completed("already_existed", 0, linkedTask)],
      "enqueue: a published tutor quiz and a linked task complete both jobs",
    );
    const p6 = await newPoint("Genetic engineering");
    await addToWeek(p6);
    assert.deepEqual(
      (await jobs(p6)).map((j) => j.status),
      ["pending", "pending"],
    );
    const taggedSet = await tutorQuiz(p6, "tagged");
    const heldTask = await tutorTask(p6, "own", "held");
    const quiet = await counted(() => worker.drainPracticeQueue());
    assert.deepEqual(quiet.value, [], "claim: content that arrived meanwhile is not handed out");
    assert.equal(quiet.calls.length, 0);
    assert.deepEqual((await jobs(p6)).map(state), [
      completed("already_existed", 0, taggedSet),
      completed("already_existed", 0, heldTask),
    ]);
    const written = await db.query<{ n: number }>(
      `select ((select count(*) from public.mcq_sets where origin = 'generated' and spec_point_id in ($1, $2))
             + (select count(*) from public.resources where origin = 'generated' and spec_point_id in ($1, $2)))::int as n`,
      [p5.id, p6.id],
    );
    assert.equal(written.rows[0].n, 0, "nothing generated for either point");
    await settled(
      "a tutor's content, there before the week or added after, completes automatic jobs unpaid",
    );

    // A tutor who asks for the AI quiz gets it beside their own: a press counts
    // only the point's own generated set.
    const pressed = await counted(() => worker.runPracticeJobNow(p5.id, "quiz"));
    assert.equal(pressed.calls.length, 1, "the press re-arms the job: one call");
    const [generated] = await generatedSets(p5);
    assert.ok(generated && generated !== tutorSet, "a generated set is written");
    assert.deepEqual(pressed.value, { status: "completed", resultId: generated, created: true });
    assert.deepEqual(state(await job(p5, "quiz")), completed("written", 1, generated));
    assert.deepEqual(await setQuestions(generated), savedQuiz(pressed.calls[0], p5));
    assert.deepEqual(
      (
        await db.query(
          "select id, published from public.mcq_sets where spec_point_id = $1 and origin = 'tutor'",
          [p5.id],
        )
      ).rows,
      [{ id: tutorSet, published: true }],
      "the tutor's own quiz stays as it was",
    );
    const again = await counted(() => worker.runPracticeJobNow(p5.id, "quiz"));
    assert.deepEqual(
      again.value,
      { status: "completed", resultId: generated, created: false },
      "pressing again answers with the generated set, not the tutor's",
    );
    assert.equal(again.calls.length, 0);
    await settled(
      "a tutor's press adds the AI quiz beside their own (one call); pressing again pays nothing",
    );
  }

  // ── 6. A set written while the call is out is kept; nothing is dropped silently ─
  {
    const p7 = await quizOnly("Cloning");
    const hold = holdNextModelCall();
    const drain = worker.drainPracticeQueue({ only: { specPointId: p7.id, kind: "quiz" } });
    await untilCalled(hold.arrived, drain, "the worker");
    // The deployed site's own writer, still live until this PR is.
    const legacy = await rpc<string>("ensure_generated_mcq_set", {
      _spec_point_id: p7.id,
      _questions: [
        {
          question: "Written by the deployed site",
          options: ["a", "b", "c", "d"],
          correct_index: 2,
          explanation: "Because.",
        },
      ],
    });
    hold.release();
    const outcomes = await drain;
    const quiz7 = await job(p7, "quiz");
    assert.deepEqual(outcomes, [
      {
        job_id: quiz7.id,
        spec_point_id: p7.id,
        kind: "quiz",
        result: "already_existed",
        result_id: legacy,
      },
    ]);
    assert.deepEqual(state(quiz7), completed("already_existed", 1, legacy));
    assert.deepEqual(await generatedSets(p7), [legacy], "no second set");
    assert.equal((await setQuestions(legacy)).length, 1, "the set already there is kept as it was");
    assert.deepEqual(
      (await runs(p7)).map((r) => [r.outcome, r.error]),
      [["discarded", "Content already existed when saving"]],
    );
    await settled(
      "a set written meanwhile is kept: already_existed, the run discarded, no second set",
    );
  }

  // ── 7. A bad answer is logged and retried, later each time, three times at most ─
  const p8 = await quizOnly("Classification of living organisms");
  {
    const only = { specPointId: p8.id, kind: "quiz" as const };
    const attempt = async (reply: Reply) => {
      model.script.push(reply);
      const run = await counted(() => worker.drainPracticeQueue({ only }));
      assert.equal(run.calls.length, 1, `${reply}: one call`);
      return { outcome: run.value, call: run.calls[0], job: await job(p8, "quiz") };
    };
    const expectations: [Reply, string, number, string, number | null][] = [
      ["duplicate_options", "", 1, "pending", 600],
      ["invalid_json", "AI returned invalid JSON", 2, "pending", 1200],
      ["max_tokens", "AI did not complete the question set", 3, "failed", null],
    ];
    for (const [reply, said, attempts, after, wait] of expectations) {
      const { outcome, call, job: j } = await attempt(reply);
      const message = said || validatorSays(call);
      assert.deepEqual(outcome, [
        {
          job_id: j.id,
          spec_point_id: p8.id,
          kind: "quiz",
          result: "failed",
          failure: "retry",
          error: message,
          status_after: after,
        },
      ]);
      assert.deepEqual(
        { status: j.status, attempts: j.attempts, last_error: j.last_error, claim: j.claim_token },
        { status: after, attempts, last_error: message, claim: null },
        `${reply}: the job afterwards`,
      );
      if (wait !== null) near(j.wait_s, wait, 5, `${reply}: the retry waits`);
      assert.deepEqual(
        (await runs(p8)).at(-1),
        {
          job_id: j.id,
          source: "queue",
          outcome: "failed",
          format: "mcq",
          error: message,
          raw_output: call.text,
          stop_reason: reply === "max_tokens" ? "max_tokens" : "end_turn",
          questions: null,
          has_usage: true,
          api_status: null,
          model: "claude-sonnet-5-5",
          grounding: "curriculum_only",
          timed: true,
        },
        `${reply}: the failed run keeps what came back`,
      );
      if (wait !== null) {
        const early = await counted(() => worker.drainPracticeQueue());
        assert.equal(early.calls.length, 0, `${reply}: a job waiting out its delay is not taken`);
        await makeReady(p8, "quiz");
      }
    }
    const after = await counted(() => worker.drainPracticeQueue());
    assert.equal(after.calls.length, 0, "a failed job is not taken again");
    await settled(
      "bad options, bad JSON, a cut-off answer: runs failed with raw_output; waits 10 then 20 min; third is final",
    );
  }

  // ── 8. A request the API calls invalid is not sent again ───────────────────
  {
    const p9 = await quizOnly("Evolution by natural selection");
    model.script.push("bad_request");
    const run = await counted(() =>
      worker.drainPracticeQueue({ only: { specPointId: p9.id, kind: "quiz" } }),
    );
    assert.equal(run.calls.length, 1);
    const j = await job(p9, "quiz");
    assert.deepEqual(run.value.map(withoutError), [
      {
        job_id: j.id,
        spec_point_id: p9.id,
        kind: "quiz",
        result: "failed",
        failure: "give_up",
        status_after: "failed",
      },
    ]);
    assert.deepEqual([j.status, j.attempts], ["failed", 1]);
    assert.deepEqual(
      (await runs(p9)).map((r) => [r.outcome, !!r.error, r.has_usage, r.questions, r.api_status]),
      [["failed", true, false, null, 400]],
      "a refused call is logged with no usage, and the API's status",
    );
    await settled("a request the API rejects as invalid gives up at once");
  }

  // ── 9. A tutor's press re-arms a failed job and writes it ──────────────────
  {
    const redo = await counted(() => worker.runPracticeJobNow(p8.id, "quiz"));
    assert.equal(redo.calls.length, 1);
    const [set] = await generatedSets(p8);
    assert.deepEqual(redo.value, { status: "completed", resultId: set, created: true });
    assert.deepEqual(state(await job(p8, "quiz")), completed("written", 1, set));
    assert.deepEqual(await setQuestions(set), savedQuiz(redo.calls[0], p8));
    assert.deepEqual(
      (await runs(p8)).map((r) => r.outcome),
      ["failed", "failed", "failed", "saved"],
    );
    await settled("runPracticeJobNow re-arms a failed job and writes it (created: true)");
  }

  // ── 10. Out of credit: everything stops, and the attempt is not held against the job ─
  {
    const p10 = await quizOnly("Speciation");
    model.script.push("credit");
    const run = await counted(() =>
      worker.drainPracticeQueue({ only: { specPointId: p10.id, kind: "quiz" } }),
    );
    assert.equal(run.calls.length, 1);
    const j = await job(p10, "quiz");
    assert.deepEqual(run.value.map(withoutError), [
      {
        job_id: j.id,
        spec_point_id: p10.id,
        kind: "quiz",
        result: "failed",
        failure: "outage",
        status_after: "pending",
      },
    ]);
    const paused = await queue();
    near(paused.paused_s, 30 * 60, 5, "the queue pauses for 30 minutes");
    assert.ok(paused.pause_reason?.trim(), "and says why");
    assert.deepEqual([j.status, j.attempts], ["pending", 0], "the attempt is not counted");
    near(j.wait_s, paused.paused_s!, 1, "the job waits for the pause to end");
    const [refused] = await runs(p10);
    assert.deepEqual(
      [
        refused.outcome,
        refused.has_usage,
        refused.questions,
        refused.raw_output,
        refused.api_status,
      ],
      ["failed", false, null, null, 400],
    );
    assert.match(refused.error ?? "", /credit balance/i, "the run keeps the API's own words");
    const status = await rpc<QueueStatus>("practice_queue_status", {});
    const keys =
      "paused_until pause_reason daily_call_limit calls_24h in_flight max_in_flight max_attempts counts ready failed";
    for (const key of keys.split(" ")) assert.ok(key in status, `practice_queue_status has ${key}`);
    assert.ok(status.paused_until, "the status shows the pause");

    const drained = await counted(() => worker.drainPracticeQueue());
    assert.deepEqual(drained.value, []);
    assert.equal(drained.calls.length, 0, "nothing is called while paused");

    // No press meanwhile: resuming alone must free the job the pause held back.
    await resume();
    assert.equal((await queue()).paused_s, null, "resumed");
    assert.ok((await job(p10, "quiz")).wait_s <= 0, "the job is due the moment the queue resumes");
    const resumed = await counted(() => worker.drainPracticeQueue());
    assert.equal(resumed.calls.length, 1);
    const [set] = await generatedSets(p10);
    assert.deepEqual(resumed.value, [
      { job_id: j.id, spec_point_id: p10.id, kind: "quiz", result: "written", result_id: set },
    ]);
    assert.deepEqual(state(await job(p10, "quiz")), completed("written", 1, set));
    await settled(
      "a credit outage pauses 30 min, the attempt uncounted; no call until resumed, then due at once",
    );
  }

  // ── 11. A rate limit: a short pause, one call only, the attempt not counted ─
  {
    const p11 = await quizOnly("Fossils");
    model.script.push("rate_limit");
    const run = await counted(() =>
      worker.drainPracticeQueue({ only: { specPointId: p11.id, kind: "quiz" } }),
    );
    assert.equal(run.calls.length, 1, "one call: the SDK does not retry it");
    const j = await job(p11, "quiz");
    assert.deepEqual(run.value, [
      {
        job_id: j.id,
        spec_point_id: p11.id,
        kind: "quiz",
        result: "failed",
        failure: "outage",
        error: "AI rate limit — try again in a moment",
        status_after: "pending",
      },
    ]);
    near((await queue()).paused_s, 2 * 60, 5, "the queue pauses for 2 minutes");
    assert.deepEqual([j.status, j.attempts], ["pending", 0], "the attempt is not counted");
    assert.equal((await runs(p11)).at(-1)?.api_status, 429, "the run keeps the API's status");
    const pressed = await counted(() => worker.runPracticeJobNow(p11.id, "quiz"));
    assert.deepEqual(pressed.value, { status: "paused" }, "a press while paused");
    assert.equal(pressed.calls.length, 0, "calls nothing");
    await resume();
    const back = await counted(() => worker.runPracticeJobNow(p11.id, "quiz"));
    assert.equal(back.calls.length, 1);
    const [set] = await generatedSets(p11);
    assert.deepEqual(back.value, { status: "completed", resultId: set, created: true });
    await settled(
      "a rate limit pauses 2 min, one call, the attempt uncounted; a press meanwhile waits",
    );
  }

  // ── 12. A lease that ran out: the first worker's save is refused while the second holds the job ─
  {
    const p12 = await quizOnly("Extinction");
    const only = { specPointId: p12.id, kind: "quiz" as const };
    const from = served.length;
    const first = holdNextModelCall();
    const slow = worker.drainPracticeQueue({ only });
    await untilCalled(first.arrived, slow, "the first worker");
    const claimed = await job(p12, "quiz");
    assert.deepEqual([claimed.status, claimed.attempts], ["generating", 1]);

    const busy = await counted(() => worker.runPracticeJobNow(p12.id, "quiz"));
    assert.deepEqual(busy.value, { status: "busy" }, "a press while it is being written");
    assert.equal(busy.calls.length, 0);

    // Its lease runs out mid-call, and a second worker takes the job over.
    await db.query(
      "update private.practice_jobs set lease_until = now() - interval '1 second' where id = $1",
      [claimed.id],
    );
    const second = holdNextModelCall();
    const takeover = worker.drainPracticeQueue({ only });
    await untilCalled(second.arrived, takeover, "the second worker");
    const secondCall = model.calls.at(-1)!;
    const retaken = await job(p12, "quiz");
    assert.deepEqual([retaken.status, retaken.attempts], ["generating", 2]);
    assert.notEqual(retaken.claim_token, claimed.claim_token, "under a new token");

    // The first answer comes back while the second worker holds the job.
    first.release();
    assert.deepEqual(await slow, [
      { job_id: claimed.id, spec_point_id: p12.id, kind: "quiz", result: "lost_claim" },
    ]);
    assert.deepEqual(await generatedSets(p12), [], "nothing is saved from a lost claim");
    assert.equal((await job(p12, "quiz")).claim_token, retaken.claim_token, "the job is untouched");

    second.release();
    const outcomes = await takeover;
    const [set] = await generatedSets(p12);
    assert.ok(set, "the second worker's set is written");
    assert.deepEqual(outcomes, [
      {
        job_id: claimed.id,
        spec_point_id: p12.id,
        kind: "quiz",
        result: "written",
        result_id: set,
      },
    ]);
    assert.deepEqual(
      await setQuestions(set),
      savedQuiz(secondCall, p12),
      "the second worker's questions",
    );
    assert.deepEqual(state(await job(p12, "quiz")), completed("written", 2, set));
    assert.deepEqual((await runs(p12)).map((r) => [r.outcome, r.error]).sort(), [
      ["discarded", "Claim lost before saving"],
      ["saved", null],
    ]);
    assert.equal(
      served.slice(from).filter((s) => !s.byHarness && s.path === "rpc/fail_practice_job").length,
      0,
      "a lost claim is not recorded as a failure",
    );
    await settled(
      "a lapsed lease: the second worker writes; the first one's save is lost_claim, its run discarded",
    );
  }

  // ── 13. A save the database refuses: its run is closed as failed, the job tried again ─
  {
    const p13 = await quizOnly("Antibiotic resistance");
    const only = { specPointId: p13.id, kind: "quiz" as const };
    await db.query("insert into public.test_refused_saves values ($1)", [p13.id]);
    const from = served.length;
    const refused = await counted(() => worker.drainPracticeQueue({ only }));
    assert.equal(refused.calls.length, 1);
    const failedSaves = served.slice(from).filter((s) => !s.byHarness && s.status >= 400);
    assert.deepEqual(
      failedSaves.map((s) => [s.path, s.status]),
      [["rpc/complete_practice_job", 400]],
      "the save raised",
    );
    failedSaves.forEach((s) => expectedFailures.add(s));
    const j = await job(p13, "quiz");
    const message = refused.value[0]?.error ?? "";
    assert.match(message, /The database refused this save/, "the outcome says why");
    assert.deepEqual(refused.value, [
      {
        job_id: j.id,
        spec_point_id: p13.id,
        kind: "quiz",
        result: "failed",
        failure: "retry",
        error: message,
        status_after: "pending",
      },
    ]);
    assert.deepEqual(
      { status: j.status, attempts: j.attempts, last_error: j.last_error, claim: j.claim_token },
      { status: "pending", attempts: 1, last_error: message, claim: null },
    );
    near(j.wait_s, 600, 5, "a failed save is tried again in 10 minutes");
    assert.deepEqual(await generatedSets(p13), [], "nothing was saved");
    assert.deepEqual(
      (await runs(p13)).map((r) => [r.outcome, r.error, r.has_usage, r.questions]),
      [["failed", message, true, 8]],
      "the call's run is closed as failed, keeping its questions and usage",
    );

    await db.query("delete from public.test_refused_saves where spec_point_id = $1", [p13.id]);
    const early = await counted(() => worker.drainPracticeQueue());
    assert.equal(early.calls.length, 0, "the job waits out its delay");
    // A tutor's press skips the wait.
    const pressed = await counted(() => worker.runPracticeJobNow(p13.id, "quiz"));
    assert.equal(pressed.calls.length, 1);
    const sets = await generatedSets(p13);
    assert.equal(sets.length, 1, "one set");
    assert.deepEqual(pressed.value, { status: "completed", resultId: sets[0], created: true });
    assert.deepEqual(await setQuestions(sets[0]), savedQuiz(pressed.calls[0], p13));
    assert.deepEqual(state(await job(p13, "quiz")), completed("written", 2, sets[0]));
    assert.deepEqual(
      (await runs(p13)).map((r) => r.outcome),
      ["failed", "saved"],
    );
    await settled(
      "a save the database refuses closes its run as failed; the job waits, a press skips the wait, one set",
    );
  }

  // ── 14. A save that went through though its answer was lost: nothing redone ─
  {
    const p14 = await quizOnly("Inherited disorders");
    loseNextAnswer.add("rpc/complete_practice_job");
    const lost = await counted(() =>
      worker.drainPracticeQueue({ only: { specPointId: p14.id, kind: "quiz" } }),
    );
    assert.equal(lost.calls.length, 1);
    assert.equal(loseNextAnswer.size, 0, "the save's answer was lost");
    const [set] = await generatedSets(p14);
    assert.ok(set, "the save went through");
    const j = await job(p14, "quiz");
    assert.deepEqual(
      lost.value,
      [{ job_id: j.id, spec_point_id: p14.id, kind: "quiz", result: "lost_claim" }],
      "not a failure: the job is no longer the worker's",
    );
    assert.deepEqual(state(j), completed("written", 1, set), "the job stays written");
    assert.deepEqual(
      (await runs(p14)).map((r) => [r.outcome, r.error]),
      [["saved", null]],
      "a saved run stays saved",
    );
    await settled(
      "a save whose answer was lost stays saved: the job written, the run saved, nothing tried again",
    );
  }

  // ── 15. The minute job knocks only when a call may start, and the worker answers ─
  {
    await db.query(
      "insert into vault.decrypted_secrets values ('practice_worker_url', $1), ('practice_worker_secret', $2)",
      [WORKER_URL, WORKER_SECRET],
    );
    assert.equal(await knock(), null, "nothing ready: no knock");
    const p15 = await newPoint("Variation and selection");
    await addToWeek(p15);
    const door = await knock();
    assert.deepEqual(door, {
      url: WORKER_URL,
      body: {},
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${WORKER_SECRET}` },
      timeout_milliseconds: 300000,
    });
    const woken = await counted(() => answer(door!));
    assert.equal(woken.value.status, 200, "the route takes the minute job's secret");
    assert.equal(woken.value.body.claimed, 2);
    assert.deepEqual(
      (woken.value.body.outcomes as Outcome[]).map((o) => `${o.kind} ${o.result}`).sort(),
      ["quiz written", "task written"],
    );
    oneCallPerJob(woken.calls, p15, "the worker the knock woke");
    await oneOfEach(p15, "the worker the knock woke");
    assert.equal(await knock(), null, "nothing left: no knock");

    // At the in-flight limit, no knock though a job is ready.
    await db.query("update private.practice_queue set max_in_flight = 1");
    const p16 = await newPoint("Natural selection in action");
    await addToWeek(p16);
    const held = holdNextModelCall();
    const first = await knock();
    assert.ok(first, "a call may start: a knock");
    const busy = answer(first);
    await untilCalled(held.arrived, busy, "the woken worker");
    assert.equal(await knock(), null, "one call in flight at a limit of one: no knock");
    held.release();
    assert.equal((await busy).body.claimed, 1, "the worker took one job, as the limit allows");
    const next = await knock();
    assert.ok(next, "that call done, the other job gets its knock");
    assert.equal((await answer(next)).body.claimed, 1);
    await oneOfEach(p16, "one job at a time");
    await db.query("update private.practice_queue set max_in_flight = 3");
    assert.equal(await knock(), null, "nothing left: no knock");
    await settled(
      "the minute job knocks only when a call may start (not at the in-flight limit); the woken worker writes",
    );
  }

  // ── 16. The daily cap counts billed calls, and lost ones, never refused ones ─
  {
    const billed = billable();
    assert.ok(model.calls.length > billed, "some calls so far were refused (400s, a 429)");
    assert.equal(
      await calls24h(),
      billed,
      "the cap counts only the calls that may have been billed",
    );

    // Room for one more billed call. An outage then refuses two calls in a
    // row (no credit, then overloaded), and each pause ends.
    await setDailyCap(billed + 1);
    const p17 = await quizOnly("Conservation of species");
    const only17 = { specPointId: p17.id, kind: "quiz" as const };
    for (const [reply, status] of [
      ["credit", 400],
      ["overloaded", 529],
    ] as const) {
      model.script.push(reply);
      const refused = await counted(() => worker.drainPracticeQueue({ only: only17 }));
      assert.equal(refused.calls.length, 1, `${reply}: one call`);
      assert.deepEqual(
        refused.value.map((o) => [o.result, o.failure, o.status_after]),
        [["failed", "outage", "pending"]],
      );
      const run = (await runs(p17)).at(-1)!;
      assert.deepEqual(
        [run.outcome, run.has_usage, run.api_status],
        ["failed", false, status],
        `${reply}: refused, unbilled, with the API's status`,
      );
      await resume();
    }
    assert.equal(await calls24h(), billed, "the outage's refused calls are not counted");
    // Were they counted, the queue would now sit at its cap for a day.
    const door = await knock();
    assert.ok(door, "once the pause ends the minute job knocks");
    const resumed = await counted(() => answer(door));
    assert.equal(resumed.calls.length, 1, "and the woken worker makes the call");
    assert.deepEqual(
      (resumed.value.body.outcomes as Outcome[]).map((o) => [o.spec_point_id, o.result]),
      [[p17.id, "written"]],
    );
    assert.equal(await calls24h(), billed + 1, "a billed call counts: the cap is reached");

    // At the cap: no knock though a job is ready, no call, and a press is queued.
    const p18 = await quizOnly("Biodiversity");
    assert.equal(await knock(), null, "at the daily cap: no knock");
    const capped = await counted(() => worker.runPracticeJobNow(p18.id, "quiz"));
    assert.deepEqual(capped.value, { status: "queued" });
    const drained = await counted(() => worker.drainPracticeQueue());
    assert.deepEqual(drained.value, []);
    assert.equal(capped.calls.length + drained.calls.length, 0, "nothing is called at the cap");

    // A call in flight holds its place under the cap. One that never gets an
    // answer may have been billed, so it keeps it: a dropped connection (an
    // outage) and a timeout (a slow call, tried later).
    const p19 = await quizOnly("Biodiversity hotspots");
    const only18 = { specPointId: p18.id, kind: "quiz" as const };
    const noAnswer = async (reply: Reply, failure: string, outcomes: Outcome[], cap: number) => {
      assert.deepEqual(
        outcomes.map((o) => [o.result, o.failure, o.status_after]),
        [["failed", failure, "pending"]],
        reply,
      );
      const run = (await runs(p18)).at(-1)!;
      assert.deepEqual(
        [run.outcome, run.has_usage, run.api_status],
        ["failed", false, null],
        `${reply}: no answer, so no usage and no status`,
      );
      assert.equal(await calls24h(), cap, `${reply}: a call with no answer counts`);
    };
    const stillCapped = async (reply: Reply) => {
      await makeReady(p18, "quiz");
      assert.equal(await knock(), null, `${reply}: at the cap again, no knock`);
      const none = await counted(() => worker.drainPracticeQueue());
      assert.equal(none.calls.length, 0, `${reply}: and no call`);
    };

    await setDailyCap(billed + 2);
    model.script.push("dropped");
    const held = holdNextModelCall();
    const cut = worker.drainPracticeQueue({ only: only18 });
    await untilCalled(held.arrived, cut, "the last call under the cap");
    assert.equal(await knock(), null, "the call in flight takes the last place: no knock");
    const meanwhile = await counted(() => worker.drainPracticeQueue());
    assert.equal(meanwhile.calls.length, 0, "and no second call, though another job is ready");
    held.release();
    await noAnswer("dropped", "outage", await cut, billed + 2);
    near(
      (await queue()).paused_s,
      2 * 60,
      5,
      "a dropped connection pauses the queue for 2 minutes",
    );
    await resume();
    await stillCapped("dropped");

    await setDailyCap(billed + 3);
    model.script.push("timeout");
    const slow = await counted(() => worker.drainPracticeQueue({ only: only18 }));
    assert.equal(slow.calls.length, 1, "timeout: one call");
    await noAnswer("timeout", "retry", slow.value, billed + 3);
    assert.equal((await queue()).paused_s, null, "a timeout pauses nothing: only its job waits");
    await stillCapped("timeout");

    await setDailyCap(100);
    const freed = await counted(() => worker.drainPracticeQueue());
    assert.equal(freed.calls.length, 2);
    assert.deepEqual(
      freed.value.map((o) => [o.spec_point_id, o.result]).sort(),
      [
        [p18.id, "written"],
        [p19.id, "written"],
      ].sort(),
    );
    await settled(
      "the daily cap counts billed calls, dropped ones and timeouts, never refused ones, so an outage can't stall the queue; at the cap no knock, no call, a press is queued",
    );
  }

  // ── The worker spoke only to the queue's RPCs and the run log ──────────────
  const allowed = new Set([
    "rpc/claim_practice_jobs",
    "rpc/complete_practice_job",
    "rpc/fail_practice_job",
    "rpc/request_practice_job",
    "rpc/practice_queue_status",
    "rpc/exam_generation_context",
    "exam_generation_runs",
  ]);
  assert.deepEqual(
    [...new Set(workerRequests().map((s) => s.path))].filter((p) => !allowed.has(p)),
    [],
    "the worker never reads or writes content tables itself",
  );
} catch (error) {
  process.stderr.write(
    [
      "",
      `worker console (${workerLog.length} lines, last 40):`,
      ...workerLog.slice(-40),
      "",
      "last requests the worker made:",
      ...workerRequests().slice(-12).map(describe),
      "",
    ].join("\n"),
  );
  throw error;
}

clearTimeout(watchdog);
await db.close();
say("e2e: all checks passed");
