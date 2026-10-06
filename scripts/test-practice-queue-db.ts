/** Isolated PostgreSQL checks for the practice queue (20261005220000): one job
 * per point and kind, the trigger on saved weeks, claiming, saving, failing,
 * waking the worker, and the rollback. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-practice-queue-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const tutor = uuid(2);
const biology = uuid(10); // AQA GCSE
const chemistry = uuid(11); // Edexcel iGCSE, and paused for the student

// The shape of production the migration touches (5 Oct 2026). has_role,
// update_updated_at_column, enforce_plan_overrides, plan_point_has_work,
// save_weekly_plan, the read policies and the two legacy writers are the live
// bodies. pg_cron, pg_net and Vault are stubbed down to what the migration
// calls, and the pg_net stub records each request instead of sending it.
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

-- A rival writer, for the race between the check and the save: while a point
-- is listed here, writing its generated set or task writes someone else's
-- first. Its triggers are added only for that check.
create table public.test_rivals(spec_point_id uuid primary key);
create function public.test_rival_writes_first() returns trigger language plpgsql as $$
begin
  if new.title <> 'Rival'
     and exists (select 1 from public.test_rivals r where r.spec_point_id = new.spec_point_id) then
    if tg_table_name = 'mcq_sets' then
      insert into public.mcq_sets (spec_point_id, title, published, origin)
      values (new.spec_point_id, 'Rival', true, 'generated');
    else
      insert into public.resources (kind, title, subject, level, spec_point_id, origin, review_status)
      values ('homework', 'Rival', new.subject, new.level, new.spec_point_id, 'generated', 'to_review');
    end if;
  end if;
  return new;
end $$;

-- A tutor publishing a quiz in the moment between an enqueue's first look and
-- its insert. Its trigger, on practice_jobs, is added only for that check.
create function public.test_tutor_publishes_meanwhile() returns trigger language plpgsql as $$
begin
  if new.kind = 'quiz'
     and exists (select 1 from public.test_rivals r where r.spec_point_id = new.spec_point_id) then
    insert into public.mcq_sets (spec_point_id, title, published, origin)
    values (new.spec_point_id, 'Published meanwhile', true, 'tutor');
  end if;
  return new;
end $$;

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

// ── Helpers ──────────────────────────────────────────────────────────────
/**
 * The Monday that starts the UK week holding `at`, worked out without
 * Postgres, so the migration's own week sum is checked against something else.
 */
