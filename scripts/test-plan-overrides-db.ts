/** Isolated PostgreSQL regression checks for the tutor override migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-overrides-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics } from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const other = uuid(2);
const tutor = uuid(3);
const today = currentWeekKey();
const week = (n: number) => toDateKey(addWeeks(weekKeyToDate(today), n));

// The shape of production the migration touches, with the role helper stubbed.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create type subject as enum ('biology','chemistry'); create type board as enum ('aqa'); create type level as enum ('gcse');
create type plan_source as enum ('ai','student','tutor');
create type plan_point_origin as enum ('ai','student','tutor','carried_over','core','focus');
create table profiles(id uuid primary key, level level);
create table student_enrolments(student_id uuid, subject subject, board board);
create table parent_student_links(parent_id uuid, student_id uuid);
create table topics(id uuid primary key, subject subject, board board, level level);
create table spec_points(id uuid primary key, topic_id uuid references topics);
create table student_program_plan(student_id uuid, subject subject, program_start date, exam_date date, pacing jsonb, acknowledged_at timestamptz default now(), updated_at timestamptz default now(), primary key(student_id,subject));
create table student_weekly_plans(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board, level level, week_start date, source plan_source, ai_rationale text, updated_at timestamptz default now(), unique(student_id,subject,week_start));
create table student_weekly_plan_points(plan_id uuid references student_weekly_plans on delete cascade, spec_point_id uuid references spec_points, origin plan_point_origin, carried_from date, done_at timestamptz, primary key(plan_id,spec_point_id));
create table resources(id uuid primary key, kind text, spec_point_id uuid);
create table resource_spec_points(resource_id uuid, spec_point_id uuid);
create table homework_submissions(student_id uuid, resource_id uuid, submitted_at timestamptz);
create table mcq_attempts(user_id uuid, created_at timestamptz, point_scores jsonb, set_id uuid);
create table mcq_sets(id uuid, spec_point_id uuid);
create table mcq_questions(set_id uuid, spec_point_id uuid);
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260922120000_planner_tutor_overrides.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures ──────────────────────────────────────────────────────────────
for (const id of [student, other, tutor]) await db.query("insert into auth.users values($1)", [id]);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
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
// A chemistry point, to prove the subject check.
await db.query("insert into topics values ($1,'chemistry','aqa','gcse')", [uuid(40)]);
await db.query("insert into spec_points values($1,$2)", [uuid(400), uuid(40)]);

const baseline = computePacing(
  topics.map((t) => ({ ...t, weight: 7 })),
  weekKeyToDate(week(-2)),
  weekKeyToDate(week(10)),
);
for (const id of [student, other]) {
  await db.query("insert into profiles values($1,'gcse')", [id]);
  await db.query("insert into student_enrolments values($1,'biology','aqa')", [id]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [id, week(-2), week(10), JSON.stringify(baseline)],
  );
}
const a = topics[0].points.map((p) => p.specPointId);
const b = topics[1].points.map((p) => p.specPointId);
const currentPlan = uuid(50);
const pastPlan = uuid(51);
const futurePlan = uuid(52);
for (const [id, w] of [
  [currentPlan, today],
  [pastPlan, week(-1)],
  [futurePlan, week(3)],
])
  await db.query(
    "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source) values($1,$2,'biology','aqa','gcse',$3,'ai')",
    [id, student, w],
  );
const insertPoint = (plan: string, point: string, origin: string, done: string | null = null) =>
  db.query("insert into student_weekly_plan_points values($1,$2,$3,null,$4)", [
    plan,
    point,
    origin,
    done,
  ]);
// This week: a[0] automatic (removable), a[1] automatic with work, a[2] pinned,
// a[3] automatic and ticked off, a[4] automatic (to be skipped).
await insertPoint(currentPlan, a[0], "core");
await insertPoint(currentPlan, a[1], "core");
await insertPoint(currentPlan, a[2], "tutor");
await insertPoint(currentPlan, a[3], "core", new Date().toISOString());
await insertPoint(currentPlan, a[4], "core");
await db.query("insert into mcq_attempts values($1,$2,$3,null)", [
  student,
  `${today}T12:00:00Z`,
  JSON.stringify({ [a[1]]: 50 }),
]);
// Last week and a future week both hold a[4]; the future week also pins it.
await insertPoint(pastPlan, a[4], "core");
await insertPoint(futurePlan, a[4], "focus");
await insertPoint(futurePlan, a[5], "tutor");

await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const rows = async (plan: string) =>
  (
    await db.query<{ spec_point_id: string; origin: string }>(
      "select spec_point_id, origin from student_weekly_plan_points where plan_id=$1 order by spec_point_id",
      [plan],
    )
  ).rows;
const overrides = async () =>
  (
    await db.query<{ spec_point_id: string; kind: string; week_start: string | null }>(
      "select spec_point_id, kind, week_start::text from student_plan_overrides where student_id=$1 order by kind, spec_point_id",
      [student],
    )
  ).rows;
const has = (list: { spec_point_id: string }[], id: string) =>
  list.some((r) => r.spec_point_id === id);

// ── 1 · Version ───────────────────────────────────────────────────────────
await as(student);
assert.equal(
  (await db.query<{ v: number }>("select assessment_scheduler_version() v")).rows[0].v,
  5,
);

// ── 2 · Only a tutor may override ─────────────────────────────────────────
await assert.rejects(
  db.query("select remove_plan_point($1,'biology',$2,$3)", [student, a[0], today]),
  /Only a tutor/,
);
await assert.rejects(
  db.query("select skip_plan_point($1,'biology',$2)", [student, a[4]]),
  /Only a tutor/,
);
// The student can read overrides but not write them.
await assert.rejects(
  db.query(
    "insert into student_plan_overrides(student_id,subject,spec_point_id,kind) values($1,'biology',$2,'skip')",
    [student, a[4]],
  ),
  /row-level security|permission denied/,
);

// ── 3 · Remove from this week ─────────────────────────────────────────────
await as(tutor);
await assert.rejects(
  db.query("select remove_plan_point($1,'biology',$2,$3)", [student, a[0], week(-1)]),
  /Past weeks/,
);
await assert.rejects(
  db.query("select remove_plan_point($1,'biology',$2,$3)", [student, uuid(400), today]),
  /not on this subject/,
);
let result = (
  await db.query<{
    r: { removed: boolean; blocked: boolean; reason: string | null; origin: string };
  }>("select remove_plan_point($1,'biology',$2,$3,'Done at school') r", [student, a[0], today])
).rows[0].r;
assert.deepEqual(result, { removed: true, blocked: true, reason: null, origin: "core" });
assert(!has(await rows(currentPlan), a[0]), "Removed point still in the week");
assert.deepEqual(await overrides(), [{ spec_point_id: a[0], kind: "remove", week_start: today }]);

// The student's work outranks the tutor's edit.
result = (
  await db.query<{ r: { removed: boolean; blocked: boolean; reason: string | null } }>(
    "select remove_plan_point($1,'biology',$2,$3) r",
    [student, a[1], today],
  )
).rows[0].r;
assert.equal(result.removed, false);
assert.equal(result.reason, "worked");
assert(has(await rows(currentPlan), a[1]), "Worked point was deleted");
assert.equal((await overrides()).length, 1, "Override written for a worked point");
// So does a tick.
result = (
  await db.query<{ r: { removed: boolean; reason: string | null } }>(
    "select remove_plan_point($1,'biology',$2,$3) r",
    [student, a[3], today],
  )
).rows[0].r;
assert.equal(result.reason, "worked");
assert(has(await rows(currentPlan), a[3]), "Ticked point was deleted");

// Removing a point the week does not hold yet records the decision anyway.
result = (
  await db.query<{ r: { removed: boolean; blocked: boolean } }>(
    "select remove_plan_point($1,'biology',$2,$3) r",
    [student, b[0], week(3)],
  )
).rows[0].r;
assert.deepEqual(result, { removed: false, blocked: true, reason: null, origin: null });

// ── 4 · The trigger drops automatic writes of an overridden point ─────────
await as(student);
await insertPoint(currentPlan, a[0], "core");
assert(!has(await rows(currentPlan), a[0]), "Trigger let an automatic write through");
await insertPoint(currentPlan, a[0], "focus");
assert(!has(await rows(currentPlan), a[0]), "Trigger let a review write through");
// A person's choice is not bound by it.
await insertPoint(currentPlan, a[0], "student");
assert(has(await rows(currentPlan), a[0]), "Trigger blocked a hand-picked write");
// An update that would flip a pin of an overridden point to an automatic lane
// leaves the pin alone.
await db.query(
  "update student_weekly_plan_points set origin='core' where plan_id=$1 and spec_point_id=$2",
  [currentPlan, a[0]],
);
assert.equal(
  (await rows(currentPlan)).find((r) => r.spec_point_id === a[0])?.origin,
  "student",
  "Trigger let a pin be flipped to automatic",
);
await db.query("delete from student_weekly_plan_points where plan_id=$1 and spec_point_id=$2", [
  currentPlan,
  a[0],
]);

// ── 5 · save_weekly_plan filters overridden automatic points ──────────────
const save = (points: { spec_point_id: string; origin: string }[], w = today) =>
  db.query("select save_weekly_plan($1,'biology','aqa','gcse',$2,'ai','re-cut',$3)", [
    student,
    w,
    JSON.stringify(points),
  ]);
await save([
  { spec_point_id: a[0], origin: "core" },
  { spec_point_id: a[1], origin: "core" },
  { spec_point_id: a[4], origin: "core" },
  { spec_point_id: a[6], origin: "core" },
]);
let kept = await rows(currentPlan);
assert(!has(kept, a[0]), "Re-cut reinstated a removed point");
assert(has(kept, a[6]), "Re-cut lost a fresh automatic point");
assert(has(kept, a[2]), "Re-cut lost the pin");
assert(has(kept, a[3]), "Re-cut lost the ticked point");
// A hand-picked write of the same point still lands.
await save([
  { spec_point_id: a[0], origin: "tutor" },
  { spec_point_id: a[4], origin: "core" },
  { spec_point_id: a[6], origin: "core" },
]);
kept = await rows(currentPlan);
assert.equal(
  kept.find((r) => r.spec_point_id === a[0])?.origin,
  "tutor",
  "Pin of a removed point refused",
);
await db.query("delete from student_weekly_plan_points where plan_id=$1 and spec_point_id=$2", [
  currentPlan,
  a[0],
]);

// ── 6 · Skip in the programme ─────────────────────────────────────────────
await as(tutor);
const skip = (
  await db.query<{ r: { removed: number; pinned_weeks: string[]; worked_weeks: string[] } }>(
    "select skip_plan_point($1,'biology',$2,'Covered at school') r",
    [student, a[4]],
  )
).rows[0].r;
assert.equal(skip.removed, 2, "Skip should clear this week and the future week");
assert.deepEqual(skip.pinned_weeks, []);
assert.deepEqual(skip.worked_weeks, []);
assert(!has(await rows(currentPlan), a[4]), "Skipped point still in this week");
assert(!has(await rows(futurePlan), a[4]), "Skipped point still in a future week");
assert(has(await rows(pastPlan), a[4]), "Skip rewrote history");
assert(has(await rows(futurePlan), a[5]), "Skip touched another point");
// A skip reports where a pin keeps the point.
const pinnedSkip = (
  await db.query<{ r: { removed: number; pinned_weeks: string[] } }>(
    "select skip_plan_point($1,'biology',$2) r",
    [student, a[5]],
  )
).rows[0].r;
assert.equal(pinnedSkip.removed, 0);
assert.deepEqual(pinnedSkip.pinned_weeks, [week(3)]);
assert(has(await rows(futurePlan), a[5]), "Skip deleted a pin");
// Idempotent: a second skip updates the note rather than failing.
await db.query("select skip_plan_point($1,'biology',$2,'Still covered') r", [student, a[4]]);
assert.equal(
  (await overrides()).filter((o) => o.kind === "skip" && o.spec_point_id === a[4]).length,
  1,
);
// Automatic writes of a skipped point are dropped in every week.
await as(student);
await save([{ spec_point_id: a[4], origin: "core" }], week(5));
const laterPlan = (
  await db.query<{ id: string }>(
    "select id from student_weekly_plans where student_id=$1 and week_start=$2",
    [student, week(5)],
  )
).rows[0].id;
assert.deepEqual(await rows(laterPlan), [], "Skipped point written into a new week");

// ── 7 · Clearing an override is a plain delete for a tutor ────────────────
await as(tutor);
await db.query(
  "delete from student_plan_overrides where student_id=$1 and spec_point_id=$2 and kind='skip'",
  [student, a[4]],
);
await as(student);
await insertPoint(currentPlan, a[4], "core");
assert(has(await rows(currentPlan), a[4]), "Cleared skip still blocks");

// ── 8 · A tutor can reorder topics on the student's behalf ────────────────
const preview = reorderTopics({
  bands: baseline,
  topics,
  from: today,
  examDate: week(10),
  order: orderInputs(baseline, topics, today)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
const reorder = (who: string, target: string | null) =>
  db.query("select reorder_student_topics('biology','aqa','gcse',$1,$2,$3,$4,$5,$6,$7)", [
    today,
    JSON.stringify(baseline),
    week(10),
    JSON.stringify(preview),
    [],
    "[]",
    target,
  ]);
await as(other);
await assert.rejects(reorder(other, student), /Only the student or their tutor/);
await as(tutor);
await reorder(tutor, student);
const saved = (
  await db.query<{ pacing: unknown }>(
    "select pacing from student_program_plan where student_id=$1",
    [student],
  )
).rows[0].pacing;
assert.deepEqual(saved, JSON.parse(JSON.stringify(preview)));
// The re-cut honoured the week-level removal and the remaining pin.
kept = await rows(currentPlan);
assert(!has(kept, a[0]), "Reorder reinstated a removed point");
assert(has(kept, a[2]), "Reorder lost the pin");
const thisWeekTeaching = withWeeklyPoints(
  preview,
  new Map(topics.map((t) => [t.topicId, t.points])),
).flatMap((band) => band.pointsByWeek?.[today] ?? []);
assert(thisWeekTeaching.length > 0, "Fixture: the reordered spine teaches nothing this week");
assert(
  thisWeekTeaching.every((p) => has(kept, p.specPointId)),
  "Reorder did not write the new teaching",
);
// The student can still reorder their own plan with the trailing parameter left out.
await as(student);
const back = reorderTopics({
  bands: preview,
  topics,
  from: today,
  examDate: week(10),
  order: orderInputs(preview, topics, today).remaining.map((t) => t.topicId),
});
await db.query("select reorder_student_topics('biology','aqa','gcse',$1,$2,$3,$4,$5,$6)", [
  today,
  JSON.stringify(preview),
  week(10),
  JSON.stringify(back),
  [],
  "[]",
]);

await db.close();
console.log(
  "PASS: version, tutor-only writes, remove (worked/ticked/past/subject guards), trigger drops automatic writes and keeps pins, save_weekly_plan filter, skip across weeks with pins reported, clear, tutor reorder on behalf.",
);
