/** Isolated PostgreSQL checks for 20261121124400_remove_plan_point_unsaved_week
 * and 20261121124500_plan_change_log. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-change-log-db.ts
 *
 * The first rollback file holds the live remove_plan_point, so it runs first to
 * show the fault (a point can't be removed from a week with no saved plan),
 * then its migration to show it fixed. Then the log: every kind of change
 * writes one row saying who made it, the programme's own lines write none, the
 * log is read by staff only and written by nobody, and it never stops the
 * change it records.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sam = uuid(1); // a student
const tutor = uuid(2);
const ghost = uuid(3); // a student whose account has gone
const topic = uuid(10);
const [p1, p2, p3, p4] = [uuid(21), uuid(22), uuid(23), uuid(24)];
// Mondays far enough ahead never to be "a past week".
const W1 = "2099-01-05";
const W2 = "2099-01-12";

// The tables and helpers the two migrations touch, as production defines them
// (information_schema / pg_get_functiondef, 21 Nov 2026), cut down to the
// columns they use.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type plan_point_origin as enum ('ai','core','focus','student','tutor');
create type plan_override_kind as enum ('remove','skip');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
create function plan_override_caller_is_tutor() returns boolean language sql stable as $$
  select private.has_role(auth.uid(), 'tutor') $$;
create function plan_point_has_work(uuid, uuid, date) returns boolean language sql stable as $$ select false $$;
create table topics(id uuid primary key, subject subject not null);
create table spec_points(id uuid primary key, topic_id uuid references topics(id));
create table student_weekly_plans(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  subject subject not null, week_start date not null, unique (student_id, subject, week_start));
create table student_weekly_plan_points(plan_id uuid not null references student_weekly_plans(id) on delete cascade,
  spec_point_id uuid not null, origin plan_point_origin not null default 'ai', created_at timestamptz not null default now(),
  carried_from date, done_at timestamptz, primary key (plan_id, spec_point_id));
create table student_plan_overrides(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  subject subject not null, spec_point_id uuid not null references spec_points(id) on delete cascade,
  kind plan_override_kind not null, week_start date, note text, created_by uuid, created_at timestamptz not null default now());
create unique index on student_plan_overrides (student_id, subject, spec_point_id, kind, (coalesce(week_start, date '0001-01-01')));
create table student_program_plan(student_id uuid not null, subject subject not null, program_start date not null,
  exam_date date not null, pacing jsonb not null, primary key (student_id, subject));
create table student_breaks(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  starts_on date not null, ends_on date not null, reason text not null, cancelled_at timestamptz, ended_early_at timestamptz);
grant usage on schema public, private, auth to authenticated;
grant all on all tables in schema public to authenticated;

insert into auth.users values ('${sam}'), ('${tutor}');
insert into user_roles values ('${sam}','student'), ('${tutor}','tutor');
insert into topics values ('${topic}','biology');
insert into spec_points values ('${p1}','${topic}'), ('${p2}','${topic}'), ('${p3}','${topic}'), ('${p4}','${topic}');
`);

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const fix = await file("migrations/20261121124400_remove_plan_point_unsaved_week.sql");
const fixDown = await file("rollbacks/20261121124400_remove_plan_point_unsaved_week.down.sql");
const log = await file("migrations/20261121124500_plan_change_log.sql");
const logDown = await file("rollbacks/20261121124500_plan_change_log.down.sql");

/** Run SQL as a signed-in user, or as the system (no user, the table owner). */
async function as<T = Record<string, unknown>>(who: string | null, sql: string): Promise<T[]> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who ?? ""]);
  if (who) await db.exec("set role authenticated");
  try {
    // exec, not query: some steps are more than one statement. The last one's rows come back.
    return ((await db.exec(sql)).at(-1)?.rows ?? []) as T[];
  } finally {
    await db.exec("reset role");
  }
}
/** The log, oldest first, as "kind/role" with what else the row holds. */
async function logged() {
  const rows = await as<{ k: string }>(
    null,
    `select kind || '/' || actor_role || coalesce(' ' || week_start, '') ||
            case when detail = '{}'::jsonb then '' else ' ' || detail::text end as k
       from public.student_plan_changes order by created_at, id`,
  );
  return rows.map((r) => r.k).sort();
}
const remove = (point: string, week: string, note: string | null = null) =>
  as<{ r: { removed: boolean; blocked: boolean; origin: string | null } }>(
    tutor,
    `select public.remove_plan_point('${sam}','biology','${point}','${week}',${note ? `'${note}'` : "null"}) as r`,
  );

