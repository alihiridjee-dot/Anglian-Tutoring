/** Isolated PostgreSQL checks for 20261120000319_level_set_by_plan.sql: a
 * student with a live plan cannot change their own level, and everyone the
 * rule does not name still can. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-level-set-by-plan-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const REFUSAL = "Your level is set by your plan. Message your tutor to change it.";

// The slice of production the migration touches, as live on 20 Nov 2026:
// the column grants of 20260806232240 and private.is_staff as it is live.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create type public.level as enum ('gcse', 'alevel');
create type public.profile_role as enum ('student', 'tutor', 'parent');
create table public.profiles(
  id uuid primary key, role public.profile_role not null default 'student',
  level public.level, exam_year int, display_name text);
create table public.user_roles(user_id uuid, role text);
create table public.subscriptions(
  id serial primary key, user_id uuid, student_id uuid, status text, plan text);
grant select on public.profiles to authenticated;
grant update (level, exam_year, display_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;
create function private.is_staff(_user_id uuid) returns boolean language sql stable security definer set search_path to '' as $$
  select exists (
           select 1 from public.user_roles r
           where r.user_id = _user_id and r.role in ('tutor', 'admin')
         )
      or exists (
           select 1 from public.profiles p
           where p.id = _user_id and p.role = 'tutor'
         );
$$;
`);

const read = (name: string) => readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");
const migration = await read("migrations/20261120000319_level_set_by_plan.sql");
const rollback = await read("rollbacks/20261120000319_level_set_by_plan.down.sql");
await db.exec(migration);
await db.exec(migration); // idempotent

const STUDENT = {
  active: uuid(1),
  trialing: uuid(2),
  parentPays: uuid(3),
  sameLevel: uuid(4),
  otherColumn: uuid(5),
  onboarding: uuid(6),
  cancelled: uuid(7),
  pastDue: uuid(8),
};
const TUTOR = uuid(20);
const TUTOR_BY_PROFILE = uuid(21);
const PARENT = uuid(30);

for (const id of Object.values(STUDENT))
  await db.query("insert into public.profiles(id, level, exam_year) values ($1, 'alevel', 2027)", [
    id,
  ]);
await db.query("insert into public.profiles(id, role) values ($1, 'tutor'), ($2, 'tutor')", [
  TUTOR,
  TUTOR_BY_PROFILE,
]);
await db.query("insert into public.profiles(id, role) values ($1, 'parent')", [PARENT]);
await db.query("insert into public.user_roles values ($1, 'tutor')", [TUTOR]);
const subscribe = (student: string, status: string, payer = student) =>
  db.query(
    "insert into public.subscriptions(user_id, student_id, status, plan) values ($1, $2, $3, 'weekly_2')",
    [payer, student, status],
  );
await subscribe(STUDENT.active, "active");
await subscribe(STUDENT.trialing, "trialing");
await subscribe(STUDENT.parentPays, "active", PARENT);
await subscribe(STUDENT.sameLevel, "active");
await subscribe(STUDENT.otherColumn, "active");
await subscribe(STUDENT.cancelled, "canceled");
await subscribe(STUDENT.pastDue, "past_due");

/** Run one statement as `role` signed in as `uid` (null = no user), then reset. */
async function as(role: string, uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e as Error & { code?: string };
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const levelOf = async (id: string) =>
  (await db.query<{ level: string }>("select level from public.profiles where id = $1", [id]))
    .rows[0].level;
const setOwnLevel = (id: string, level: string) =>
  as("authenticated", id, "update public.profiles set level = $1 where id = $2", [level, id]);

// Refused: a real change, by the student themself, while their plan is live.
for (const [label, id] of [
  ["active plan", STUDENT.active],
  ["trialing plan", STUDENT.trialing],
  ["a plan the parent pays for", STUDENT.parentPays],
] as const) {
  const err = await setOwnLevel(id, "gcse");
  assert.ok(err, `${label}: refused`);
  assert.equal(err.message, REFUSAL, `${label}: the student is told why`);
  assert.equal(err.code, "42501", `${label}: errcode`);
  assert.equal(await levelOf(id), "alevel", `${label}: level unchanged`);
}

// Let through: the same level saved again, as onboarding's first step does.
assert.equal(
  await as(
    "authenticated",
    STUDENT.sameLevel,
    "update public.profiles set level = 'alevel', exam_year = 2028 where id = $1",
    [STUDENT.sameLevel],
  ),
  null,
  "same level saved again",
);
const saved = await db.query<{ exam_year: number }>(
  "select exam_year from public.profiles where id = $1",
  [STUDENT.sameLevel],
);
assert.equal(saved.rows[0].exam_year, 2028, "same level: the exam year still saves");

// Let through: another column of a live-plan student's own row.
assert.equal(
  await as(
    "authenticated",
    STUDENT.otherColumn,
    "update public.profiles set display_name = 'Sam' where id = $1",
    [STUDENT.otherColumn],
  ),
  null,
  "another column",
);

// Let through: no live plan (still onboarding, or a plan that lapsed).
for (const [label, id] of [
  ["no plan yet", STUDENT.onboarding],
  ["cancelled plan", STUDENT.cancelled],
  ["past-due plan", STUDENT.pastDue],
] as const) {
  assert.equal(await setOwnLevel(id, "gcse"), null, `${label}: allowed`);
  assert.equal(await levelOf(id), "gcse", `${label}: level changed`);
}

// Let through: staff, by user_roles or by a tutor profile.
for (const [label, tutor, level] of [
  ["tutor by role", TUTOR, "gcse"],
  ["tutor by profile", TUTOR_BY_PROFILE, "alevel"],
] as const) {
  assert.equal(
    await as("authenticated", tutor, "update public.profiles set level = $1 where id = $2", [
      level,
      STUDENT.active,
    ]),
    null,
    `${label}: allowed`,
  );
  assert.equal(await levelOf(STUDENT.active), level, `${label}: level changed`);
}

// Let through: the service role and the database owner (no auth.uid()).
assert.equal(
  await as("service_role", null, "update public.profiles set level = 'gcse' where id = $1", [
    STUDENT.trialing,
  ]),
  null,
  "service role",
);
assert.equal(await levelOf(STUDENT.trialing), "gcse", "service role: level changed");
assert.equal(
  await as("postgres", null, "update public.profiles set level = 'alevel' where id = $1", [
    STUDENT.trialing,
  ]),
  null,
  "database owner",
);

// The trigger function cannot be called on its own.
const direct = await as(
  "authenticated",
  STUDENT.active,
  "select private.keep_level_while_plan_live()",
);
assert.ok(direct, "authenticated cannot call the trigger function");

// The rollback puts it back as it was: the student may change their level.
await db.exec(rollback);
await db.exec(rollback); // idempotent
assert.equal(await setOwnLevel(STUDENT.parentPays, "gcse"), null, "after rollback: allowed");
const left = await db.query(
  "select 1 from pg_proc where proname = 'keep_level_while_plan_live' union all select 1 from pg_trigger where tgname = 'level_set_by_plan'",
);
assert.equal(left.rows.length, 0, "after rollback: function and trigger gone");

// And it applies again cleanly after a rollback.
await db.exec(migration);
assert.ok(await setOwnLevel(STUDENT.parentPays, "alevel"), "re-applied: refused again");

console.log("level set by plan: all checks passed");
