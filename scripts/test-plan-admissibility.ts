/** Isolated PostgreSQL regression checks. No production data is read or written.
 * PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-admissibility.ts */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
await db.exec(`
create role anon; create role authenticated;
create type subject as enum ('biology','chemistry');
create type board as enum ('aqa','edexcel');
create type level as enum ('gcse','igcse');
create type plan_source as enum ('ai','student');
create type plan_point_origin as enum ('core','focus','ai','student','tutor','carried_over');
create table profiles(id uuid primary key, level level);
create table student_enrolments(student_id uuid,subject subject,board board);
create table student_program_plan(student_id uuid,subject subject,pacing jsonb,exam_date date);
create table topics(id uuid primary key,subject subject,board board,level level);
create table spec_points(id uuid primary key,topic_id uuid references topics);
create table student_weekly_plans(id uuid primary key default gen_random_uuid(),student_id uuid,
 subject subject,board board,level level,week_start date,source plan_source,ai_rationale text,updated_at timestamptz,
 unique(student_id,subject,week_start));
create table student_weekly_plan_points(plan_id uuid references student_weekly_plans,spec_point_id uuid references spec_points,
 origin plan_point_origin,carried_from date,done_at timestamptz,primary key(plan_id,spec_point_id));
create table resources(id uuid primary key,kind text,spec_point_id uuid);
create table resource_spec_points(resource_id uuid,spec_point_id uuid);
create table homework_submissions(student_id uuid,resource_id uuid,submitted_at timestamptz);
create table mcq_sets(id uuid primary key,spec_point_id uuid);
create table mcq_questions(set_id uuid,spec_point_id uuid);
create table mcq_attempts(user_id uuid,set_id uuid,created_at timestamptz,point_scores jsonb);
insert into profiles values ('${id(100)}','gcse');
insert into student_enrolments values ('${id(100)}','biology','aqa');
insert into topics values ('${id(200)}','biology','aqa','gcse'),('${id(201)}','chemistry','aqa','gcse');
insert into spec_points select ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,'${id(200)}'
 from generate_series(1,12) i;
insert into spec_points values ('${id(13)}','${id(201)}');
insert into student_weekly_plans values ('${id(300)}','${id(100)}','biology','aqa','gcse','2026-09-07','ai',null,now());
insert into student_weekly_plan_points select '${id(300)}',id,'core',null,null from spec_points where id <= '${id(9)}';
update student_weekly_plan_points set done_at = '2026-09-08' where spec_point_id = '${id(1)}';
update student_weekly_plan_points set carried_from = '2026-08-31' where spec_point_id = '${id(2)}';
update student_weekly_plan_points set origin = 'tutor' where spec_point_id = '${id(9)}';
insert into resources values ('${id(3)}','homework',null),('${id(7)}','homework','${id(7)}'),('${id(8)}','homework','${id(8)}');
insert into resource_spec_points values ('${id(3)}','${id(3)}');
insert into homework_submissions values
 ('${id(100)}','${id(3)}','2026-09-06T23:30:00Z'), -- London Monday
 ('${id(101)}','${id(7)}','2026-09-08T00:00:00Z'), -- another student's work
 ('${id(100)}','${id(8)}','2026-09-06T22:30:00Z'); -- previous London week
insert into mcq_sets values ('${id(4)}',null),('${id(5)}',null);
insert into mcq_questions values ('${id(4)}','${id(4)}');
insert into mcq_attempts values
 ('${id(100)}','${id(4)}','2026-09-08',null),
 ('${id(100)}','${id(5)}','2026-09-08','{"${id(5)}":70}');
insert into student_program_plan values ('${id(100)}','biology',
 '[{"topicId":"${id(200)}","startWeek":"2026-11-02"}]','2027-06-07');
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
alter table student_weekly_plans enable row level security;
create policy own_plans on student_weekly_plans to authenticated
 using(student_id = current_setting('test.viewer')::uuid)
 with check(student_id = current_setting('test.viewer')::uuid);
alter table student_weekly_plan_points enable row level security;
create policy own_points on student_weekly_plan_points to authenticated
 using(exists(select 1 from student_weekly_plans p where p.id = plan_id))
 with check(exists(select 1 from student_weekly_plans p where p.id = plan_id));
`);
for (const name of [
  "20260907130000_plan_point_admissibility.sql",
  "20260907140000_preserve_inadmissible_history.sql",
])
  await db.exec(readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
await db.exec(`set role authenticated; set test.viewer = '${id(100)}';`);
await db.query(
  `select save_weekly_plan('${id(100)}','biology','aqa','gcse','2026-09-07','ai',null,'[]')`,
);
const retained = (
  await db.query(
    "select spec_point_id,done_at,carried_from,origin from student_weekly_plan_points order by spec_point_id",
  )
).rows;
assert.deepEqual(
  retained.map((r: { spec_point_id: string }) => r.spec_point_id),
  [1, 2, 3, 4, 5, 9].map(id),
  "completion, carry, ungraded homework, quiz, snapshot-only attempt and tutor choices survive; untouched rows do not",
);
assert(retained[0].done_at);
assert(retained[1].carried_from);
assert.equal(retained[5].origin, "tutor");
const insert = (point: number, origin: string) =>
  db.query(
    `insert into student_weekly_plan_points values ('${id(300)}','${id(point)}','${origin}',null,null)`,
  );
await assert.rejects(insert(10, "core"), /does not reach until/);
await insert(10, "tutor");
await assert.rejects(insert(13, "tutor"), /different course/);
await assert.rejects(
  db.query(
    `select save_weekly_plan('${id(101)}','biology','aqa','gcse','2026-09-07','ai',null,'[]')`,
  ),
  /row-level security/,
);
await assert.rejects(
  db.query(
    `select save_weekly_plan('${id(100)}','chemistry','aqa','igcse','2026-09-07','ai',null,'[]')`,
  ),
  /sits gcse/,
  "known profile level is enforced without subject enrolment",
);
await db.query(
  `insert into student_weekly_plans values ('${id(301)}','${id(100)}','biology','aqa','gcse','2027-06-07','ai',null,now())`,
);
await assert.rejects(
  db.query(
    `insert into student_weekly_plan_points values ('${id(301)}','${id(11)}','student',null,null)`,
  ),
  /exam date/,
);
await db.exec(
  `reset role; update student_enrolments set board = 'edexcel'; set role authenticated;`,
);
await assert.rejects(insert(12, "tutor"), /no longer matches/);
assert.equal(
  (await db.query("select assessment_scheduler_version() as version")).rows[0].version,
  4,
);
await db.close();
console.log(
  "Admissibility SQL checks passed: history retention, London week boundaries, removal, course/spine/exam guards, stale enrolment, RLS and version 4.",
);
