/** Isolated PostgreSQL regression checks for S-26: a tutor can't move a
 * student onto a level or board with no curriculum.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-course-change-coverage-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const unlevelled = uuid(2);
const tutor = uuid(3);

await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type level as enum ('gcse','gcse_trilogy','igcse','alevel');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table profiles(id uuid primary key, role profile_role not null default 'student', level level);
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board, target_grade text, unique(student_id, subject));
create table topics(id uuid primary key default gen_random_uuid(), level level, board board, subject subject);
create table spec_points(id uuid primary key default gen_random_uuid(), topic_id uuid references topics);
alter table student_enrolments enable row level security;
create policy "enrolments self update" on student_enrolments for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy "enrolments tutor update" on student_enrolments for update to authenticated using (private.has_role(auth.uid(),'tutor')) with check (private.has_role(auth.uid(),'tutor'));
create policy "enrolments read" on student_enrolments for select to authenticated using (true);
`);
// The live definition before this migration (20260923081108), so the test
// starts where production does.
await db.exec(`
create function public.tutor_set_student_level(_student_id uuid, _level public.level) returns void language plpgsql security definer set search_path = '' as $f$
begin
  if not (private.has_role(auth.uid(), 'tutor'::public.app_role) or private.has_role(auth.uid(), 'admin'::public.app_role)) then
    raise exception 'Tutor access required' using errcode = '42501';
  end if;
  update public.profiles set level = _level where id = _student_id and role = 'student'::public.profile_role;
  if not found then raise exception 'No student with that id' using errcode = 'P0002'; end if;
end; $f$;
`);

// Curriculum: GCSE AQA Biology and Chemistry, GCSE Edexcel Biology, A-level
// AQA Biology only. iGCSE AQA Biology has a topic heading but no spec points.
const covered: Array<[string, string, string]> = [
  ["gcse", "aqa", "biology"],
  ["gcse", "aqa", "chemistry"],
  ["gcse", "edexcel", "biology"],
  ["alevel", "aqa", "biology"],
];
for (const [level, board, subject] of covered) {
  const t = await db.query<{ id: string }>(
    "insert into topics(level,board,subject) values($1,$2,$3) returning id",
    [level, board, subject],
  );
  await db.query("insert into spec_points(topic_id) values($1)", [t.rows[0].id]);
}
await db.query("insert into topics(level,board,subject) values('igcse','aqa','biology')");

await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query(
  "insert into profiles(id,role,level) values($1,'student','gcse'),($2,'student',null),($3,'tutor',null)",
  [student, unlevelled, tutor],
);
await db.query(
  "insert into student_enrolments(student_id,subject,board) values($1,'biology','aqa'),($2,'biology','aqa')",
  [student, unlevelled],
);

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261003112000_course_change_needs_curriculum.sql",
    import.meta.url,
  ),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant select, update on all tables in schema public to authenticated;
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const fails = async (q: () => Promise<unknown>, what: string, match?: RegExp) => {
  let err: unknown = null;
  try {
    await q();
  } catch (e) {
    err = e;
  }
  assert(err, what);
  if (match) assert.match((err as Error).message, match, what);
};
const level = async (id: string) =>
  (await db.query<{ level: string | null }>("select level::text from profiles where id=$1", [id]))
    .rows[0].level;
const board = async (id: string, subject: string) =>
  (
    await db.query<{ board: string }>(
      "select board::text from student_enrolments where student_id=$1 and subject=$2",
      [id, subject],
    )
  ).rows[0].board;

// ── Level ─────────────────────────────────────────────────────────────────
await as(tutor);
await fails(
  () => db.query("select tutor_set_student_level($1,'igcse')", [student]),
  "A tutor moved a student to a level with no curriculum (a topic heading but no spec points)",
  /no curriculum at that level for Biology \(AQA\)/,
);
assert.equal(await level(student), "gcse", "The refused level change still wrote");
await db.query("select tutor_set_student_level($1,'alevel')", [student]);
assert.equal(await level(student), "alevel", "A covered level change was refused");
await db.query("select tutor_set_student_level($1,'gcse')", [student]);

// A second subject with no A-level curriculum blocks the move to A-level.
await db.exec("reset role");
await db.query(
  "insert into student_enrolments(student_id,subject,board) values($1,'chemistry','aqa')",
  [student],
);
await db.exec("set role authenticated");
await as(tutor);
await fails(
  () => db.query("select tutor_set_student_level($1,'alevel')", [student]),
  "One uncovered subject should block the whole level change",
  /Chemistry \(AQA\)/,
);
assert.equal(await level(student), "gcse");

await as(student);
await fails(
  () => db.query("select tutor_set_student_level($1,'gcse')", [student]),
  "A student used the tutor RPC",
  /Tutor access required/,
);

// ── Board ─────────────────────────────────────────────────────────────────
await as(tutor);
await fails(
  () =>
    db.query(
      "update student_enrolments set board='ocr' where student_id=$1 and subject='biology'",
      [student],
    ),
  "A tutor switched a subject to a board with no curriculum",
  /no OCR curriculum for Biology/,
);
assert.equal(await board(student, "biology"), "aqa");
await db.query(
  "update student_enrolments set board='edexcel' where student_id=$1 and subject='biology'",
  [student],
);
assert.equal(await board(student, "biology"), "edexcel", "A covered board change was refused");
// Grades still save: the trigger only looks at board changes.
await db.query(
  "update student_enrolments set target_grade='7' where student_id=$1 and subject='chemistry'",
  [student],
);

// A student with no level has nothing to check against.
await db.query(
  "update student_enrolments set board='ocr' where student_id=$1 and subject='biology'",
  [unlevelled],
);
assert.equal(await board(unlevelled, "biology"), "ocr");

// The student's own writes (onboarding) aren't refused here.
await as(student);
await db.query(
  "update student_enrolments set board='ocr' where student_id=$1 and subject='biology'",
  [student],
);
assert.equal(await board(student, "biology"), "ocr", "The student's own board change was refused");

// The helper isn't callable by clients.
await as(tutor);
await fails(
  () => db.query("select private.has_curriculum('gcse','aqa','biology')"),
  "A client called private.has_curriculum",
);

console.log("course change coverage: all checks passed");
