/** Isolated PostgreSQL checks for 20261109170711: a student asks for any spec
 * point's quiz and task, 10 a day, only on their own course. No production data
 * is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-student-practice-requests-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const tutor = uuid(2);
const parent = uuid(3);
const lapsed = uuid(4); // a student whose subscription has run out
const other = uuid(5); // a second student on the same course

const bioTopic = uuid(10); // Edexcel GCSE biology: the student's course
const aqaTopic = uuid(11); // AQA GCSE biology: another board
const alevelTopic = uuid(12); // Edexcel A-level biology: another level
const physTopic = uuid(13); // Edexcel GCSE physics: a subject not paid for

const p = (n: number) => uuid(100 + n);
const offBoard = uuid(200);
const offLevel = uuid(201);
const unpaid = uuid(202);

// The queue's own bodies, read from the migration that made them live.
const queueSql = await readFile("supabase/migrations/20261005220000_practice_queue.sql", "utf8");
function cut(sql: string, start: string, end: string) {
  const from = sql.indexOf(start);
  assert.ok(from >= 0, `${start} not found`);
  const to = sql.indexOf(end, from);
  assert.ok(to > from, `end of ${start} not found`);
  return sql.slice(from, to + end.length);
}
const jobsTable = cut(queueSql, "create table if not exists private.practice_jobs", "\n);");
const contentId = cut(
  queueSql,
  "create or replace function private.practice_content_id(",
  "$function$;",
);
const enqueue = cut(
  queueSql,
  "create or replace function private.enqueue_practice(",
  "$function$;",
);

await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth; create schema private;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create type public.app_role as enum ('student', 'tutor', 'admin');
create type public.profile_role as enum ('student', 'parent', 'tutor');
create type public.subject as enum ('biology', 'chemistry', 'physics');
create type public.board as enum ('edexcel', 'aqa', 'ocr', 'cambridge', 'oxford_aqa');
create type public.level as enum ('gcse', 'alevel', 'gcse_trilogy', 'igcse');
create type public.resource_kind as enum ('video', 'download', 'live_session', 'homework');

create function public.update_updated_at_column() returns trigger language plpgsql set search_path to 'public'
as $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

create table public.user_roles(user_id uuid, role public.app_role);
create table public.profiles(id uuid primary key, role public.profile_role, level public.level,
  enrolled_courses text[]);
create table public.student_enrolments(id uuid primary key default gen_random_uuid(),
  student_id uuid, subject public.subject, board public.board);
create table public.topics(id uuid primary key, subject public.subject not null,
  board public.board not null, level public.level not null, title text not null);
create table public.spec_points(id uuid primary key,
  topic_id uuid not null references public.topics(id), code text not null, title text not null);
create table public.ai_request_log(id bigint generated always as identity primary key,
  user_id uuid not null, endpoint text not null, created_at timestamptz not null default now());

create table public.mcq_sets(id uuid primary key default gen_random_uuid(),
  spec_point_id uuid references public.spec_points(id), origin text not null default 'generated',
  published boolean not null default true, created_at timestamptz not null default now());
create table public.mcq_questions(id uuid primary key default gen_random_uuid(),
  set_id uuid references public.mcq_sets(id) on delete cascade, spec_point_id uuid);
create table public.resources(id uuid primary key default gen_random_uuid(),
  kind public.resource_kind not null, spec_point_id uuid, review_status text not null default 'to_review',
  publish_at timestamptz, created_at timestamptz not null default now());
create table public.resource_spec_points(resource_id uuid references public.resources(id) on delete cascade,
  spec_point_id uuid);

-- Live bodies (9 Nov 2026).
CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select exists (
           select 1 from public.user_roles r
           where r.user_id = _user_id and r.role in ('tutor', 'admin')
         )
      or exists (
           select 1 from public.profiles p
           where p.id = _user_id and p.role = 'tutor'
         );
$function$;

-- Stands in for the subscription check: a lapsed student pays for nothing.
create table private.paid(student_id uuid, subject text);
create function private.student_paid_subjects(p_student_id uuid) returns text[]
 language sql stable security definer set search_path to ''
as $$ select coalesce(array_agg(subject), '{}') from private.paid where student_id = p_student_id $$;

-- Records each wake instead of sending it; can be told to fail.
create table private.kicks(at timestamptz default clock_timestamp());
create table private.kick_fails(on_ boolean);
create function private.kick_practice_worker() returns void language plpgsql security definer set search_path to ''
as $$ begin
  if exists (select 1 from private.kick_fails) then raise exception 'pg_net is down'; end if;
  insert into private.kicks default values;
end $$;
`);

await db.exec(jobsTable + ";");
await db.exec(`
create trigger practice_jobs_updated before update on private.practice_jobs
  for each row execute function public.update_updated_at_column();
`);
await db.exec(contentId);
await db.exec(enqueue);

await db.exec(`
insert into auth.users values ('${student}'), ('${tutor}'), ('${parent}'), ('${lapsed}'), ('${other}');
insert into public.profiles values
  ('${student}', 'student', 'gcse', '{biology}'),
  ('${tutor}', 'tutor', null, null),
  ('${parent}', 'parent', null, null),
  ('${lapsed}', 'student', 'gcse', '{biology}'),
  ('${other}', 'student', 'gcse', '{biology}');
insert into public.user_roles values ('${tutor}', 'tutor');
insert into public.student_enrolments (student_id, subject, board) values
  ('${student}', 'biology', 'edexcel'), ('${student}', 'physics', 'edexcel'),
  ('${lapsed}', 'biology', 'edexcel'), ('${other}', 'biology', 'edexcel');
insert into private.paid values ('${student}', 'biology'), ('${other}', 'biology');
insert into public.topics values
  ('${bioTopic}', 'biology', 'edexcel', 'gcse', 'Cells'),
  ('${aqaTopic}', 'biology', 'aqa', 'gcse', 'Cells'),
  ('${alevelTopic}', 'biology', 'edexcel', 'alevel', 'Cells'),
  ('${physTopic}', 'physics', 'edexcel', 'gcse', 'Forces');
insert into public.spec_points
  select ('00000000-0000-0000-0000-' || lpad((100 + n)::text, 12, '0'))::uuid, '${bioTopic}', 'B' || n, 'Point ' || n
  from generate_series(1, 12) n;
insert into public.spec_points values
  ('${offBoard}', '${aqaTopic}', 'A1', 'AQA point'),
  ('${offLevel}', '${alevelTopic}', 'L1', 'A-level point'),
  ('${unpaid}', '${physTopic}', 'P1', 'Physics point');
`);

const migration = await readFile(
  "supabase/migrations/20261109170711_student_practice_requests.sql",
  "utf8",
);
await db.exec(migration);
// Idempotent.
await db.exec(migration);

type Row = { kind: string; state: string; requests_left: number };

async function as<T>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("begin");
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
    await db.exec("set local role authenticated");
    const res = await db.query(sql, params);
    await db.exec("commit");
    return res.rows as T[];
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const status = (uid: string | null, point: string) =>
  as<Row>(uid, "select * from public.practice_for_point($1)", [point]);
const request = (uid: string | null, point: string) =>
  as<Row>(uid, "select * from public.request_practice_for_point($1)", [point]);
const states = (rows: Row[]) => rows.map((r) => `${r.kind}:${r.state}`).join(" ");
const one = async <T>(sql: string) => ((await db.query(sql)).rows[0] as Record<string, T>).v;
const jobs = (point: string) =>
  db
    .query<{ kind: string; status: string; requested: boolean }>(
      `select kind, status, requested from private.practice_jobs where spec_point_id = $1 order by kind`,
      [point],
    )
    .then((r) => r.rows);
const used = (uid: string) =>
  one<number>(
    `select count(*)::int v from public.ai_request_log where user_id = '${uid}' and endpoint = 'practice_request'`,
  );
const kicks = () => one<number>(`select count(*)::int v from private.kicks`);

// ── A point with nothing ──────────────────────────────────────────────────
{
  const before = await status(student, p(1));
  assert.equal(states(before), "quiz:missing task:missing");
  assert.equal(before[0].requests_left, 10);

  const after = await request(student, p(1));
  assert.equal(states(after), "quiz:writing task:writing", "both are queued");
  assert.equal(after[0].requests_left, 8, "a quiz and a task are two requests");
  assert.deepEqual(await jobs(p(1)), [
    { kind: "quiz", status: "pending", requested: false },
    { kind: "task", status: "pending", requested: false },
  ]);
  assert.equal(await used(student), 2);
  assert.equal(await kicks(), 1, "the worker is woken");

  // Asking again costs nothing and wakes nothing.
  const again = await request(student, p(1));
  assert.equal(states(again), "quiz:writing task:writing");
  assert.equal(again[0].requests_left, 8);
  assert.equal(await used(student), 2);
  assert.equal(await kicks(), 1);

  // Another student asking for the same point is free for them too.
  const theirs = await request(other, p(1));
  assert.equal(states(theirs), "quiz:writing task:writing");
  assert.equal(theirs[0].requests_left, 10);
  assert.equal(await used(other), 0);
}

// ── Once written, it is ready for everyone ────────────────────────────────
{
  await db.exec(`
    insert into public.mcq_sets (spec_point_id) values ('${p(1)}');
    insert into public.resources (kind, spec_point_id) values ('homework', '${p(1)}');
  `);
  assert.equal(states(await status(student, p(1))), "quiz:ready task:ready");
  assert.equal(states(await status(other, p(1))), "quiz:ready task:ready");
}

// ── A point with its quiz but no task ─────────────────────────────────────
{
  await db.exec(`insert into public.mcq_sets (spec_point_id) values ('${p(2)}')`);
  assert.equal(states(await status(student, p(2))), "quiz:ready task:missing");
  const after = await request(student, p(2));
  assert.equal(states(after), "quiz:ready task:writing", "only the task is queued");
  assert.equal(after[0].requests_left, 7);
  assert.deepEqual(
    (await jobs(p(2))).map((j) => j.kind),
    ["task"],
  );
  // A tutor's published quiz on the point counts too (practice_content_id).
  await db.exec(`insert into public.mcq_sets (spec_point_id, origin) values ('${p(3)}', 'tutor')`);
  assert.equal(states(await status(student, p(3))), "quiz:ready task:missing");
}

// ── Ten a day ─────────────────────────────────────────────────────────────
{
  // 3 used so far. Three more points with both: 3 + 6 = 9.
  for (const n of [4, 5, 6]) await request(student, p(n));
  assert.equal(await used(student), 9);

  const last = await request(student, p(7));
  assert.equal(states(last), "quiz:writing task:missing", "the quiz takes the last one");
  assert.equal(last[0].requests_left, 0);
  assert.equal(await used(student), 10);

  const none = await request(student, p(8));
  assert.equal(states(none), "quiz:missing task:missing", "nothing more today");
  assert.equal(none[0].requests_left, 0);
  assert.deepEqual(await jobs(p(8)), []);
  assert.equal(await used(student), 10);
  assert.equal((await status(student, p(7)))[1].state, "missing");

  // Yesterday's requests don't count: move them to before London midnight.
  await db.exec(`
    update public.ai_request_log
       set created_at = (date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London')
                        - interval '1 second'
     where user_id = '${student}'`);
  const fresh = await status(student, p(8));
  assert.equal(fresh[0].requests_left, 10, "a new day, ten more");
  // Another endpoint's rows never count.
  await db.exec(
    `insert into public.ai_request_log (user_id, endpoint) values ('${student}', 'help_ask')`,
  );
  assert.equal((await status(student, p(8)))[0].requests_left, 10);
}

// ── Only on the student's own course ──────────────────────────────────────
{
  for (const [point, why] of [
    [offBoard, "another board"],
    [offLevel, "another level"],
    [unpaid, "a subject not paid for"],
  ] as const) {
    assert.deepEqual(await status(student, point), [], `no state for ${why}`);
    await assert.rejects(request(student, point), /own course/, `no request for ${why}`);
    assert.deepEqual(await jobs(point), [], `nothing queued for ${why}`);
  }
  for (const [uid, who] of [
    [tutor, "a tutor"],
    [parent, "a parent"],
    [lapsed, "a lapsed student"],
  ] as const) {
    assert.deepEqual(await status(uid, p(9)), [], `no state for ${who}`);
    await assert.rejects(request(uid, p(9)), /own course/, `no request for ${who}`);
  }
  // A student who is also staff is refused (tutors are never students).
  await db.exec(`insert into public.user_roles values ('${other}', 'admin')`);
  await assert.rejects(request(other, p(9)), /own course/);
  await db.exec(`delete from public.user_roles where user_id = '${other}'`);

  assert.deepEqual(await status(null, p(9)), []);
  await assert.rejects(request(null, p(9)), /Not signed in/);
  assert.deepEqual(await jobs(p(9)), []);
}

// ── A job that gave up ────────────────────────────────────────────────────
{
  await db.exec(`
    insert into private.practice_jobs (spec_point_id, kind, status, attempts, last_error)
    values ('${p(9)}', 'quiz', 'failed', 3, 'Gave up after 3 attempts')`);
  const recent = await request(student, p(9));
  assert.equal(states(recent), "quiz:failed task:writing", "a fresh failure isn't retried");
  const usedNow = await used(student);

  // A day later it can be asked for again, and counts.
  await db.exec(`
    alter table private.practice_jobs disable trigger practice_jobs_updated;
    update private.practice_jobs set updated_at = now() - interval '25 hours'
     where spec_point_id = '${p(9)}' and kind = 'quiz';
    alter table private.practice_jobs enable trigger practice_jobs_updated;`);
  assert.equal((await status(student, p(9)))[0].state, "missing");
  const retried = await request(student, p(9));
  assert.equal(states(retried), "quiz:writing task:writing");
  assert.equal(await used(student), usedNow + 1);
  assert.equal((await jobs(p(9)))[0].status, "pending");
}

// ── A finished job whose quiz was later deleted ───────────────────────────
{
  await db.exec(`
    insert into public.mcq_sets (id, spec_point_id) values ('${uuid(300)}', '${p(10)}');
    insert into private.practice_jobs (spec_point_id, kind, status, result_id, completed_how)
    values ('${p(10)}', 'quiz', 'completed', '${uuid(300)}', 'written');
    delete from public.mcq_sets where id = '${uuid(300)}';`);
  assert.equal((await status(student, p(10)))[0].state, "missing");
  assert.equal((await request(student, p(10)))[0].state, "writing");
  assert.equal((await jobs(p(10)))[0].status, "pending");
}

// ── A worker that can't be woken never undoes the request ─────────────────
{
  await db.exec(`insert into private.kick_fails values (true)`);
  const before = await used(student);
  const after = await request(student, p(11));
  assert.equal(states(after), "quiz:writing task:writing");
  assert.equal(await used(student), before + 2);
  await db.exec(`delete from private.kick_fails`);
}

// ── Who may call what ─────────────────────────────────────────────────────
{
  const can = async (role: string, fn: string) =>
    one<boolean>(`select has_function_privilege('${role}', '${fn}', 'execute') v`);
  for (const fn of ["public.practice_for_point(uuid)", "public.request_practice_for_point(uuid)"]) {
    assert.equal(await can("authenticated", fn), true, `${fn} for students`);
    assert.equal(await can("anon", fn), false, `${fn} not for anon`);
  }
  for (const fn of [
    "private.practice_request_daily_limit()",
    "private.practice_requests_used_today(uuid)",
    "private.can_request_practice(uuid, uuid)",
    "private.practice_state(uuid, text)",
  ]) {
    assert.equal(await can("authenticated", fn), false, `${fn} is internal`);
    assert.equal(await can("anon", fn), false, `${fn} is internal`);
  }
  // A student can't spend another's allowance or read their jobs.
  await assert.rejects(as(student, "select * from private.practice_jobs"), /permission denied/);
}

// ── Rollback ──────────────────────────────────────────────────────────────
{
  await db.exec(
    await readFile("supabase/rollbacks/20261109170711_student_practice_requests.down.sql", "utf8"),
  );
  const left = await one<number>(`
    select count(*)::int v from pg_proc
    where proname in ('practice_for_point', 'request_practice_for_point', 'practice_state',
                      'can_request_practice', 'practice_requests_used_today',
                      'practice_request_daily_limit')`);
  assert.equal(left, 0);
  assert.ok((await one<number>(`select count(*)::int v from private.practice_jobs`)) > 0);
  await db.exec(migration);
}

console.log("student practice requests: all checks passed");
