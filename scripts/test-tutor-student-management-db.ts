/** Isolated PostgreSQL regression checks for the tutor student-management migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-tutor-student-management-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const other = uuid(2);
const tutor = uuid(3);
const parent = uuid(4);

// The shape of production the migration touches, with the role helper stubbed
// the way production defines it: a caller may ask about their own roles, and
// staff may ask about anyone's.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('edexcel','aqa','ocr');
create type level as enum ('gcse','alevel','igcse');
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
create table profiles(id uuid primary key references auth.users, display_name text, role profile_role not null default 'student', level level, school text, student_invite_code text, created_at timestamptz default now(), onboarding_completed_at timestamptz);
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid references auth.users, subject subject, board board, previous_grade text, current_grade text, target_grade text, unique(student_id, subject));
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid);
create table subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, student_id uuid, status text);
create table billing_feedback(id uuid primary key default gen_random_uuid(), user_id uuid, student_id uuid, action text, reason text, reason_category text);

alter table profiles enable row level security;
create policy "profiles self read" on profiles for select to authenticated using (auth.uid() = id);
alter table student_enrolments enable row level security;
create policy "enrolments self read" on student_enrolments for select to authenticated using (student_id = auth.uid());
create policy "enrolments self update" on student_enrolments for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy "enrolments tutor read" on student_enrolments for select to authenticated using (private.has_role(auth.uid(),'tutor'));
alter table billing_feedback enable row level security;
create policy "billing feedback insert manager" on billing_feedback for insert to authenticated with check (false);
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260923081108_tutor_student_management.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.query("insert into auth.users values($1,'student@example.com',now())", [student]);
await db.query("insert into auth.users values($1,'other@example.com',null)", [other]);
await db.query("insert into auth.users values($1,'tutor@example.com',now())", [tutor]);
await db.query("insert into auth.users values($1,'parent@example.com',now())", [parent]);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into profiles(id,display_name,role,level) values($1,'Bea','student','gcse')", [student]);
await db.query("insert into profiles(id,display_name,role,level) values($1,'Al','student','gcse')", [other]);
await db.query("insert into profiles(id,display_name,role) values($1,'Ms T','tutor')", [tutor]);
await db.query("insert into profiles(id,display_name,role) values($1,'Mum','parent')", [parent]);
await db.query("insert into student_enrolments(student_id,subject,board) values($1,'biology','aqa')", [student]);
await db.query("insert into subscriptions(user_id,student_id,status) values($1,$2,'active')", [parent, student]);

await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant all on all tables in schema public to authenticated;
 set role authenticated;`);
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

// ── Directory ─────────────────────────────────────────────────────────────
await as(tutor);
const dir = await db.query<{ id: string; email: string; display_name: string }>(
  "select id, email, display_name from tutor_student_directory()",
);
assert.deepEqual(
  dir.rows.map((r) => r.email).sort(),
  ["other@example.com", "student@example.com"],
  "Directory lists exactly the students, with email",
);
assert(!dir.rows.some((r) => r.id === parent), "Directory leaked a parent");

await as(student);
await fails(() => db.query("select * from tutor_student_directory()"), "A student read the directory");
await as(parent);
await fails(() => db.query("select * from tutor_student_directory()"), "A parent read the directory");

// ── Level ─────────────────────────────────────────────────────────────────
await as(tutor);
await db.query("select tutor_set_student_level($1,'alevel')", [student]);
const lvl = await db.query<{ level: string }>(
  "select level from tutor_student_directory() where id=$1",
  [student],
);
assert.equal(lvl.rows[0].level, "alevel", "Tutor could not change the level");
await fails(
  () => db.query("select tutor_set_student_level($1,'gcse')", [tutor]),
  "Level set on a non-student did not raise",
);
await as(student);
await fails(
  () => db.query("select tutor_set_student_level($1,'gcse')", [student]),
  "A student changed their own level through the tutor RPC",
);

// ── Enrolment board and grades ────────────────────────────────────────────
await as(tutor);
const upd = await db.query<{ board: string }>(
  "update student_enrolments set board='ocr', target_grade='7' where student_id=$1 and subject='biology' returning board",
  [student],
);
assert.equal(upd.rows[0]?.board, "ocr", "Tutor could not update the enrolment");
await as(other);
const denied = await db.query(
  "update student_enrolments set board='edexcel' where student_id=$1 and subject='biology' returning board",
  [student],
);
assert.equal(denied.rows.length, 0, "Another student changed someone else's board");

// ── Notes ─────────────────────────────────────────────────────────────────
await as(tutor);
const note = await db.query<{ id: string; created_at: string; updated_at: string }>(
  "insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'Struggles with moles') returning id, created_at, updated_at",
  [student, tutor],
);
assert.equal(note.rows.length, 1, "Tutor could not add a note");
await fails(
  () =>
    db.query("insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'   ')", [
      student,
      tutor,
    ]),
  "A blank note was accepted",
);
await fails(
  () =>
    db.query("insert into student_tutor_notes(student_id,author_id,body) values($1,$2,'x')", [
      student,
      other,
    ]),
  "A note was filed under someone else's name",
);
await db.query("select pg_sleep(0.01)");
const edited = await db.query<{ updated_at: string; created_at: string }>(
  "update student_tutor_notes set body='Struggles with moles; improving' where id=$1 returning updated_at, created_at",
  [note.rows[0].id],
);
assert(
  edited.rows[0].updated_at > edited.rows[0].created_at,
  "updated_at did not move on edit",
);
await as(student);
const seen = await db.query("select id from student_tutor_notes");
assert.equal(seen.rows.length, 0, "The student can read tutor notes about them");
await as(parent);
const seenByParent = await db.query("select id from student_tutor_notes");
assert.equal(seenByParent.rows.length, 0, "A parent can read tutor notes");

// ── Billing feedback ──────────────────────────────────────────────────────
await as(tutor);
await db.query(
  "insert into billing_feedback(user_id,student_id,action,reason_category) values($1,$2,'cancel','other')",
  [tutor, student],
);
await as(parent);
await db.query(
  "insert into billing_feedback(user_id,student_id,action,reason_category) values($1,$2,'pause','other')",
  [parent, student],
);
await as(other);
await fails(
  () =>
    db.query(
      "insert into billing_feedback(user_id,student_id,action,reason_category) values($1,$2,'cancel','other')",
      [other, student],
    ),
  "An unrelated student filed billing feedback on someone else's plan",
);

// ── Idempotence ───────────────────────────────────────────────────────────
await db.exec("reset role");
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260923081108_tutor_student_management.sql", import.meta.url),
    "utf8",
  ),
);

console.log("tutor student management: all checks passed");