const londonMonday = (at: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  day.setUTCDate(
    day.getUTCDate() - ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(part("weekday")),
  );
  return day.toISOString().slice(0, 10);
};
// Known answers: a UK week starts at midnight in London, which is 11pm UTC in
// summer and midnight UTC in winter.
assert.equal(londonMonday(new Date("2026-10-04T22:59:00Z")), "2026-09-28", "Sunday 23:59 BST");
assert.equal(londonMonday(new Date("2026-10-04T23:00:00Z")), "2026-10-05", "Monday 00:00 BST");
assert.equal(londonMonday(new Date("2026-01-04T23:59:00Z")), "2025-12-29", "Sunday 23:59 GMT");
assert.equal(londonMonday(new Date("2026-01-05T00:00:00Z")), "2026-01-05", "Monday 00:00 GMT");
assert.equal(londonMonday(new Date("2026-10-07T12:00:00Z")), "2026-10-05", "a Wednesday");
const thisMonday = londonMonday(new Date());
/** The Monday n weeks from this one. */
const mon = (n: number) => {
  const d = new Date(`${thisMonday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
};

/** Run as a signed-in user, or anonymously (null), through the API role. */
const as = async <T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
  notices?: string[],
) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
  try {
    const options = notices
      ? { onNotice: (n: { message: string }) => notices.push(n.message) }
      : undefined;
    return (await db.query<T>(sql, params, options)).rows;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
};
/** Run as the server's service-role credential, as PostgREST does. */
const svc = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  await db.exec("set role service_role");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
};

let points = 0;
/** A spec point nobody has touched yet. */
const newPoint = async (topic = biology) => {
  points += 1;
  const id = uuid(1000 + points);
  await db.query(
    "insert into public.spec_points (id, topic_id, code, title) values ($1, $2, $3, $4)",
    [id, topic, `EDEX ${points}.1`, `Point ${points}`],
  );
  return id;
};
const pointCode = (id: string) => `EDEX ${Number(id.slice(-12)) - 1000}.1`;
const pointTitle = (id: string) => `Point ${Number(id.slice(-12)) - 1000}`;

type Kind = "quiz" | "task";
type Job = {
  id: number;
  spec_point_id: string;
  kind: Kind;
  status: string;
  attempts: number;
  run_after: Date;
  claim_token: string | null;
  lease_until: Date | null;
  last_error: string | null;
  result_id: string | null;
  completed_how: string | null;
  requested: boolean;
  updated_at: Date;
};
const job = async (point: string, kind: Kind) =>
  (
    await db.query<Job>(
      "select * from private.practice_jobs where spec_point_id = $1 and kind = $2",
      [point, kind],
    )
  ).rows[0];
const jobCount = async (point: string) =>
  (
    await db.query<{ n: number }>(
      "select count(*)::int as n from private.practice_jobs where spec_point_id = $1",
      [point],
    )
  ).rows[0].n;
/** Minutes from the job's last write to when it may run again. */
const waitMinutes = async (jobId: number) =>
  (
    await db.query<{ m: number }>(
      "select extract(epoch from run_after - updated_at)::int / 60 as m from private.practice_jobs where id = $1",
      [jobId],
    )
  ).rows[0].m;
const enqueue = async (point: string) =>
  (await db.query<{ n: number }>("select private.enqueue_practice($1) as n", [point])).rows[0].n;
const content = async (point: string, kind: string, ownOnly = false) =>
  (
    await db.query<{ id: string | null }>("select private.practice_content_id($1, $2, $3) as id", [
      point,
      kind,
      ownOnly,
    ])
  ).rows[0].id;

type Claimed = {
  job_id: number;
  claim_token: string;
  spec_point_id: string;
  kind: Kind;
  attempt: number;
};
const claim = (limit: number | null = 1, point: string | null = null, kind: string | null = null) =>
  svc<Claimed>("select * from public.claim_practice_jobs($1, $2, $3)", [limit, point, kind]);
const complete = async (held: Claimed, questions: unknown, runId: string | null = null) =>
  (
    await svc<{ status: string; result_id: string | null }>(
      "select * from public.complete_practice_job($1, $2, $3::jsonb, $4)",
      [held.job_id, held.claim_token, JSON.stringify(questions), runId],
    )
  )[0];
const fail = async (
  held: Claimed,
  error: string | null,
  failure: string,
  pauseMinutes = 0,
  runId: string | null = null,
) =>
  (
    await svc<{ s: string }>("select public.fail_practice_job($1, $2, $3, $4, $5, $6) as s", [
      held.job_id,
      held.claim_token,
      error,
      failure,
      pauseMinutes,
      runId,
    ])
  )[0].s;
const request = async (point: string, kind: string, rearm = false) =>
  (
    await svc<{ job_id: number; status: string; result_id: string | null }>(
      "select * from public.request_practice_job($1, $2, $3)",
      [point, kind, rearm],
    )
  )[0];
const pause = async (minutes: number, reason: string | null = null) =>
  (
    await svc<{ until: Date | null }>("select public.pause_practice_queue($1, $2) as until", [
      minutes,
      reason,
    ])
  )[0].until;
type QueueStatus = {
  paused_until: string | null;
  pause_reason: string | null;
  daily_call_limit: number;
  calls_24h: number;
  in_flight: number;
  max_in_flight: number;
  max_attempts: number;
  counts: Record<string, number>;
  ready: Record<string, unknown>[];
  failed: Record<string, unknown>[];
};
const queueStatus = async () =>
  (await svc<{ s: QueueStatus }>("select public.practice_queue_status() as s"))[0].s;

/**
 * A model call logged the way the worker logs it: through the API, as the
 * service role. A failed call has no questions; one refused with an error
 * status (apiStatus) or cut off by a timeout has no usage either.
 */
const logRun = async (
  held: Claimed | null,
  run: {
    outcome?: string;
    error?: string | null;
    hoursAgo?: number;
    point?: string;
    usage?: boolean;
    apiStatus?: number;
  } = {},
) => {
  const failed = run.outcome === "failed";
  const billed = run.usage ?? !failed;
  return (
    await svc<{ id: string }>(
      `insert into public.exam_generation_runs
         (spec_point_id, framework_version, model, format, grounding, exemplar_ids,
          generated_questions, usage, outcome, error, source, job_id, created_at, api_status)
       values ($1, 'v1', 'claude-sonnet-5-5', 'mcq', 'style', '{}', $2::jsonb, $3::jsonb,
               $4, $5, 'queue', $6, now() - make_interval(hours => $7), $8)
       returning id`,
      [
        held?.spec_point_id ?? run.point ?? null,
        failed ? null : '[{"question":"Q"}]',
        billed ? '{"input_tokens":10}' : null,
        run.outcome ?? "passed",
        run.error ?? (failed ? "The call failed" : null),
        held?.job_id ?? null,
        run.hoursAgo ?? 0,
        run.apiStatus ?? null,
      ],
    )
  )[0].id;
};
const runRow = async (id: string) =>
  (
    await db.query<{ outcome: string; error: string | null }>(
      "select outcome, error from public.exam_generation_runs where id = $1",
      [id],
    )
  ).rows[0];

/** A clean queue: no jobs, the default settings, no knocks recorded. */
const resetQueue = () =>
  db.exec(`
    delete from private.practice_jobs;
    update private.practice_queue set paused_until = null, pause_reason = null,
      daily_call_limit = 100, max_in_flight = 3, max_attempts = 3, lease_seconds = 360;
    delete from net.requests;
  `);
/** Make a waiting job due now. */
const due = (jobId: number) =>
  db.query("update private.practice_jobs set run_after = now() where id = $1", [jobId]);
/** Let a claim's lease run out, as if its worker had died. */
const expire = (jobId: number) =>
  db.query(
    "update private.practice_jobs set lease_until = now() - interval '1 second' where id = $1",
    [jobId],
  );
/** Pretend a job was last written `hours` ago. */
const backdate = (jobId: number, hours: number) =>
  db.exec(`
    alter table private.practice_jobs disable trigger practice_jobs_updated;
    update private.practice_jobs set updated_at = now() - interval '${hours} hours' where id = ${jobId};
    alter table private.practice_jobs enable trigger practice_jobs_updated;
  `);

const addSet = async (
  point: string | null,
  set: { origin?: string; published?: boolean; createdAt?: string } = {},
) =>
  (
    await db.query<{ id: string }>(
      `insert into public.mcq_sets (spec_point_id, title, published, origin, created_at)
       values ($1, 'A set', $2, $3, coalesce($4::timestamptz, now())) returning id`,
      [point, set.published ?? false, set.origin ?? "tutor", set.createdAt ?? null],
    )
  ).rows[0].id;
const addQuestion = (set: string, point: string) =>
  db.query(
    `insert into public.mcq_questions (set_id, question, options, correct_index, spec_point_id)
     values ($1, 'Q', '["a","b","c","d"]', 0, $2)`,
    [set, point],
  );
const addTask = async (
  point: string | null,
  task: { review?: string; publishAt?: string | null; kind?: string } = {},
) =>
  (
    await db.query<{ id: string }>(
      `insert into public.resources (kind, title, subject, level, spec_point_id, review_status, publish_at)
       values ($1, 'A task', 'biology', 'gcse', $2, $3, $4::timestamptz) returning id`,
      [task.kind ?? "homework", point, task.review ?? "approved", task.publishAt ?? null],
    )
  ).rows[0].id;
const link = (resource: string, point: string) =>
  db.query("insert into public.resource_spec_points (resource_id, spec_point_id) values ($1, $2)", [
    resource,
    point,
  ]);

/** A quiz the generator might write: genetics, where case is meaning. */
const quiz = [
  {
    question: "  Which genotype is heterozygous?  ",
    options: ["TT", "Tt", "tt", "T"],
    correct_index: 1,
    explanation: "  It has one of each allele.  ",
  },
  {
    question: "Which genotype shows the recessive phenotype?",
    options: ["TT", "Tt", "tt", "None of these"],
    correct_index: 2,
    explanation: "Both alleles are recessive.",
  },
];
const task = [
  {
    prompt: "Explain what an allele is.",
    marks: 2,
    answer_type: "short",
    mark_scheme: "  A version of a gene (1). Found at the same locus (1).  ",
  },
  {
    prompt: "A cross gives 75 tall and 25 short plants. Give the ratio.",
    marks: 3,
    answer_type: "numeric",
    mark_scheme: "3:1",
  },
];

/** Everything the migration may add or change, to compare the rollback with the start. */
const catalog = async () =>
  (
    await db.query<{ item: string }>(`
      select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
             || coalesce(p.proacl::text, '') as item
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
      union all
      select 'relation ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' ' || coalesce(c.relacl::text, '')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private')
      union all
      select 'column ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || case when a.attnotnull then ' not null' else '' end
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = 'public.exam_generation_runs'::regclass and a.attnum > 0 and not a.attisdropped
      union all
      select 'constraint ' || c.conrelid::regclass || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname in ('public', 'private')
      union all
      select 'trigger ' || t.tgname || ' on ' || t.tgrelid::regclass from pg_trigger t where not t.tgisinternal
      union all
      select 'policy ' || p.polname || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') from pg_policy p
      union all
      select 'cron ' || j.jobname || ' ' || j.schedule || ' ' || j.command from cron.job j
      order by 1`)
  ).rows.map((r) => r.item);
/** The two writers the deployed site still calls. */
const legacy = async () =>
  (
    await db.query<{ def: string; acl: string }>(
      `select pg_get_functiondef(p.oid) as def, p.proacl::text as acl from pg_proc p
       where p.proname in ('ensure_generated_mcq_set', 'ensure_generated_homework') order by p.proname`,
    )
  ).rows;

// ── Fixtures, before the migration ──────────────────────────────────────
await db.query("insert into auth.users values ($1), ($2)", [student, tutor]);
await db.query("insert into public.user_roles values ($1, 'student'), ($2, 'tutor')", [
  student,
  tutor,
]);
await db.query(
  `insert into public.topics (id, subject, board, level, title) values
     ($1, 'biology', 'aqa', 'gcse', 'Inheritance'), ($2, 'chemistry', 'edexcel', 'igcse', 'Bonding')`,
  [biology, chemistry],
);
await db.exec("insert into public.test_paused_subjects values ('chemistry')");

// Weeks planned before the migration. Last week's point is history; this
// week's and next week's are queued by the migration's one-off fill.
const pastPoint = await newPoint();
const nowPoint = await newPoint();
const nextPoint = await newPoint();
for (const [week, point] of [
  [mon(-1), pastPoint],
  [mon(0), nowPoint],
  [mon(1), nextPoint],
]) {
  const plan = (
    await db.query<{ id: string }>(
      "insert into public.student_weekly_plans (student_id, subject, board, level, week_start) values ($1, 'biology', 'aqa', 'gcse', $2) returning id",
      [student, week],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
    [plan, point],
  );
}
// This week's point already has its quiz: the deployed site wrote it.
const nowQuiz = (
  await svc<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb) as id", [
    nowPoint,
    JSON.stringify(quiz),
  ])
)[0].id;
// And a run logged the old way, before the migration.
const oldRun = (
  await db.query<{ id: string }>(
    `insert into public.exam_generation_runs
       (spec_point_id, framework_version, model, format, grounding, exemplar_ids, generated_questions, usage)
     values ($1, 'v1', 'claude-sonnet-5-5', 'mcq', 'style', '{}', '[{"question":"Q"}]', '{"input_tokens":10}')
     returning id`,
    [nowPoint],
  )
).rows[0].id;

const catalogBefore = await catalog();
const legacyBefore = await legacy();

// The queue and its follow-up fix, applied in order as production has them.
const migration = (
  await Promise.all(
    [
      "../supabase/migrations/20261005220000_practice_queue.sql",
      "../supabase/migrations/20261006110000_practice_queue_safeupdate.sql",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  )
).join("\n");
const rollback = await readFile(
  new URL("../supabase/rollbacks/20261005220000_practice_queue.down.sql", import.meta.url),
  "utf8",
);

await db.exec(migration);
await db.exec("update private.practice_queue set daily_call_limit = 50");
await db.exec(migration);

// ── 1. It runs twice, and queues the weeks already planned ──────────────
{
  const settings = (await db.query("select * from private.practice_queue")).rows;
  assert.equal(settings.length, 1, "one settings row");
  assert.equal(settings[0].daily_call_limit, 50, "running it again keeps the settings");
  assert.equal(settings[0].paused_until, null);
  assert.deepEqual(
    [settings[0].max_in_flight, settings[0].max_attempts, settings[0].lease_seconds],
    [3, 3, 360],
  );
  await db.exec("update private.practice_queue set daily_call_limit = 100");

  const jobs = (
    await db.query(
      "select spec_point_id, kind, status, completed_how, result_id from private.practice_jobs order by spec_point_id, kind",
    )
  ).rows;
  const waiting = { status: "pending", completed_how: null, result_id: null };
  assert.deepEqual(
    jobs,
    [
      {
        spec_point_id: nowPoint,
        kind: "quiz",
        status: "completed",
        completed_how: "already_existed",
        result_id: nowQuiz,
      },
      { spec_point_id: nowPoint, kind: "task", ...waiting },
      { spec_point_id: nextPoint, kind: "quiz", ...waiting },
      { spec_point_id: nextPoint, kind: "task", ...waiting },
    ],
    "this week's and next week's points are queued, once; last week's are not",
  );

  assert.deepEqual(
    (await db.query("select jobname, schedule, command from cron.job")).rows,
    [
      {
        jobname: "practice-worker",
        schedule: "* * * * *",
        command: " select private.kick_practice_worker(); ",
      },
    ],
    "one minute job, holding no secret",
  );
  const triggers = await db.query<{ n: number }>(
    "select count(*)::int as n from pg_trigger where tgname = 'plan_point_enqueues_practice'",
  );
  assert.equal(triggers.rows[0].n, 1);
}

// ── 2. Only the service role reaches the queue ──────────────────────────
{
  const rpcs = [
    "public.request_practice_job(uuid, text, boolean)",
    "public.claim_practice_jobs(integer, uuid, text)",
    "public.complete_practice_job(bigint, uuid, jsonb, uuid)",
    "public.fail_practice_job(bigint, uuid, text, text, integer, uuid)",
    "public.practice_queue_status()",
    "public.pause_practice_queue(integer, text)",
    "public.rearm_failed_practice_jobs(uuid[])",
  ];
  const helpers = [
    "private.practice_content_id(uuid, text, boolean)",
    "private.save_generated_quiz(uuid, jsonb)",
    "private.save_generated_task(uuid, jsonb)",
    "private.enqueue_practice(uuid, text)",
    "private.enqueue_practice_for_plan_point()",
    "private.practice_in_flight()",
    "private.practice_calls_24h()",
    "private.practice_call_budget()",
    "private.kick_practice_worker()",
  ];
  const canExecute = async (role: string, fn: string) =>
    (
      await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'execute') as ok", [
        role,
        fn,
      ])
    ).rows[0].ok;
  for (const fn of [...rpcs, ...helpers])
    for (const role of ["public", "anon", "authenticated"])
      assert.equal(await canExecute(role, fn), false, `${role} can't execute ${fn}`);
  for (const fn of rpcs) assert.equal(await canExecute("service_role", fn), true, fn);
  for (const fn of helpers) assert.equal(await canExecute("service_role", fn), false, fn);
  const overloads = await db.query<{ n: number }>(
    "select count(*)::int as n from pg_proc where proname = 'fail_practice_job'",
  );
  assert.equal(overloads.rows[0].n, 1, "one fail_practice_job, so PostgREST never has to choose");

  // No API role holds anything on a private table, whatever its schema rights.
  const privateRelations = (
    await db.query<{ name: string; kind: string }>(
      `select n.nspname || '.' || c.relname as name, c.relkind::text as kind
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'private' and c.relkind in ('r', 'S') order by 1`,
    )
  ).rows;
  assert.deepEqual(
    privateRelations.map((r) => r.name),
    ["private.practice_jobs", "private.practice_jobs_id_seq", "private.practice_queue"],
  );
  const holdsAny = async (role: string, relation: { name: string; kind: string }) =>
    (
      await db.query<{ any: boolean }>(
        relation.kind === "S"
          ? "select has_sequence_privilege($1, $2, 'USAGE, SELECT, UPDATE') as any"
          : "select has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as any",
        [role, relation.name],
      )
    ).rows[0].any;
  for (const relation of privateRelations)
    for (const role of ["public", "anon", "authenticated", "service_role"])
      assert.equal(
        await holdsAny(role, relation),
        false,
        `${role} holds nothing on ${relation.name}`,
      );
  const rls = await db.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'private' and c.relkind = 'r' and not c.relrowsecurity`,
  );
  assert.deepEqual(rls.rows, [], "row level security is on for every private table");
  for (const role of ["anon", "authenticated", "service_role"]) {
    const usage = await db.query<{ ok: boolean }>(
      "select has_schema_privilege($1, 'private', 'USAGE') as ok",
      [role],
    );
    assert.equal(usage.rows[0].ok, false, `${role} can't even look into private`);
  }

  // And when they try.
  const calls = [
    ["select public.request_practice_job($1, 'quiz')", [nowPoint]],
    ["select public.claim_practice_jobs()", []],
    ["select public.complete_practice_job(1, $1, '[]')", [uuid(9)]],
    ["select public.fail_practice_job(1, $1, 'x', 'retry')", [uuid(9)]],
    ["select public.practice_queue_status()", []],
    ["select public.pause_practice_queue(0)", []],
    ["select public.rearm_failed_practice_jobs()", []],
  ] as const;
  for (const who of [null, student, tutor])
    for (const [sql, params] of calls)
      await assert.rejects(() => as(who, sql, [...params]), /permission denied/, `${who}: ${sql}`);
  for (const who of [null, student, tutor]) {
    await assert.rejects(() => as(who, "select * from private.practice_jobs"), /permission denied/);
    await assert.rejects(
      () => as(who, "update private.practice_queue set daily_call_limit = 1000"),
      /permission denied/,
    );
    await assert.rejects(
      () => as(who, "select private.practice_content_id($1, 'quiz')", [nowPoint]),
      /permission denied/,
    );
  }
  await assert.rejects(() => svc("select * from private.practice_jobs"), /permission denied/);
  await assert.rejects(
    () => svc("select private.enqueue_practice($1)", [nowPoint]),
    /permission denied/,
    "the service role goes through the RPCs too",
  );
}