// ── remove_plan_point: a week with no saved plan ─────────────────────────────
await db.exec(fixDown);
await assert.rejects(remove(p1, W1), /"_row" is not assigned yet/);
await db.exec(fix);
await db.exec(fix); // idempotent
assert.deepEqual((await remove(p1, W1))[0].r, {
  removed: false,
  blocked: true,
  reason: null,
  origin: null,
});
// And a week that has one still reports the line it took out.
await as(
  null,
  `
  insert into student_weekly_plans(id, student_id, subject, week_start) values ('${uuid(30)}','${sam}','biology','${W2}');
  insert into student_weekly_plan_points(plan_id, spec_point_id, origin) values ('${uuid(30)}','${p2}','core')`,
);
assert.deepEqual((await remove(p2, W2))[0].r, {
  removed: true,
  blocked: true,
  reason: null,
  origin: "core",
});
await as(null, "delete from student_plan_overrides; delete from student_weekly_plans");

// ── the log ──────────────────────────────────────────────────────────────────
await db.exec(log);
await db.exec(log); // idempotent
assert.deepEqual(await logged(), []);

// A tutor sets points aside, and sets them back.
await remove(p1, W1, `Moved to the week of ${W2}`);
await remove(p2, W1);
await as(tutor, `select public.remove_plan_point('${sam}','biology','${p2}','${W1}','again')`); // already removed: no second row
await as(
  tutor,
  `insert into student_plan_overrides(student_id, subject, spec_point_id, kind, created_by)
  values ('${sam}','biology','${p3}','skip','${tutor}')`,
);
await as(tutor, `delete from student_plan_overrides where spec_point_id in ('${p2}','${p3}')`);
assert.deepEqual(await logged(), [
  `moved/tutor ${W1} {"to_week": "${W2}"}`,
  `removed/tutor ${W1}`,
  `restored/tutor ${W1}`,
  "skipped/tutor",
  "unskipped/tutor",
]);
// Overrides first: clearing them is itself logged.
await as(null, "delete from student_plan_overrides; delete from public.student_plan_changes");

// A line put in by hand is a change; the programme's own lines are not.
await as(
  null,
  `insert into student_weekly_plans(id, student_id, subject, week_start) values ('${uuid(31)}','${sam}','biology','${W1}')`,
);
const point = (id: string, origin: string, carried = "null") =>
  `insert into student_weekly_plan_points(plan_id, spec_point_id, origin, carried_from) values ('${uuid(31)}','${id}','${origin}',${carried})
   on conflict (plan_id, spec_point_id) do update set origin = excluded.origin, carried_from = excluded.carried_from`;
await as(tutor, point(p1, "tutor"));
await as(sam, point(p2, "student"));
await as(sam, point(p3, "core"));
await as(sam, point(p4, "focus", `'2098-12-29'`));
assert.deepEqual(await logged(), [
  `added/student ${W1} {"origin": "student"}`,
  `added/tutor ${W1} {"origin": "tutor"}`,
  `carried/student ${W1} {"from_week": "2098-12-29"}`,
]);
// A week saved again re-sends every line: nothing new happened.
await as(sam, point(p1, "tutor"));
await as(sam, point(p4, "focus", `'2098-12-29'`));
assert.equal((await logged()).length, 3);
// A programme line a tutor then sets by hand is a change.
await as(tutor, point(p3, "tutor"));
assert.equal((await logged()).filter((k) => k.startsWith("added/tutor")).length, 2);
await as(null, "delete from public.student_plan_changes");

// The plan itself: started, its exam date, its topic order.
const pacing = (...bands: [string, string, string, string?][]) =>
  JSON.stringify(
    bands.map(([topicId, title, startWeek, kind]) => ({ topicId, title, startWeek, kind })),
  );
