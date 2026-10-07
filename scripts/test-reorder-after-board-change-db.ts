/** Isolated PostgreSQL regression checks: a topic reorder after a board or level
 * change (20261007130000). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-reorder-after-board-change-db.ts
 *
 * Production's planner functions come from the migrations that hold them,
 * md5-checked against production on 7 Oct 2026 (comment lines aside):
 * save_weekly_plan and reorder_student_topics from 20260922104641,
 * enforce_plan_point_admissible from 20260915120000 and
 * enforce_plan_matches_enrolment from 20260907140000.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints, type PacingBand } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics } from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
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
const examDate = week(10);

type Course = { board: "edexcel" | "aqa"; level: "gcse" | "igcse" };
/** Three Biology topics of eight points each, ids numbered from `base`. */
const courseOf = (course: Course, base: number) => ({
  course,
  topics: [1, 2, 3].map((n) => ({
    topicId: uuid(base + n),
    title: `${course.board} ${course.level} topic ${n}`,
    points: Array.from({ length: 8 }, (_, i) => ({
      specPointId: uuid((base + n) * 100 + i),
      code: `${n}.${i}`,
      title: `Point ${i}`,
      weight: 1,
    })),
  })),
});
// The student starts on Edexcel GCSE; a tutor moves the board, or the level.
const courses = [
  courseOf({ board: "edexcel", level: "gcse" }, 100),
  courseOf({ board: "aqa", level: "gcse" }, 200),
  courseOf({ board: "edexcel", level: "igcse" }, 300),
];
const [before, ...after] = courses;
const topicsFor = (to: Course) =>
  courses.find((c) => c.course.board === to.board && c.course.level === to.level)!.topics;
const old = before.topics[0].points.map((p) => p.specPointId);
// This week, cut for the old course. Which rows a re-cut keeps is the point.
const ticked = old[0];
const ownPick = old[1];
const carried = old[2];
const review = old[3];
const untouched = old[4];
const workedThisWeek = old[5];
const workedEarlier = old[6];
const pastPoint = old[7];
const pacingFor = (topics: typeof before.topics, from: string): PacingBand[] =>
  computePacing(
    topics.map((t) => ({ ...t, weight: t.points.length })),
    weekKeyToDate(from),
    weekKeyToDate(examDate),
  );

/**
 * Production as it stands, holding a student on Edexcel GCSE Biology whose
 * course has just changed to `to`. The student's next planner load re-seeds
 * the spine for the new course from this week, as ProgramDAL.loadRoadmap does.
 */
