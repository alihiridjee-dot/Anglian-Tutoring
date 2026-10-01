/** Isolated PostgreSQL checks for 20261001164835_revision_notes. No production
 * data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-revision-notes-db.ts
 *
 * Stands up the few pieces of production the migration leans on (auth.uid,
 * private.has_role, private.my_content_subjects, spec_points), applies the
 * migration file whole, then checks who can read and write what. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const bioStudent = uuid(1);
const unpaidStudent = uuid(2);
const tutor = uuid(3);
const parentOfBio = uuid(4);
const [pointBio, pointChem] = [uuid(100), uuid(101)];

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.subject as enum ('biology','chemistry','physics');
create type public.level as enum ('gcse','alevel','gcse_trilogy','igcse');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_user_id uuid, _role public.app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor') then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
-- Stands in for the paywall: the subjects the caller (or their child) has paid for.
create table private.paid(user_id uuid, subject text);
create function private.my_content_subjects() returns text[] language sql stable security definer set search_path = public, private as $$
  select coalesce(array_agg(distinct subject), '{}') from private.paid where user_id = auth.uid() $$;
create table public.spec_points(id uuid primary key);
insert into public.spec_points values ('${pointBio}'), ('${pointChem}');
insert into auth.users values ('${tutor}');
insert into public.user_roles values ('${tutor}', 'tutor');
insert into private.paid values ('${bioStudent}', 'biology'), ('${parentOfBio}', 'biology');
grant usage on schema private, auth to authenticated, anon, service_role;
grant execute on all functions in schema private, auth to authenticated, anon, service_role;
`);

await db.exec(await readFile(new URL("../supabase/migrations/20261001164835_revision_notes.sql", import.meta.url), "utf8"));
await db.exec(`grant all on all tables in schema public to service_role; alter role service_role bypassrls;`);

async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${user ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${user ?? ""}', false);`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
async function asServer(sql: string, params: unknown[] = []) {
  await db.exec("set role service_role");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const fails = async (p: Promise<unknown>, why: string) => {
  await assert.rejects(p, undefined, why);
};

// Loading drafts is a service-role job.
await db.exec("set role service_role");
await db.exec(`
insert into public.note_concepts (id, subject, chapter, title, scope, kind, sort_order) values
  ('bio-001', 'biology', 'Cell biology', 'Cells', 'Cells.', 'content', 1),
  ('bio-002', 'biology', 'Cell biology', 'Microscopes', 'Microscopes.', 'content', 2),
  ('chem-001', 'chemistry', 'Atoms', 'Atoms', 'Atoms.', 'content', 1);
insert into public.note_concept_spec_points values ('bio-001', '${pointBio}', true), ('chem-001', '${pointChem}', true);
insert into public.notes (concept_id, body, written_by, status, approved_at) values
  ('bio-001', '{"title":"Cells"}', 'sonnet', 'approved', now()),
  ('bio-002', '{"title":"Microscopes"}', 'sonnet', 'draft', null),
  ('chem-001', '{"title":"Atoms"}', 'sonnet', 'approved', now());
`);
await db.exec("reset role");

// A student who has paid for Biology sees Biology concepts and approved Biology notes only.
const ids = (rows: { concept_id?: string; id?: string }[]) => rows.map((r) => r.concept_id ?? r.id).sort();
assert.deepEqual(ids(await as(bioStudent, "select id from public.note_concepts")), ["bio-001", "bio-002"]);
assert.deepEqual(ids(await as(bioStudent, "select concept_id from public.notes")), ["bio-001"], "draft and unpaid notes are hidden");
assert.deepEqual(ids(await as(bioStudent, "select concept_id from public.note_concept_spec_points")), ["bio-001"]);

// A parent sees what their child has paid for (my_content_subjects covers both).
assert.deepEqual(ids(await as(parentOfBio, "select concept_id from public.notes")), ["bio-001"]);

// A student with no paid subject sees nothing; nor does a signed-out visitor.
assert.equal((await as(unpaidStudent, "select * from public.notes")).length, 0);
assert.equal((await as(unpaidStudent, "select * from public.note_concepts")).length, 0);
await fails(as(null, "select * from public.notes"), "anon has no grant");

// Students cannot write, approve or delete.
await fails(as(bioStudent, "insert into public.notes (concept_id, body, written_by) values ('bio-002', '{}', 'me')"), "student insert");
assert.equal((await as(bioStudent, "update public.notes set status = 'approved', approved_at = now() where concept_id = 'bio-002' returning *")).length, 0, "student cannot approve");
assert.equal((await as(bioStudent, "delete from public.notes where concept_id = 'bio-001' returning *")).length, 0, "student cannot delete");

// A tutor sees drafts and can approve one.
assert.deepEqual(ids(await as(tutor, "select concept_id from public.notes")), ["bio-001", "bio-002", "chem-001"]);
const approved = await as(tutor, `update public.notes set status = 'approved', approved_at = now(), approved_by = '${tutor}' where concept_id = 'bio-002' returning concept_id`);
assert.equal(approved.length, 1);
assert.deepEqual(ids(await as(bioStudent, "select concept_id from public.notes")), ["bio-001", "bio-002"], "approved note is now visible");

// Approval and its timestamp move together.
await fails(asServer("update public.notes set status = 'approved', approved_at = null where concept_id = 'chem-001'"), "approved without a time");
await fails(asServer("update public.notes set status = 'draft' where concept_id = 'chem-001'"), "draft with an approval time");

console.log("revision notes: all access checks pass");
