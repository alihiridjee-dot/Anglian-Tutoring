/** Isolated PostgreSQL regression checks for S-18: deleting a topic, spec
 * point or quiz set that students have touched is refused, with a count, by
 * any route; untouched ones still delete; and a shared quiz's questions can be
 * replaced in place without changing past attempts. No production data is read
 * or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-guard-student-data-deletes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const [ann, ben] = [uuid(2), uuid(3)];

// The tables and cascades S-18 is about, as production defines them
// (pg_constraint and pg_policies, 1 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type mcq_origin as enum ('tutor','generated');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table topics(id uuid primary key, title text);
create table spec_points(id uuid primary key, topic_id uuid not null references topics on delete cascade);
create table mcq_sets(id uuid primary key, spec_point_id uuid references spec_points on delete cascade,
  title text, origin mcq_origin not null default 'generated', updated_at timestamptz);
create table mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid not null references mcq_sets on delete cascade,
  position int, question text, options jsonb, correct_index int, explanation text,
  spec_point_id uuid references spec_points on delete set null);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid not null references mcq_sets on delete cascade,
  user_id uuid, score int, total int, answers jsonb, point_scores jsonb);
create table student_topic_confidence(student_id uuid, topic_id uuid references topics on delete cascade);
create table student_spec_point_confidence(student_id uuid, spec_point_id uuid references spec_points on delete cascade);
create table student_spec_point_schedule(student_id uuid, spec_point_id uuid references spec_points on delete cascade);
create table student_spec_point_reviews(student_id uuid, spec_point_id uuid references spec_points on delete cascade);
create table student_plan_overrides(student_id uuid, spec_point_id uuid references spec_points on delete cascade);
create table student_weekly_plans(id uuid primary key, student_id uuid);
create table student_weekly_plan_points(plan_id uuid references student_weekly_plans on delete cascade,
  spec_point_id uuid references spec_points on delete cascade);
create table weekly_focus_points(spec_point_id uuid references spec_points on delete cascade);
do $$ declare t text; begin
  foreach t in array array['topics','spec_points','mcq_sets','mcq_questions'] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "%s tutors write" on %I for all to authenticated using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role))$p$, t, t);
  end loop;
end $$;
grant usage on schema public, auth, private to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, anon, service_role;
grant execute on function private.has_role(uuid, app_role) to authenticated, anon;
`);
await db.exec(
  await readFile(
    new URL(
      "../supabase/migrations/20261001193000_guard_student_data_deletes.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);

// Two topics, each with a point and its shared quiz.
const [busyTopic, quietTopic] = [uuid(10), uuid(11)];
const [busyPoint, quietPoint, otherPoint] = [uuid(20), uuid(21), uuid(22)];
const [busySet, quietSet] = [uuid(30), uuid(31)];
await db.exec(`
insert into user_roles values ('${tutor}','tutor');
insert into topics values ('${busyTopic}','Cells'),('${quietTopic}','Ecology');
insert into spec_points values ('${busyPoint}','${busyTopic}'),('${otherPoint}','${busyTopic}'),('${quietPoint}','${quietTopic}');
insert into mcq_sets(id, spec_point_id, title) values ('${busySet}','${busyPoint}','Cells quiz'),('${quietSet}','${quietPoint}','Ecology quiz');
insert into mcq_questions(set_id, position, question, options, correct_index) values
  ('${busySet}',0,'Old Q','["a","b","c","d"]',0),('${quietSet}',0,'Q','["a","b","c","d"]',0);
insert into mcq_attempts(set_id, user_id, score, total, point_scores) values
  ('${busySet}','${ann}',1,1,'{"x":100}'),('${busySet}','${ann}',0,1,'{"x":0}'),('${busySet}','${ben}',1,1,'{"x":100}');
insert into weekly_focus_points values ('${quietPoint}');
`);

await db.exec("set role authenticated");
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [tutor]);
const refused = async (sql: string, expect: RegExp, what: string) => {
  let err: { message?: string } | undefined;
  try {
    await db.exec(sql);
  } catch (e) {
    err = e as { message?: string };
  }
  assert(err, `${what} was allowed`);
  assert.match(err.message ?? "", expect, what);
};
const count = async (sql: string) =>
  Number((await db.query<{ n: number }>(`select (${sql})::int n`)).rows[0].n);

// A quiz students have taken: refused, with the count, and nothing goes.
await refused(
  `delete from mcq_sets where id = '${busySet}'`,
  /Students have taken this quiz \(3 attempts by 2 students\)/,
  "Deleting a taken quiz",
);
assert.equal(await count("select count(*) from mcq_attempts"), 3, "Attempts were lost");

// A topic with taken quizzes: its own message wins over the cascade's.
await refused(
  `delete from topics where id = '${busyTopic}'`,
  /This topic can't be deleted: 2 students have work or planner history on it \(3 quiz attempts\)/,
  "Deleting a topic with attempts",
);

// Planner history alone blocks too: Ann's attempts go (as an account deletion
// would remove them), and her review history on another point still counts.
await db.exec("reset role");
await db.exec(
  `delete from mcq_attempts; insert into student_spec_point_reviews values ('${ann}','${otherPoint}')`,
);
await db.exec("set role authenticated");
await refused(
  `delete from topics where id = '${busyTopic}'`,
  /This topic can't be deleted: 1 student has work or planner history on it\. /,
  "Deleting a topic with a student's reviews",
);
await refused(
  `delete from spec_points where id = '${otherPoint}'`,
  /This spec point can't be deleted: 1 student has/,
  "Deleting a spec point with a student's reviews",
);

// Each kind of planner record counts on its own.
for (const [table, row] of [
  ["student_spec_point_confidence", `'${ben}','${quietPoint}'`],
  ["student_spec_point_schedule", `'${ben}','${quietPoint}'`],
  ["student_plan_overrides", `'${ben}','${quietPoint}'`],
  ["student_topic_confidence", `'${ben}','${quietTopic}'`],
  ["student_weekly_plan_points", `'${uuid(40)}','${quietPoint}'`],
] as const) {
  await db.exec("reset role");
  await db.exec(
    `insert into student_weekly_plans values ('${uuid(40)}','${ben}') on conflict do nothing`,
  );
  await db.exec(`insert into ${table} values (${row})`);
  await db.exec("set role authenticated");
  await refused(
    `delete from topics where id = '${quietTopic}'`,
    /1 student has work or planner history/,
    `Deleting a topic with ${table}`,
  );
  await db.exec("reset role");
  await db.exec(`delete from ${table}`);
  await db.exec("set role authenticated");
}

// Untouched content still deletes, cascades and all; a quiz nobody took too.
await db.exec(`delete from topics where id = '${quietTopic}'`);
assert.equal(await count(`select count(*) from mcq_sets where id = '${quietSet}'`), 0);
assert.equal(await count("select count(*) from weekly_focus_points"), 0);

// Replace questions: same set, new questions, past attempts untouched. Only the
// app server's credential may call it.
await db.exec("reset role");
await db.exec(`insert into mcq_attempts(set_id, user_id, score, total, point_scores)
  values ('${busySet}','${ben}',1,1,'{"x":100}')`);
const before = JSON.stringify(
  (await db.query("select score, total, point_scores from mcq_attempts")).rows,
);
const newQs = JSON.stringify([
  { question: "New Q1", options: ["a", "b", "c", "d"], correct_index: 2, explanation: "e" },
  { question: "New Q2", options: ["a", "b", "c", "d"], correct_index: 1 },
]);
await db.exec("set role authenticated");
await refused(
  `select public.replace_generated_mcq_questions('${busySet}', '${newQs}')`,
  /permission denied/,
  "A browser calling replace_generated_mcq_questions",
);
await db.exec("set role service_role");
const replaced = await db.query<{ n: number }>(
  "select public.replace_generated_mcq_questions($1, $2::jsonb) n",
  [busySet, newQs],
);
assert.equal(replaced.rows[0].n, 2);
const qs = (
  await db.query<{ question: string; position: number; spec_point_id: string }>(
    "select question, position, spec_point_id from mcq_questions where set_id = $1 order by position",
    [busySet],
  )
).rows;
assert.deepEqual(
  qs.map((q) => [q.question, q.position, q.spec_point_id]),
  [
    ["New Q1", 0, busyPoint],
    ["New Q2", 1, busyPoint],
  ],
);
assert.equal(
  JSON.stringify((await db.query("select score, total, point_scores from mcq_attempts")).rows),
  before,
  "Replacing questions changed past attempts",
);

// Bad questions are refused and the old ones stay.
await refused(
  `select public.replace_generated_mcq_questions('${busySet}', '[{"question":"Q","options":["a"],"correct_index":0}]')`,
  /four options/,
  "A question with one option",
);
await refused(
  `select public.replace_generated_mcq_questions('${busySet}', '[]')`,
  /no questions/,
  "An empty replacement",
);
assert.equal(await count(`select count(*) from mcq_questions where set_id = '${busySet}'`), 2);

console.log("guard student data deletes: all checks passed");