async function build(to: Course, withFix: boolean) {
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
create type subject as enum ('biology'); create type board as enum ('edexcel','aqa'); create type level as enum ('gcse','igcse');
create type plan_source as enum ('ai','student','tutor');
create type plan_point_origin as enum ('ai','student','tutor','carried_over','core','focus');
create table profiles(id uuid primary key, level level);
create table student_enrolments(student_id uuid, subject subject, board board, unique(student_id, subject));
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
  await db.exec(await migration("20260922104641_planner_tutor_overrides.sql"));
  await db.exec(await migration("20261001125425_plan_override_tutor_check_definer.sql"));
  await db.exec(
    await functionFrom("20260915120000_student_topic_order.sql", "enforce_plan_point_admissible"),
  );
  await db.exec(
    await functionFrom(
      "20260907140000_preserve_inadmissible_history.sql",
      "enforce_plan_matches_enrolment",
    ),
  );
  await db.exec(`
create trigger plan_point_admissible before insert or update of spec_point_id, origin, plan_id
  on student_weekly_plan_points for each row execute function enforce_plan_point_admissible();
create trigger plan_matches_enrolment before insert or update of student_id, subject, board, level
  on student_weekly_plans for each row execute function enforce_plan_matches_enrolment();
`);
  if (withFix) {
    const fix = await migration("20261007130000_reorder_skips_other_course.sql");
    await db.exec(fix);
    await db.exec(fix); // idempotent
  }

  for (const { course, topics } of courses)
    for (const t of topics) {
      await db.query("insert into topics values ($1,'biology',$2,$3)", [
        t.topicId,
        course.board,
        course.level,
      ]);
      for (const p of t.points)
        await db.query("insert into spec_points values($1,$2)", [p.specPointId, t.topicId]);
    }
  await db.query("insert into auth.users values($1)", [student]);
  await db.query("insert into profiles values($1,'gcse')", [student]);
  await db.query("insert into student_enrolments values($1,'biology','edexcel')", [student]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [student, week(-2), examDate, JSON.stringify(pacingFor(before.topics, week(-2)))],
  );
  const [pastPlan, thisPlan] = [uuid(50), uuid(51)];
  for (const [id, w] of [
    [pastPlan, week(-1)],
    [thisPlan, today],
  ])
    await db.query(
      "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source) values($1,$2,'biology','edexcel','gcse',$3,'ai')",
      [id, student, w],
    );
  await db.query("insert into student_weekly_plan_points values($1,$2,'core',null,null)", [
    pastPlan,
    pastPoint,
  ]);
  for (const [point, origin, carriedFrom, done] of [
    [ticked, "core", null, new Date().toISOString()],
    [ownPick, "student", null, null],
    [carried, "core", week(-1), null],
    [review, "focus", null, null],
    [untouched, "core", null, null],
    [workedThisWeek, "core", null, null],
    [workedEarlier, "core", null, null],
  ])
    await db.query("insert into student_weekly_plan_points values($1,$2,$3,$4,$5)", [
      thisPlan,
      point,
      origin,
      carriedFrom,
      done,
    ]);
  for (const [point, when] of [
    [workedThisWeek, today],
    [workedEarlier, week(-1)],
  ])
    await db.query("insert into mcq_attempts values($1,$2,$3,null)", [
      student,
      `${when}T12:00:00Z`,
      JSON.stringify({ [point]: 50 }),
    ]);

  // The change itself: a plain update, as both course editors write it.
  if (to.board !== before.course.board)
    await db.query("update student_enrolments set board=$2 where student_id=$1", [
      student,
      to.board,
    ]);
  if (to.level !== before.course.level)
    await db.query("update profiles set level=$2 where id=$1", [student, to.level]);
  const topics = topicsFor(to);
  const spine = pacingFor(topics, today);
  await db.query(
    "update student_program_plan set program_start=$2, pacing=$3 where student_id=$1",
    [student, today, JSON.stringify(spine)],
  );

  await db.exec(`grant usage on schema public,auth to authenticated;
 grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid()) with check(student_id=auth.uid());
 set role authenticated;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [student]);

  const preview = reorderTopics({
    bands: spine,
    topics,
    from: today,
    examDate,
    order: orderInputs(spine, topics, today)
      .remaining.map((t) => t.topicId)
      .reverse(),
  });
  const thisWeek = (bands: PacingBand[]) =>
    withWeeklyPoints(bands, new Map(topics.map((t) => [t.topicId, t.points]))).flatMap(
      (b) => b.pointsByWeek?.[today]?.map((p) => p.specPointId) ?? [],
    );
  return {
    db,
    pastPlan,
    thisPlan,
    preview,
    /** The planner's own re-cut of this week (useWeekPlan → refreshWeek → savePlan):
     * old-course rows read back as withheld, so only the new course's cut is sent. */
    recut: () =>
      db.query("select save_weekly_plan($1,'biology',$2,$3,$4,'ai','re-cut',$5)", [
        student,
        to.board,
        to.level,
        today,
        JSON.stringify(thisWeek(spine).map((id) => ({ spec_point_id: id, origin: "core" }))),
      ]),
    /** The student's reorder from this week, as ProgramDAL.reorder sends it. */
    reorder: (expected: PacingBand[] = spine, pacing: PacingBand[] = preview) =>
      db.query("select reorder_student_topics('biology',$1,$2,$3,$4,$5,$6,$7,$8)", [
        to.board,
        to.level,
        today,
        JSON.stringify(expected),
        examDate,
        JSON.stringify(pacing),
        [],
        "[]",
      ]),
    newTeaching: thisWeek(preview),
  };
}

const rows = async (db: InstanceType<typeof PGlite>, plan: string) =>
  (
    await db.query<{ spec_point_id: string; origin: string; done_at: string | null }>(
      "select spec_point_id, origin, done_at from student_weekly_plan_points where plan_id=$1 order by spec_point_id",
      [plan],
    )
  ).rows;
const ids = (list: { spec_point_id: string }[]) => list.map((r) => r.spec_point_id);
const oldCourse = new Set(before.topics.flatMap((t) => t.points.map((p) => p.specPointId)));
const describe = (to: Course) => `${to.board} ${to.level}`;

// ── 1 · Production before this migration: the reorder is refused ─────────
for (const { course: to } of after)
  for (const recutFirst of [false, true]) {
    const t = await build(to, false);
    if (recutFirst) await t.recut();
    await assert.rejects(
      t.reorder(),
      /is on a different course/,
      `Expected the unfixed reorder to fail after a move to ${describe(to)}`,
    );
    await t.db.close();
  }

// ── 2 · With it: the reorder goes through, old-course work stays put ──────
for (const { course: to } of after)
  for (const recutFirst of [false, true]) {
    const label = `${describe(to)}, ${recutFirst ? "after" : "before"} This week's re-cut`;
    const t = await build(to, true);
    const past = await rows(t.db, t.pastPlan);
    if (recutFirst) await t.recut();
    await t.reorder();

    const plan = (
      await t.db.query<{ board: string; level: string }>(
        "select board::text, level::text from student_weekly_plans where id=$1",
        [t.thisPlan],
      )
    ).rows[0];
    assert.deepEqual(plan, { board: to.board, level: to.level }, `Week not moved: ${label}`);
    const saved = (
      await t.db.query<{ pacing: unknown }>(
        "select pacing from student_program_plan where student_id=$1",
        [student],
      )
    ).rows[0].pacing;
    assert.deepEqual(saved, JSON.parse(JSON.stringify(t.preview)), `Order not saved: ${label}`);

    const kept = await rows(t.db, t.thisPlan);
    // Exactly what save_weekly_plan protects, as the This week re-cut leaves it.
    assert.deepEqual(
      ids(kept.filter((r) => oldCourse.has(r.spec_point_id))),
      [ticked, ownPick, carried, workedThisWeek].sort(),
      `Old-course rows: ${label}`,
    );
    assert(kept.find((r) => r.spec_point_id === ticked)?.done_at, "Tick lost");
    assert.equal(kept.find((r) => r.spec_point_id === ownPick)?.origin, "student", "Pick lost");
    assert(t.newTeaching.length > 0, "Fixture: the new order teaches nothing this week");
    assert(
      t.newTeaching.every((id) => ids(kept).includes(id)),
      `New order's teaching missing: ${label}`,
    );
    assert.deepEqual(await rows(t.db, t.pastPlan), past, `Past week changed: ${label}`);

    // And again, now that the week is on the new course and still holds old rows.
    const topics = topicsFor(to);
    const back = reorderTopics({
      bands: t.preview,
      topics,
      from: today,
      examDate,
      order: orderInputs(t.preview, topics, today)
        .remaining.map((x) => x.topicId)
        .reverse(),
    });
    await t.reorder(t.preview, back);
    assert.deepEqual(
      ids((await rows(t.db, t.thisPlan)).filter((r) => oldCourse.has(r.spec_point_id))),
      [ticked, ownPick, carried, workedThisWeek].sort(),
      `A second reorder changed the old-course rows: ${label}`,
    );
    await t.db.close();
  }

console.log(
  "PASS: unfixed reorder refused after a board or level change; fixed reorder saves the new order, moves the week, keeps old-course ticked/picked/carried/worked rows exactly as This week's re-cut does, leaves past weeks alone, and reorders again.",
);
