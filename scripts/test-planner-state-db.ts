/** Isolated PostgreSQL checks for planner_state and planner_point_evidence
 * (20261017143927): one read answers a planner open, in the shapes the client's
 * old reads returned, as the caller and no one else.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-planner-state-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [alex, sam] = [uuid(1), uuid(2)];
const [t1, t2, t9] = [uuid(11), uuid(12), uuid(19)];
const [p1, p2, p3, p9] = [uuid(21), uuid(22), uuid(23), uuid(29)];
const [r1, r2, r3] = [uuid(31), uuid(32), uuid(33)];
const [s1, s2] = [uuid(41), uuid(42)];
const [week, nextWeek, chemWeek] = [uuid(51), uuid(52), uuid(53)];
const W = "2026-10-12";

await db.exec(`
set timezone = 'UTC'; -- as Supabase runs, so timestamps print as PostgREST's do
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type level as enum ('gcse','gcse_trilogy','igcse','alevel');
create type plan_source as enum ('ai','student','tutor');
create type plan_point_origin as enum ('ai','core','focus','student','tutor','carried_over');
create type plan_override_kind as enum ('skip','close_week');
create table profiles(id uuid primary key, level level, exam_year int2);
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board);
create table topics(id uuid primary key, title text, sort_order int, subject subject, board board, level level);
create table spec_points(id uuid primary key, code text, title text, description text, topic_id uuid references topics, sort_order int, weight numeric);
create table resources(id uuid primary key, kind text, spec_point_id uuid);
create table resource_spec_points(resource_id uuid, spec_point_id uuid);
create table mcq_sets(id uuid primary key, spec_point_id uuid);
create table mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid, spec_point_id uuid);
create table homework_submissions(id uuid primary key default gen_random_uuid(), student_id uuid, resource_id uuid, score_pct numeric, graded_at timestamptz, submitted_at timestamptz);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), user_id uuid, set_id uuid, score int, total int, created_at timestamptz, point_scores jsonb);
create table student_program_plan(student_id uuid, subject subject, program_start date, exam_date date, pacing jsonb, primary key(student_id, subject));
create table student_subject_pauses(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, reason text, started_at timestamptz, ended_at timestamptz, cancelled_at timestamptz, programme_resumed_at timestamptz);
create table student_breaks(id uuid primary key default gen_random_uuid(), student_id uuid, starts_on date, ends_on date, reason text, cancelled_at timestamptz, recorded_at timestamptz);
create table student_plan_overrides(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, spec_point_id uuid, kind plan_override_kind, week_start date, note text, created_by uuid, created_at timestamptz);
create table student_weekly_plans(id uuid primary key, student_id uuid, subject subject, board board, level level, week_start date, source plan_source, note text, ai_rationale text, unique(student_id, subject, week_start));
create table student_weekly_plan_points(plan_id uuid references student_weekly_plans, spec_point_id uuid references spec_points, origin plan_point_origin, carried_from date, done_at timestamptz);
create function public.assessment_scheduler_version() returns int language sql stable as $$ select 5 $$;
grant usage on schema public, auth to authenticated, anon;
grant select on all tables in schema public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`);
// Curriculum is readable by everyone; a student's own records only by them.
for (const table of [
  "topics",
  "spec_points",
  "resources",
  "resource_spec_points",
  "mcq_sets",
  "mcq_questions",
])
  await db.exec(`alter table ${table} enable row level security;
    create policy read on ${table} for select to authenticated using (true);`);
const own: Record<string, string> = {
  profiles: "id",
  student_enrolments: "student_id",
  homework_submissions: "student_id",
  mcq_attempts: "user_id",
  student_program_plan: "student_id",
  student_subject_pauses: "student_id",
  student_breaks: "student_id",
  student_plan_overrides: "student_id",
  student_weekly_plans: "student_id",
};
for (const [table, column] of Object.entries(own))
  await db.exec(`alter table ${table} enable row level security;
    create policy own on ${table} for select to authenticated using (${column} = auth.uid());`);
await db.exec(`alter table student_weekly_plan_points enable row level security;
  create policy own on student_weekly_plan_points for select to authenticated
  using (exists (select 1 from student_weekly_plans w where w.id = plan_id and w.student_id = auth.uid()));`);

// planner_attempt_sources exactly as live (20260907120000_planner_read_models).
const readModels = await readFile(
  new URL("../supabase/migrations/20260907120000_planner_read_models.sql", import.meta.url),
  "utf8",
);
await db.exec(
  readModels.slice(
    readModels.indexOf("create or replace function public.planner_attempt_sources"),
    readModels.indexOf("create or replace function public.planner_course_snapshot"),
  ),
);

await db.exec(`
insert into profiles values ('${alex}','gcse',2027), ('${sam}','gcse',2028);
insert into student_enrolments(student_id,subject,board) values ('${alex}','biology','aqa'), ('${sam}','biology','aqa');
insert into topics values ('${t1}','Cells',1,'biology','aqa','gcse'), ('${t2}','Organisation',2,'biology','aqa','gcse'),
  ('${t9}','Atoms',1,'chemistry','aqa','gcse');
insert into spec_points values ('${p1}','4.1.1','Eukaryotes',null,'${t1}',1,1.5), ('${p2}','4.1.2','Microscopy','Light and electron','${t1}',2,null),
  ('${p3}','4.2.1','Digestion',null,'${t2}',1,2), ('${p9}','5.1.1','Atoms',null,'${t9}',1,1);
insert into resources values ('${r1}','homework','${p1}'), ('${r2}','homework',null), ('${r3}','video','${p1}');
insert into resource_spec_points values ('${r2}','${p2}');
insert into mcq_sets values ('${s1}','${p3}'), ('${s2}',null);
insert into mcq_questions(set_id,spec_point_id) values ('${s1}','${p3}'), ('${s2}','${p2}');
insert into homework_submissions(student_id,resource_id,score_pct,graded_at,submitted_at) values
  ('${alex}','${r1}',80,'2026-10-13T10:00:00Z','2026-10-13T09:00:00Z'), ('${sam}','${r1}',40,null,'2026-10-13T09:00:00Z');
insert into mcq_attempts(user_id,set_id,score,total,created_at,point_scores) values
  ('${alex}','${s1}',3,4,'2026-10-14T09:00:00Z',null), ('${alex}','${s2}',1,2,'2026-10-14T10:00:00Z','{"${p2}":50}');
insert into student_program_plan values ('${alex}','biology','2026-09-07','2027-06-07','[{"topicId":"${t1}","startWeek":"2026-09-07","endWeek":"2026-11-30"}]');
insert into student_subject_pauses(student_id,subject,reason,started_at,ended_at,programme_resumed_at) values
  ('${alex}','biology','paused','2026-10-01T00:00:00Z',null,null), ('${alex}','biology','lapsed','2026-09-10T00:00:00Z','2026-09-12T00:00:00Z','2026-09-14T00:00:00Z'),
  ('${alex}','chemistry','paused','2026-09-01T00:00:00Z',null,null);
insert into student_breaks(student_id,starts_on,ends_on,reason,cancelled_at,recorded_at) values
  ('${alex}','2026-12-21','2027-01-03','holiday',null,null), ('${alex}','2026-11-02','2026-11-08','illness',null,'2026-11-09T00:00:00Z'),
  ('${alex}','2026-10-26','2026-11-01','holiday','2026-10-01T00:00:00Z',null);
insert into student_plan_overrides(student_id,subject,spec_point_id,kind,week_start,note,created_by,created_at) values
  ('${alex}','biology','${p2}','skip',null,'covered in class','${sam}','2026-10-10T00:00:00Z');
insert into student_weekly_plans values ('${week}','${alex}','biology','aqa','gcse','${W}','ai',null,'Cells first'),
  ('${nextWeek}','${alex}','biology','aqa','gcse','2026-10-19','tutor','bring a calculator',null),
  ('${chemWeek}','${alex}','chemistry','aqa','gcse','${W}','ai',null,null);
insert into student_weekly_plan_points values ('${week}','${p1}','core',null,'2026-10-13T12:00:00Z'), ('${week}','${p3}','focus','2026-10-05',null),
  ('${nextWeek}','${p2}','tutor',null,null), ('${chemWeek}','${p9}','core',null,null);
`);

const asUser = async <T>(id: string | null, sql: string, params: unknown[] = []): Promise<T> => {
  await db.exec(`set role ${id ? "authenticated" : "anon"}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  try {
    return ((await db.query(sql, params)) as { rows: { v: T }[] }).rows[0].v;
  } finally {
    await db.exec("reset role");
  }
};
const snapshot = (who: string | null) =>
  asUser<Record<string, unknown>>(
    who,
    `select public.planner_course_snapshot($1,'biology','aqa','gcse') v`,
    [alex],
  );
const state = (who: string | null, weekStart = W) =>
  asUser<StateAnswer>(who, `select public.planner_state($1,'biology','aqa','gcse',$2) v`, [
    alex,
    weekStart,
  ]);
type Row = Record<string, unknown>;
/** planner_state's answer, as far as these checks look into it. */
type StateAnswer = {
  course: Row;
  programme: Row | null;
  profile: Row | null;
  boards: unknown[];
  pauses: Row[];
  breaks: Row[];
  overrides: Row[];
  ledger: { week_start: string; student_weekly_plan_points: Row[] }[];
  week: { plan: Row; points: Row[] } | null;
  scheduler_version: number;
};
/** jsonb_agg keeps no order without `order by`; compare those lists as sets. */
const sorted = (rows: unknown[]) =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
/** The same, all the way down: the snapshot's lists come from unordered unions. */
const normal = (v: unknown): unknown =>
  Array.isArray(v)
    ? sorted(v.map(normal))
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normal(x)]))
      : v;

