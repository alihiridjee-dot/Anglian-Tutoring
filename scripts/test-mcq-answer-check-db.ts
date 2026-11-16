/** Isolated PostgreSQL checks for the answer check (20261116190000_mcq_answer_check),
 * applied after the figure migrations it builds on, and its rollback.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-mcq-answer-check-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const sql = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");

// The tables the quiz writers touch, with production's column grants.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('aqa','edexcel','ocr');
create type level as enum ('gcse','alevel','igcse');
create table topics(id uuid primary key default gen_random_uuid(), subject subject, board board, level level);
create table spec_points(id uuid primary key default gen_random_uuid(), topic_id uuid references topics, code text, title text);
create table mcq_sets(id uuid primary key default gen_random_uuid(), spec_point_id uuid, title text, description text,
  published boolean, subject subject, created_by uuid, origin text, updated_at timestamptz default now());
create unique index on mcq_sets(spec_point_id) where origin = 'generated' and spec_point_id is not null;
create table mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid, position integer, question text,
  options jsonb, correct_index integer, explanation text, created_at timestamptz default now(), spec_point_id uuid);
create table resources(id uuid primary key default gen_random_uuid(), kind text, title text, subject subject, board board,
  level level, spec_point_id uuid, created_by uuid, origin text, review_status text, publish_at timestamptz);
create unique index on resources(spec_point_id) where kind = 'homework' and spec_point_id is not null;
create table homework_questions(id uuid primary key default gen_random_uuid(), resource_id uuid, position integer, prompt text,
  marks integer, answer_type text, image_path text, image_name text, mark_scheme text, spec_point_id uuid,
  created_at timestamptz default now());
create table resource_spec_points(resource_id uuid, spec_point_id uuid, primary key (resource_id, spec_point_id));
create table exam_generation_runs(id uuid primary key default gen_random_uuid(),
  spec_point_id uuid references spec_points(id) on delete set null,
  framework_version text not null default 'v', model text not null default 'm',
  format text not null check (format in ('written', 'mcq')),
  grounding text not null default 'g', exemplar_ids uuid[] not null default '{}',
  generated_questions jsonb, usage jsonb, created_at timestamptz not null default now(),
  outcome text not null default 'passed' check (outcome in ('passed','saved','discarded','failed')),
  error text, source text not null default 'queue', job_id bigint, api_status integer);
grant usage on schema public to authenticated;
grant select (id, set_id, position, question, options, created_at, spec_point_id) on mcq_questions to authenticated;
`);
await db.exec(await sql("migrations/20261017145754_question_figures.sql"));
await db.exec(await sql("migrations/20261029123927_option_figures.sql"));
await db.exec(await sql("migrations/20261116190000_mcq_answer_check.sql"));

const topic = (
  await db.query<{ id: string }>(
    "insert into topics(subject,board,level) values('chemistry','edexcel','gcse') returning id",
  )
).rows[0].id;
const point = async (code: string) =>
  (
    await db.query<{ id: string }>(
      "insert into spec_points(topic_id,code,title) values($1,$2,'Redox') returning id",
      [topic, code],
    )
  ).rows[0].id;
/** A model call's row: a blind solve that passed, unless told otherwise. */
const run = async (pointId: string | null, over: Record<string, unknown> = {}) => {
  const row = { format: "mcq_check", outcome: "passed", error: null, job_id: 1, ...over };
  return (
    await db.query<{ id: string }>(
      `insert into exam_generation_runs(spec_point_id, format, outcome, error, job_id, usage)
       values($1, $2, $3, $4, $5, '{}') returning id`,
      [pointId, row.format, row.outcome, row.error, row.job_id],
    )
  ).rows[0].id;
};
const mcq = (n: number, checkedBy?: string) => ({
  question: `Question ${n}?`,
  options: ["A", "B", "C", "D"],
  correct_index: 2,
  explanation: "Because.",
  ...(checkedBy ? { checked_run_id: checkedBy } : {}),
});
const save = (pointId: string, questions: object[]) =>
  db.query<{ id: string }>("select private.save_generated_quiz($1, $2) as id", [
    pointId,
    JSON.stringify(questions),
  ]);
const questionsOf = async (setId: string) =>
  (
    await db.query<{ question: string; checked_run_id: string | null }>(
      "select question, checked_run_id from mcq_questions where set_id = $1 order by position",
      [setId],
    )
  ).rows;

// ── A blind solve is a kind of run; nothing else new is ──
const p1 = await point("3.3");
const check = await run(p1);
await assert.rejects(run(p1, { format: "mcq_guess" }), /exam_generation_runs_format_check/);

// ── The quiz writer saves each question with the run that confirmed it ──
const set1 = (await save(p1, [mcq(1, check), mcq(2, check)])).rows[0].id;
assert.deepEqual(await questionsOf(set1), [
  { question: "Question 1?", checked_run_id: check },
  { question: "Question 2?", checked_run_id: check },
]);

