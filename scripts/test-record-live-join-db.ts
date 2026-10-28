/** Isolated PostgreSQL regression checks for PT-01: pressing Join files a
 * student as at a live lesson (record_live_join), nothing else can write
 * attendance, a parent's count leaves out lessons nobody could join, and the
 * nightly purge still clears a lesson, with its attendance, a week on. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-record-live-join-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1); // GCSE Biology with AQA, paid
const parent = uuid(2); // linked to `student`
const tutor = uuid(3);
const alevel = uuid(4); // A-level Biology, paid
const unpaid = uuid(5); // GCSE Biology, no plan
const other = uuid(6); // GCSE Biology with AQA, paid, not linked to `parent`

// The tables, grants, policies and functions this touches, as production
// defines them (pg_policies / pg_get_functiondef / role_table_grants and
// cron.job, read live on 28 Oct 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private; create schema cron;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create type level as enum ('gcse','alevel','gcse_trilogy','igcse');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type resource_kind as enum ('video','download','live_session','homework');
create type resource_origin as enum ('tutor','generated');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table profiles(id uuid primary key, role profile_role not null default 'student',
  enrolled_courses text[] not null default '{}', level level);
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  subject subject not null, board board not null, created_at timestamptz not null default now());
create table parent_student_links(parent_id uuid, student_id uuid);
create table subscriptions(student_id uuid, plan text, status text, current_period_end timestamptz);
create table student_breaks(student_id uuid, starts_on date, ends_on date, cancelled_at timestamptz);
create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
create function private.student_paid_subjects(p_student_id uuid) returns text[] language sql stable security definer set search_path = public, private as $$
  select coalesce((select case when x.cap is null then x.courses else x.courses[1:x.cap] end
    from (select coalesce(p.enrolled_courses, '{}'::text[]) as courses,
      (select max(case when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int else null end)
        from public.subscriptions s where s.student_id = p_student_id and s.status in ('active', 'trialing')
          and (s.current_period_end is null or s.current_period_end > now())) as cap
      from public.profiles p where p.id = p_student_id and private.student_has_access(p_student_id)) x), '{}'::text[]) $$;

create table resources(id uuid primary key default gen_random_uuid(), kind resource_kind not null, title text not null,
  subject subject not null, board board, level level not null, starts_at timestamptz, join_url text, due_at timestamptz,
  origin resource_origin not null default 'tutor', review_status text not null default 'approved', publish_at timestamptz);
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid);
create table session_attendees(id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources(id) on delete cascade, user_id uuid not null,
  joined_at timestamptz not null default now(), unique (resource_id, user_id));
alter table session_attendees enable row level security;
create policy "attendees parent reads linked" on session_attendees for select to authenticated using (
  exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = session_attendees.user_id));
create policy "attendees read self or tutor" on session_attendees for select to authenticated using (
  ((select auth.uid()) = user_id) or private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "attendees self insert" on session_attendees for insert to authenticated with check ((select auth.uid()) = user_id);

-- pg_cron, as far as the purge's own migration uses it.
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = _name returning 1) select exists (select 1 from d) $$;

grant usage on schema public, auth, private to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;
`);

const migration = (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
// Today's production: the purge scheduled, student_engagement as it stands.
await db.exec(await migration("20260716120000_purge_stale_live_sessions.sql"));
await db.exec(await migration("20261005162000_breaks_not_held_against.sql"));
await db.exec("revoke execute on function public.purge_stale_live_sessions() from public");

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
const profile = (id: string, role: string, courses: string[], level: string | null) =>
  db.query("insert into profiles values($1,$2,$3,$4)", [id, role, courses, level]);
const enrol = (id: string, subject: string, board: string) =>
  db.query(
    "insert into student_enrolments(student_id, subject, board, created_at) values($1,$2,$3,now() - interval '60 days')",
    [id, subject, board],
  );
const plan = (id: string) =>
  db.query("insert into subscriptions values($1,'monthly_1','active',now() + interval '20 days')", [
    id,
  ]);
await profile(student, "student", ["biology"], "gcse");
await enrol(student, "biology", "aqa");
await plan(student);
await profile(parent, "parent", [], null);
await db.query("insert into parent_student_links values($1,$2)", [parent, student]);
await profile(tutor, "tutor", [], null);
await profile(alevel, "student", ["biology"], "alevel");
await enrol(alevel, "biology", "aqa");
await plan(alevel);
await profile(unpaid, "student", ["biology"], "gcse");
await enrol(unpaid, "biology", "aqa");
await profile(other, "student", ["biology"], "gcse");
await enrol(other, "biology", "aqa");
await plan(other);

/** A live lesson starting `minutes` from now (negative: already started). */
const lesson = async (
  title: string,
  minutes: number,
  opts: { level?: string; board?: string | null; link?: boolean; review?: string } = {},
) =>
  (
    await db.query<{ id: string }>(
      `insert into resources(kind, title, subject, level, board, starts_at, join_url, review_status)
       values('live_session',$1,'biology',$2,$3,now() + make_interval(mins => $4),$5,$6) returning id`,
      [
        title,
        opts.level ?? "gcse",
        opts.board ?? null,
        minutes,
        opts.link === false ? null : "https://zoom.us/j/1",
        opts.review ?? "approved",
      ],
    )
  ).rows[0].id;

