/** Isolated PostgreSQL checks for the roster's "Last active" (last_active_at).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-directory-last-active-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const finley = uuid(1);
const quiet = uuid(2);
const tutor = uuid(3);

// The shape of production the function reads, with the role helper stubbed
// the way production defines it.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, last_sign_in_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type level as enum ('gcse','alevel','igcse');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from user_roles where user_id = _user_id and role = _role);
end $$;
create table profiles(id uuid primary key references auth.users, display_name text, role profile_role not null default 'student', level level, school text, student_invite_code text, created_at timestamptz default now(), onboarding_completed_at timestamptz);
create table homework_submissions(id uuid primary key default gen_random_uuid(), student_id uuid, submitted_at timestamptz not null default now());
create table homework_drafts(student_id uuid, resource_id uuid, updated_at timestamptz not null default now());
create table mcq_attempts(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz not null default now());
create table chat_messages(id uuid primary key default gen_random_uuid(), sender_id uuid, created_at timestamptz not null default now());
`);
const migration = await readFile(
  new URL("../supabase/migrations/20261011161842_directory_last_active.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);

// ── Fixtures: Finley as found on 11 Oct ──────────────────────────────────
await db.query("insert into auth.users values($1,'finley@example.com','2026-10-01T18:11Z')", [
  finley,
]);
await db.query("insert into auth.users values($1,'quiet@example.com',null)", [quiet]);
await db.query("insert into auth.users values($1,'tutor@example.com','2026-10-11T09:00Z')", [
  tutor,
]);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into profiles(id,display_name) values($1,'Finley'),($2,'Quiet')", [
  finley,
  quiet,
]);
await db.query("insert into profiles(id,display_name,role) values($1,'Ms T','tutor')", [tutor]);
await db.query("insert into auth.sessions(user_id,updated_at) values($1,'2026-10-10T10:47Z')", [
  finley,
]);
await db.query(
  "insert into homework_submissions(student_id,submitted_at) values($1,'2026-10-10T11:10Z'),($1,'2026-10-10T11:28Z')",
  [finley],
);
// The tutor's reply is newer than anything Finley did, and must not count.
await db.query("insert into chat_messages(sender_id,created_at) values($1,'2026-10-11T08:00Z')", [
  tutor,
]);

await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant all on all tables in schema public to authenticated;
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const lastActive = async (id: string) => {
  const r = await db.query<{ last_active_at: Date | null; last_sign_in_at: Date | null }>(
    "select last_active_at, last_sign_in_at from tutor_student_directory() where id=$1",
    [id],
  );
  return r.rows[0];
};

// ── Last active ───────────────────────────────────────────────────────────
await as(tutor);
let row = await lastActive(finley);
assert.equal(
  row.last_active_at?.toISOString(),
  "2026-10-10T11:28:00.000Z",
  "Last active did not follow Finley's latest hand-in",
);
assert.equal(
  row.last_sign_in_at?.toISOString(),
  "2026-10-01T18:11:00.000Z",
  "last_sign_in_at changed meaning",
);

row = await lastActive(quiet);
assert.equal(row.last_active_at, null, "A student who never did anything shows activity");

await db.exec("reset role");
await db.query("insert into mcq_attempts(user_id,created_at) values($1,'2026-10-11T07:00Z')", [
  finley,
]);
await db.query(
  "insert into homework_drafts(student_id,updated_at) values($1,'2026-10-11T07:30Z')",
  [quiet],
);
await db.query("insert into chat_messages(sender_id,created_at) values($1,'2026-10-11T07:45Z')", [
  finley,
]);
await db.exec("set role authenticated");
await as(tutor);
assert.equal(
  (await lastActive(finley)).last_active_at?.toISOString(),
  "2026-10-11T07:45:00.000Z",
  "A quiz or the student's own message did not count",
);
assert.equal(
  (await lastActive(quiet)).last_active_at?.toISOString(),
  "2026-10-11T07:30:00.000Z",
  "A saved draft did not count",
);

// The app opening (a session refresh) counts on its own.
await db.exec("reset role");
await db.query("update auth.sessions set updated_at='2026-10-11T09:30Z' where user_id=$1", [
  finley,
]);
await db.exec("set role authenticated");
await as(tutor);
assert.equal(
  (await lastActive(finley)).last_active_at?.toISOString(),
  "2026-10-11T09:30:00.000Z",
  "Having the app open did not count",
);

// ── Still staff-only ──────────────────────────────────────────────────────
await as(finley);
let threw = false;
try {
  await db.query("select * from tutor_student_directory()");
} catch {
  threw = true;
}
assert(threw, "A student read the directory");

// ── Grants and idempotence ────────────────────────────────────────────────
await db.exec("reset role");
await db.exec(migration);
const acl = await db.query<{ anon: boolean; authed: boolean; service: boolean }>(
  `select has_function_privilege('anon','public.tutor_student_directory()','execute') anon,
          has_function_privilege('authenticated','public.tutor_student_directory()','execute') authed,
          has_function_privilege('service_role','public.tutor_student_directory()','execute') service`,
);
assert.deepEqual(
  acl.rows[0],
  { anon: false, authed: true, service: true },
  "Grants differ from production's",
);

console.log("directory last active: all checks passed");
