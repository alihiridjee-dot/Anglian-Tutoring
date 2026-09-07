/** Run against a temporary PGlite install, never the hosted database:
 * PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-planner-read-models.ts */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('aqa','edexcel','ocr');
create type level as enum ('gcse','alevel','gcse_trilogy','igcse');
create table topics(id uuid primary key,title text,sort_order int,subject subject,board board,level level);
create table spec_points(id uuid primary key,topic_id uuid,code text,title text,sort_order int,weight numeric);
create table resources(id uuid primary key,kind text,spec_point_id uuid);
create table resource_spec_points(resource_id uuid,spec_point_id uuid);
create table mcq_sets(id uuid primary key,spec_point_id uuid);
create table mcq_questions(id uuid primary key,set_id uuid,spec_point_id uuid);
create table homework_submissions(id uuid primary key,student_id uuid,resource_id uuid,score_pct numeric,graded_at timestamptz,submitted_at timestamptz);
create table mcq_attempts(id uuid primary key,user_id uuid,set_id uuid,score int,total int,created_at timestamptz,point_scores jsonb);
create table student_spec_point_schedule(id uuid);
create table student_spec_point_reviews(id uuid);
create function record_reviews_atomic(jsonb) returns void language sql as 'select';
grant usage on schema public to authenticated, anon, service_role;
grant select on all tables in schema public to authenticated, service_role;
grant all on student_spec_point_schedule, student_spec_point_reviews to authenticated;
alter table homework_submissions enable row level security;
alter table mcq_attempts enable row level security;
create policy own_homework on homework_submissions for select to authenticated using(student_id = current_setting('test.viewer')::uuid);
create policy own_quiz on mcq_attempts for select to authenticated using(user_id = current_setting('test.viewer')::uuid);
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20260907120000_planner_read_models.sql", import.meta.url), "utf8"));
const a = "00000000-0000-0000-0000-000000000001";
const b = "00000000-0000-0000-0000-000000000002";
const point = "00000000-0000-0000-0000-000000000003";
await db.exec(`
insert into topics values ('${a}','Topic',1,'biology','aqa','gcse');
insert into spec_points values ('${point}','${a}','B1','Point',1,1);
insert into resources values ('${a}','homework','${point}');
insert into resource_spec_points values ('${a}','${point}');
insert into mcq_sets values ('${a}','${point}'), ('${b}',null);
insert into mcq_questions values ('${a}','${a}',null), ('${b}','${b}','${point}'), ('${point}','${b}',null);
insert into homework_submissions values ('${a}','${a}','${a}',75,now(),now()), ('${b}','${b}','${a}',99,now(),now());
insert into mcq_attempts select md5(i::text)::uuid,'${a}','${a}',1,1,now(),jsonb_build_object('${point}',100) from generate_series(1,1205) i;
set role authenticated; set test.viewer = '${a}';
`);
const snapshot = (await db.query(`select planner_course_snapshot('${a}','biology','aqa','gcse') as data`)).rows[0].data;
assert.equal(snapshot.attempts.length,1205, "RPC must not truncate history");
assert.equal(snapshot.submissions.length,1);
assert.equal(snapshot.sources.resourceLinks.length,1, "direct/junction links deduplicate");
assert(snapshot.sources.setScope.some((s: any) => s.set_id === b && s.spec_point_id === "__unattributed__"));
const other = (await db.query(`select planner_course_snapshot('${b}','biology','aqa','gcse') as data`)).rows[0].data;
assert.equal(other.submissions.length,0, "RLS blocks other students' evidence");
assert.equal(other.attempts.length,0);
const privileges = (await db.query(`select
 has_table_privilege('authenticated','student_spec_point_schedule','INSERT') as card_write,
 has_table_privilege('authenticated','student_spec_point_reviews','INSERT') as ledger_write,
 has_function_privilege('authenticated','record_reviews_atomic(jsonb)','EXECUTE') as rpc_write,
 has_function_privilege('anon','planner_attempt_sources(uuid[])','EXECUTE') as anon_read`)).rows[0];
assert.deepEqual(privileges,{card_write:false,ledger_write:false,rpc_write:false,anon_read:false});
await db.exec("reset role; set role service_role;");
const job = (await db.query(`select planner_course_snapshot('${b}','biology','aqa','gcse') as data`)).rows[0].data;
assert.equal(job.submissions.length,1, "service jobs can use the same read model");
await db.close();
console.log("Planner RPC checks passed: SQL execution, 1,205 attempts, attribution, RLS, anonymous denial, retired write denial, service access.");