// ── Without a check it is refused, naming the question, and nothing is saved ──
const p2 = await point("3.4");
const check2 = await run(p2);
await assert.rejects(save(p2, [mcq(1, check2), mcq(2)]), /Question 2 has no answer check/);
assert.equal(
  (await db.query("select 1 from mcq_sets where spec_point_id = $1", [p2])).rows.length,
  0,
);

// ── A check that isn't one is refused by the table itself ──
const refused = /A generated question needs an answer check that passed for its spec point/;
for (const [why, id] of [
  ["a run that doesn't exist", crypto.randomUUID()],
  ["the writer's own run", await run(p2, { format: "mcq" })],
  ["a blind solve that failed", await run(p2, { outcome: "failed", error: "cut off" })],
  ["another point's blind solve", check],
] as const)
  await assert.rejects(save(p2, [mcq(1, id)]), refused, why);
assert.ok((await save(p2, [mcq(1, check2)])).rows[0].id, "and with its own check it is saved");

// ── The lock is on the table: a script that skips the writer is refused too ──
await assert.rejects(
  db.query(
    "insert into mcq_questions(set_id, position, question, options, correct_index, spec_point_id) values($1, 9, 'Unchecked?', '[]', 0, $2)",
    [set1, p1],
  ),
  refused,
);
await db.query(
  "insert into mcq_questions(set_id, position, question, options, correct_index, spec_point_id, checked_run_id) values($1, 9, 'Checked?', '[]', 0, $2, $3)",
  [set1, p1, check],
);

// ── A tutor's own quiz needs none; nor does a tutor writing into a generated one by hand ──
const own = (
  await db.query<{ id: string }>(
    "insert into mcq_sets(spec_point_id, title, published, origin) values($1, 'Mine', true, 'tutor') returning id",
    [p1],
  )
).rows[0].id;
await db.query(
  "insert into mcq_questions(set_id, position, question, options, correct_index) values($1, 0, 'By hand?', '[]', 0)",
  [own],
);
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [crypto.randomUUID()]);
await db.query(
  "insert into mcq_questions(set_id, position, question, options, correct_index, spec_point_id) values($1, 10, 'A tutor''s own?', '[]', 0, $2)",
  [set1, p1],
);
await db.query("select set_config('request.jwt.claim.sub', '', false)");

// ── Mending a saved question is an edit, and isn't looked at ──
await db.query("update mcq_questions set correct_index = 1 where set_id = $1 and position = 0", [
  set1,
]);

// ── "Replace questions" carries the checks too, and a refusal leaves the quiz as it was ──
const replace = (setId: string, questions: object[]) =>
  db.query<{ n: number }>("select public.replace_generated_mcq_questions($1, $2) as n", [
    setId,
    JSON.stringify(questions),
  ]);
const before = await questionsOf(set1);
await assert.rejects(replace(set1, [mcq(11, check), mcq(12)]), /A question has no answer check/);
await assert.rejects(replace(set1, [mcq(11, check), mcq(12, check2)]), refused);
assert.deepEqual(await questionsOf(set1), before);
const recheck = await run(p1, { job_id: null });
assert.equal((await replace(set1, [mcq(11, recheck), mcq(12, recheck)])).rows[0].n, 2);
assert.deepEqual(await questionsOf(set1), [
  { question: "Question 11?", checked_run_id: recheck },
  { question: "Question 12?", checked_run_id: recheck },
]);

// ── The daily cap counts what the queue writes, not the blind solves ──
const calls = async () =>
  (await db.query<{ n: number }>("select private.practice_calls_24h() as n")).rows[0].n;
const counted = await calls();
await run(p1, { format: "mcq" });
assert.equal(await calls(), counted + 1);
await run(p1);
await run(p1, { outcome: "failed", error: "cut off" });
assert.equal(await calls(), counted + 1);

// ── Students never read which run checked a question ──
await db.exec("set role authenticated");
assert.ok((await db.query("select question from mcq_questions")).rows.length > 0);
await assert.rejects(db.query("select checked_run_id from mcq_questions"), /permission denied/);
await db.exec("reset role");

// ── A run that goes takes only its mark with it ──
await db.query("delete from exam_generation_runs where id = $1", [recheck]);
assert.deepEqual(
  (await questionsOf(set1)).map((q) => q.checked_run_id),
  [null, null],
);

// ── The rollback: unchecked quizzes save again, and the blind solves are gone ──
await db.exec(await sql("rollbacks/20261116190000_mcq_answer_check.down.sql"));
const cols = await db.query(
  "select column_name from information_schema.columns where table_name = 'mcq_questions' and column_name = 'checked_run_id'",
);
assert.equal(cols.rows.length, 0);
assert.ok((await save(await point("3.5"), [mcq(1)])).rows[0].id);
assert.equal((await replace(set1, [mcq(21)])).rows[0].n, 1);
assert.equal(
  (await db.query("select 1 from exam_generation_runs where format = 'mcq_check'")).rows.length,
  0,
);
await assert.rejects(run(p1), /exam_generation_runs_format_check/);
assert.equal(await calls(), counted + 1);

console.log("answer check: all checks passed");