const running = await lesson("Running now", -30);
const startingSoon = await lesson("Starts in 12 minutes", 12);
// The Join buttons show from 10 minutes before by the device's own clock; a
// clock running 10 minutes fast shows it 20 minutes before.
const fastClock = await lesson("Starts in 20 minutes", 20);
const tooEarly = await lesson("Starts in 40 minutes", 40);
const over = await lesson("Ended", -95);
const otherBoard = await lesson("OCR only", -5, { board: "ocr" });
const aqaOnly = await lesson("AQA only", -5, { board: "aqa" });
const alevelLesson = await lesson("A-level", -5, { level: "alevel" });
const noLink = await lesson("No link yet", -5, { link: false });
const held = await lesson("Held for review", -5, { review: "held" });
const daysAgo = await lesson("Three days ago", -3 * 24 * 60);
const weekOld = await lesson("Eight days ago", -8 * 24 * 60);
const task = (
  await db.query<{ id: string }>(
    "insert into resources(kind, title, subject, level, due_at) values('homework','Task','biology','gcse',now() - interval '1 day') returning id",
  )
).rows[0].id;

// The older lessons were attended (filed by hand: the function only files a
// lesson around its start).
for (const id of [daysAgo, weekOld])
  await db.query("insert into session_attendees(resource_id, user_id) values($1,$2)", [
    id,
    student,
  ]);

// ── Apply the migration, twice ────────────────────────────────────────────
const sql = await migration("20261028104500_record_live_join.sql");
await db.exec(sql);
await db.exec(sql);

await db.exec("set role authenticated");
const as = (id: string | null) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
const asRole = async <T>(role: string, fn: () => Promise<T>) => {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("set role authenticated");
  }
};
const fails = async (q: () => Promise<unknown>, what: string) => {
  let threw = false;
  try {
    await q();
  } catch {
    threw = true;
  }
  assert(threw, what);
};
const join = async (id: string) =>
  (await db.query<{ ok: boolean }>("select public.record_live_join($1) as ok", [id])).rows[0].ok;
const filed = async (id: string, who: string) =>
  Number(
    (
      await asRole("postgres", () =>
        db.query<{ n: number }>(
          "select count(*)::int as n from session_attendees where resource_id = $1 and user_id = $2",
          [id, who],
        ),
      )
    ).rows[0].n,
  );

// ── Who is filed, and when ────────────────────────────────────────────────
await as(student);
assert.equal(await join(running), true, "A student joining a running lesson wasn't filed");
assert.equal(await join(running), true, "Pressing Join again should still answer true");
assert.equal(await filed(running, student), 1, "Pressing Join twice filed the lesson twice");
assert.equal(await join(startingSoon), true, "Joining 12 minutes early wasn't filed");
assert.equal(await join(fastClock), true, "Joining on a clock running fast wasn't filed");
assert.equal(await join(aqaOnly), true, "A lesson for the student's own board wasn't filed");

