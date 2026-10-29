/** Isolated PostgreSQL checks for answer pictures (20261029123927_option_figures),
 * applied after the question figures migration it builds on, and its rollback.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-option-figures-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const sql = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");

// The tables the quiz writer touches, with production's column grants.
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
`);
await db.exec(await sql("migrations/20261017145754_question_figures.sql"));
await db.exec(await sql("migrations/20261029123927_option_figures.sql"));

const topic = (
  await db.query<{ id: string }>(
    "insert into topics(subject,board,level) values('chemistry','aqa','gcse') returning id",
  )
).rows[0].id;
const point = async (code: string) =>
  (
    await db.query<{ id: string }>(
      "insert into spec_points(topic_id,code,title) values($1,$2,'Elements and compounds') returning id",
      [topic, code],
    )
  ).rows[0].id;
const picture = (n: number) => ({
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220" class="qf" role="img"></svg>',
  alt: `Box ${n} of particles.`,
});
const pictures = [1, 2, 3, 4].map(picture);
const briefs = [1, 2, 3, 4].map((n) => ({
  brief: { kind: "particle-diagram", n },
  drawn_by: "code",
}));
const mcq = (n: number, extra: object = {}) => ({
  question: `Question ${n}?`,
  options: ["A", "B", "C", "D"],
  correct_index: 2,
  explanation: "Because.",
  ...extra,
});

// ── The quiz writer saves a question's answer pictures, and nothing with the others ──
const setId = (
  await db.query<{ id: string }>("select private.save_generated_quiz($1, $2) as id", [
    await point("5.1.1"),
    JSON.stringify([mcq(1, { option_figures: pictures, option_figure_briefs: briefs }), mcq(2)]),
  ])
).rows[0].id;
const quiz = await db.query(
  "select option_figures, option_figure_briefs from mcq_questions where set_id = $1 order by position",
  [setId],
);
assert.deepEqual(quiz.rows, [
  { option_figures: pictures, option_figure_briefs: briefs },
  { option_figures: null, option_figure_briefs: null },
]);

// ── Three pictures, or one without its description, is refused, naming the question ──
await assert.rejects(
  db.query("select private.save_generated_quiz($1, $2)", [
    await point("5.1.2"),
    JSON.stringify([mcq(1), mcq(2, { option_figures: pictures.slice(0, 3) })]),
  ]),
  /Question 2's answer pictures need four drawings, each with its description/,
);
await assert.rejects(
  db.query("select private.save_generated_quiz($1, $2)", [
    await point("5.1.3"),
    JSON.stringify([mcq(1, { option_figures: [...pictures.slice(0, 3), { svg: "<svg/>" }] })]),
  ]),
  /Question 1's answer pictures need four drawings/,
);
// ...and by the table itself, whoever writes.
await assert.rejects(
  db.query("insert into mcq_questions(question, option_figures) values('Q', $1)", [
    JSON.stringify([...pictures.slice(0, 3), { alt: "No drawing." }]),
  ]),
  /mcq_questions_option_figures_shape/,
);

// ── Students read the answer pictures, never their briefs ──
await db.exec("set role authenticated");
assert.equal((await db.query("select option_figures from mcq_questions")).rows.length, 2);
await assert.rejects(
  db.query("select option_figure_briefs from mcq_questions"),
  /permission denied/,
);
await db.exec("reset role");

// ── The rollback leaves the quiz writer as it was, and the answer pictures gone ──
await db.exec(await sql("rollbacks/20261029123927_option_figures.down.sql"));
const cols = await db.query(
  "select column_name from information_schema.columns where table_name = 'mcq_questions' and column_name like 'option_figure%'",
);
assert.equal(cols.rows.length, 0);
const after = (
  await db.query<{ id: string }>("select private.save_generated_quiz($1, $2) as id", [
    await point("5.1.4"),
    JSON.stringify([mcq(1, { figure: picture(9), figure_brief: briefs[0] })]),
  ])
).rows[0].id;
assert.ok(after, "the rolled-back writer still saves a quiz with a figure");

console.log("answer pictures: all checks passed");
