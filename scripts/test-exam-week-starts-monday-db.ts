/** Isolated PostgreSQL checks for 20261123140000_exam_week_starts_monday. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-exam-week-starts-monday-db.ts
 *
 * An exam on a Wednesday: the week of its Monday is the exam week.
 *
 * 1. Production as it stands: plan_point_admissible lets an automatic point
 *    into the exam week, and a reorder re-cuts the saved exam week.
 * 2. The trigger alone would break every reorder of a student with a saved
 *    exam week, which is why the reorder loop changes with it.
 * 3. With the migration: the exam week is refused, the week before it is
 *    not, a Monday exam gets the same answers as before, and a reorder
 *    leaves the saved exam week as it is and re-cuts the weeks before it.
 * 4. The rollback gives production's answers back.
 *
 * Production's functions come from the migrations that hold them, md5-checked
 * against production on 23 Nov 2026: enforce_plan_point_admissible from
 * 20260915120000, reorder_student_topics from 20261119222800, save_weekly_plan
 * from 20260922104641, and the break table and trigger from 20261005160000.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints, type PacingBand } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics, type OrderTopic } from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/planner/week";
import { shiftKey } from "../src/lib/planner/breaks";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const FIX = "20261123140000_exam_week_starts_monday";
const BREAKS = "20261005160000_student_breaks.sql";
const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const rollback = () =>
  readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8");
/** The text of a migration from `start` up to and including the first `end` after it. */
async function slice(file: string, start: string, end: string): Promise<string> {
  const sql = await migration(file);
  const from = sql.indexOf(start);
  assert(from >= 0, `${start} is not in ${file}`);
  const to = sql.indexOf(end, from + start.length);
  assert(to >= 0, `${end} does not follow ${start} in ${file}`);
  return sql.slice(from, to + end.length);
}
/** One `create or replace function` statement out of a migration that holds several. */
async function functionFrom(file: string, name: string): Promise<string> {
  const sql = await migration(file);
  const at = sql.indexOf(`create or replace function public.${name}(`);
  assert(at >= 0, `${name} is not in ${file}`);
  const rest = sql.slice(at);
  const quote = /as\s+(\$[a-z_]*\$)/i.exec(rest)!;
  const close = rest.indexOf(quote[1], quote.index + quote[0].length);
  return rest.slice(0, rest.indexOf(";", close) + 1);
}

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const today = currentWeekKey();
const week = (n: number) => toDateKey(addWeeks(weekKeyToDate(today), n));
const start = week(-2);
/** The exam week's Monday, and the exam on its Wednesday. */
const examWeek = week(10);
const WEDNESDAY = shiftKey(examWeek, 2);
const RECUT = "Updated to the chosen topic order. Reviews retain their assessed timing.";

/** Three Biology topics of eight points each. */
const topics: OrderTopic[] = [1, 2, 3].map((n) => ({
  topicId: uuid(100 + n),
  title: `Topic ${n}`,
  points: Array.from({ length: 8 }, (_, i) => ({
    specPointId: uuid((100 + n) * 100 + i),
    code: `${n}.${i}`,
    title: `Point ${i}`,
    weight: 1,
  })),
}));
const spine: PacingBand[] = computePacing(
  topics.map((t) => ({ ...t, weight: t.points.length })),
  weekKeyToDate(start),
  weekKeyToDate(WEDNESDAY),
);
assert(
  spine.every((b) => b.endWeek < examWeek),
  "Fixture: teaching stops before the exam week",
);
/** The remaining topics backwards, from this week, as the editor sends it. */
const reordered = (examDate: string) =>
  reorderTopics({
    bands: spine,
    topics,
    from: today,
    examDate,
    order: orderInputs(spine, topics, today)
      .remaining.map((t) => t.topicId)
      .reverse(),
  });
/** A point the spine never sets this week, so it is no copy of this week's teaching. */
const extra = topics[2].points[7].specPointId;
const firstCut = withWeeklyPoints(spine, new Map(topics.map((t) => [t.topicId, t.points])))
  .flatMap((b) => b.pointsByWeek?.[today] ?? [])
  .map((p) => p.specPointId);
assert(firstCut.length > 0 && !firstCut.includes(extra), "Fixture: this week teaches");

type Db = InstanceType<typeof PGlite>;

/**
 * Production as it stands, with one student whose exam is `examDate`. A week
 * was saved for this week and for the exam week before any fix: the exam
 * week holds one automatic point, as the old planner could set.
 */