// 1. The course snapshot answers exactly as before, for the student and for anyone else.
const rollback = await readFile(
  new URL("../supabase/rollbacks/20261017143927_planner_state.down.sql", import.meta.url),
  "utf8",
);
await db.exec(rollback);
const before = { alex: await snapshot(alex), sam: await snapshot(sam) };
const migration = await readFile(
  new URL("../supabase/migrations/20261017143927_planner_state.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
assert.deepEqual(
  normal(await snapshot(alex)),
  normal(before.alex),
  "snapshot unchanged for the student",
);
assert.deepEqual(
  normal(await snapshot(sam)),
  normal(before.sam),
  "snapshot unchanged for another student",
);
assert.equal(
  (before.alex.submissions as unknown[]).length,
  1,
  "the fixture has evidence to compare",
);
assert.equal((before.alex.attempts as unknown[]).length, 2);
console.log("ok  planner_course_snapshot answers as it did");

// 2. planner_state, read by the student: every part in the old read's shape.
const mine = await state(alex);
assert.deepEqual(normal(mine.course), normal(before.alex), "course = the snapshot");
assert.deepEqual(mine.programme, {
  program_start: "2026-09-07",
  exam_date: "2027-06-07",
  pacing: [{ topicId: t1, startWeek: "2026-09-07", endWeek: "2026-11-30" }],
});
assert.deepEqual(mine.profile, { level: "gcse", exam_year: 2027 });
assert.deepEqual(mine.boards, ["aqa"]);
assert.deepEqual(
  mine.pauses.map((p) => [p.reason, p.ended_at === null, !!p.programme_resumed_at]),
  [
    ["lapsed", false, true],
    ["paused", true, false],
  ],
  "this subject's stops, oldest first",
);
assert.deepEqual(Object.keys(mine.pauses[0]).sort(), [
  "ended_at",
  "id",
  "programme_resumed_at",
  "reason",
  "started_at",
]);
assert.deepEqual(
  mine.breaks.map((b) => [b.starts_on, b.ends_on, b.reason, b.recorded_at]),
  [
    ["2026-11-02", "2026-11-08", "illness", "2026-11-09T00:00:00+00:00"],
    ["2026-12-21", "2027-01-03", "holiday", null],
  ],
  "breaks that stand, by start, in PostgREST's date and timestamp formats",
);
assert.deepEqual(
  mine.overrides.map((o) => [o.spec_point_id, o.kind, o.week_start, o.note]),
  [[p2, "skip", null, "covered in class"]],
);
assert.deepEqual(
  sorted(mine.ledger.map((w) => [w.week_start, sorted(w.student_weekly_plan_points)])),
  sorted([
    [
      W,
      sorted([
        { spec_point_id: p1, done_at: "2026-10-13T12:00:00+00:00" },
        { spec_point_id: p3, done_at: null },
      ]),
    ],
    ["2026-10-19", [{ spec_point_id: p2, done_at: null }]],
  ]),
  "every week of this subject, not chemistry's",
);
assert.ok(mine.week, "this week is read");
assert.deepEqual(mine.week.plan, {
  id: week,
  subject: "biology",
  board: "aqa",
  level: "gcse",
  week_start: W,
  source: "ai",
  note: null,
  ai_rationale: "Cells first",
});
assert.deepEqual(
  sorted(mine.week.points),
  sorted([
    {
      origin: "core",
      carried_from: null,
      done_at: "2026-10-13T12:00:00+00:00",
      spec_points: {
        id: p1,
        code: "4.1.1",
        title: "Eukaryotes",
        description: null,
        topic_id: t1,
        sort_order: 1,
        topics: { title: "Cells", sort_order: 1, subject: "biology", board: "aqa", level: "gcse" },
      },
    },
    {
      origin: "focus",
      carried_from: "2026-10-05",
      done_at: null,
      spec_points: {
        id: p3,
        code: "4.2.1",
        title: "Digestion",
        description: null,
        topic_id: t2,
        sort_order: 1,
        topics: {
          title: "Organisation",
          sort_order: 2,
          subject: "biology",
          board: "aqa",
          level: "gcse",
        },
      },
    },
  ]),
  "the week's points with what getPlan and the admission rules read about them",
);
assert.equal(mine.scheduler_version, 5);
assert.equal((await state(alex, "2026-11-16")).week, null, "a week with no plan reads as none");
console.log("ok  planner_state, read by the student");

// 3. Read as someone else: RLS answers, exactly as for the reads it replaces.
const theirs = await state(sam);
assert.deepEqual(normal(theirs.course), normal(before.sam), "curriculum yes, Alex's evidence no");
assert.equal(theirs.programme, null);
assert.equal(theirs.profile, null);
for (const part of ["boards", "pauses", "breaks", "overrides", "ledger"] as const)
  assert.deepEqual(theirs[part], [], part);
assert.equal(theirs.week, null);
console.log("ok  planner_state, read by another student, holds none of Alex's records");

// 4. A week's evidence in one trip = the snapshot's evidence for those points.
const evidence = await asUser<{
  sources: { resourceLinks: Row[] };
  submissions: Row[];
  attempts: Row[];
}>(alex, "select public.planner_point_evidence($1,$2) v", [alex, [p1, p3]]);
assert.deepEqual(
  sorted(evidence.submissions),
  sorted((before.alex.submissions as Row[]).filter((s) => s.resource_id === r1)),
);
assert.deepEqual(
  sorted(evidence.attempts),
  sorted((before.alex.attempts as Row[]).filter((a) => a.set_id === s1)),
);
assert.deepEqual(normal(evidence.sources.resourceLinks), [{ resource_id: r1, spec_point_id: p1 }]);
console.log("ok  planner_point_evidence");

// 5. Nobody signed out may call either.
for (const call of [
  `select public.planner_state('${alex}','biology','aqa','gcse','${W}') v`,
  `select public.planner_point_evidence('${alex}',array['${p1}']::uuid[]) v`,
])
  await assert.rejects(asUser(null, call), /permission denied/);
console.log("ok  anon is refused");