await as(
  sam,
  `insert into student_program_plan values ('${sam}','biology','${W1}','2099-06-01',
  '${pacing(["a", "Cells", "2099-01-05"], ["b", "Genetics", "2099-02-02"], ["a", "Cells", "2099-03-02", "focus"])}')`,
);
await as(tutor, `update student_program_plan set exam_date = '2099-06-08'`);
// The same topics in the same order on other dates: not a change of order.
await as(
  tutor,
  `update student_program_plan set pacing = '${pacing(["a", "Cells", "2099-01-12"], ["b", "Genetics", "2099-02-09"])}'`,
);
await as(
  tutor,
  `update student_program_plan set pacing = '${pacing(["b", "Genetics", "2099-01-12"], ["a", "Cells", "2099-02-09"])}'`,
);
// A nightly job has no user: it is the system's change.
await as(null, `update student_program_plan set exam_date = '2099-06-15'`);
assert.deepEqual(await logged(), [
  'exam-date/system {"to": "2099-06-15", "from": "2099-06-08"}',
  'exam-date/tutor {"to": "2099-06-08", "from": "2099-06-01"}',
  `plan-started/student ${W1} {"exam_date": "2099-06-01"}`,
  'topic-order/tutor {"after": ["Genetics", "Cells"], "before": ["Cells", "Genetics"]}',
]);
await as(null, "delete from public.student_plan_changes");

// Breaks.
await as(
  sam,
  `insert into student_breaks(id, student_id, starts_on, ends_on, reason) values
  ('${uuid(40)}','${sam}','2099-03-02','2099-03-08','holiday'), ('${uuid(41)}','${sam}','2099-04-06','2099-04-19','exams')`,
);
await as(sam, `update student_breaks set cancelled_at = now() where id = '${uuid(40)}'`);
await as(
  tutor,
  `update student_breaks set ended_early_at = now(), ends_on = '2099-04-12' where id = '${uuid(41)}'`,
);
await as(tutor, `update student_breaks set reason = 'other' where id = '${uuid(41)}'`); // not a change to the plan
assert.deepEqual(await logged(), [
  'break-booked/student 2099-03-02 {"reason": "holiday", "ends_on": "2099-03-08"}',
  'break-booked/student 2099-04-06 {"reason": "exams", "ends_on": "2099-04-19"}',
  'break-cancelled/student 2099-03-02 {"ends_on": "2099-03-08"}',
  'break-ended/tutor 2099-04-06 {"ends_on": "2099-04-12"}',
]);

// Who may read it, and that nobody may write it.
assert.equal((await as(tutor, "select 1 from public.student_plan_changes")).length, 4);
assert.equal((await as(sam, "select 1 from public.student_plan_changes")).length, 0);
for (const who of [tutor, sam])
  for (const write of [
    `insert into public.student_plan_changes(student_id, kind, actor_role) values ('${sam}','removed','tutor')`,
    "update public.student_plan_changes set kind = 'removed'",
    "delete from public.student_plan_changes",
  ])
    await assert.rejects(as(who, write), /permission denied/);

// The log never stops the change it records.
// A student whose account has gone: the change goes through, nothing is logged.
await as(
  tutor,
  `insert into student_plan_overrides(student_id, subject, spec_point_id, kind) values ('${ghost}','biology','${p1}','skip')`,
);
// A point that leaves the course takes its overrides with it: not an undo.
await as(
  tutor,
  `insert into student_plan_overrides(student_id, subject, spec_point_id, kind) values ('${sam}','biology','${p4}','skip')`,
);
await as(
  null,
  `delete from student_weekly_plan_points where spec_point_id = '${p4}'; delete from spec_points where id = '${p4}'`,
);
const after = await logged();
assert.equal(after.filter((k) => k.startsWith("skipped/")).length, 1);
assert.equal(after.filter((k) => k.startsWith("unskipped/")).length, 0);
// The log goes with the student's account.
await as(null, `delete from auth.users where id = '${sam}'`);
assert.deepEqual(await logged(), []);

// ── rollback ─────────────────────────────────────────────────────────────────
await db.exec(logDown);
await db.exec(logDown); // idempotent
const left = await as<{ n: number }>(
  null,
  `select count(*)::int as n from pg_trigger where not tgisinternal and tgname in
     ('plan_override_logged','plan_point_logged_insert','plan_point_logged_update','program_plan_logged','break_logged')`,
);
assert.equal(left[0].n, 0);
assert.equal(
  (
    await as<{ t: string | null }>(
      null,
      "select to_regclass('public.student_plan_changes')::text as t",
    )
  )[0].t,
  null,
);
// And the tables it watched take changes as before.
await as(
  tutor,
  `insert into student_plan_overrides(student_id, subject, spec_point_id, kind) values ('${ghost}','biology','${p2}','skip')`,
);

console.log("plan change log: all checks passed");
