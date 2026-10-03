/** Isolated PostgreSQL regression checks for M-31: only a note's author can
 * change or delete it. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-tutor-notes-author-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const author = uuid(2);
const colleague = uuid(3);
const admin = uuid(4);

await db.exec(`
create role authenticated;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table public.student_tutor_notes (
  id uuid primary key default gen_random_uuid(), student_id uuid not null, author_id uuid not null,
  body text not null check (btrim(body) <> ''), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.student_tutor_notes enable row level security;
-- The live policy before this migration (pg_policies, 3 Oct 2026).
create policy "stn tutor" on public.student_tutor_notes for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role) or private.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (author_id = (select auth.uid()) and (private.has_role((select auth.uid()), 'tutor'::public.app_role) or private.has_role((select auth.uid()), 'admin'::public.app_role)));
`);
await db.query("insert into user_roles values($1,'tutor'),($2,'tutor'),($3,'admin')", [
  author,
  colleague,
  admin,
]);
await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant select, insert, update, delete on public.student_tutor_notes to authenticated;`);

/** Rows the statement touched, or 0 when it was refused outright. */
const touched = async (sql: string, params: unknown[]) => {
  try {
    return (await db.query(sql, params)).rows.length;
  } catch {
    return 0;
  }
};
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const run = async () => {
  await db.exec("set role authenticated");
  await as(author);
  const n = await db.query<{ id: string }>(
    "insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'Struggles with moles') returning id",
    [student, author],
  );
  const id = n.rows[0].id;

  await as(colleague);
  const seen = await db.query("select id from student_tutor_notes where id=$1", [id]);
  const edited = await touched(
    "update student_tutor_notes set body='changed' where id=$1 returning id",
    [id],
  );
  const takenOver = await touched(
    "update student_tutor_notes set author_id=$2, body='mine now' where id=$1 returning id",
    [id, colleague],
  );
  const deleted = await touched("delete from student_tutor_notes where id=$1 returning id", [id]);
  let forged = false;
  try {
    await db.query(
      "insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'forged')",
      [student, author],
    );
    forged = true;
  } catch {
    /* refused */
  }
  await as(student);
  const studentSees = await db.query("select id from student_tutor_notes");

  await as(author);
  const ownEdit = await db.query(
    "update student_tutor_notes set body='Better now' where id=$1 returning id",
    [id],
  );
  const ownDelete = await db.query("delete from student_tutor_notes where id=$1 returning id", [
    id,
  ]);
  await db.exec("reset role");
  return {
    colleagueReads: seen.rows.length === 1,
    colleagueEdits: edited === 1,
    colleagueTakesOver: takenOver === 1,
    colleagueDeletes: deleted === 1,
    colleagueForges: forged,
    studentReads: studentSees.rows.length > 0,
    authorEdits: ownEdit.rows.length === 1,
    authorDeletes: ownDelete.rows.length === 1,
  };
};

// Before: a colleague can't edit the text in place (WITH CHECK wants them as
// author), but can take the note over as their own, or delete it.
const before = await run();
assert(
  before.colleagueTakesOver && before.colleagueDeletes,
  "Fixture check: the bug reproduces before the fix",
);
await db.exec("truncate student_tutor_notes");

const migration = await readFile(
  new URL("../supabase/migrations/20261003113000_tutor_notes_author_only.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

const after = await run();
assert.deepEqual(
  after,
  {
    colleagueReads: true,
    colleagueEdits: false,
    colleagueTakesOver: false,
    colleagueDeletes: false,
    colleagueForges: false,
    studentReads: false,
    authorEdits: true,
    authorDeletes: true,
  },
  "Only the author changes or deletes a note; staff still read it",
);

// An admin reads too, and writes only as themselves.
await db.exec("set role authenticated");
await as(admin);
await db.query(
  "insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'Admin note')",
  [student, admin],
);
assert.equal((await db.query("select id from student_tutor_notes")).rows.length, 1);

console.log("tutor notes author-only: all checks passed");