// ── 3. What counts as a point's quiz or task already ────────────────────
{
  // Quizzes: the point's generated set first, published or not; then a
  // published set for the point; then a published set holding a question on it.
  const unpublishedGenerated = await newPoint();
  const generated = await addSet(unpublishedGenerated, { origin: "generated" });
  await addSet(unpublishedGenerated, { published: true, createdAt: "2026-01-01" });
  assert.equal(
    await content(unpublishedGenerated, "quiz"),
    generated,
    "a generated set counts even unpublished, and comes first",
  );

  const tutorSet = await newPoint();
  const older = await addSet(tutorSet, { published: true, createdAt: "2026-01-01" });
  await addSet(tutorSet, { published: true, createdAt: "2026-02-01" });
  assert.equal(await content(tutorSet, "quiz"), older, "a published tutor set, the oldest first");

  const draft = await newPoint();
  await addSet(draft, { published: false });
  assert.equal(await content(draft, "quiz"), null, "an unpublished tutor set doesn't count");

  const tagged = await newPoint();
  const elsewhere = await addSet(await newPoint(), { published: true });
  await addQuestion(elsewhere, tagged);
  assert.equal(await content(tagged, "quiz"), elsewhere, "a published set with a question on it");

  const taggedDraft = await newPoint();
  await addQuestion(await addSet(await newPoint(), { published: false }), taggedDraft);
  assert.equal(await content(taggedDraft, "quiz"), null, "not when that set is unpublished");

  // Tasks: the point's own task, whatever its status; then a task linked to
  // the point that students can open.
  const held = await newPoint();
  const heldTask = await addTask(held, { review: "held" });
  assert.equal(await content(held, "task"), heldTask, "the point's own task, even held back");

  const linked = async (review: string, publishAt: string | null, kind = "homework") => {
    const point = await newPoint();
    const resource = await addTask(null, { review, publishAt, kind });
    await link(resource, point);
    return { point, resource };
  };
  const approved = await linked("approved", null);
  assert.equal(await content(approved.point, "task"), approved.resource, "a linked approved task");
  const live = await linked("to_review", "2026-01-01T00:00:00Z");
  assert.equal(await content(live.point, "task"), live.resource, "linked, waiting, already live");
  const liveNow = await linked("to_review", null);
  assert.equal(await content(liveNow.point, "task"), liveNow.resource, "linked, waiting, no date");
  const ahead = await linked("to_review", "2099-01-01T00:00:00Z");
  assert.equal(await content(ahead.point, "task"), null, "not one that isn't live yet");
  const heldLink = await linked("held", null);
  assert.equal(await content(heldLink.point, "task"), null, "not a linked task held back");
  const video = await linked("approved", null, "video");
  assert.equal(await content(video.point, "task"), null, "a linked video isn't a task");

  // Only the point's own item, for a job a tutor asked for: its generated set
  // or its own task, and nothing else.
  assert.equal(await content(unpublishedGenerated, "quiz", true), generated);
  assert.equal(await content(tutorSet, "quiz", true), null, "a tutor's own quiz doesn't count");
  assert.equal(await content(tagged, "quiz", true), null, "nor a question tagged elsewhere");
  assert.equal(await content(held, "task", true), heldTask, "the point's own task does");
  assert.equal(await content(approved.point, "task", true), null, "a linked task doesn't");

  await assert.rejects(() => content(held, "video"), /Unknown practice kind/);

  // Queueing follows it: content there means a job completed from the start.
  assert.equal(await enqueue(tutorSet), 2, "a new point gets both jobs");
  assert.equal(await enqueue(tutorSet), 0, "and only once");
  const done = await job(tutorSet, "quiz");
  assert.deepEqual(
    [done.status, done.completed_how, done.result_id, done.attempts],
    ["completed", "already_existed", older, 0],
  );
  assert.equal((await job(tutorSet, "task")).status, "pending");
  await enqueue(draft);
  assert.equal((await job(draft, "quiz")).status, "pending", "an unpublished set is paid for");
  await enqueue(heldLink.point);
  assert.equal((await job(heldLink.point, "task")).status, "pending", "so is a held linked task");
  await enqueue(held);
  assert.equal((await job(held, "task")).result_id, heldTask);
  await assert.rejects(
    () => db.query("select private.enqueue_practice($1)", [uuid(999)]),
    /Unknown spec point/,
  );
  await assert.rejects(
    () => db.query("select private.enqueue_practice($1, 'video')", [held]),
    /Unknown practice kind/,
  );
}

// ── 4. Saving a week queues its points, and never fails because of it ──
{
  await resetQueue();
  const [a, b, c, d, e] = [
    await newPoint(),
    await newPoint(),
    await newPoint(),
    await newPoint(),
    await newPoint(),
  ];
  const quizForA = await addSet(a, { published: true });
  const save = (list: string[], subject = "biology") =>
    as<{ id: string }>(
      student,
      `select public.save_weekly_plan($1, $2::public.subject, $3::public.board, $4::public.level, $5, 'ai', null, $6::jsonb) as id`,
      [
        student,
        subject,
        subject === "biology" ? "aqa" : "edexcel",
        subject === "biology" ? "gcse" : "igcse",
        mon(2),
        JSON.stringify(list.map((p) => ({ spec_point_id: p, origin: "core" }))),
      ],
    );
  const [{ id: plan }] = await save([a, b]);

  const aQuiz = await job(a, "quiz");
  assert.deepEqual(
    [aQuiz.status, aQuiz.completed_how, aQuiz.result_id],
    ["completed", "already_existed", quizForA],
  );
  for (const [point, kind] of [
    [a, "task"],
    [b, "quiz"],
    [b, "task"],
  ] as const)
    assert.equal(
      (await job(point, kind)).status,
      "pending",
      `${kind} queued by the student's save`,
    );
  await assert.rejects(
    () => as(student, "select count(*) from private.practice_jobs"),
    /permission denied/,
    "though the student can't see the queue",
  );

  // Re-saving the week goes through ON CONFLICT DO UPDATE. The trigger runs
  // there too: a's quiz was removed, so it is queued again.
  const bQuiz = await job(b, "quiz");
  await db.query("delete from public.mcq_sets where id = $1", [quizForA]);
  await save([a, b]);
  const again = await job(a, "quiz");
  assert.deepEqual(
    [again.status, again.attempts, again.result_id, again.completed_how, again.claim_token],
    ["pending", 0, null, null, null],
    "a completed job whose content went is queued again",
  );
  assert.deepEqual(await job(b, "quiz"), bQuiz, "a waiting job is left as it was");

  // Adding a point already in the week (the planner's upsert that ignores
  // duplicates), or ticking it off, changes nothing.
  await as(
    student,
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'student') on conflict do nothing",
    [plan, b],
  );
  await as(
    student,
    "update public.student_weekly_plan_points set done_at = now() where plan_id = $1 and spec_point_id = $2",
    [plan, b],
  );
  assert.deepEqual(await job(b, "quiz"), bQuiz);
  assert.equal(await jobCount(b), 2);

  // A point a tutor took out is dropped by its BEFORE trigger, unqueued.
  await db.query(
    "insert into public.student_plan_overrides (student_id, subject, spec_point_id, kind) values ($1, 'biology', $2, 'skip')",
    [student, c],
  );
  await as(
    student,
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
    [plan, c],
  );
  const cRows = await db.query(
    "select 1 from public.student_weekly_plan_points where spec_point_id = $1",
    [c],
  );
  assert.equal(cRows.rows.length, 0, "the override dropped the row");
  assert.equal(await jobCount(c), 0, "so nothing was queued");

  // A paused subject's point is refused, and nothing is queued.
  const chem = await newPoint(chemistry);
  await assert.rejects(
    () => save([chem], "chemistry"),
    (err: { code?: string }) => err.code === "23514",
  );
  assert.equal(await jobCount(chem), 0);

  // When queueing goes wrong, the week still saves, with a warning.
  await db.exec(
    `alter table private.practice_jobs add constraint test_refuse check (spec_point_id <> '${d}')`,
  );
  const notices: string[] = [];
  await as(
    student,
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
    [plan, d],
    notices,
  );
  const dRows = await db.query(
    "select 1 from public.student_weekly_plan_points where spec_point_id = $1",
    [d],
  );
  assert.equal(dRows.rows.length, 1, "the point is in the week");
  assert.equal(await jobCount(d), 0);
  assert.equal(notices.length, 1);
  assert.match(notices[0], new RegExp(`^practice queue: could not enqueue ${d}: .*test_refuse`));
  await db.exec("alter table private.practice_jobs drop constraint test_refuse");
  // The next save of the week catches it up.
  await save([a, b, d, e]);
  assert.equal(await jobCount(d), 2);
  assert.equal(await jobCount(e), 2);
}

// ── 5. A failed job gets one fresh round a day, while it is in a week ───
{
  await resetQueue();
  const [old, recent] = [await newPoint(), await newPoint()];
  const save = () =>
    as(
      student,
      "select public.save_weekly_plan($1, 'biology', 'aqa', 'gcse', $2, 'ai', null, $3::jsonb)",
      [
        student,
        mon(3),
        JSON.stringify([old, recent].map((p) => ({ spec_point_id: p, origin: "core" }))),
      ],
    );
  await save();
  for (const point of [old, recent]) {
    const [held] = await claim(1, point, "quiz");
    assert.equal(await fail(held, "The request was refused", "give_up"), "failed");
  }
  await backdate((await job(old, "quiz")).id, 25);
  await backdate((await job(recent, "quiz")).id, 23);
  const recentBefore = await job(recent, "quiz");
  await save();
  const rearmed = await job(old, "quiz");
  assert.deepEqual(
    [rearmed.status, rearmed.attempts, rearmed.last_error],
    ["pending", 0, "The request was refused"],
    "one that failed over a day ago gets another go, its last error kept",
  );
  assert.ok(rearmed.run_after <= new Date());
  assert.deepEqual(await job(recent, "quiz"), recentBefore, "one that failed today doesn't");
  assert.equal(await enqueue(recent), 0);
}

// ── 5b. A job already in order gets no write and no lock ────────────────
{
  // A row's xmax changes whenever something updates or locks it (claim and
  // fail leave their own lock behind, so it isn't always 0). A no-op upsert
  // would lock the row, and two saves locking rows in different orders
  // deadlock.
  await resetQueue();
  const lockedBy = async (jobId: number) =>
    (
      await db.query<{ x: string }>(
        "select xmax::text as x from private.practice_jobs where id = $1",
        [jobId],
      )
    ).rows[0].x;
  const [waiting, hasQuiz, failedToday, beingWritten] = [
    await newPoint(),
    await newPoint(),
    await newPoint(),
    await newPoint(),
  ];
  await addSet(hasQuiz, { published: true });
  for (const point of [waiting, hasQuiz, failedToday, beingWritten]) await enqueue(point);
  const [refused] = await claim(1, failedToday, "quiz");
  await fail(refused, "Refused", "give_up");
  await claim(1, beingWritten, "quiz");

  const before: Job[] = [];
  for (const point of [waiting, hasQuiz, failedToday, beingWritten])
    for (const kind of ["quiz", "task"] as const) before.push(await job(point, kind));
  assert.deepEqual(
    before.map((j) => j.status),
    ["pending", "pending", "completed", "pending", "failed", "pending", "generating", "pending"],
  );
  const locks = new Map<number, string>();
  for (const j of before) locks.set(j.id, await lockedBy(j.id));
  for (const point of [waiting, hasQuiz, failedToday, beingWritten])
    assert.equal(await enqueue(point), 0);
  for (const j of before) {
    assert.deepEqual(await job(j.spec_point_id, j.kind), j, `${j.status} ${j.kind}: untouched`);
    assert.equal(await lockedBy(j.id), locks.get(j.id), `${j.status} ${j.kind}: not even locked`);
  }
}

