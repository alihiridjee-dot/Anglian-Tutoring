/** Isolated PostgreSQL regression checks for 20261005190000_plan_tick_from_work.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-tick-from-work-db.ts
 *
 * The weekly task list's tick is set by the database from quiz attempts and
 * task hand-ins; a student's own tick only stands on a point with no practice.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const plan = uuid(2);
const lastWeek = uuid(3);
const quizOnly = uuid(10); // a published quiz on the point
const taskOnly = uuid(11); // an approved task linked through resource_spec_points
const both = uuid(12); // a quiz (by a tagged question) and a task (directly)
const bare = uuid(13); // nothing attached
const draftOnly = uuid(14); // an unpublished quiz and a rejected task only
const quiz = uuid(20);
const mixedQuiz = uuid(21);
const draftQuiz = uuid(22);
const task = uuid(30);
const bothTask = uuid(31);
const rejectedTask = uuid(32);

// Monday of this week in London, as the app keys weeks.
const monday = (
  await db.query<{ d: string }>(
    "select (date_trunc('week', now() at time zone 'Europe/London'))::date::text d",
  )
).rows[0].d;

// Only what the migration touches, shaped as production has them.
await db.exec(`
create role authenticated; create role anon;
create schema private;
create table public.student_weekly_plans(id uuid primary key, student_id uuid, week_start date);
create table public.student_weekly_plan_points(plan_id uuid references public.student_weekly_plans,
  spec_point_id uuid, done_at timestamptz, primary key (plan_id, spec_point_id));
create table public.mcq_sets(id uuid primary key, published boolean, spec_point_id uuid);
create table public.mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid, spec_point_id uuid);
create table public.mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid, user_id uuid,
  created_at timestamptz default now(), point_scores jsonb);
create table public.resources(id uuid primary key, kind text, review_status text, publish_at timestamptz, spec_point_id uuid);
create table public.resource_spec_points(resource_id uuid, spec_point_id uuid);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid,
  student_id uuid, submitted_at timestamptz default now());

insert into public.student_weekly_plans values ('${plan}', '${student}', '${monday}'),
  ('${lastWeek}', '${student}', date '${monday}' - 7);
insert into public.mcq_sets values ('${quiz}', true, '${quizOnly}'), ('${mixedQuiz}', true, null),
  ('${draftQuiz}', false, '${draftOnly}');
insert into public.mcq_questions(set_id, spec_point_id) values ('${mixedQuiz}', '${both}');
insert into public.resources values ('${task}', 'homework', 'approved', null, null),
  ('${bothTask}', 'homework', 'to_review', now() - interval '1 day', '${both}'),
  ('${rejectedTask}', 'homework', 'rejected', null, '${draftOnly}');
insert into public.resource_spec_points values ('${task}', '${taskOnly}');
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261005190000_plan_tick_from_work.sql", import.meta.url),
  "utf8",
);
const rollback = await readFile(
  new URL("../supabase/rollbacks/20261005190000_plan_tick_from_work.down.sql", import.meta.url),
  "utf8",
);

// Before: hand ticks everywhere, including last week.
await db.exec(`
insert into public.student_weekly_plan_points values
  ('${plan}', '${quizOnly}', now()), ('${plan}', '${taskOnly}', now()), ('${plan}', '${both}', now()),
  ('${plan}', '${bare}', now()), ('${plan}', '${draftOnly}', now()), ('${lastWeek}', '${quizOnly}', null);
`);

// Applied twice to show it is safe to run again.
await db.exec(migration);
await db.exec(migration);

const ticked = async (point: string, planId = plan) =>
  (
    await db.query<{ done_at: string | null }>(
      "select done_at from public.student_weekly_plan_points where plan_id = $1 and spec_point_id = $2",
      [planId, point],
    )
  ).rows[0].done_at !== null;

// Hand ticks on points with practice are gone; the rest stand.
assert.equal(await ticked(quizOnly), false, "A hand tick on a quiz point survived");
assert.equal(await ticked(taskOnly), false, "A hand tick on a task point survived");
assert.equal(await ticked(both), false, "A hand tick on a quiz-and-task point survived");
assert.equal(await ticked(bare), true, "A point with no practice lost its own tick");
assert.equal(await ticked(draftOnly), true, "Unpublished practice counted as practice");

// The student cannot tick a practice point by hand…
await db.exec(`update public.student_weekly_plan_points set done_at = now()
  where plan_id = '${plan}' and spec_point_id = '${quizOnly}'`);
assert.equal(await ticked(quizOnly), false, "A hand tick on a quiz point was accepted");
// …but can still tick and untick a point with none.
await db.exec(`update public.student_weekly_plan_points set done_at = null
  where plan_id = '${plan}' and spec_point_id = '${bare}'`);
assert.equal(await ticked(bare), false, "Unticking a bare point was refused");

// A quiz attempt ticks its point, this week only.
await db.exec(`insert into public.mcq_attempts(set_id, user_id) values ('${quiz}', '${student}')`);
assert.equal(await ticked(quizOnly), true, "A quiz attempt did not tick its point");
assert.equal(await ticked(quizOnly, lastWeek), false, "This week's attempt ticked last week");
const first = (
  await db.query<{ done_at: string }>(
    `select done_at::text from public.student_weekly_plan_points where plan_id = '${plan}' and spec_point_id = '${quizOnly}'`,
  )
).rows[0].done_at;
await db.exec(`update public.student_weekly_plan_points set done_at = null
  where plan_id = '${plan}' and spec_point_id = '${quizOnly}'`);
assert.equal(await ticked(quizOnly), true, "An earned tick could be removed by hand");
const again = (
  await db.query<{ done_at: string }>(
    `select done_at::text from public.student_weekly_plan_points where plan_id = '${plan}' and spec_point_id = '${quizOnly}'`,
  )
).rows[0].done_at;
assert.equal(again, first, "A refresh moved the date the tick was earned");

// A hand-in ticks a point linked through resource_spec_points.
await db.exec(
  `insert into public.homework_submissions(resource_id, student_id) values ('${task}', '${student}')`,
);
assert.equal(await ticked(taskOnly), true, "A hand-in did not tick its point");

// A point with both needs both.
await db.exec(
  `insert into public.homework_submissions(resource_id, student_id) values ('${bothTask}', '${student}')`,
);
assert.equal(await ticked(both), false, "The task alone ticked a quiz-and-task point");
await db.exec(
  `insert into public.mcq_attempts(set_id, user_id) values ('${mixedQuiz}', '${student}')`,
);
assert.equal(await ticked(both), true, "Quiz and task together did not tick the point");

// Another student's work ticks nothing here.
await db.exec(
  `update public.student_weekly_plan_points set done_at = null where plan_id = '${plan}' and spec_point_id = '${draftOnly}'`,
);
await db.exec(
  `insert into public.mcq_attempts(set_id, user_id) values ('${draftQuiz}', '${uuid(99)}')`,
);
assert.equal(await ticked(draftOnly), false, "Another student's attempt ticked this plan");

// A point added to the plan after the work was done arrives ticked.
await db.exec(
  `delete from public.student_weekly_plan_points where plan_id = '${plan}' and spec_point_id = '${taskOnly}'`,
);
await db.exec(
  `insert into public.student_weekly_plan_points(plan_id, spec_point_id) values ('${plan}', '${taskOnly}')`,
);
assert.equal(await ticked(taskOnly), true, "A point re-added after its hand-in arrived unticked");

// Rollback: hand ticking works again and the old ticks are back.
await db.exec(rollback);
assert.equal(await ticked(both), true, "The rollback did not restore a hand tick");
await db.exec(`update public.student_weekly_plan_points set done_at = now()
  where plan_id = '${plan}' and spec_point_id = '${quizOnly}'`);
assert.equal(await ticked(quizOnly), true, "Hand ticking did not come back after the rollback");

console.log("plan_tick_from_work: all checks passed");
