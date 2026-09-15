/** Run with PGLITE_PATH pointing to a temporary @electric-sql/pglite installation.
 * Uses real planner SQL in an isolated Postgres instance; no remote student data. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics } from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/week";
const { PGlite } = await import(process.env.PGLITE_PATH ?? "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type subject as enum ('biology'); create type board as enum ('aqa'); create type level as enum ('gcse');
create type plan_source as enum ('ai'); create type plan_point_origin as enum ('core','focus','student','tutor','ai','carried_over');
create table profiles(id uuid primary key, level level);
create table student_enrolments(student_id uuid, subject subject, board board);
create table topics(id uuid primary key, subject subject, board board, level level);
create table spec_points(id uuid primary key, topic_id uuid references topics);
create table student_program_plan(student_id uuid, subject subject, program_start date, exam_date date, pacing jsonb, acknowledged_at timestamptz default now(), updated_at timestamptz default now(), primary key(student_id,subject));
create table student_weekly_plans(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board, level level, week_start date, source plan_source, ai_rationale text, updated_at timestamptz default now(), unique(student_id,subject,week_start));
create table student_weekly_plan_points(plan_id uuid references student_weekly_plans, spec_point_id uuid references spec_points, origin plan_point_origin, carried_from date, done_at timestamptz, primary key(plan_id,spec_point_id));
create table resources(id uuid primary key, kind text, spec_point_id uuid);
create table resource_spec_points(resource_id uuid, spec_point_id uuid);
create table homework_submissions(student_id uuid, resource_id uuid, submitted_at timestamptz);
create table mcq_attempts(user_id uuid, created_at timestamptz, point_scores jsonb, set_id uuid);
create table mcq_sets(id uuid, spec_point_id uuid);
create table mcq_questions(set_id uuid, spec_point_id uuid);
`);
const saveSql = (
  await readFile(
    new URL(
      "../supabase/migrations/20260907140000_preserve_inadmissible_history.sql",
      import.meta.url,
    ),
    "utf8",
  )
).split("create or replace function public.assessment_scheduler_version")[0];
await db.exec(saveSql);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260915120000_student_topic_order.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  "create trigger plan_point_admissible before insert or update of spec_point_id, origin, plan_id on student_weekly_plan_points for each row execute function enforce_plan_point_admissible()",
);
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const other = uuid(2);
const today = currentWeekKey();
const week = (n: number) => toDateKey(addWeeks(weekKeyToDate(today), n));
const topics = [10, 20, 30].map((n) => ({
  topicId: uuid(n),
  title: `Topic ${n}`,
  points: Array.from({ length: 7 }, (_, i) => ({
    specPointId: uuid(n * 10 + i),
    code: `${n}.${i}`,
    title: `Point ${i}`,
    weight: 1,
  })),
}));
for (const t of topics) {
  await db.query("insert into topics values ($1,'biology','aqa','gcse')", [t.topicId]);
  for (const p of t.points)
    await db.query("insert into spec_points values($1,$2)", [p.specPointId, t.topicId]);
}
const baseline = computePacing(
  topics.map((t) => ({ ...t, weight: 7 })),
  weekKeyToDate(week(-2)),
  weekKeyToDate(week(10)),
);
const preview = reorderTopics({
  bands: baseline,
  topics,
  from: today,
  examDate: week(10),
  order: orderInputs(baseline, topics, today)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
for (const id of [student, other]) {
  await db.query("insert into profiles values($1,'gcse')", [id]);
  await db.query("insert into student_enrolments values($1,'biology','aqa')", [id]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [id, week(-2), week(10), JSON.stringify(baseline)],
  );
}
const currentPlan = uuid(50);
const oldPlan = uuid(51);
const futurePlan = uuid(52);
const earlyPlan = uuid(53);
for (const [id, w] of [
  [currentPlan, today],
  [oldPlan, week(-1)],
  [futurePlan, week(5)],
  [earlyPlan, week(2)],
])
  await db.query(
    "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source) values($1,$2,'biology','aqa','gcse',$3,'ai')",
    [id, student, w],
  );
const a = topics[0].points.map((p) => p.specPointId);
for (let i = 0; i < a.length; i++)
  await db.query("insert into student_weekly_plan_points values($1,$2,$3,$4,$5)", [
    currentPlan,
    a[i],
    i === 3 ? "student" : i === 4 ? "tutor" : i === 6 ? "focus" : "core",
    i === 1 ? week(-1) : null,
    i === 0 ? new Date().toISOString() : null,
  ]);
await db.query("insert into mcq_attempts values($1,$2,$3,null)", [
  student,
  `${today}T12:00:00Z`,
  JSON.stringify({ [a[2]]: 50 }),
]);
await db.query("insert into student_weekly_plan_points values($1,$2,'core',null,null)", [
  oldPlan,
  a[5],
]);
await db.query("insert into student_weekly_plan_points values($1,$2,'core',null,null)", [
  futurePlan,
  topics[1].points[6].specPointId,
]);
await db.query("insert into student_weekly_plan_points values($1,$2,'focus',null,null)", [
  futurePlan,
  topics[1].points[5].specPointId,
]);
await db.query("insert into student_weekly_plan_points values($1,$2,'focus',null,null)", [
  futurePlan,
  a[6],
]);
await db.query("insert into student_weekly_plan_points values($1,$2,'core',null,null)", [
  earlyPlan,
  topics[1].points[4].specPointId,
]);
await db.query("insert into mcq_attempts values($1,$2,$3,null)", [
  student,
  `${today}T12:00:00Z`,
  JSON.stringify({ [topics[1].points[4].specPointId]: 50 }),
]);
await db.exec(`grant usage on schema public,auth to authenticated; grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());
 set role authenticated;`);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [student]);
const call = (expected = baseline, pacing = preview, effective = today) =>
  db.query("select reorder_student_topics('biology','aqa','gcse',$1,$2,$3,$4,$5,$6)", [
    effective,
    JSON.stringify(expected),
    week(10),
    JSON.stringify(pacing),
    [a[6], topics[1].points[5].specPointId],
    JSON.stringify([{ startWeek: week(5), points: [topics[1].points[5]] }]),
  ]);
const state = async () =>
  (await db.query("select pacing from student_program_plan where student_id=$1", [student])).rows[0]
    .pacing;
const old = (await db.query("select * from student_weekly_plan_points where plan_id=$1", [oldPlan]))
  .rows;
await call();
const savedPreview = preview.map((b) =>
  b.topicId === topics[1].topicId && b.startWeek > week(2) ? { ...b, openedWeek: week(2) } : b,
);
assert.deepEqual(await state(), JSON.parse(JSON.stringify(savedPreview)));
assert(
  (
    await db.query(
      "select * from student_weekly_plan_points where plan_id=$1 and spec_point_id=$2",
      [earlyPlan, topics[1].points[4].specPointId],
    )
  ).rows.length === 1,
  "Lost work started ahead of its assigned week",
);
assert.deepEqual(
  (await db.query("select * from student_weekly_plan_points where plan_id=$1", [oldPlan])).rows,
  old,
);
const kept = (
  await db.query("select * from student_weekly_plan_points where plan_id=$1", [currentPlan])
).rows;
for (const id of [a[0], a[1], a[2], a[3], a[4], a[6]])
  assert(
    kept.some((p: any) => p.spec_point_id === id),
    `Lost protected ${id}`,
  );
assert(!kept.some((p: any) => p.spec_point_id === a[5]), "Unstarted moved work remained");
assert(
  kept.some((p: any) => topics[2].points.some((c) => c.specPointId === p.spec_point_id)),
  "New teaching missing",
);
assert(kept.find((p: any) => p.spec_point_id === a[0]).done_at, "Completion reset");
assert(kept.find((p: any) => p.spec_point_id === a[1]).carried_from, "Carry marker reset");
const futureRows = (
  await db.query("select * from student_weekly_plan_points where plan_id=$1", [futurePlan])
).rows;
assert(
  futureRows.some(
    (p: any) => p.spec_point_id === topics[1].points[5].specPointId && p.origin === "focus",
  ),
  "Updated future review missing",
);
assert(
  !futureRows.some((p: any) => p.spec_point_id === a[6]),
  "Old future review duplicated the current assignment",
);
await assert.rejects(call(), /another window/);
assert.deepEqual(await state(), JSON.parse(JSON.stringify(savedPreview)));
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
await assert.rejects(call(savedPreview), /another window/);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [student]);
// A future boundary must not re-cut this week's saved assignment.
await db.exec("begin");
const later = week(2);
const laterPreview = reorderTopics({
  bands: savedPreview,
  topics,
  from: later,
  examDate: week(10),
  order: orderInputs(savedPreview, topics, later)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
await call(savedPreview, laterPreview, later);
assert.deepEqual(
  (await db.query("select * from student_weekly_plan_points where plan_id=$1", [currentPlan])).rows,
  kept,
);
await db.exec("rollback");
// Simulate an insertion failure after the timetable update; the entire RPC rolls back.
await db.exec(`reset role; create function fail_write() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$;
create trigger fixture_failure before insert on student_weekly_plan_points for each row execute function fail_write(); set role authenticated;`);
const reversed = reorderTopics({
  bands: savedPreview,
  topics,
  from: today,
  examDate: week(10),
  order: orderInputs(savedPreview, topics, today)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
await assert.rejects(call(savedPreview, reversed), /fixture failure/);
assert.deepEqual(await state(), JSON.parse(JSON.stringify(savedPreview)));
assert.deepEqual(
  (await db.query("select * from student_weekly_plan_points where plan_id=$1", [currentPlan])).rows,
  kept,
);
await db.close();
console.log(
  "PASS: atomic save, previous weeks, completed/carried/attempted/manual work, assessed review, new teaching, future saved weeks, stale preview, student isolation, rollback.",
);