// ── 5c. A quiz saved while the enqueue waited for its lock counts ───────
{
  // The look under the lock must see what has been saved by then, not what
  // was there when its statement began, so practice_content_id is volatile.
  // A trigger plays the tutor who publishes a quiz in that moment.
  await resetQueue();
  const p = await newPoint();
  const gone = await addSet(p, { published: true });
  await enqueue(p);
  await db.query("delete from public.mcq_sets where id = $1", [gone]);
  await db.exec(`
    create trigger test_meanwhile before insert on private.practice_jobs
      for each row execute function public.test_tutor_publishes_meanwhile();
  `);
  await db.query("insert into public.test_rivals values ($1)", [p]);
  assert.equal(await enqueue(p), 0, "not queued again: a quiz is there now");
  const kept = await job(p, "quiz");
  assert.deepEqual([kept.status, kept.completed_how], ["completed", "already_existed"]);
  await db.exec(`
    drop trigger test_meanwhile on private.practice_jobs;
    delete from public.test_rivals;
  `);
}

// ── 6. Claiming ─────────────────────────────────────────────────────────
{
  await resetQueue();
  const [p1, p2, p3] = [await newPoint(), await newPoint(), await newPoint()];
  for (const point of [p1, p2, p3]) await enqueue(point);

  // Paused: nothing is handed out.
  const until = await pause(10, "Testing");
  assert.ok(until && until > new Date());
  assert.deepEqual(await claim(5), []);
  assert.equal(await pause(0), null);

  // The longest due first, as many as asked, each under its own token and lease.
  const first = await claim(2);
  assert.deepEqual(
    first.map((c) => [c.spec_point_id, c.kind, c.attempt]),
    [
      [p1, "quiz", 1],
      [p1, "task", 1],
    ],
  );
  assert.notEqual(first[0].claim_token, first[1].claim_token);
  const held = await job(p1, "quiz");
  assert.deepEqual(
    [held.status, held.claim_token, held.attempts],
    ["generating", first[0].claim_token, 1],
  );
  const lease = await db.query<{ s: number }>(
    "select extract(epoch from lease_until - updated_at)::int as s from private.practice_jobs where id = $1",
    [held.id],
  );
  assert.equal(lease.rows[0].s, 360, "a lease of lease_seconds");

  // Three in flight at most, and a claimed job is never handed out twice.
  assert.deepEqual(
    (await claim(10)).map((c) => [c.spec_point_id, c.kind]),
    [[p2, "quiz"]],
  );
  assert.deepEqual(await claim(10), []);
}
{
  // The 24-hour cap counts calls made for jobs, and the calls in flight. A
  // call refused with an error status wasn't billed, so it doesn't count; one
  // that timed out might have been, so it does.
  await resetQueue();
  await db.exec("update private.practice_queue set max_in_flight = 10, daily_call_limit = 5");
  const [p, q] = [await newPoint(), await newPoint()];
  await enqueue(p);
  await enqueue(q);
  const [held] = await claim(1);
  for (let i = 0; i < 3; i++) await logRun(held, { hoursAgo: 1 });
  await logRun(held, { outcome: "failed", error: "Request timed out" }); // counts
  await logRun(held, {
    outcome: "failed",
    apiStatus: 400,
    error: "Your credit balance is too low",
  });
  await logRun(held, { outcome: "failed", apiStatus: 429, error: "Rate limited" });
  await logRun(held, { outcome: "failed", apiStatus: 529, error: "Overloaded" });
  await logRun(held, { hoursAgo: 25 }); // over a day ago
  await logRun(null, { point: p }); // a tutor's draft, not a job's
  assert.equal((await queueStatus()).calls_24h, 4, "3 calls and a timeout");
  assert.deepEqual(await claim(10), [], "4 calls and 1 in flight: the cap of 5 is reached");
  assert.equal(await fail(held, "Refused", "give_up"), "failed");
  assert.equal((await claim(10)).length, 1, "with nothing in flight, one more call fits");
  assert.deepEqual(await claim(10), []);
  // An error status on a call that was billed anyway still counts.
  await resetQueue();
  await db.exec("update private.practice_queue set daily_call_limit = 1");
  await enqueue(await newPoint());
  const [billed] = await claim(1, null, "quiz");
  await logRun(billed, { outcome: "failed", usage: true, apiStatus: 500, error: "Server error" });
  await fail(billed, "Server error", "give_up");
  assert.equal((await queueStatus()).calls_24h, 1);
  assert.deepEqual(await claim(1), [], "the day's one call is used");
  await assert.rejects(
    () => logRun(billed, { apiStatus: 200 }),
    /exam_generation_runs_api_status_check/,
    "only an error status is recorded",
  );
}
{
  // _limit is kept to 1..10.
  await resetQueue();
  await db.exec("update private.practice_queue set max_in_flight = 10");
  for (let i = 0; i < 7; i++) await enqueue(await newPoint());
  assert.equal((await claim(50)).length, 10, "never more than 10 at once");
  await resetQueue();
  for (let i = 0; i < 2; i++) await enqueue(await newPoint());
  assert.equal((await claim(0)).length, 1, "a limit under 1 takes one");
  assert.equal((await claim(null)).length, 1);
}
{
  // Out of attempts: failed, saying why, and never handed out.
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  let [held] = await claim(1, p, "quiz");
  await fail(held, "AI returned invalid JSON", "retry");
  await due(held.job_id);
  [held] = await claim(1, p, "quiz");
  await fail(held, "AI did not complete the question set", "retry");
  await due(held.job_id);
  [held] = await claim(1, p, "quiz");
  assert.equal(held.attempt, 3);
  await expire(held.job_id); // the worker died on its last try
  assert.deepEqual(await claim(1, p, "quiz"), []);
  const gaveUp = await job(p, "quiz");
  assert.deepEqual(
    [gaveUp.status, gaveUp.last_error, gaveUp.claim_token, gaveUp.lease_until],
    ["failed", "Gave up after 3 attempts: AI did not complete the question set", null, null],
  );
  // The task: three workers die in turn, without a word.
  for (let i = 1; i <= 3; i++) {
    const [taken] = await claim(1, p, "task");
    assert.equal(taken.attempt, i, "a lease that ran out is taken over, and counts");
    await expire(taken.job_id);
  }
  assert.deepEqual(await claim(1, p, "task"), []);
  assert.equal(
    (await job(p, "task")).last_error,
    "Gave up after 3 attempts: the worker stopped before finishing",
  );
}
{
  // A worker whose lease ran out has lost the job to the next one.
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [first] = await claim(1, p, "quiz");
  await expire(first.job_id);
  const [second] = await claim(1, p, "quiz");
  assert.equal(second.job_id, first.job_id);
  assert.notEqual(second.claim_token, first.claim_token);
  assert.equal(second.attempt, 2);
  const run = await logRun(first);
  assert.deepEqual(await complete(first, quiz, run), { status: "lost_claim", result_id: null });
  assert.equal(await fail(first, "late", "retry"), "lost_claim");
  assert.equal((await job(p, "quiz")).claim_token, second.claim_token, "the new claim stands");
  assert.equal(await content(p, "quiz"), null, "and the late save wrote nothing");
}
{
  // Only one point, or one kind.
  await resetQueue();
  const [p, q] = [await newPoint(), await newPoint()];
  await enqueue(p);
  await enqueue(q);
  assert.deepEqual(
    (await claim(5, q, "task")).map((c) => [c.spec_point_id, c.kind]),
    [[q, "task"]],
  );
  assert.deepEqual(
    (await claim(5, null, "quiz")).map((c) => [c.spec_point_id, c.kind]),
    [
      [p, "quiz"],
      [q, "quiz"],
    ],
  );
}
{
  // A point that has its content by now is completed, not handed out, and
  // uses none of the budget.
  await resetQueue();
  const [p, q] = [await newPoint(), await newPoint()];
  await enqueue(p);
  await enqueue(q);
  const tutorQuiz = await addSet(p, { published: true });
  const [taken] = await claim(1);
  assert.deepEqual([taken.spec_point_id, taken.kind], [p, "task"]);
  const skipped = await job(p, "quiz");
  assert.deepEqual(
    [skipped.status, skipped.completed_how, skipped.result_id, skipped.attempts],
    ["completed", "already_existed", tutorQuiz, 0],
  );
}

// ── 7. Saving a quiz ────────────────────────────────────────────────────
{
  await resetQueue();
  const p = await newPoint(chemistry);
  await enqueue(p);
  let [held] = await claim(1, p, "quiz");
  await fail(held, "AI returned invalid JSON", "retry");
  await due(held.job_id);
  [held] = await claim(1, p, "quiz");
  const run = await logRun(held);
  const saved = await complete(held, quiz, run);
  assert.equal(saved.status, "written");

  const set = (await db.query("select * from public.mcq_sets where id = $1", [saved.result_id]))
    .rows[0];
  assert.deepEqual(
    [set.spec_point_id, set.title, set.description, set.published, set.subject, set.created_by],
    [
      p,
      `${pointCode(p)} ${pointTitle(p)}`,
      "Practice questions for this spec point",
      true,
      "chemistry",
      null,
    ],
  );
  assert.equal(set.origin, "generated");
  const rows = (
    await db.query(
      "select position, question, options, correct_index, explanation, spec_point_id from public.mcq_questions where set_id = $1 order by position",
      [saved.result_id],
    )
  ).rows;
  assert.deepEqual(rows, [
    {
      position: 0,
      question: "Which genotype is heterozygous?",
      options: ["TT", "Tt", "tt", "T"],
      correct_index: 1,
      explanation: "It has one of each allele.",
      spec_point_id: p,
    },
    {
      position: 1,
      question: "Which genotype shows the recessive phenotype?",
      options: ["TT", "Tt", "tt", "None of these"],
      correct_index: 2,
      explanation: "Both alleles are recessive.",
      spec_point_id: p,
    },
  ]);

  const doneJob = await job(p, "quiz");
  assert.deepEqual(
    [
      doneJob.status,
      doneJob.completed_how,
      doneJob.result_id,
      doneJob.claim_token,
      doneJob.lease_until,
      doneJob.last_error,
    ],
    ["completed", "written", saved.result_id, null, null, null],
    "completing clears the claim and the last error",
  );
  assert.deepEqual(await runRow(run), { outcome: "saved", error: null });

  // The same claim can't save twice, and a run that was saved stays saved.
  assert.deepEqual(await complete(held, quiz, run), { status: "lost_claim", result_id: null });
  assert.deepEqual(await runRow(run), { outcome: "saved", error: null });
  const late = await logRun(held);
  await complete(held, quiz, late);
  assert.deepEqual(await runRow(late), { outcome: "discarded", error: "Claim lost before saving" });
  const sets = await db.query<{ n: number }>(
    "select count(*)::int as n from public.mcq_sets where spec_point_id = $1",
    [p],
  );
  assert.equal(sets.rows[0].n, 1);
}

