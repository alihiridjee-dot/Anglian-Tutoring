/** Isolated PostgreSQL checks for 20261123120000_plan_table_checks. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-table-checks-db.ts
 *
 * 1. A saved week starts on a Monday: a Wednesday is refused, through
 *    save_weekly_plan and by a direct insert alike.
 * 2. A programme's pacing is a list: {} is refused, [] is not.
 *
 * Each fault is shown first on production's functions as they stand (from
 * the migrations that hold them, as test-reorder-on-a-break-db.ts has them),
 * then fixed. The rollback is checked last.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const FIX = "20261123120000_plan_table_checks";
const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const rollback = () =>
  readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8");
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
const topic = uuid(100);
const point = uuid(101);
const MONDAY = "2026-11-16";
const WEDNESDAY = "2026-11-18";
const spine = [
  { topicId: topic, title: "Topic", weeks: 30, startWeek: "2026-09-07", endWeek: "2027-03-29" },
];

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
create table spec_points(id uuid primary key, topic_id uuid references topics);
create table student_program_plan(student_id uuid, subject subject, program_start date, exam_date date, pacing jsonb not null, acknowledged_at timestamptz default now(), updated_at timestamptz default now(), primary key(student_id,subject));
create table student_weekly_plans(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board, level level, week_start date not null, source plan_source, ai_rationale text, updated_at timestamptz default now(), unique(student_id,subject,week_start));
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
await db.exec(
  await functionFrom("20260915120000_student_topic_order.sql", "enforce_plan_point_admissible"),
);
await db.exec(`
create trigger plan_point_admissible before insert or update of spec_point_id, origin, plan_id
  on student_weekly_plan_points for each row execute function enforce_plan_point_admissible();
`);

await db.query("insert into auth.users values($1)", [student]);
await db.query("insert into profiles values($1,'gcse')", [student]);
await db.query("insert into student_enrolments values($1,'biology','edexcel')", [student]);
await db.query("insert into topics values($1,'biology','edexcel','gcse')", [topic]);
await db.query("insert into spec_points values($1,$2)", [point, topic]);
await db.query(
  "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology','2026-09-07','2027-06-07',$2)",
  [student, JSON.stringify(spine)],
);
// A week saved before the checks: the migration validates the rows already there.
await db.query(
  "insert into student_weekly_plans(student_id,subject,board,level,week_start,source) values($1,'biology','edexcel','gcse','2026-11-09','ai')",
  [student],
);
await db.exec(`grant usage on schema public,auth to authenticated;
 grant all on all tables in schema public to authenticated;`);

const asStudent = () =>
  db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${student}',false)`);
const asOwner = () => db.exec("reset role");
/** save_weekly_plan as ProgramDAL saves a week, with no points. */
const saveWeek = (week: string) =>
  db.query("select save_weekly_plan($1,'biology','edexcel','gcse',$2,'ai',null,'[]'::jsonb)", [
    student,
    week,
  ]);
const insertWeek = (week: string) =>
  db.query(
    "insert into student_weekly_plans(student_id,subject,board,level,week_start,source) values($1,'biology','edexcel','gcse',$2,'student')",
    [student, week],
  );
const setPacing = (pacing: string) =>
  db.query("update student_program_plan set pacing=$1::jsonb where student_id=$2", [
    pacing,
    student,
  ]);
const dropWeek = (week: string) =>
  db.query("delete from student_weekly_plans where student_id=$1 and week_start=$2", [
    student,
    week,
  ]);
const refused = (constraint: string) => (e: { code?: string; message?: string }) =>
  e.code === "23514" && (e.message ?? "").includes(constraint);
const MONDAY_ONLY = "student_weekly_plans_week_start_monday";
const LIST_ONLY = "student_program_plan_pacing_is_list";

// ── 1 · Production as it stands: both faults ──────────────────────────────
await asStudent();
await saveWeek(WEDNESDAY);
await insertWeek("2026-11-26"); // a Thursday
await asOwner();
await dropWeek(WEDNESDAY);
await dropWeek("2026-11-26");
await asStudent();
await setPacing("{}");
// The programme's own insert of a point then fails, whatever the point.
const { rows } = await saveWeek(MONDAY);
const planId = (rows[0] as { save_weekly_plan: string }).save_weekly_plan;
await assert.rejects(
  db.query(
    "insert into student_weekly_plan_points(plan_id,spec_point_id,origin) values($1,$2,'core')",
    [planId, point],
  ),
  /cannot extract elements from an object/,
  "Expected an automatic point to fail on a pacing of {}",
);
await setPacing(JSON.stringify(spine));
await asOwner();
await dropWeek(MONDAY);

// ── 2 · With the checks: both refused; a Monday and a list still pass ─────
const fix = await migration(`${FIX}.sql`);
await db.exec(fix);
await db.exec(fix); // idempotent
await asStudent();
await assert.rejects(
  saveWeek(WEDNESDAY),
  refused(MONDAY_ONLY),
  "save_weekly_plan took a Wednesday",
);
await assert.rejects(
  insertWeek(WEDNESDAY),
  refused(MONDAY_ONLY),
  "A direct insert took a Wednesday",
);
await assert.rejects(setPacing("{}"), refused(LIST_ONLY), "A pacing of {} was taken");
await saveWeek(MONDAY);
await insertWeek("2026-11-23");
await setPacing("[]");
await setPacing(JSON.stringify(spine));
await asOwner();
const weeks = (
  await db.query<{ week_start: string }>(
    "select to_char(week_start,'YYYY-MM-DD') as week_start from student_weekly_plans order by 1",
  )
).rows.map((r) => r.week_start);
assert.deepEqual(weeks, ["2026-11-09", MONDAY, "2026-11-23"], "The Monday weeks were not all kept");

// ── 3 · The rollback takes both checks away ───────────────────────────────
await db.exec(await rollback());
await db.exec(await rollback()); // idempotent
await asStudent();
await saveWeek(WEDNESDAY);
await setPacing("{}");
await asOwner();

console.log(
  "PASS: before the checks a Wednesday week was saved and a pacing of {} broke every automatic insert; with them a Wednesday is refused through save_weekly_plan and by a direct insert, {} is refused, and a Monday and [] are taken; both are idempotent; the rollback takes them away.",
);