for (const [what, id] of [
  ["a lesson 40 minutes away", tooEarly],
  ["a lesson that ended", over],
  ["another board's lesson", otherBoard],
  ["another level's lesson", alevelLesson],
  ["a lesson with no link", noLink],
  ["a lesson held for review", held],
  ["a task", task],
  ["a resource that doesn't exist", uuid(99)],
] as const) {
  assert.equal(await join(id), false, `A student was filed for ${what}`);
  assert.equal(await filed(id, student), 0, `A row was written for ${what}`);
}

for (const [who, id] of [
  ["A parent", parent],
  ["A tutor", tutor],
  ["An A-level student", alevel],
  ["A student with no plan", unpaid],
] as const) {
  await as(id);
  assert.equal(await join(running), false, `${who} was filed as attending`);
  assert.equal(await filed(running, id), 0, `${who} got a row`);
}
await as(null);
assert.equal(await join(running), false, "No signed-in user, yet a row was filed");
await asRole("anon", () =>
  fails(() => join(running), "An anonymous caller could call record_live_join"),
);

// ── Nobody writes attendance directly ─────────────────────────────────────
await as(other);
await fails(
  () =>
    db.query("insert into session_attendees(resource_id, user_id) values($1,$2)", [
      tooEarly,
      other,
    ]),
  "A student could still file their own attendance directly",
);
await as(student);
await fails(
  () =>
    db.query(
      "update session_attendees set joined_at = now() - interval '1 day' where user_id = $1",
      [student],
    ),
  "A student could change their attendance",
);
await fails(
  () => db.query("delete from session_attendees where user_id = $1", [student]),
  "A student could delete their attendance",
);
await as(other);
assert.equal(await join(running), true, "A second student on the course wasn't filed");

// ── Reads are unchanged ───────────────────────────────────────────────────
const seen = async () =>
  (await db.query<{ user_id: string }>("select user_id from session_attendees")).rows.map(
    (r) => r.user_id,
  );
await as(student);
assert.deepEqual(new Set(await seen()), new Set([student]), "A student sees only their own rows");
await as(parent);
assert.deepEqual(new Set(await seen()), new Set([student]), "A parent sees only their child's");
await as(tutor);
assert.deepEqual(new Set(await seen()), new Set([student, other]), "A tutor sees every row");

// ── What a parent is shown ────────────────────────────────────────────────
const counts = async () => {
  await as(parent);
  return {
    ...(
      await db.query<{ sessions_held: number; sessions_attended: number }>(
        "select sessions_held, sessions_attended from public.student_engagement($1)",
        [student],
      )
    ).rows[0],
  };
};
// Held so far on their course: Eight days ago, Three days ago, Running now,
// Ended and AQA only. Not "No link yet" or "Held for review": nobody could
// join those, so they would count as missed for every child. The ones still
// to start haven't been held, and the OCR and A-level ones aren't theirs.
// Attended: the two older ones, Running now and AQA only.
assert.deepEqual(
  await counts(),
  { sessions_held: 5, sessions_attended: 4 },
  "The parent's attendance count is wrong",
);

// ── The purge stays, and takes a week-old lesson's attendance with it ────
await asRole("postgres", async () => {
  const jobs = await db.query("select 1 from cron.job where jobname = 'purge-stale-live-sessions'");
  assert.equal(jobs.rows.length, 1, "The nightly purge is no longer scheduled");
  await db.query("select public.purge_stale_live_sessions()");
});
assert.equal(await filed(weekOld, student), 0, "The purge left a week-old lesson's attendance");
assert.equal(await filed(daysAgo, student), 1, "The purge took a lesson from this week");
assert.deepEqual(
  await counts(),
  { sessions_held: 4, sessions_attended: 3 },
  "After the purge, the parent's count should cover the last week",
);

console.log("record live join: all checks passed");
