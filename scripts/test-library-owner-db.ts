/** Isolated PostgreSQL regression checks for 20261001120000_library_content_has_no_owner.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-library-owner-db.ts
 *
 * The two writers are first created from the migrations that define them today,
 * and a sheet and a quiz are saved through them the old way — owned by the
 * student who asked first — so the new migration is applied over the shape that
 * production actually has. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const firstStudent = uuid(2); // whose week asked for the library rows first
const otherStudent = uuid(3);
const topic = uuid(50);
const [pointA, pointB, pointC, pointD] = [uuid(100), uuid(101), uuid(102), uuid(103)];

const migration = (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

/** One function definition, from its `create` line to the closing `$$;`. */
async function definition(file: string, marker: string) {
  const lines = (await migration(file)).split("\n");
  const start = lines.findIndex((l) => l.includes(marker));
  assert.ok(start >= 0, `${marker} not found in ${file}`);
  const end = lines.findIndex((l, i) => i > start && /^\$\$;/.test(l));
  return lines.slice(start, end + 1).join("\n");
}

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);

create type public.subject as enum ('biology', 'physics');
create type public.level as enum ('gcse');
create type public.board as enum ('aqa');
create type public.resource_origin as enum ('tutor', 'generated');

create table public.topics(id uuid primary key, subject public.subject not null);
create table public.spec_points(
  id uuid primary key, topic_id uuid not null references public.topics, code text, title text);

-- The July scaffold's shape: an owner that is required and takes the row with it.
create table public.resources(
  id uuid primary key default gen_random_uuid(), kind text not null, title text,
  subject public.subject, board public.board, level public.level,
  spec_point_id uuid references public.spec_points,
  created_by uuid not null references auth.users(id) on delete cascade,
  origin public.resource_origin not null default 'tutor',
  review_status text not null default 'approved', publish_at timestamptz);
create unique index on public.resources (spec_point_id)
  where kind = 'homework' and spec_point_id is not null;
create table public.resource_spec_points(
  resource_id uuid references public.resources on delete cascade, spec_point_id uuid,
  primary key (resource_id, spec_point_id));
create table public.homework_questions(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources on delete cascade,
  position int, prompt text, marks int, answer_type text, mark_scheme text, spec_point_id uuid,
  unique (resource_id, position));
create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources on delete cascade,
  student_id uuid not null, score_pct numeric);
create table public.homework_answers(
  submission_id uuid references public.homework_submissions on delete cascade,
  question_id uuid references public.homework_questions on delete cascade, answer_text text);

create table public.mcq_sets(
  id uuid primary key default gen_random_uuid(), spec_point_id uuid, title text,
  description text, published boolean, subject public.subject,
  created_by uuid not null, origin public.resource_origin not null default 'tutor');
create unique index on public.mcq_sets (spec_point_id)
  where origin = 'generated' and spec_point_id is not null;
create table public.mcq_questions(
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.mcq_sets on delete cascade,
  position int, question text, options jsonb, correct_index int, explanation text,
  spec_point_id uuid);

insert into auth.users values ('${tutor}'), ('${firstStudent}'), ('${otherStudent}');
insert into public.topics values ('${topic}', 'biology');
insert into public.spec_points values
  ('${pointA}', '${topic}', '1.1', 'Cells'), ('${pointB}', '${topic}', '1.2', 'Microscopy'),
  ('${pointC}', '${topic}', '1.3', 'Transport'), ('${pointD}', '${topic}', '1.4', 'Osmosis');
`);

// The writers as production has them now.
await db.exec(
  (await definition(
    "20260921221948_homework_review_gate.sql",
    "create function public.ensure_generated_homework(",
  )) +
    `
revoke all on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) to service_role;`,
);
await db.exec(
  (await definition(
    "20260916140000_shared_mcq_sets.sql",
    "create or replace function public.ensure_generated_mcq_set(",
  )) +
    `