async function build(examDate: string, extraSql: string[] = []): Promise<Db> {
  const db = new PGlite();
  await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create type subject as enum ('biology'); create type board as enum ('edexcel'); create type level as enum ('gcse');
create type plan_source as enum ('ai','student','tutor');
create type plan_point_origin as enum ('ai','student','tutor','carried_over','core','focus');
create table profiles(id uuid primary key, level level);
create table student_enrolments(student_id uuid, subject subject, board board, unique(student_id, subject));
create table parent_student_links(parent_id uuid, student_id uuid);
create table topics(id uuid primary key, subject subject, board board, level level);
create table spec_points(id uuid primary key, topic_id uuid references topics,
  not_examined boolean not null default false);
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
  await db.exec(await migration("20260922104641_planner_tutor_overrides.sql"));
  await db.exec(await migration("20261001125425_plan_override_tutor_check_definer.sql"));
  await db.exec(await slice(BREAKS, "create table public.student_breaks (", "\n);"));
  await db.exec(
    await slice(
      BREAKS,
      "create or replace function private.refuse_planning_on_a_break()",
      "$function$;",
    ),
  );
  await db.exec(await slice(BREAKS, "create trigger plan_not_on_a_break", ";"));
  await db.exec(
    await functionFrom("20260915120000_student_topic_order.sql", "enforce_plan_point_admissible"),
  );
  await db.exec(
    await functionFrom("20261119222800_custom_plan_left_points.sql", "reorder_student_topics"),
  );
  await db.exec(`
create trigger plan_point_admissible before insert or update of spec_point_id, origin, plan_id
  on student_weekly_plan_points for each row execute function enforce_plan_point_admissible();
`);

  for (const t of topics) {
    await db.query("insert into topics values ($1,'biology','edexcel','gcse')", [t.topicId]);
    for (const p of t.points)
      await db.query("insert into spec_points (id, topic_id) values ($1,$2)", [
        p.specPointId,
        t.topicId,
      ]);
  }
  await db.query("insert into auth.users values($1)", [student]);
  await db.query("insert into profiles values($1,'gcse')", [student]);
  await db.query("insert into student_enrolments values($1,'biology','edexcel')", [student]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [student, start, examDate, JSON.stringify(spine)],
  );
  const saveWeek = async (id: string, w: string, points: string[]) => {
    await db.query(
      "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source,ai_rationale) values($1,$2,'biology','edexcel','gcse',$3,'ai','as built')",
      [id, student, w],
    );
    for (const p of points)
      await db.query(
        "insert into student_weekly_plan_points(plan_id,spec_point_id,origin) values($1,$2,'core')",
        [id, p],
      );
  };
  await saveWeek(uuid(50), today, firstCut);
  // Only a mid-week exam's week could ever have been saved with work in it.
  if (examDate !== examWeek) await saveWeek(uuid(51), examWeek, [extra]);

  await db.exec(`grant usage on schema public,auth to authenticated;
 grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());`);
  await db.exec(
    await slice(
      BREAKS,
      "alter table public.student_breaks enable row level security;",
      "grant select on public.student_breaks to authenticated;",
    ),
  );
  for (const sql of extraSql) await db.exec(sql);
  return db;
}

/** A point the student picked for the exam week before any fix: kept by every re-cut. */
const pickExamWeek = (db: Db) =>
  db.query(
    "insert into student_weekly_plan_points(plan_id,spec_point_id,origin) values($1,$2,'student')",
    [uuid(51), topics[2].points[6].specPointId],
  );

/** Run `call` as the student, then roll everything back. Its refusal, or null. */
async function attempt(db: Db, call: (db: Db) => Promise<unknown>): Promise<string | null> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [student]);
    await db.exec("set local role authenticated");
    await call(db);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec("rollback");
  }
}
/** A week saved by the planner (save_weekly_plan) holding one point of `origin`. */
const plan = (w: string, origin: "core" | "focus" | "student" | "tutor") => (db: Db) =>
  db.query("select save_weekly_plan($1,'biology','edexcel','gcse',$2,'ai',null,$3::jsonb)", [
    student,
    w,
    JSON.stringify([{ spec_point_id: extra, origin, carried_from: null }]),
  ]);
/** The reorder from this week, as ProgramDAL.reorder sends it. */
const reorder = (examDate: string) => (db: Db) =>
  db.query("select reorder_student_topics('biology','edexcel','gcse',$1,$2,$3,$4,$5,$6,$7)", [
    today,
    JSON.stringify(spine),
    examDate,
    JSON.stringify(reordered(examDate)),
    [],
    "[]",
    null,
  ]);