// ── 8. Saving a task ────────────────────────────────────────────────────
{
  await resetQueue();
  const p = await newPoint(chemistry);
  await enqueue(p);
  const [held] = await claim(1, p, "task");
  const run = await logRun(held);
  const saved = await complete(held, task, run);
  assert.equal(saved.status, "written");

  const sheet = (
    await db.query(
      "select *, publish_at = created_at as published_on_save, publish_at <= now() as live from public.resources where id = $1",
      [saved.result_id],
    )
  ).rows[0];
  assert.deepEqual(
    [
      sheet.kind,
      sheet.title,
      sheet.subject,
      sheet.board,
      sheet.level,
      sheet.spec_point_id,
      sheet.created_by,
      sheet.origin,
      sheet.review_status,
    ],
    [
      "homework",
      `${pointCode(p)} ${pointTitle(p)}`,
      "chemistry",
      "edexcel",
      "igcse",
      p,
      null,
      "generated",
      "to_review",
    ],
    "the course comes from the point's topic",
  );
  assert.equal(sheet.published_on_save, true, "publish_at is when it was saved");
  assert.equal(sheet.live, true, "so students can open it at once");
  const rows = (
    await db.query(
      "select position, prompt, marks, answer_type, mark_scheme, spec_point_id from public.homework_questions where resource_id = $1 order by position",
      [saved.result_id],
    )
  ).rows;
  assert.deepEqual(rows, [
    {
      position: 0,
      prompt: "Explain what an allele is.",
      marks: 2,
      answer_type: "short",
      mark_scheme: "A version of a gene (1). Found at the same locus (1).",
      spec_point_id: p,
    },
    {
      position: 1,
      prompt: "A cross gives 75 tall and 25 short plants. Give the ratio.",
      marks: 3,
      answer_type: "numeric",
      mark_scheme: "3:1",
      spec_point_id: p,
    },
  ]);
  assert.deepEqual(
    (
      await db.query(
        "select resource_id, spec_point_id from public.resource_spec_points where resource_id = $1",
        [saved.result_id],
      )
    ).rows,
    [{ resource_id: saved.result_id, spec_point_id: p }],
  );
  assert.deepEqual(
    [(await job(p, "task")).status, (await job(p, "task")).completed_how],
    ["completed", "written"],
  );
  assert.deepEqual(await runRow(run), { outcome: "saved", error: null });
}

// ── 9. A worker that lost its claim saves nothing ──────────────────────
{
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [held] = await claim(1, p, "quiz");
  const run = await logRun(held);
  const stranger = { ...held, claim_token: uuid(999) };
  assert.deepEqual(await complete(stranger, quiz, run), { status: "lost_claim", result_id: null });
  assert.deepEqual(await runRow(run), { outcome: "discarded", error: "Claim lost before saving" });
  assert.equal(await content(p, "quiz"), null, "nothing written");
  const still = await job(p, "quiz");
  assert.deepEqual([still.status, still.claim_token], ["generating", held.claim_token]);
  assert.deepEqual(await complete({ ...held, job_id: 999999 }, quiz), {
    status: "lost_claim",
    result_id: null,
  });
}
{
  // A run is only ever given its outcome by its own job: passing another
  // job's run relabels nothing, whichever way the save goes.
  await resetQueue();
  const [p, q, r] = [await newPoint(), await newPoint(), await newPoint()];
  for (const point of [p, q, r]) await enqueue(point);
  const [mine] = await claim(1, p, "quiz");
  const [theirs] = await claim(1, q, "quiz");
  const [third] = await claim(1, r, "quiz");
  const theirRun = await logRun(theirs);
  const untouched = { outcome: "passed", error: null };
  await complete({ ...mine, claim_token: uuid(997) }, quiz, theirRun); // lost claim
  assert.deepEqual(await runRow(theirRun), untouched);
  assert.equal((await complete(mine, quiz, theirRun)).status, "written");
  assert.deepEqual(await runRow(theirRun), untouched);
  await svc("select public.ensure_generated_mcq_set($1, $2::jsonb)", [r, JSON.stringify(quiz)]);
  assert.equal((await complete(third, quiz, theirRun)).status, "already_existed");
  assert.deepEqual(await runRow(theirRun), untouched);
  assert.equal((await complete(theirs, quiz, theirRun)).status, "written");
  assert.deepEqual(await runRow(theirRun), { outcome: "saved", error: null }, "its own job, yes");
}

// ── 10. Content that turned up meanwhile is kept, loudly ───────────────
{
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [quizJob] = await claim(1, p, "quiz");
  const [taskJob] = await claim(1, p, "task");
  // The deployed site writes both while the worker's calls are out.
  const theirSet = (
    await svc<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb) as id", [
      p,
      JSON.stringify([quiz[1]]),
    ])
  )[0].id;
  const theirTask = (
    await svc<{ id: string }>(
      "select public.ensure_generated_homework($1, 'Their task', 'biology', 'gcse', $2::jsonb) as id",
      [p, JSON.stringify([task[1]])],
    )
  )[0].id;

  const quizRun = await logRun(quizJob);
  assert.deepEqual(await complete(quizJob, quiz, quizRun), {
    status: "already_existed",
    result_id: theirSet,
  });
  assert.deepEqual(await runRow(quizRun), {
    outcome: "discarded",
    error: "Content already existed when saving",
  });
  const taskRun = await logRun(taskJob);
  assert.deepEqual(await complete(taskJob, task, taskRun), {
    status: "already_existed",
    result_id: theirTask,
  });
  assert.deepEqual(await runRow(taskRun), {
    outcome: "discarded",
    error: "Content already existed when saving",
  });

  const count = async (sql: string) => (await db.query<{ n: number }>(sql, [p])).rows[0].n;
  assert.equal(
    await count("select count(*)::int as n from public.mcq_sets where spec_point_id = $1"),
    1,
    "no second set",
  );
  assert.equal(
    await count(
      "select count(*)::int as n from public.mcq_questions q join public.mcq_sets s on s.id = q.set_id where s.spec_point_id = $1",
    ),
    1,
    "and theirs is as they wrote it",
  );
  assert.equal(
    await count("select count(*)::int as n from public.resources where spec_point_id = $1"),
    1,
    "no second task",
  );
  assert.equal(
    await count(
      "select count(*)::int as n from public.homework_questions q join public.resources r on r.id = q.resource_id where r.spec_point_id = $1",
    ),
    1,
  );
  const kept = await job(p, "quiz");
  assert.deepEqual(
    [kept.status, kept.completed_how, kept.result_id, kept.claim_token],
    ["completed", "already_existed", theirSet, null],
  );
}

// ── 11. A writer that gets in between the check and the save ───────────
{
  await resetQueue();
  await db.exec(`
    create trigger test_rival before insert on public.mcq_sets
      for each row execute function public.test_rival_writes_first();
    create trigger test_rival before insert on public.resources
      for each row execute function public.test_rival_writes_first();
  `);
  const p = await newPoint();
  await enqueue(p);
  const [quizJob] = await claim(1, p, "quiz");
  const [taskJob] = await claim(1, p, "task");
  await db.query("insert into public.test_rivals values ($1)", [p]);

  const quizRun = await logRun(quizJob);
  const quizResult = await complete(quizJob, quiz, quizRun);
  const rivalSet = (
    await db.query<{ id: string }>(
      "select id from public.mcq_sets where spec_point_id = $1 and title = 'Rival'",
      [p],
    )
  ).rows[0].id;
  assert.deepEqual(quizResult, { status: "already_existed", result_id: rivalSet });
  assert.equal((await runRow(quizRun)).outcome, "discarded");
  const rivalQuestions = await db.query("select 1 from public.mcq_questions where set_id = $1", [
    rivalSet,
  ]);
  assert.equal(rivalQuestions.rows.length, 0, "none of ours went into the rival's set");

  const taskResult = await complete(taskJob, task);
  const rivalTask = (
    await db.query<{ id: string }>(
      "select id from public.resources where spec_point_id = $1 and title = 'Rival'",
      [p],
    )
  ).rows[0].id;
  assert.deepEqual(taskResult, { status: "already_existed", result_id: rivalTask });
  const rivalLinks = await db.query(
    "select 1 from public.resource_spec_points where resource_id = $1",
    [rivalTask],
  );
  assert.equal(rivalLinks.rows.length, 0);
  await db.exec(`
    drop trigger test_rival on public.mcq_sets;
    drop trigger test_rival on public.resources;
    delete from public.test_rivals;
  `);

  // On its own the save says it wrote nothing, rather than naming the rival's.
  assert.equal(
    (
      await db.query<{ id: string | null }>(
        "select private.save_generated_quiz($1, $2::jsonb) as id",
        [p, JSON.stringify(quiz)],
      )
    ).rows[0].id,
    null,
  );
  assert.equal(
    (
      await db.query<{ id: string | null }>(
        "select private.save_generated_task($1, $2::jsonb) as id",
        [p, JSON.stringify(task)],
      )
    ).rows[0].id,
    null,
  );
}

// ── 12. Questions that fail the checks are refused, and the claim kept ─
{
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [quizJob] = await claim(1, p, "quiz");
  const [taskJob] = await claim(1, p, "task");
  const q = quiz[1];
  const badQuizzes: [unknown, RegExp][] = [
    [{}, /no questions/],
    [[], /no questions/],
    ["not a list", /no questions/],
    [[{ ...q, question: "   " }], /Question 1 has no text/],
    [[q, { ...q, question: 7 }], /Question 2 has no text/],
    [[{ ...q, options: "TT Tt tt T" }], /Question 1 needs four options/],
    [[{ ...q, options: ["TT", "Tt", "tt"] }], /needs four options, each with text/],
    [[{ ...q, options: ["TT", "Tt", "tt", " "] }], /each with text/],
    [[{ ...q, options: ["TT", "Tt", "tt", 4] }], /each with text/],
    [[{ ...q, options: ["TT", " TT ", "Tt", "tt"] }], /two identical options/],
    [[{ ...q, options: ["a  b", "a b", "c", "d"] }], /two identical options/],
    [[{ ...q, correct_index: 4 }], /answer key is not one of its four options/],
    [[{ ...q, correct_index: 1.5 }], /answer key/],
    [[{ ...q, correct_index: "1" }], /answer key/],
    [[{ ...q, explanation: "" }], /no explanation/],
    [[{ question: q.question, options: q.options, correct_index: 1 }], /no explanation/],
  ];
  for (const [questions, why] of badQuizzes)
    await assert.rejects(() => complete(quizJob, questions), why, JSON.stringify(questions));

  const t = task[0];
  const badTasks: [unknown, RegExp][] = [
    [[], /no questions/],
    [[{ ...t, prompt: "" }], /Question 1 has no prompt/],
    [[t, { ...t, marks: 0 }], /Question 2 must be worth a whole number of marks from 1 to 30/],
    [[{ ...t, marks: 31 }], /marks from 1 to 30/],
    [[{ ...t, marks: 2.5 }], /marks from 1 to 30/],
    [[{ ...t, marks: "3" }], /marks from 1 to 30/],
    [[{ prompt: t.prompt, answer_type: "short", mark_scheme: "x" }], /marks from 1 to 30/],
    [[{ ...t, answer_type: "essay" }], /answer type must be short, long or numeric/],
    [[{ ...t, mark_scheme: "  " }], /no mark scheme/],
    [quiz, /no prompt/],
  ];
  for (const [questions, why] of badTasks)
    await assert.rejects(() => complete(taskJob, questions), why, JSON.stringify(questions));

  for (const [held, kind] of [
    [quizJob, "quiz"],
    [taskJob, "task"],
  ] as const) {
    const kept = await job(p, kind);
    assert.deepEqual([kept.status, kept.claim_token], ["generating", held.claim_token]);
    assert.equal(await content(p, kind), null, `no ${kind} written`);
  }
}

