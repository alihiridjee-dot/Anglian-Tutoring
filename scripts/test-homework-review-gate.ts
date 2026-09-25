/** Run with PGLITE_PATH pointing to a temporary @electric-sql/pglite installation.
 * Applies the real review-gate migration to an isolated Postgres instance and
 * checks who can see what; no remote student data. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.PGLITE_PATH ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);
const otherStudent = uuid(3);
const parent = uuid(4);

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.subject as enum ('biology','physics');
create type public.board as enum ('aqa');
create type public.level as enum ('gcse');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_uid uuid, _role public.app_role) returns boolean language sql stable security definer as $$ select exists (select 1 from public.user_roles r where r.user_id = _uid and r.role = _role) $$;
-- Every student here is on biology only, which is what makes physics the control.
create function private.my_content_subjects() returns text[] language sql stable as $$ select array['biology'] $$;
grant usage on schema private, auth to authenticated;

create table public.spec_points(id uuid primary key);
create table public.resources(
  id uuid primary key default gen_random_uuid(), kind text not null, title text, subject public.subject,
  board public.board, level public.level, spec_point_id uuid references public.spec_points, created_by uuid, origin text);
create unique index on public.resources (spec_point_id) where kind = 'homework' and spec_point_id is not null;
create table public.resource_spec_points(resource_id uuid, spec_point_id uuid, primary key(resource_id, spec_point_id));
create table public.homework_questions(
  id uuid primary key default gen_random_uuid(), resource_id uuid references public.resources, position int,
  prompt text, marks int, answer_type text, mark_scheme text, spec_point_id uuid);
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid,
  graded_at timestamptz, release_at timestamptz, tutor_reviewed_at timestamptz);
create table public.homework_ai_marks(submission_id uuid primary key, marks jsonb not null, summary text, model text, created_at timestamptz not null default now());

alter table public.resources enable row level security;
alter table public.homework_submissions enable row level security;
alter table public.parent_student_links enable row level security;
create policy "links" on public.parent_student_links for select to authenticated using (parent_id = (select auth.uid()));
create policy "resources read scoped" on public.resources for select to authenticated
  using ((select private.has_role((select auth.uid()), 'tutor')) or ((subject)::text in (select unnest(private.my_content_subjects()))));
create policy "resources tutors update" on public.resources for update to authenticated using (private.has_role((select auth.uid()), 'tutor'));
create policy "hs read scoped" on public.homework_submissions for select to authenticated
  using ((select auth.uid()) = student_id or private.has_role((select auth.uid()), 'tutor')
    or exists (select 1 from public.parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = homework_submissions.student_id));
grant select, update on public.resources to authenticated;
grant select on public.homework_submissions, public.parent_student_links, public.user_roles to authenticated;

insert into auth.users values ('${tutor}'),('${student}'),('${otherStudent}'),('${parent}');
insert into public.user_roles values ('${tutor}','tutor'),('${student}','student'),('${otherStudent}','student');
insert into public.parent_student_links values ('${parent}','${student}');
insert into public.spec_points select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid from generate_series(100, 105) n;
-- A sheet from before the gate existed.
insert into public.resources(id, kind, title, subject, spec_point_id, origin) values ('${uuid(200)}','homework','Old sheet','biology','${uuid(100)}','generated');
`);

await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260921221948_homework_review_gate.sql", import.meta.url),
    "utf8",
  ),
);

/** Run one statement as a signed-in user, the way PostgREST would. */
async function as<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`,
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}
const titles = async (userId: string) =>
  (await as<{ title: string }>(userId, "select title from public.resources order by title")).map(
    (r) => r.title,
  );
const questions = JSON.stringify([
  { prompt: "Q", marks: 3, answer_type: "short", mark_scheme: "MS" },
]);
const ensure = (point: number, title: string, publishAt: string | null) =>
  db.query<{ id: string }>(
    "select public.ensure_generated_homework($1,$2,'biology','gcse',$3::jsonb,$4,'aqa',$5) as id",
    [uuid(point), title, questions, student, publishAt],
  );

// 1. Everything that predates the gate stays visible.
assert.deepEqual(await titles(student), ["Old sheet"]);
const [old] = (
  await db.query<{ review_status: string }>("select review_status from public.resources")
).rows;
assert.equal(old.review_status, "approved");

// 2. A sheet written ahead of time waits; one written for this week is live.
const future = new Date(Date.now() + 86_400_000).toISOString();
const ahead = (await ensure(101, "Next week", future)).rows[0].id;
await ensure(102, "This week", null);
assert.deepEqual(await titles(student), ["Old sheet", "This week"]);
assert.deepEqual(await titles(tutor), ["Next week", "Old sheet", "This week"]);

// 3. The generator can tell a hidden sheet exists, so it never pays for it twice.
const known = await as<{ homework_points_with_sheet: string }>(
  student,
  "select public.homework_points_with_sheet($1::uuid[])",
  [[uuid(101), uuid(105)]],
);
assert.deepEqual(
  known.map((r) => r.homework_points_with_sheet),
  [uuid(101)],
);

// 4. A student may not call the writer, and may not approve anything.
await assert.rejects(
  as(student, "select public.ensure_generated_homework($1,'x','biology','gcse',$2::jsonb,$3)", [
    uuid(103),
    questions,
    student,
  ]),
  /permission denied/,
);
await as(student, "update public.resources set review_status = 'approved' where id = $1", [ahead]);
assert.deepEqual(await titles(student), ["Old sheet", "This week"]);

// 5. Approving publishes early; holding hides — even a sheet that was live.
await as(tutor, "update public.resources set review_status = 'approved' where id = $1", [ahead]);
assert.deepEqual(await titles(student), ["Next week", "Old sheet", "This week"]);
await as(tutor, "update public.resources set review_status = 'held' where title = 'This week'");
assert.deepEqual(await titles(student), ["Next week", "Old sheet"]);

// 6. …except from a child who already handed work in against it, and their parent.
const [held] = (
  await db.query<{ id: string }>("select id from public.resources where title = 'This week'")
).rows;
const [sub] = (
  await db.query<{ id: string }>(
    "insert into public.homework_submissions(resource_id, student_id, release_at) values ($1,$2, now() + interval '30 minutes') returning id",
    [held.id, student],
  )
).rows;
assert.ok((await titles(student)).includes("This week"));
assert.ok((await titles(parent)).includes("This week"));
assert.ok(!(await titles(otherStudent)).includes("This week"));

// 7. Another subject stays out of reach whatever its status.
await db.exec(
  `insert into public.resources(kind, title, subject, origin) values ('homework','Physics sheet','physics','tutor')`,
);
assert.ok(!(await titles(student)).includes("Physics sheet"));

// 8. Mark drafts: staff only, clamped, scoped to the sheet, and flag the row as edited.
const [q] = (
  await db.query<{ id: string }>(
    "select id from public.homework_questions where resource_id = $1",
    [held.id],
  )
).rows;
const draft = JSON.stringify([
  { question_id: q.id, marks: 99, feedback: "Good" },
  { question_id: uuid(999), marks: 1, feedback: "not on this sheet" },
]);
await assert.rejects(
  as(student, "select public.save_homework_mark_draft($1,$2::jsonb,'s')", [sub.id, draft]),
  /Only tutors/,
);
await as(tutor, "select public.save_homework_mark_draft($1,$2::jsonb,'Well done')", [
  sub.id,
  draft,
]);
const [staged] = (
  await db.query<{ marks: Array<{ marks: number }>; summary: string }>(
    "select marks, summary from public.homework_ai_marks",
  )
).rows;
assert.equal(staged.marks.length, 1);
assert.equal(Number(staged.marks[0].marks), 3);
assert.equal(staged.summary, "Well done");
const [after] = (
  await db.query<{ tutor_reviewed_at: string | null; graded_at: string | null }>(
    "select tutor_reviewed_at, graded_at from public.homework_submissions",
  )
).rows;
assert.ok(after.tutor_reviewed_at && !after.graded_at);
await db.exec("update public.homework_submissions set graded_at = now()");
await assert.rejects(
  as(tutor, "select public.save_homework_mark_draft($1,$2::jsonb,'s')", [sub.id, draft]),
  /already published/,
);

// 9. Groups are invisible to students and usable by tutors.
await as(tutor, "insert into public.student_groups(name, created_by) values ('Tuesday set', $1)", [
  tutor,
]);
await as(
  tutor,
  "insert into public.student_group_members(group_id, student_id) select id, $1 from public.student_groups",
  [student],
);
assert.equal((await as(tutor, "select * from public.student_group_members")).length, 1);
assert.equal((await as(student, "select * from public.student_groups")).length, 0);
assert.equal((await as(student, "select * from public.student_group_members")).length, 0);
await assert.rejects(
  as(student, "insert into public.student_groups(name) values ('mine')"),
  /row-level security/,
);

console.log("homework review gate: all checks passed");
