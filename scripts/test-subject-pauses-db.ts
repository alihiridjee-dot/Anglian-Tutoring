/** Isolated PostgreSQL checks for the subject-pause migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-subject-pauses-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const alex = uuid(1); // two subjects, both with a programme
const sam = uuid(2); // enrolled and unpaid, but no programme yet
const parent = uuid(3);
const tutor = uuid(4);
const point = uuid(100);
const point2 = uuid(101);

// The shape of production the migration touches. student_has_access and
// student_paid_subjects are the live bodies (3 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema cron;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.app_role as enum ('student', 'tutor', 'admin', 'parent');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_user_id uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;
create function private.refuse_student_row_for_staff() returns trigger language plpgsql as $$ begin return new; end $$;
create type public.subject as enum ('biology', 'chemistry', 'physics');
create type public.board as enum ('aqa', 'edexcel');
create type public.level as enum ('gcse');
create type public.plan_source as enum ('ai', 'student', 'tutor');
create type public.plan_point_origin as enum ('ai', 'student', 'tutor', 'carried_over', 'core', 'focus');
create table public.profiles(id uuid primary key references auth.users on delete cascade, role text, level public.level, enrolled_courses text[]);
create table public.subscriptions(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text, status text not null default 'inactive', plan text,
  current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_enrolments(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  subject public.subject not null, board public.board not null,
  created_at timestamptz not null default now(), unique (student_id, subject));
create table public.parent_student_links(parent_id uuid, student_id uuid);
grant select on public.parent_student_links to authenticated;
create table public.spec_points(id uuid primary key);
create table public.student_program_plan(
  student_id uuid references auth.users on delete cascade, subject public.subject,
  program_start date, exam_date date, pacing jsonb, primary key (student_id, subject));
create table public.student_weekly_plans(
  id uuid primary key default gen_random_uuid(),
  student_id uuid references auth.users on delete cascade, subject public.subject,
  board public.board, level public.level, week_start date, source public.plan_source,
  ai_rationale text, updated_at timestamptz default now(), unique (student_id, subject, week_start));
create table public.student_weekly_plan_points(
  plan_id uuid references public.student_weekly_plans on delete cascade,
  spec_point_id uuid references public.spec_points, origin public.plan_point_origin,
  carried_from date, done_at timestamptz, primary key (plan_id, spec_point_id));
create table cron.job(jobid serial, jobname text, schedule text, command text);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$
  delete from cron.job where jobname = _name returning true $$;

CREATE OR REPLACE FUNCTION private.student_has_access(p_student_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = p_student_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$function$;

CREATE OR REPLACE FUNCTION private.student_paid_subjects(p_student_id uuid)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    (
      select case
        when x.cap is null then x.courses
        else x.courses[1:x.cap]
      end
      from (
        select
          coalesce(p.enrolled_courses, '{}'::text[]) as courses,
          (
            select max(
              case
                when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
                else null
              end
            )
            from public.subscriptions s
            where s.student_id = p_student_id
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now())
          ) as cap
        from public.profiles p
        where p.id = p_student_id
          and private.student_has_access(p_student_id)
      ) x
    ),
    '{}'::text[]
  )
$function$;
`);

// ── Fixtures, before the migration, so its backfill has someone to read ──
for (const id of [alex, sam, parent, tutor])
  await db.query("insert into auth.users values ($1)", [id]);
await db.query("insert into public.user_roles values ($1, 'tutor')", [tutor]);
await db.query("insert into public.parent_student_links values ($1, $2)", [parent, alex]);
await db.query(
  "insert into public.profiles values ($1, 'student', 'gcse', array['chemistry','biology']), ($2, 'student', 'gcse', array['biology'])",
  [alex, sam],
);
await db.query(
  "insert into public.student_enrolments (student_id, subject, board) values ($1, 'chemistry', 'edexcel'), ($1, 'biology', 'edexcel'), ($2, 'biology', 'aqa')",
  [alex, sam],
);
await db.query(
  "insert into public.subscriptions (user_id, student_id, status, plan, current_period_end) values ($1, $1, 'active', 'monthly_2', now() + interval '20 days'), ($2, $2, 'paused', 'monthly_1', now() + interval '20 days')",
  [alex, sam],
);
await db.query(
  "insert into public.student_program_plan values ($1, 'chemistry', '2026-07-13', '2027-06-21', '[]'), ($1, 'biology', '2026-07-13', '2027-06-21', '[]')",
  [alex],
);
await db.query("insert into public.spec_points values ($1), ($2)", [point, point2]);

const migration = await readFile(
  new URL("../supabase/migrations/20261003130000_subject_pauses.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);

// ── Helpers ──────────────────────────────────────────────────────────────
type Pause = {
  subject: string;
  reason: string;
  started_at: Date;
  ended_at: Date | null;
  cancelled_at: Date | null;
};
const pauses = async (student: string) =>
  (
    await db.query<Pause>(
      "select subject::text, reason, started_at, ended_at, cancelled_at from public.student_subject_pauses where student_id = $1 order by started_at, subject",
      [student],
    )
  ).rows;
const open = async (student: string) => (await pauses(student)).filter((p) => !p.ended_at);
const setSub = (set: string) =>
  db.query(`update public.subscriptions set ${set} where student_id = $1`, [alex]);
const week = (n: number) => `2026-10-${String(5 + 7 * n).padStart(2, "0")}`;
const planWeek = (subject: string, n: number) =>
  db.query<{ id: string }>(
    "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source) values ($1, $2, 'edexcel', 'gcse', $3, 'ai') returning id",
    [alex, subject, week(n)],
  );
const refusesAsPaused = async (run: () => Promise<unknown>, label: string) => {
  await assert.rejects(
    run,
    (e: { message?: string; hint?: string; code?: string }) =>
      e.code === "23514" && e.hint === "subject_paused",
    label,
  );
};

// ── 1. The backfill and the hourly job ───────────────────────────────────
{
  assert.deepEqual(await pauses(alex), [], "a paying student starts with no stops");
  assert.deepEqual(await pauses(sam), [], "no programme, nothing to stop");
  const job = await db.query<{ schedule: string }>(
    "select schedule from cron.job where jobname = 'sync-subject-pauses'",
  );
  assert.equal(job.rows[0]?.schedule, "25 * * * *", "the hourly backstop is scheduled");
}

// ── 2. A paying student plans as before ──────────────────────────────────
const bioWeek = (await planWeek("biology", 0)).rows[0].id;
await db.query(
  "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
  [bioWeek, point],
);

// ── 3. The family pauses: every subject stops, nothing can be planned ───
{
  await setSub("status = 'paused'");
  const now = await open(alex);
  assert.deepEqual(
    now.map((p) => [p.subject, p.reason, p.cancelled_at]),
    [
      ["biology", "paused", null],
      ["chemistry", "paused", null],
    ],
    "a paused plan stops both subjects, and is not a cancellation",
  );
  await refusesAsPaused(() => planWeek("biology", 1), "no new week while paused");
  await refusesAsPaused(
    () =>
      db.query(
        "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
        [bioWeek, point2],
      ),
    "no point added to an existing week while paused",
  );
  await refusesAsPaused(
    () =>
      db.query(
        "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source) values ($1, 'biology', 'edexcel', 'gcse', $2, 'ai') on conflict (student_id, subject, week_start) do update set source = excluded.source",
        [alex, week(0)],
      ),
    "re-saving a week (save_weekly_plan's upsert) is refused too",
  );
  // Ticking off work already set is not planning, and history stays readable.
  await db.query(
    "update public.student_weekly_plan_points set done_at = now() where plan_id = $1",
    [bioWeek],
  );
  // Another check changes nothing.
  await db.query("select private.sync_subject_pauses($1)", [alex]);
  assert.equal((await open(alex)).length, 2, "re-checking opens no duplicate");
}

// ── 4. Resuming closes the stop and planning works again ────────────────
{
  await setSub("status = 'active'");
  assert.deepEqual(await open(alex), [], "resumed: nothing stopped");
  const all = await pauses(alex);
  assert.equal(all.length, 2, "the stop stays on record");
  for (const p of all) assert.ok(p.ended_at && p.ended_at >= p.started_at, "closed in order");
  await planWeek("biology", 1);
}

// ── 5. A failed payment is a pause, even after Stripe gives up ──────────
{
  await setSub("status = 'past_due'");
  assert.deepEqual(
    (await open(alex)).map((p) => [p.subject, p.reason]),
    [
      ["biology", "payment"],
      ["chemistry", "payment"],
    ],
  );
  await setSub("status = 'canceled'");
  assert.deepEqual(
    (await open(alex)).map((p) => [p.reason, p.cancelled_at]),
    [
      ["payment", null],
      ["payment", null],
    ],
    "Stripe closing a lapsed plan is not the family cancelling",
  );
  await setSub("status = 'active'");
  assert.deepEqual(await open(alex), []);
}

// ── 6. The family cancels: a stop when the plan ends, stamped as theirs ─
{
  await setSub("cancel_at_period_end = true");
  assert.deepEqual(await open(alex), [], "a booked cancel keeps access until the plan ends");
  await setSub("status = 'canceled'");
  const now = await open(alex);
  assert.deepEqual(
    now.map((p) => p.reason),
    ["cancelled", "cancelled"],
  );
  for (const p of now) assert.ok(p.cancelled_at, "the cancellation is stamped");
  // Resubscribing within the 7 days is a resume.
  await setSub(
    "status = 'active', cancel_at_period_end = false, current_period_end = now() + interval '30 days'",
  );
  assert.deepEqual(await open(alex), []);
}

// ── 7. A lapsed payment the family then cancels becomes theirs ──────────
{
  await setSub("status = 'past_due'");
  await setSub("cancel_at_period_end = true");
  assert.deepEqual(
    (await open(alex)).map((p) => p.reason),
    ["payment", "payment"],
  );
  const before = (await open(alex))[0].started_at;
  await setSub("status = 'canceled'");
  const now = await open(alex);
  assert.deepEqual(
    now.map((p) => p.reason),
    ["cancelled", "cancelled"],
  );
  assert.equal(
    now[0].started_at.getTime(),
    before.getTime(),
    "the stop still began with the payment",
  );
  assert.ok(now[0].cancelled_at, "and the cancellation is stamped from when it ended");
  await setSub(
    "status = 'active', cancel_at_period_end = false, current_period_end = now() + interval '30 days'",
  );
  assert.deepEqual(await open(alex), []);
}

// ── 8. Removing a subject stops only that subject, as a cancellation ────
{
  await db.exec(`
    begin;
    delete from public.student_enrolments where student_id = '${alex}' and subject = 'biology';
    update public.profiles set enrolled_courses = array['chemistry'] where id = '${alex}';
    update public.subscriptions set plan = 'monthly_1' where student_id = '${alex}';
    commit;
  `);
  const now = await open(alex);
  assert.deepEqual(
    now.map((p) => [p.subject, p.reason]),
    [["biology", "subject_removed"]],
    "chemistry carries on",
  );
  assert.ok(now[0].cancelled_at, "a removed subject is stamped as a cancellation");
  await refusesAsPaused(() => planWeek("biology", 2), "no biology week once removed");
  await planWeek("chemistry", 2);

  // Re-added, but the plan hasn't caught up: still stopped, no longer a cancellation.
  await db.exec(`
    begin;
    insert into public.student_enrolments (student_id, subject, board) values ('${alex}', 'biology', 'edexcel');
    update public.profiles set enrolled_courses = array['chemistry','biology'] where id = '${alex}';
    commit;
  `);
  const between = await open(alex);
  assert.deepEqual(
    between.map((p) => [p.subject, p.reason, p.cancelled_at]),
    [["biology", "not_on_plan", null]],
    "back on the list, so nothing is erased while the plan catches up",
  );
  await setSub("plan = 'monthly_2'");
  assert.deepEqual(await open(alex), [], "the plan covers it again: resumed");
}

// ── 9. A plan that runs out with nothing written (the hourly job) ───────
{
  await setSub("current_period_end = now() - interval '2 days'");
  // The write above is itself a change, so its trigger already recorded it.
  // Clear that, to stand in for a plan whose end passed with no write at all.
  await db.query(
    "delete from public.student_subject_pauses where student_id = $1 and ended_at is null",
    [alex],
  );
  await db.query("select private.sync_subject_pauses($1)", [alex]);
  const now = await open(alex);
  assert.deepEqual(
    now.map((p) => p.reason),
    ["payment", "payment"],
    "a plan that ran out is a lapse, not a cancellation",
  );
  const end = (
    await db.query<{ e: Date }>(
      "select current_period_end as e from public.subscriptions where student_id = $1",
      [alex],
    )
  ).rows[0].e;
  assert.equal(now[0].started_at.getTime(), end.getTime(), "it stopped when the plan ended");
  await setSub("current_period_end = now() + interval '30 days'");
  assert.deepEqual(await open(alex), []);
}

// ── 10. A broken check never blocks the change it follows ───────────────
{
  const original = migration.match(
    /create or replace function private\.sync_subject_pauses\(p_student_id uuid\)[\s\S]*?\$function\$;/,
  )?.[0];
  assert.ok(original, "found the sync function in the migration");
  await db.exec(`create or replace function private.sync_subject_pauses(p_student_id uuid)
    returns void language plpgsql as $$ begin raise exception 'boom'; end $$;`);
  await setSub("status = 'paused'"); // must not throw
  const status = (
    await db.query<{ status: string }>(
      "select status from public.subscriptions where student_id = $1",
      [alex],
    )
  ).rows[0].status;
  assert.equal(status, "paused", "the subscription change went through");
  await db.exec(original);
  // The guard doesn't depend on the record: still no planning while paused.
  await refusesAsPaused(() => planWeek("biology", 3), "the hard stop holds without the record");
  await db.query("select private.sync_subject_pauses($1)", [alex]);
  assert.equal((await open(alex)).length, 2, "the next check records it");
  await setSub("status = 'active'");
}

// ── 11. Who can read the record, and nobody writes it ───────────────────
{
  const as = async (uid: string, sql: string) => {
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
    );
    try {
      return await db.query<{ n: number }>(sql);
    } finally {
      await db.exec("reset role;");
    }
  };
  const count = "select count(*)::int as n from public.student_subject_pauses";
  const total = (await db.query<{ n: number }>(count)).rows[0].n;
  assert.ok(total > 0);
  assert.equal((await as(alex, count)).rows[0].n, total, "the student reads their own");
  assert.equal((await as(parent, count)).rows[0].n, total, "a linked parent reads them");
  assert.equal((await as(tutor, count)).rows[0].n, total, "a tutor reads them");
  assert.equal((await as(sam, count)).rows[0].n, 0, "another student reads none");
  await assert.rejects(
    () =>
      as(
        alex,
        `insert into public.student_subject_pauses (student_id, subject, reason) values ('${alex}', 'biology', 'paused')`,
      ),
    /permission denied/,
    "nobody writes the record through the API",
  );
  await assert.rejects(
    () => as(alex, "delete from public.student_subject_pauses"),
    /permission denied/,
  );
}

// ── 12. An account deleted outright takes its record with it ────────────
{
  await db.query("delete from auth.users where id = $1", [alex]);
  assert.deepEqual(await pauses(alex), []);
}

// ── 13. The rollback removes all of it ──────────────────────────────────
{
  const samWeek = () =>
    db.query(
      "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source) values ($1, 'biology', 'aqa', 'gcse', $2, 'ai')",
      [sam, week(0)],
    );
  await refusesAsPaused(samWeek, "an unpaid student can't be planned for");
  await db.exec(
    await readFile(
      new URL("../supabase/rollbacks/20261003130000_subject_pauses.down.sql", import.meta.url),
      "utf8",
    ),
  );
  await samWeek();
  const left = await db.query<{ n: number }>(
    "select (select count(*) from pg_trigger where tgname like '%paus%')::int + (select count(*) from pg_proc where pronamespace in ('private'::regnamespace, 'public'::regnamespace) and proname like '%pause%')::int + (select count(*) from cron.job where jobname = 'sync-subject-pauses')::int + (select count(*) from pg_class where relname = 'student_subject_pauses')::int as n",
  );
  assert.equal(left.rows[0].n, 0, "no trigger, function, job or table left behind");
}

console.log("subject pauses: all checks passed");
