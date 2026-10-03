/** H-5: the record-only migration creates what is missing and changes nothing
 * on a second run (production already holds everything in it). No production
 * data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-record-production-only-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table public.user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table public.profiles(id uuid primary key, display_name text);
create table public.resources(id uuid primary key, title text);
create table public.spec_points(id uuid primary key);
create table public.homework_submissions(id uuid primary key, resource_id uuid, student_id uuid,
  graded_at timestamptz, graded_by uuid);
`);
const sql = await readFile(
  new URL(
    "../supabase/migrations/20261001153609_record_production_only_objects.sql",
    import.meta.url,
  ),
  "utf8",
);

const snapshot = async () =>
  (
    await db.query<{ s: string }>(`select concat_ws(' | ',
      (select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname = 'public'),
      (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public'),
      (select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_name in ('notifications', 'resource_spec_points', 'homework_submissions')),
      (select md5(prosrc) from pg_proc where proname = 'acknowledge_submission')) s`)
  ).rows[0].s;

// An empty schema gets everything.
await db.exec(sql);
const first = await snapshot();
for (const name of [
  "notifications read own",
  "notifications update own",
  "rsp read follows resource",
  "rsp tutors write",
  "notifications_user_created_idx",
  "resource_spec_points_spec_point_idx",
  "acknowledged_at",
]) {
  assert.ok(first.includes(name), `${name} wasn't created`);
}

// Production already has it all: a second run must change nothing and not fail.
await db.exec(sql);
assert.equal(await snapshot(), first, "A second run changed the schema");

// And the recorded function works against the recorded tables.
const [student, tutor, hw, sub] = [1, 2, 3, 4].map(
  (n) => `00000000-0000-0000-0000-00000000000${n}`,
);
await db.query("insert into auth.users values ($1), ($2)", [student, tutor]);
await db.query("insert into profiles values ($1, 'Bea')", [student]);
await db.query("insert into resources values ($1, 'Cells')", [hw]);
await db.query("insert into homework_submissions values ($1, $2, $3, now(), $4)", [
  sub,
  hw,
  student,
  tutor,
]);
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [student]);
await db.query("select public.acknowledge_submission($1)", [sub]);
const note = await db.query<{ title: string }>(
  "select title from notifications where user_id = $1",
  [tutor],
);
assert.equal(note.rows[0]?.title, "Bea acknowledged your feedback");

console.log("record production-only objects: all checks passed");
