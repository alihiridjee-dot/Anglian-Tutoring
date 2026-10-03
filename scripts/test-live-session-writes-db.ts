/** Isolated PostgreSQL regression checks for M-2 and S-37: a live session or
 * video and its spec-point links are written together or not at all, only by
 * a tutor, and only a live session remembers the Zoom meeting the app made.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-live-session-writes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);
const pointA = uuid(10);
const pointB = uuid(11);
const missingPoint = uuid(99);

// The tables and policies these writes touch, as production defines them
// (pg_policies, 1 Oct 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type level as enum ('gcse','alevel','gcse_trilogy','igcse');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type resource_kind as enum ('video','download','live_session','homework');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor') then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create table spec_points(id uuid primary key);
create table resources(id uuid primary key default gen_random_uuid(), kind resource_kind not null, title text not null,
  description text, subject subject not null, board board, level level not null, video_url text,
  starts_at timestamptz, join_url text, created_by uuid, created_at timestamptz not null default now());
alter table resources enable row level security;
create policy "resources read scoped" on resources for select to authenticated using (true);
create policy "resources tutors insert" on resources for insert to authenticated with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create table resource_spec_points(resource_id uuid not null references resources on delete cascade,
  spec_point_id uuid not null references spec_points on delete cascade, created_at timestamptz not null default now(),
  primary key (resource_id, spec_point_id));
alter table resource_spec_points enable row level security;
create policy "rsp read follows resource" on resource_spec_points for select using (exists (select 1 from resources r where r.id = resource_spec_points.resource_id));
create policy "rsp tutors write" on resource_spec_points for all using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
grant usage on schema public, auth, private to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001122201_live_session_writes.sql", import.meta.url),
    "utf8",
  ),
);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into spec_points values($1),($2)", [pointA, pointB]);

await db.exec("set role authenticated");
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const fails = async (q: () => Promise<unknown>, what: string) => {
  let threw = false;
  try {
    await q();
  } catch {
    threw = true;
  }
  assert(threw, what);
};
const count = async (table: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);
const create = (kind: string, points: string[], zoom: string | null = null) =>
  db.query<{ id: string }>(
    `select public.create_linked_resource(
       _kind => $1::resource_kind, _title => 'Photosynthesis', _description => '',
       _subject => 'biology', _level => 'gcse', _board => null, _spec_point_ids => $2::uuid[],
       _starts_at => now() + interval '1 day', _join_url => 'https://zoom.us/j/123?pwd=x',
       _zoom_meeting_id => $3) as id`,
    [kind, points, zoom],
  );

// A tutor's session arrives with its links, its author, and the meeting the app made.
await as(tutor);
const made = (await create("live_session", [pointA, pointB, pointA], "123")).rows[0].id;
assert.equal(await count("resources"), 1);
assert.equal(await count("resource_spec_points"), 2, "Links were lost or duplicated");
const row = (
  await db.query<{ created_by: string; zoom_meeting_id: string }>(
    "select created_by, zoom_meeting_id from resources where id = $1",
    [made],
  )
).rows[0];
assert.equal(row.created_by, tutor, "The session wasn't credited to the tutor who made it");
assert.equal(row.zoom_meeting_id, "123", "The app-made meeting wasn't remembered");

// A link that can't be written leaves no session behind: the old two-step
// write left a live session with no points here, and a retry duplicated it.
await fails(() => create("live_session", [pointA, missingPoint]), "A failed link was accepted");
assert.equal(await count("resources"), 1, "A failed link left a session without its points");

// A video has no meeting to remember, whatever the caller sends.
const video = (await create("video", [pointA], "456")).rows[0].id;
assert.equal(
  (
    await db.query<{ z: string | null }>("select zoom_meeting_id z from resources where id = $1", [
      video,
    ])
  ).rows[0].z,
  null,
  "A video kept a Zoom meeting id",
);

// Homework and downloads aren't written this way.
await fails(() => create("homework", [pointA]), "Homework went through the session writer");

// Row-level security still decides who writes: a student is refused, and nothing lands.
await as(student);
await fails(() => create("live_session", [pointA]), "A student created a live session");
await as(tutor);
assert.equal(await count("resources"), 2, "A refused write left a row");

// Anonymous callers can't call it at all.
await db.exec("set role anon");
await fails(() => create("live_session", [pointA]), "anon could call create_linked_resource");

console.log("live session writes: all checks passed");