revoke all on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) to service_role;`,
);

const sheetQuestions = JSON.stringify([
  { prompt: "Name the organelle", marks: 1, answer_type: "short", mark_scheme: "Nucleus (1)" },
]);
const quizQuestions = JSON.stringify([
  { question: "Which?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "Because" },
]);

/** Call a writer the way the app server does: as service_role. */
async function asServer<T>(sql: string, params: unknown[]) {
  await db.exec("set role service_role");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const writeSheet = (point: string, by: string | null) =>
  asServer<{ id: string }>(
    "select public.ensure_generated_homework($1, 'Sheet', 'biology', 'gcse', $2::jsonb, $3, 'aqa') as id",
    [point, sheetQuestions, by],
  ).then((rows) => rows[0].id);
const writeQuiz = (point: string, by: string | null) =>
  asServer<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb, $3) as id", [
    point,
    quizQuestions,
    by,
  ]).then((rows) => rows[0].id);
const ownerOf = async (table: "resources" | "mcq_sets", id: string) =>
  (
    await db.query<{ created_by: string | null }>(
      `select created_by from public.${table} where id = $1`,
      [id],
    )
  ).rows[0]?.created_by;

// 1. Before: the library is saved under the student who asked first.
const oldSheet = await writeSheet(pointA, firstStudent);
const oldQuiz = await writeQuiz(pointA, firstStudent);
assert.equal(await ownerOf("resources", oldSheet), firstStudent);
assert.equal(await ownerOf("mcq_sets", oldQuiz), firstStudent);
const tutorSheet = (
  await db.query<{ id: string }>(
    `insert into public.resources(kind, title, subject, created_by, origin)
     values ('homework', 'Tutor brief', 'biology', $1, 'tutor') returning id`,
    [tutor],
  )
).rows[0].id;
await db.query(
  `insert into public.mcq_sets(title, subject, created_by, origin) values ('Tutor quiz', 'biology', $1, 'tutor')`,
  [tutor],
);

// Another student hands work in on that shared sheet.
const otherSubmission = (
  await db.query<{ id: string }>(
    "insert into public.homework_submissions(resource_id, student_id, score_pct) values ($1, $2, 80) returning id",
    [oldSheet, otherStudent],
  )
).rows[0].id;
await db.query(
  "insert into public.homework_answers select $1, id, 'Nucleus' from public.homework_questions where resource_id = $2",
  [otherSubmission, oldSheet],
);

// 2. The migration, twice: it must be safe to re-run.
const up = await migration("20261001120000_library_content_has_no_owner.sql");
await db.exec(up);
await db.exec(up);

// 3. Library rows already saved belong to nobody; a tutor's own rows keep their author.
assert.equal(
  await ownerOf("resources", oldSheet),
  null,
  "an existing library sheet keeps an owner",
);
assert.equal(await ownerOf("mcq_sets", oldQuiz), null, "an existing library quiz keeps an owner");
assert.equal(await ownerOf("resources", tutorSheet), tutor, "a tutor's brief lost its author");
const tutorQuizOwners = await db.query<{ created_by: string }>(
  "select created_by from public.mcq_sets where origin = 'tutor'",
);
assert.deepEqual(
  tutorQuizOwners.rows.map((r) => r.created_by),
  [tutor],
  "a tutor's quiz lost its author",
);

// 4. New library rows record nobody — whether or not the server still names the asker.
assert.equal(await ownerOf("resources", await writeSheet(pointB, firstStudent)), null);
assert.equal(await ownerOf("resources", await writeSheet(pointC, null)), null);
assert.equal(await ownerOf("mcq_sets", await writeQuiz(pointB, firstStudent)), null);
assert.equal(await ownerOf("mcq_sets", await writeQuiz(pointC, null)), null);
const omitted = await asServer<{ id: string }>(
  "select public.ensure_generated_homework(_spec_point_id => $1, _title => 'Sheet', _subject => 'biology', _level => 'gcse', _questions => $2::jsonb) as id",
  [pointD, sheetQuestions],
);
assert.equal(await ownerOf("resources", omitted[0].id), null, "the owner argument is optional");
const omittedQuiz = await asServer<{ id: string }>(
  "select public.ensure_generated_mcq_set(_spec_point_id => $1, _questions => $2::jsonb) as id",
  [pointD, quizQuestions],
);
assert.equal(await ownerOf("mcq_sets", omittedQuiz[0].id), null);

// 5. Deleting the student who asked first takes nobody else's work with it.
await db.query("delete from auth.users where id = $1", [firstStudent]);
const left = (
  await db.query<{ sheets: number; questions: number; submissions: number; answers: number }>(
    `select (select count(*) from public.resources where id = $1)::int as sheets,
            (select count(*) from public.homework_questions where resource_id = $1)::int as questions,
            (select count(*) from public.homework_submissions where id = $2)::int as submissions,
            (select count(*) from public.homework_answers where submission_id = $2)::int as answers`,
    [oldSheet, otherSubmission],
  )
).rows[0];
assert.deepEqual(left, { sheets: 1, questions: 1, submissions: 1, answers: 1 });

// 6. Deleting a tutor keeps their brief, with the author blanked.
await db.query("delete from auth.users where id = $1", [tutor]);
assert.equal(await ownerOf("resources", tutorSheet), null);

// 7. The constraint is SET NULL, under a known name, and there is only one.
const fks = await db.query<{ conname: string; confdeltype: string }>(
  `select c.conname, c.confdeltype
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.resources'::regclass and c.contype = 'f' and a.attname = 'created_by'`,
);
assert.deepEqual(fks.rows, [{ conname: "resources_created_by_fkey", confdeltype: "n" }]);

// 8. Still the server's alone: a signed-in browser may not call either writer.
await db.exec("set role authenticated");
await assert.rejects(
  db.query("select public.ensure_generated_homework($1, 'x', 'biology', 'gcse', $2::jsonb)", [
    uuid(104),
    sheetQuestions,
  ]),
  /permission denied/,
);
await assert.rejects(
  db.query("select public.ensure_generated_mcq_set($1, $2::jsonb)", [uuid(104), quizQuestions]),
  /permission denied/,
);
await db.exec("reset role");

// 9. The rollback runs, and puts back exactly what it says it does.
await db.exec(
  await readFile(
    new URL(
      "../supabase/rollbacks/20261001120000_library_content_has_no_owner.down.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const restored = await db.query<{ confdeltype: string }>(
  "select confdeltype from pg_constraint where conname = 'resources_created_by_fkey'",
);
assert.deepEqual(restored.rows, [{ confdeltype: "c" }]);
await assert.rejects(writeSheet(uuid(104), null), /needs the user it was made for/);
await assert.rejects(writeQuiz(uuid(104), null), /needs the user it was made for/);

console.log("library_content_has_no_owner migration: all checks passed");