/** A reorder that is kept, and what it left in each saved week. */
async function reorderKept(db: Db, examDate: string) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [student]);
  await db.exec("set role authenticated");
  await reorder(examDate)(db);
  await db.exec("reset role");
  const { rows } = await db.query<{ week: string; rationale: string; points: string[] }>(
    `select to_char(w.week_start,'YYYY-MM-DD') as week, w.ai_rationale as rationale,
       coalesce(array_agg(p.spec_point_id::text order by p.spec_point_id) filter (where p.spec_point_id is not null), '{}') as points
     from student_weekly_plans w left join student_weekly_plan_points p on p.plan_id = w.id
     group by w.week_start, w.ai_rationale order by 1`,
  );
  return new Map(rows.map((r) => [r.week, r]));
}

const EXAM_WEEK = "week is at or past the programme exam date";
/** For each origin, whether the exam week refuses it (null: it took it); then the week before, and a reorder. */
async function answers(db: Db, examDate: string) {
  // One connection, so one attempt at a time.
  const examWeekRefuses: (boolean | null)[] = [];
  for (const origin of ["core", "focus", "student", "tutor"] as const) {
    const refused = await attempt(db, plan(examWeek, origin));
    examWeekRefuses.push(refused && refused.includes(EXAM_WEEK));
  }
  return {
    examWeek: examWeekRefuses,
    weekBefore: await attempt(db, plan(week(9), "core")),
    reorder: await attempt(db, reorder(examDate)),
  };
}

// ── 1 · Production as it stands ──────────────────────────────────────────
{
  const db = await build(WEDNESDAY);
  const now = await answers(db, WEDNESDAY);
  assert.deepEqual(
    now.examWeek,
    [null, null, null, null],
    "Expected the exam week of a Wednesday exam to take any point today",
  );
  assert.equal(now.weekBefore, null);
  const weeks = await reorderKept(db, WEDNESDAY);
  assert.equal(weeks.get(examWeek)?.rationale, RECUT, "Expected the reorder to re-cut exam week");
}

// ── 2 · The trigger alone breaks the reorder ─────────────────────────────
{
  // The student's own pick in the exam week is kept by the re-cut, so the
  // loop re-sends it, and the trigger refuses it.
  const db = await build(WEDNESDAY);
  await pickExamWeek(db);
  await db.exec(await functionFrom(`${FIX}.sql`, "enforce_plan_point_admissible"));
  const refused = await attempt(db, reorder(WEDNESDAY));
  assert(refused?.includes(EXAM_WEEK), `Expected the reorder to roll back, got ${refused}`);
}

// ── 3 · With the migration ───────────────────────────────────────────────
const fix = await migration(`${FIX}.sql`);
{
  const db = await build(WEDNESDAY);
  await pickExamWeek(db); // as in 2: the reorder now passes with it there
  await db.exec(fix);
  await db.exec(fix); // idempotent
  const now = await answers(db, WEDNESDAY);
  assert.deepEqual(now.examWeek, [true, true, true, true], "The exam week still took a point");
  assert.equal(now.weekBefore, null, "The week before the exam week was refused");
  assert.equal(now.reorder, null, `The reorder was refused: ${now.reorder}`);
  const weeks = await reorderKept(db, WEDNESDAY);
  // The exam week is left exactly as it was saved; this week follows the new order.
  assert.deepEqual(weeks.get(examWeek), {
    week: examWeek,
    rationale: "as built",
    points: [topics[2].points[6].specPointId, extra].sort(),
  });
  assert.equal(weeks.get(today)?.rationale, RECUT, "This week was not re-cut");
}
{
  // A Monday exam: the same answers before and after.
  const before = await build(examWeek);
  const after = await build(examWeek, [fix]);
  assert.deepEqual(await answers(after, examWeek), await answers(before, examWeek));
  assert.deepEqual((await answers(after, examWeek)).examWeek, [true, true, true, true]);
}

// ── 4 · The rollback ─────────────────────────────────────────────────────
{
  const db = await build(WEDNESDAY, [fix]);
  await db.exec(await rollback());
  await db.exec(await rollback()); // idempotent
  const back = await answers(db, WEDNESDAY);
  assert.deepEqual(back.examWeek, [null, null, null, null], "The rollback left the exam week shut");
  const weeks = await reorderKept(db, WEDNESDAY);
  assert.equal(weeks.get(examWeek)?.rationale, RECUT);
}

console.log(
  "PASS: today a Wednesday exam's week takes any point and a reorder re-cuts it; the trigger alone would roll a reorder back; with the migration the exam week is refused for every origin, the week before is not, a reorder leaves the saved exam week as it was, and a Monday exam gets the same answers as before; it is idempotent; the rollback gives today's answers back.",
);