// ── 13. Recording a failure ─────────────────────────────────────────────
{
  await resetQueue();
  await db.exec("update private.practice_queue set max_attempts = 10");
  const p = await newPoint();
  await enqueue(p);
  const waits: number[] = [];
  for (let i = 0; i < 6; i++) {
    const [held] = await claim(1, p, "quiz");
    assert.equal(await fail(held, `Attempt ${i + 1} failed the checks`, "retry"), "pending");
    waits.push(await waitMinutes(held.job_id));
    await due(held.job_id);
  }
  assert.deepEqual(waits, [10, 20, 40, 80, 120, 120], "retries back off, to two hours at most");
  const retried = await job(p, "quiz");
  assert.deepEqual(
    [retried.status, retried.claim_token, retried.lease_until, retried.last_error],
    ["pending", null, null, "Attempt 6 failed the checks"],
  );

  // Out of attempts: failed.
  await resetQueue();
  const q = await newPoint();
  await enqueue(q);
  for (const expected of ["pending", "pending", "failed"]) {
    const [held] = await claim(1, q, "quiz");
    assert.equal(await fail(held, "Question 3 has two identical options", "retry"), expected);
    await due(held.job_id);
  }
  // Giving up fails it at once.
  const [held] = await claim(1, q, "task");
  assert.equal(await fail(held, "x".repeat(3000), "give_up"), "failed");
  const gaveUp = await job(q, "task");
  assert.deepEqual(
    [gaveUp.attempts, gaveUp.last_error?.length],
    [1, 2000],
    "the error is cut to 2000",
  );

  // Only the worker holding the claim can fail the job.
  const r = await newPoint();
  await enqueue(r);
  const [mine] = await claim(1, r, "quiz");
  assert.equal(await fail({ ...mine, claim_token: uuid(998) }, "x", "retry"), "lost_claim");
  assert.equal((await job(r, "quiz")).status, "generating");
  await assert.rejects(() => fail(mine, "x", "shrug"), /Unknown failure kind/);
  await assert.rejects(() => fail(mine, "x", null as unknown as string), /Unknown failure kind/);
}
{
  // A save that raised: the worker's fail closes that call's run as failed.
  await resetQueue();
  await db.exec("update private.practice_queue set max_attempts = 10");
  const [p, q] = [await newPoint(), await newPoint()];
  await enqueue(p);
  await enqueue(q);
  const [held] = await claim(1, p, "quiz");
  const [other] = await claim(1, q, "quiz");
  const run = await logRun(held);
  const otherRun = await logRun(other);
  const error = "Question 2's answer key is not one of its four options";
  assert.equal(await fail(held, error, "retry", 0, run), "pending");
  assert.deepEqual(await runRow(run), { outcome: "failed", error });

  // Never another job's run.
  await due(held.job_id);
  const [again] = await claim(1, p, "quiz");
  await fail(again, "Bad JSON", "retry", 0, otherRun);
  assert.deepEqual(await runRow(otherRun), { outcome: "passed", error: null });

  // Its own run is closed even when the claim has gone, and with no message
  // it still says why.
  await due(again.job_id);
  const [late] = await claim(1, p, "quiz");
  const lateRun = await logRun(late);
  await expire(late.job_id);
  assert.equal((await claim(1, p, "quiz")).length, 1, "another worker takes it over");
  assert.equal(await fail(late, null, "retry", 0, lateRun), "lost_claim");
  assert.deepEqual(await runRow(lateRun), { outcome: "failed", error: "Save failed" });

  // A run that really was saved stays saved.
  assert.equal((await complete(other, quiz, otherRun)).status, "written");
  assert.equal(await fail(other, "Late failure", "retry", 0, otherRun), "lost_claim");
  assert.deepEqual(await runRow(otherRun), { outcome: "saved", error: null });
}

// ── 14. An outage pauses the queue, and isn't held against the job ─────
{
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [quizJob, taskJob] = await claim(2, p);
  const credit = `Your credit balance is too low to access the Anthropic API. ${"x".repeat(600)}`;
  assert.equal(await fail(quizJob, credit, "outage", 30), "pending");
  const settings = async () =>
    (
      await db.query<{ until: Date; reason: string; minutes: number }>(
        "select paused_until as until, pause_reason as reason, extract(epoch from paused_until - updated_at)::int / 60 as minutes from private.practice_queue",
      )
    ).rows[0];
  const paused = await settings();
  assert.equal(paused.minutes, 30);
  assert.equal(paused.reason, credit.slice(0, 500));
  const waiting = await job(p, "quiz");
  assert.deepEqual(
    [waiting.status, waiting.attempts, waiting.claim_token, waiting.last_error?.length],
    ["pending", 0, null, credit.length],
    "the attempt is given back",
  );
  assert.equal(waiting.run_after.getTime(), paused.until.getTime(), "it waits out the pause");

  // A second, shorter outage never shortens the pause.
  assert.equal(await fail(taskJob, "429 rate limited", "outage", 2), "pending");
  const after = await settings();
  assert.equal(after.until.getTime(), paused.until.getTime());
  assert.equal(after.reason, "429 rate limited");
  assert.equal((await job(p, "task")).run_after.getTime(), paused.until.getTime());
  assert.deepEqual(await claim(5), [], "nothing is claimed while paused");

  // Zero minutes still pauses for one.
  await resetQueue();
  const q = await newPoint();
  await enqueue(q);
  const [held] = await claim(1, q, "quiz");
  assert.equal(await fail(held, "Connection error", "outage", 0), "pending");
  assert.equal((await settings()).minutes, 1);
}
{
  // Resuming by hand frees the job an outage held back, at once. A job in a
  // longer retry back-off keeps its delay.
  await resetQueue();
  const [backingOff, limited] = [await newPoint(), await newPoint()];
  await enqueue(backingOff);
  await enqueue(limited);
  let [held] = await claim(1, backingOff, "quiz");
  await fail(held, "AI returned invalid JSON", "retry");
  await due(held.job_id);
  [held] = await claim(1, backingOff, "quiz");
  await fail(held, "AI returned invalid JSON", "retry");
  assert.equal(await waitMinutes(held.job_id), 20);
  const [hit] = await claim(1, limited, "quiz");
  assert.equal(await fail(hit, "429 rate limited", "outage", 2), "pending");
  assert.deepEqual(await claim(5, null, "quiz"), [], "paused");

  assert.equal(await pause(0), null);
  assert.ok((await job(limited, "quiz")).run_after <= new Date(), "free at once");
  assert.equal(await waitMinutes(held.job_id), 20, "the longer retry still waits");
  assert.deepEqual(
    (await claim(5, null, "quiz")).map((c) => c.spec_point_id),
    [limited],
    "the freed job is claimed straight away",
  );
}

// ── 15. The tutor's button ──────────────────────────────────────────────
{
  await resetQueue();
  const p = await newPoint();
  const asked = await request(p, "quiz");
  assert.deepEqual([asked.status, asked.result_id], ["pending", null]);
  assert.equal(asked.job_id, (await job(p, "quiz")).id);
  assert.equal(await job(p, "task"), undefined, "only the kind asked for");
  assert.equal((await job(p, "quiz")).requested, false, "asking without a press records nothing");

  // With content there, the job completes and names it.
  const q = await newPoint();
  const tutorQuiz = await addSet(q, { published: true });
  const found = await request(q, "quiz");
  assert.deepEqual([found.status, found.result_id], ["completed", tutorQuiz]);
  assert.equal((await job(q, "quiz")).completed_how, "already_existed");

  // A failed job stays failed, unless pressed for.
  let [held] = await claim(1, p, "quiz");
  await fail(held, "Refused", "give_up");
  assert.equal((await request(p, "quiz")).status, "failed");
  assert.equal((await request(p, "quiz", true)).status, "pending");
  const rearmed = await job(p, "quiz");
  assert.deepEqual([rearmed.attempts, rearmed.requested], [0, true]);
  assert.ok(rearmed.run_after <= new Date());

  // A job waiting out a retry is due at once, and keeps its attempts.
  [held] = await claim(1, p, "quiz");
  await fail(held, "AI returned invalid JSON", "retry");
  assert.equal(await waitMinutes(held.job_id), 10);
  await request(p, "quiz", true);
  const hurried = await job(p, "quiz");
  assert.deepEqual([hurried.status, hurried.attempts], ["pending", 1]);
  assert.ok(hurried.run_after <= new Date());

  // A job being generated is never touched, even when its own set turns up.
  [held] = await claim(1, p, "quiz");
  const before = await job(p, "quiz");
  await svc("select public.ensure_generated_mcq_set($1, $2::jsonb)", [p, JSON.stringify(quiz)]);
  assert.equal((await request(p, "quiz", true)).status, "generating");
  assert.deepEqual(await job(p, "quiz"), before);

  // A completed job whose content was replaced points at what is there now,
  // and one whose content is gone is queued again.
  const z = await newPoint();
  const firstSet = await addSet(z, { published: true, createdAt: "2026-01-01" });
  assert.equal((await request(z, "quiz")).result_id, firstSet);
  const secondSet = await addSet(z, { published: true });
  await db.query("delete from public.mcq_sets where id = $1", [firstSet]);
  const moved = await request(z, "quiz");
  assert.deepEqual([moved.status, moved.result_id], ["completed", secondSet]);
  await db.query("delete from public.mcq_sets where id = $1", [secondSet]);
  const gone = await request(z, "quiz");
  assert.deepEqual([gone.status, gone.result_id], ["pending", null]);

  await assert.rejects(() => request(z, "video"), /Unknown practice kind/);
  await assert.rejects(() => request(uuid(999), "quiz"), /Unknown spec point/);
}

