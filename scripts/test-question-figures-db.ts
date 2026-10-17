/** Isolated PostgreSQL checks for question figures (20261017170000_question_figures).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-question-figures-db.ts
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

// The tables the two writers touch, with production's column grants: students
// read questions column by column, never the answer key, explanation or scheme.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema private;
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('aqa','edexcel','ocr');
create type level as enum ('gcse','alevel','igcse');
create table topics(id uuid primary key default gen_random_uuid(), subject subject, board board, level level);
create table spec_points(id uuid primary key default gen_random_uuid(), topic_id uuid references topics, code text, title text);
create table mcq_sets(id uuid primary key default gen_random_uuid(), spec_point_id uuid, title text, description text,
  published boolean, subject subject, created_by uuid, origin text);
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
grant usage on schema public to authenticated;
grant select (id, set_id, position, question, options, created_at, spec_point_id) on mcq_questions to authenticated;
grant select (id, resource_id, position, prompt, marks, answer_type, image_path, image_name, spec_point_id, created_at)
  on homework_questions to authenticated;
`);
const file = (await readdir(new URL("../supabase/migrations/", import.meta.url))).find((f) =>
  f.endsWith("_question_figures.sql"),
);
assert.ok(file, "the question figures migration");
await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

const point = (
  await db.query<{ id: string }>(
    "with t as (insert into topics(subject,board,level) values('physics','aqa','gcse') returning id) insert into spec_points(topic_id,code,title) select id,'4.2.1','Circuits' from t returning id",
  )
).rows[0].id;
const figure = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220" class="qf" role="img"></svg>',
  alt: "A series circuit.",
};
const brief = { brief: { kind: "circuit" }, drawn_by: "deepseek" };
const mcq = (n: number, extra: object = {}) => ({
  question: `Question ${n}?`,
  options: ["A", "B", "C", "D"],
  correct_index: 1,
  explanation: "Because.",
  ...extra,
});

// ── The quiz writer saves a figure with its question, and nothing with the others ──
const setId = (
  await db.query<{ id: string }>("select private.save_generated_quiz($1, $2) as id", [
    point,
    JSON.stringify([mcq(1, { figure, figure_brief: brief }), mcq(2), mcq(3, { figure: null })]),
  ])
).rows[0].id;
const quiz = await db.query<{ position: number; figure: unknown; figure_brief: unknown }>(
  "select position, figure, figure_brief from mcq_questions where set_id = $1 order by position",
  [setId],
);
assert.deepEqual(quiz.rows, [
  { position: 0, figure, figure_brief: brief },
  { position: 1, figure: null, figure_brief: null },
  { position: 2, figure: null, figure_brief: null },
]);

// ── A figure without its drawing or description is refused, naming the question ──
const other = (
  await db.query<{ id: string }>(
    "insert into spec_points(topic_id,code,title) select topic_id,'4.2.2','Series and parallel' from spec_points limit 1 returning id",
  )
).rows[0].id;
await assert.rejects(
  db.query("select private.save_generated_quiz($1, $2)", [
    other,
    JSON.stringify([mcq(1), mcq(2, { figure: { svg: "<svg/>" } })]),
  ]),
  /Question 2's figure needs its drawing and its description/,
);
// ...and by the table itself, whoever writes.
await assert.rejects(
  db.query("insert into mcq_questions(question, figure) values('Q', $1)", [
    JSON.stringify({ alt: "No drawing." }),
  ]),
  /mcq_questions_figure_shape/,
);

// ── The task writer, likewise ──
const resourceId = (
  await db.query<{ id: string }>("select private.save_generated_task($1, $2) as id", [
    other,
    JSON.stringify([
      {
        prompt: "Explain.",
        marks: 2,
        answer_type: "short",
        mark_scheme: "- A point (1)",
        figure,
        figure_brief: brief,
      },
      { prompt: "Describe.", marks: 3, answer_type: "long", mark_scheme: "- Another (1)" },
    ]),
  ])
).rows[0].id;
const task = await db.query<{ figure: unknown; figure_brief: unknown }>(
  "select figure, figure_brief from homework_questions where resource_id = $1 order by position",
  [resourceId],
);
assert.deepEqual(task.rows, [
  { figure, figure_brief: brief },
  { figure: null, figure_brief: null },
]);

// ── Students read the figure, never its brief ──
await db.exec("set role authenticated");
assert.equal((await db.query("select figure from mcq_questions")).rows.length, 3);
assert.equal((await db.query("select figure from homework_questions")).rows.length, 2);
await assert.rejects(db.query("select figure_brief from mcq_questions"), /permission denied/);
await assert.rejects(db.query("select figure_brief from homework_questions"), /permission denied/);
await db.exec("reset role");

console.log("question figures: all checks passed");