// ── 15b. A press asks for the point's own AI quiz, beside a tutor's own ─
{
  await resetQueue();
  // On its own, a point with only a tutor's quiz is done: no call is made.
  const t = await newPoint();
  const tutorsOwn = await addSet(t, { published: true });
  await enqueue(t);
  const automatic = await job(t, "quiz");
  assert.deepEqual(
    [automatic.status, automatic.completed_how, automatic.result_id, automatic.requested],
    ["completed", "already_existed", tutorsOwn, false],
  );
  assert.deepEqual(await claim(5, t, "quiz"), [], "no call for it");

  // A press queues it again, the claim hands it out, and the AI set is
  // written alongside the tutor's quiz.
  const pressed = await request(t, "quiz", true);
  assert.deepEqual([pressed.status, pressed.result_id], ["pending", null]);
  const armed = await job(t, "quiz");
  assert.deepEqual(
    [armed.requested, armed.attempts, armed.claim_token, armed.completed_how],
    [true, 0, null, null],
  );
  const [taken] = await claim(1, t, "quiz");
  assert.equal(taken.job_id, armed.id, "handed out, the tutor's quiz notwithstanding");
  const aiSet = await complete(taken, quiz);
  assert.equal(aiSet.status, "written");
  assert.deepEqual(
    (
      await db.query(
        "select id, origin from public.mcq_sets where spec_point_id = $1 order by origin",
        [t],
      )
    ).rows,
    [
      { id: tutorsOwn, origin: "tutor" },
      { id: aiSet.result_id, origin: "generated" },
    ],
  );

  // Pressing again names the point's own set, not the tutor's, still written.
  const again = await request(t, "quiz", true);
  assert.deepEqual([again.status, again.result_id], ["completed", aiSet.result_id]);
  const kept = await job(t, "quiz");
  assert.deepEqual([kept.completed_how, kept.requested], ["written", true]);

  // The press is never forgotten: with its own set gone, the tutor's quiz
  // still doesn't count, and the job is queued again.
  await db.query("delete from public.mcq_sets where id = $1", [aiSet.result_id]);
  assert.equal(await enqueue(t), 1);
  const requeued = await job(t, "quiz");
  assert.deepEqual([requeued.status, requeued.requested], ["pending", true]);

  // A job completed against a tutor's quiz, whose point has since got its own
  // set: a press points it at that set.
  const u = await newPoint();
  const tutorU = await addSet(u, { published: true });
  await enqueue(u);
  assert.equal((await job(u, "quiz")).result_id, tutorU);
  const ownU = (
    await svc<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb) as id", [
      u,
      JSON.stringify(quiz),
    ])
  )[0].id;
  const named = await request(u, "quiz", true);
  assert.deepEqual(
    [named.status, named.result_id],
    ["completed", ownU],
    "its own, not the tutor's",
  );
  assert.equal((await job(u, "quiz")).completed_how, "already_existed");

  // Saving for a pressed job ignores a tutor's quiz that turned up meanwhile,
  // but keeps a generated set that did.
  const v = await newPoint();
  await request(v, "quiz", true);
  const [vHeld] = await claim(1, v, "quiz");
  await addSet(v, { published: true });
  assert.equal((await complete(vHeld, quiz)).status, "written");

  const w = await newPoint();
  await request(w, "quiz", true);
  const [wHeld] = await claim(1, w, "quiz");
  const theirs = (
    await svc<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb) as id", [
      w,
      JSON.stringify([quiz[0]]),
    ])
  )[0].id;
  const wRun = await logRun(wHeld);
  assert.deepEqual(await complete(wHeld, quiz, wRun), {
    status: "already_existed",
    result_id: theirs,
  });
  assert.equal((await runRow(wRun)).outcome, "discarded");

  // The same for a task: a tutor's task linked to the point stops counting,
  // and the point's own task is written.
  const x = await newPoint();
  const linkedTask = await addTask(null);
  await link(linkedTask, x);
  await enqueue(x);
  assert.equal((await job(x, "task")).result_id, linkedTask);
  assert.equal((await request(x, "task", true)).status, "pending");
  const [xHeld] = await claim(1, x, "task");
  const ownTask = await complete(xHeld, task);
  assert.equal(ownTask.status, "written");
  assert.equal(await content(x, "task", true), ownTask.result_id);

  // A press while a worker has the job is noted, and the claim is left alone.
  const y = await newPoint();
  await enqueue(y);
  const [yHeld] = await claim(1, y, "quiz");
  const during = await job(y, "quiz");
  assert.equal(during.requested, false);
  assert.equal((await request(y, "quiz", true)).status, "generating");
  const noted = await job(y, "quiz");
  assert.deepEqual(
    [noted.requested, noted.status, noted.claim_token, noted.lease_until, noted.attempts],
    [true, "generating", yHeld.claim_token, during.lease_until, during.attempts],
  );
}

// ── 16. Reading and steering the queue ──────────────────────────────────
{
  await resetQueue();
  const empty = await queueStatus();
  assert.deepEqual(Object.keys(empty).sort(), [
    "calls_24h",
    "counts",
    "daily_call_limit",
    "failed",
    "in_flight",
    "max_attempts",
    "max_in_flight",
    "pause_reason",
    "paused_until",
    "ready",
  ]);
  assert.deepEqual(empty, {
    paused_until: null,
    pause_reason: null,
    daily_call_limit: 100,
    calls_24h: 0,
    in_flight: 0,
    max_in_flight: 3,
    max_attempts: 3,
    counts: { pending: 0, generating: 0, completed: 0, failed: 0 },
    ready: [],
    failed: [],
  });

  // 26 points, 52 jobs: one claimed and logged, one failed, and one completed
  // on the way to the next claim because its point got a quiz.
  const listed: string[] = [];
  for (let i = 0; i < 26; i++) {
    const point = await newPoint();
    listed.push(point);
    await enqueue(point);
  }
  const [held] = await claim(1);
  await logRun(held);
  const [broken] = await claim(1);
  await fail(broken, "Refused", "give_up");
  await addSet(listed[1], { published: true });
  await claim(1);
  const s = await queueStatus();
  assert.deepEqual(s.counts, { pending: 48, generating: 2, completed: 1, failed: 1 });
  assert.equal(s.in_flight, 2);
  assert.equal(s.calls_24h, 1);
  assert.equal(s.ready.length, 48, "every ready job");
  const order = (
    await db.query<{ id: number }>(
      "select id from private.practice_jobs where status = 'pending' order by run_after, id",
    )
  ).rows.map((r) => r.id);
  assert.deepEqual(
    s.ready.map((r) => r.job_id),
    order,
    "in the order they'll be claimed",
  );
  const next = await job(listed[2], "quiz");
  assert.deepEqual(s.ready[0], {
    job_id: next.id,
    spec_point_id: listed[2],
    code: pointCode(listed[2]),
    title: pointTitle(listed[2]),
    kind: "quiz",
    attempts: 0,
  });
  const failedJob = await job(listed[0], "task");
  assert.deepEqual(s.failed, [
    {
      job_id: failedJob.id,
      spec_point_id: listed[0],
      code: pointCode(listed[0]),
      title: pointTitle(listed[0]),
      kind: "task",
      attempts: 1,
      last_error: "Refused",
      updated_at: (
        await db.query<{ t: string }>(
          "select to_jsonb(updated_at) #>> '{}' as t from private.practice_jobs where id = $1",
          [failedJob.id],
        )
      ).rows[0].t,
    },
  ]);
  for (let i = 0; i < 2; i++) await enqueue(await newPoint());
  assert.equal((await queueStatus()).ready.length, 50, "50 at most");

  // Pausing and resuming by hand.
  const until = await pause(15, "Ali is checking the bill");
  assert.ok(until && until > new Date());
  const shown = (
    await db.query<{ same: boolean; minutes: number; reason: string }>(
      `select (s.status ->> 'paused_until')::timestamptz = q.paused_until as same,
              extract(epoch from q.paused_until - q.updated_at)::int / 60 as minutes,
              s.status ->> 'pause_reason' as reason
       from (select public.practice_queue_status() as status) s, private.practice_queue q`,
    )
  ).rows[0];
  assert.deepEqual(shown, { same: true, minutes: 15, reason: "Ali is checking the bill" });
  assert.equal(await pause(0), null);
  assert.deepEqual(
    [(await queueStatus()).paused_until, (await queueStatus()).pause_reason],
    [null, null],
  );
  await db.exec(
    "update private.practice_queue set paused_until = now() - interval '1 minute', pause_reason = 'Old'",
  );
  assert.equal((await queueStatus()).paused_until, null, "a pause that has passed isn't one");
  await assert.rejects(() => pause(-5), /Pause for a number of minutes/);
  await assert.rejects(() => pause(null as unknown as number), /Pause for a number of minutes/);

  // Failed jobs, re-armed by point or all at once.
  await resetQueue();
  const [f1, f2] = [await newPoint(), await newPoint()];
  await enqueue(f1);
  await enqueue(f2);
  for (const [point, kind] of [
    [f1, "quiz"],
    [f1, "task"],
    [f2, "quiz"],
  ] as const) {
    const [taken] = await claim(1, point, kind);
    await fail(taken, "Refused", "give_up");
  }
  const rearm = async (ids: string[] | null) =>
    (
      await svc<{ n: number }>("select public.rearm_failed_practice_jobs($1::uuid[]) as n", [ids])
    )[0].n;
  assert.equal(await rearm([f2]), 1);
  assert.deepEqual(
    [(await job(f2, "quiz")).status, (await job(f1, "quiz")).status],
    ["pending", "failed"],
  );
  assert.equal(await rearm(null), 2);
  const back = await job(f1, "task");
  assert.deepEqual([back.status, back.attempts, back.last_error], ["pending", 0, "Refused"]);
  assert.equal(await rearm(null), 0);
}

// ── 17. Waking the worker ───────────────────────────────────────────────
{
  await resetQueue();
  const knocks = async () => {
    await db.query("select private.kick_practice_worker()");
    return (
      await db.query("select url, body, params, headers, timeout_milliseconds from net.requests")
    ).rows;
  };
  await db.exec(`insert into vault.decrypted_secrets values
    ('practice_worker_url', 'https://example.test/api/practice-worker'),
    ('practice_worker_secret', 'test-secret-0123456789abcdef0123456789')`);
  assert.deepEqual(await knocks(), [], "nothing ready: no knock");

  const p = await newPoint();
  await enqueue(p);
  await pause(5);
  assert.deepEqual(await knocks(), [], "paused: no knock");
  await pause(0);

  assert.deepEqual(await knocks(), [
    {
      url: "https://example.test/api/practice-worker",
      body: {},
      params: {},
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-secret-0123456789abcdef0123456789",
      },
      timeout_milliseconds: 300000,
    },
  ]);

  // Both secrets, or no knock.
  await db.exec("delete from net.requests");
  await db.exec("delete from vault.decrypted_secrets where name = 'practice_worker_secret'");
  assert.deepEqual(await knocks(), [], "no secret");
  await db.exec(
    "insert into vault.decrypted_secrets values ('practice_worker_secret', '   '), ('practice_worker_url_old', 'x')",
  );
  assert.deepEqual(await knocks(), [], "a blank secret is none");
  await db.exec(
    "update vault.decrypted_secrets set decrypted_secret = 'test-secret-0123456789abcdef0123456789' where name = 'practice_worker_secret'",
  );
  await db.exec("delete from vault.decrypted_secrets where name = 'practice_worker_url'");
  assert.deepEqual(await knocks(), [], "no address");
  await db.exec(
    "insert into vault.decrypted_secrets values ('practice_worker_url', 'https://example.test/api/practice-worker')",
  );

  // Every job claimed: no knock, until a lease runs out.
  const taken = await claim(2, p);
  assert.equal(taken.length, 2);
  assert.deepEqual(await knocks(), []);
  await expire(taken[0].job_id);
  assert.equal((await knocks()).length, 1, "a job whose worker died is ready again");

  // At either cap the worker could claim nothing, so it isn't woken.
  await resetQueue();
  const [a, b] = [await newPoint(), await newPoint()];
  await enqueue(a);
  await enqueue(b);
  await db.exec("update private.practice_queue set max_in_flight = 1");
  const [busy] = await claim(1, a, "quiz");
  assert.deepEqual(await knocks(), [], "the in-flight limit is reached, though jobs are ready");
  await expire(busy.job_id);
  assert.equal((await knocks()).length, 1, "a worker presumed dead doesn't hold the slot");
  await db.exec("delete from net.requests");
  await fail(busy, "Refused", "give_up");
  await db.exec("update private.practice_queue set max_in_flight = 3, daily_call_limit = 2");
  await logRun(busy, { hoursAgo: 2 });
  await logRun(busy, { hoursAgo: 3 });
  assert.deepEqual(await knocks(), [], "the day's calls are used");
  await logRun(busy, { outcome: "failed", apiStatus: 429, error: "Rate limited" });
  await db.exec("update private.practice_queue set daily_call_limit = 3");
  assert.equal((await knocks()).length, 1, "room again (an unbilled refusal took none of it)");
}

// ── 18. The run log ─────────────────────────────────────────────────────
{
  const old = (
    await db.query(
      "select outcome, source, job_id, error from public.exam_generation_runs where id = $1",
      [oldRun],
    )
  ).rows[0];
  assert.deepEqual(old, { outcome: "passed", source: "unknown", job_id: null, error: null });

  const insert = (columns: Record<string, unknown>) =>
    svc(
      `insert into public.exam_generation_runs
         (framework_version, model, format, grounding, exemplar_ids, generated_questions, usage, outcome, error, source)
       values ('v1', 'm', 'mcq', 'style', '{}', $1::jsonb, $2::jsonb, $3, $4, $5)`,
      [
        columns.generated_questions ?? null,
        columns.usage ?? null,
        columns.outcome ?? "passed",
        columns.error ?? null,
        columns.source ?? "builder",
      ],
    );
  await insert({ outcome: "failed", error: "Your credit balance is too low" });
  await assert.rejects(
    () => insert({ outcome: "failed" }),
    /exam_generation_runs_failure_says_why/,
    "a failed call says why",
  );
  await assert.rejects(
    () => insert({ outcome: "passed" }),
    /exam_generation_runs_questions_unless_failed/,
    "a call that passed has its questions",
  );
  await assert.rejects(
    () => insert({ outcome: "kept", generated_questions: "[]", usage: "{}" }),
    /exam_generation_runs_outcome_check/,
  );
  await assert.rejects(
    () => insert({ source: "cli", generated_questions: "[]", usage: "{}" }),
    /exam_generation_runs_source_check/,
  );
  await assert.rejects(
    () =>
      svc(
        `insert into public.exam_generation_runs (framework_version, model, format, grounding, exemplar_ids, generated_questions, usage, job_id)
         values ('v1', 'm', 'mcq', 'style', '{}', '[]', '{}', 424242)`,
      ),
    /exam_generation_runs_job_id_fkey/,
  );

  // Tutors read the log; students don't.
  const total = (
    await db.query<{ n: number }>("select count(*)::int as n from public.exam_generation_runs")
  ).rows[0].n;
  const seen = async (who: string) =>
    (await as<{ n: number }>(who, "select count(*)::int as n from public.exam_generation_runs"))[0]
      .n;
  assert.equal(await seen(tutor), total);
  assert.equal(await seen(student), 0);

  // Deleting a point takes its jobs; its runs stay, with no job.
  await resetQueue();
  const p = await newPoint();
  await enqueue(p);
  const [held] = await claim(1, p, "quiz");
  const run = await logRun(held);
  await db.query("delete from public.spec_points where id = $1", [p]);
  assert.equal(await jobCount(p), 0);
  assert.deepEqual(
    (
      await db.query(
        "select spec_point_id, job_id from public.exam_generation_runs where id = $1",
        [run],
      )
    ).rows,
    [{ spec_point_id: null, job_id: null }],
  );
}

// ── 19. The tables refuse impossible states ─────────────────────────────
{
  const p = await newPoint();
  const insertJob = (columns: string, values: string) =>
    db.query(
      `insert into private.practice_jobs (spec_point_id, kind${columns}) values ('${p}', 'quiz'${values})`,
    );
  const claimFields = `'${uuid(5)}', now()`;
  for (const [columns, values, why] of [
    [", status", ", 'generating'", /practice_jobs_claim_only_while_generating/],
    [", claim_token, lease_until", `, ${claimFields}`, /practice_jobs_claim_only_while_generating/],
    [", status, claim_token", `, 'generating', '${uuid(5)}'`, /practice_jobs_claim/],
    [", lease_until", ", now()", /practice_jobs_claim_token_and_lease/],
    [", status", ", 'completed'", /practice_jobs_result_only_when_completed/],
    [", result_id", `, '${uuid(6)}'`, /practice_jobs_result_and_how/],
    [", completed_how", ", 'written'", /practice_jobs_result_and_how/],
    [
      ", status, result_id, completed_how",
      `, 'completed', '${uuid(6)}', 'magic'`,
      /completed_how_check/,
    ],
    [", status", ", 'done'", /practice_jobs_status_check/],
    [", attempts", ", -1", /practice_jobs_attempts_check/],
  ] as const)
    await assert.rejects(() => insertJob(columns, values), why, `${columns} ${values}`);
  await assert.rejects(
    () =>
      db.query(`insert into private.practice_jobs (spec_point_id, kind) values ($1, 'video')`, [p]),
    /practice_jobs_kind_check/,
  );
  await insertJob("", "");
  await assert.rejects(
    () => insertJob("", ""),
    /practice_jobs_one_per_point/,
    "one job per point and kind",
  );

  await assert.rejects(
    () => db.query("insert into private.practice_queue (id) values (false)"),
    /practice_queue_id_check/,
  );
  await assert.rejects(
    () => db.query("insert into private.practice_queue (id) values (true)"),
    /practice_queue_pkey/,
    "one settings row",
  );
  for (const [setting, why] of [
    ["max_in_flight = 11", /max_in_flight_check/],
    ["max_in_flight = 0", /max_in_flight_check/],
    ["max_attempts = 0", /max_attempts_check/],
    ["lease_seconds = 30", /lease_seconds_check/],
    ["lease_seconds = 359", /lease_seconds_check/],
    ["lease_seconds = 3601", /lease_seconds_check/],
    ["daily_call_limit = -1", /daily_call_limit_check/],
  ] as const)
    await assert.rejects(() => db.query(`update private.practice_queue set ${setting}`), why);
  await db.exec("update private.practice_queue set lease_seconds = 360");

  // Without its settings row the queue claims nothing, and wakes nobody:
  // never without limits.
  await enqueue(await newPoint());
  await db.exec("delete from private.practice_queue; delete from net.requests;");
  await assert.rejects(() => claim(1), /The practice queue has no settings row/);
  await db.query("select private.kick_practice_worker()");
  const knocked = await db.query("select 1 from net.requests");
  assert.equal(knocked.rows.length, 0);
  await db.exec("insert into private.practice_queue (id) values (true)");
}

// ── 20. The legacy writers are untouched ────────────────────────────────
assert.deepEqual(await legacy(), legacyBefore, "ensure_generated_* as they were, grants included");

// ── 21. The rollback removes what the migration added, and only that ───
{
  const runsBefore = (
    await db.query(
      "select id, spec_point_id, framework_version, model, format, grounding, exemplar_ids, generated_questions, usage, created_at from public.exam_generation_runs order by id",
    )
  ).rows;
  const failedRuns = (
    await db.query<{ id: string }>(
      "select id from public.exam_generation_runs where generated_questions is null or usage is null",
    )
  ).rows.map((r) => r.id);
  assert.ok(failedRuns.length > 0);
  const auditColumns =
    "id, outcome, error, stop_reason, raw_output, source, job_id, duration_ms, api_status";
  const logBefore = (
    await db.query(`select ${auditColumns} from public.exam_generation_runs order by id`)
  ).rows;
  assert.ok(logBefore.some((r) => r.api_status !== null && r.outcome === "failed"));

  await db.exec(rollback);
  await db.exec(rollback); // safe to run twice

  // Everything the migration added is gone. The one thing the rollback adds,
  // on purpose, is where it keeps the failure log.
  const kept = (await catalog()).filter((item) => item.includes("exam_generation_runs_audit"));
  assert.ok(
    kept.some((item) => item.startsWith("relation private.exam_generation_runs_audit r ")),
    kept.join("\n"),
  );
  assert.deepEqual(
    (await catalog()).filter((item) => !item.includes("exam_generation_runs_audit")),
    catalogBefore,
  );
  assert.deepEqual(
    (await db.query(`select ${auditColumns} from private.exam_generation_runs_audit order by id`))
      .rows,
    logBefore,
    "every run's outcome, error, raw output and status, copied once",
  );
  for (const role of ["public", "anon", "authenticated", "service_role"]) {
    const holds = await db.query<{ any: boolean }>(
      "select has_table_privilege($1, 'private.exam_generation_runs_audit', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as any",
      [role],
    );
    assert.equal(holds.rows[0].any, false, `${role} can't read the kept log`);
  }
  assert.deepEqual(await legacy(), legacyBefore);
  const runsAfter = (
    await db.query(
      "select id, spec_point_id, framework_version, model, format, grounding, exemplar_ids, generated_questions, usage, created_at from public.exam_generation_runs order by id",
    )
  ).rows;
  assert.deepEqual(
    runsAfter,
    runsBefore.map((r) =>
      failedRuns.includes(r.id as string)
        ? { ...r, generated_questions: r.generated_questions ?? [], usage: r.usage ?? {} }
        : r,
    ),
    "every run is kept; a failed call's gets an empty list and usage",
  );

  // A week saves as before, with nothing to queue it.
  const p = await newPoint();
  await as(
    student,
    "select public.save_weekly_plan($1, 'biology', 'aqa', 'gcse', $2, 'ai', null, $3::jsonb)",
    [student, mon(4), JSON.stringify([{ spec_point_id: p, origin: "core" }])],
  );

  // And the migration goes back on cleanly, even over the first draft's
  // five-argument fail_practice_job, which it replaces rather than overloads.
  await db.exec(`create function public.fail_practice_job(bigint, uuid, text, text, integer)
    returns text language sql as $$ select 'old' $$`);
  await db.exec(migration);
  assert.equal(await jobCount(p), 2, "the one-off fill queues the week saved meanwhile");
  assert.deepEqual(
    (
      await db.query<{ sig: string }>(
        "select oid::regprocedure::text as sig from pg_proc where proname = 'fail_practice_job'",
      )
    ).rows,
    [{ sig: "fail_practice_job(bigint,uuid,text,text,integer,uuid)" }],
  );
  assert.equal(
    (await db.query<{ n: number }>("select count(*)::int as n from cron.job")).rows[0].n,
    1,
  );

  // Rolling back once more keeps the first copy of each run's log, not the
  // defaults its columns came back with.
  await db.exec(rollback);
  assert.deepEqual(
    (await db.query(`select ${auditColumns} from private.exam_generation_runs_audit order by id`))
      .rows,
    logBefore,
  );
}

// ── 22. Every UPDATE and DELETE names its rows (pg-safeupdate) ─────────
// Supabase runs every API request with pg-safeupdate, which refuses an UPDATE
// or DELETE without a WHERE clause, even inside a function. PGlite can't load
// it, so every check above passed while, in production, the worker could not
// record a failure or pause the queue (6 Oct). This reads the installed bodies.
{
  const writes =
    /\bupdate\s+(?!set\b)[\w.]+(?:\s+(?:as\s+)?(?!set\b)\w+)?\s+set\b|\bdelete\s+from\b/i;
  const unguarded = async () => {
    const bodies = (
      await db.query<{ name: string; body: string }>(
        `select p.proname as name, p.prosrc as body from pg_proc p
         where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
           and (p.proname like '%practice%' or p.proname like 'save_generated_%')`,
      )
    ).rows;
    assert.ok(bodies.length >= 16, "the queue's functions are installed");
    return bodies.flatMap(({ name, body }) =>
      body
        .replace(/--[^\n]*/g, "")
        .split(";")
        .filter((statement) => writes.test(statement) && !/\bwhere\b/i.test(statement))
        .map((statement) => {
          const write = statement.slice(statement.search(writes)).replace(/\s+/g, " ");
          return `${name}: ${write.slice(0, 40)}`;
        }),
    );
  };

  // The check catches it: the queue as first written had two such updates.
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261005220000_practice_queue.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(await unguarded(), [
    "fail_practice_job: update private.practice_queue q set paus",
    "pause_practice_queue: update private.practice_queue q set paus",
  ]);

  // With the fix, none.
  await db.exec(migration);
  assert.deepEqual(await unguarded(), [], "every UPDATE and DELETE has a WHERE clause");
}

console.log("practice queue: all checks passed");
