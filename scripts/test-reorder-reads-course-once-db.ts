/** Isolated PostgreSQL regression checks: a topic reorder reads the course's
 * points once (20261109165500). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-reorder-reads-course-once-db.ts
 *
 * On 9 Nov 2026 a new student's reorder of Edexcel A-level Chemistry ran past
 * the 8 s statement timeout twice and rolled back, leaving curriculum order.
 * The check that every point is one of the course's, in its own topic and
 * band, read spec_points again for every week of the plan, under the
 * student's read rules. This proves that the new check refuses exactly what
 * the old one refused, with the same message, and reads spec_points a fixed
 * number of times however many weeks the plan has.
 *
 * Production's functions come from the migrations that hold them, as in
 * test-reorder-on-a-break-db.ts. The read rules here have production's shape:
 * a tutor test evaluated row by row, or a topic the student may read.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, type PacingBand } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics } from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const FIX = "20261109165500_reorder_reads_course_once";
const BEFORE = "20261007112100_reorder_skips_break_weeks.sql";
const BREAKS = "20261005160000_student_breaks.sql";
const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
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
const tutor = uuid(3);
const today = currentWeekKey();
const week = (n: number) => toDateKey(addWeeks(weekKeyToDate(today), n));
const WEEKS = 20;
const examDate = week(WEEKS);

/** Four Biology topics of ten points each; the programme began two weeks ago. */
const topics = [1, 2, 3, 4].map((n) => ({
  topicId: uuid(100 + n),
  title: `Topic ${n}`,
  points: Array.from({ length: 10 }, (_, i) => ({
    specPointId: uuid((100 + n) * 100 + i),
    code: `${n}.${i}`,
    title: `Point ${i}`,
    weight: 1,
  })),
}));
/** Another course's topic, as the live table holds every course side by side. */
const otherTopic = uuid(900);
const otherPoints = Array.from({ length: 1500 }, (_, i) => uuid(9_000_000 + i));
const spine: PacingBand[] = computePacing(
  topics.map((t) => ({ ...t, weight: t.points.length })),
  weekKeyToDate(week(-2)),
  weekKeyToDate(examDate),
);
/** The student's new order from this week: the remaining topics backwards. */
const preview = reorderTopics({
  bands: spine,
  topics,
  from: today,
  examDate,
  order: orderInputs(spine, topics, today)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
const weeksWithPoints = new Set(preview.flatMap((b) => Object.keys(b.pointsByWeek ?? {}))).size;
assert(
  weeksWithPoints >= 10,
  `Fixture: the order should teach over many weeks, not ${weeksWithPoints}`,
);

/** Production as it stands, with the reorder from `body`. */
async function build(body: string) {
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
create type subject as enum ('biology','chemistry'); create type board as enum ('edexcel'); create type level as enum ('gcse');
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
-- Who may read which topic: production's paid subjects, in a table of its own.
create table readable_topics(student_id uuid, topic_id uuid);
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
  await db.exec(await slice(BREAKS, "create table public.student_breaks (", "\n);"));
  await db.exec(
    await slice(
      BREAKS,
      "create or replace function private.refuse_planning_on_a_break()",
      "$function$;",
    ),
  );
  await db.exec(`
create trigger plan_point_admissible before insert or update of spec_point_id, origin, plan_id
  on student_weekly_plan_points for each row execute function enforce_plan_point_admissible();
create trigger plan_matches_enrolment before insert or update of student_id, subject, board, level
  on student_weekly_plans for each row execute function enforce_plan_matches_enrolment();
`);
  await db.exec(await slice(BREAKS, "create trigger plan_not_on_a_break", ";"));
  await db.exec(await slice(BREAKS, "create trigger plan_point_not_on_a_break", ";"));
  await db.exec(body);
  await db.exec(body); // idempotent

  for (const t of topics) {
    await db.query("insert into topics values ($1,'biology','edexcel','gcse')", [t.topicId]);
    await db.query("insert into readable_topics values ($1,$2)", [student, t.topicId]);
    for (const p of t.points)
      await db.query("insert into spec_points values($1,$2)", [p.specPointId, t.topicId]);
  }
  await db.query("insert into topics values ($1,'chemistry','edexcel','gcse')", [otherTopic]);
  await db.query("insert into readable_topics values ($1,$2)", [student, otherTopic]);
  await db.query("insert into spec_points select unnest($1::uuid[]), $2", [
    otherPoints,
    otherTopic,
  ]);
  for (const id of [student, tutor]) await db.query("insert into auth.users values($1)", [id]);
  await db.query("insert into user_roles values($1,'tutor')", [tutor]);
  await db.query("insert into profiles values($1,'gcse')", [student]);
  await db.query("insert into student_enrolments values($1,'biology','edexcel')", [student]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [student, week(-2), examDate, JSON.stringify(spine)],
  );
  // This week as the planner saved it on Monday: the spine's cut, one point ticked.
  const plan = uuid(50);
  await db.query(
    "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source) values($1,$2,'biology','edexcel','gcse',$3,'ai')",
    [plan, student, today],
  );
  const band = spine.find((b) => b.startWeek <= today && b.endWeek >= today)!;
  const cut = topics.find((t) => t.topicId === band.topicId)!.points.slice(0, 4);
  for (const [i, p] of cut.entries())
    await db.query("insert into student_weekly_plan_points values($1,$2,'core',null,$3)", [
      plan,
      p.specPointId,
      i === 0 ? new Date().toISOString() : null,
    ]);

  // Production's read rules, in their shape: the tutor test runs row by row.
  await db.exec(`grant usage on schema public,auth to authenticated;
 grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));
 alter table spec_points enable row level security;
 create policy read on spec_points for select to authenticated using (
   exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor')
   or topic_id in (select topic_id from readable_topics where student_id = auth.uid()));
 alter table topics enable row level security;
 create policy read on topics for select to authenticated using (
   exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor')
   or id in (select topic_id from readable_topics where student_id = auth.uid()));`);
  await db.exec(
    await slice(
      BREAKS,
      "alter table public.student_breaks enable row level security;",
      "grant select on public.student_breaks to authenticated;",
    ),
  );
  return db;
}

/**
 * One reorder, as ProgramDAL.reorder sends it. A refusal leaves the role set:
 * the transaction it ran in is rolled back, and that resets the role too.
 */
const reorder = async (db: InstanceType<typeof PGlite>, pacing: unknown, as = student) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [as]);
  await db.exec("set role authenticated");
  await db.query("select reorder_student_topics('biology','edexcel','gcse',$1,$2,$3,$4,$5,$6,$7)", [
    today,
    JSON.stringify(spine),
    examDate,
    JSON.stringify(pacing),
    [],
    "[]",
    as === student ? null : student,
  ]);
  await db.exec("reset role");
};

/** What a reorder did: its refusal, or the plan and this week as saved. */
async function outcome(db: InstanceType<typeof PGlite>, pacing: unknown, as = student) {
  await db.exec("begin");
  try {
    await reorder(db, pacing, as);
    const plan = await db.query("select pacing from student_program_plan");
    const week = await db.query(
      "select spec_point_id, origin::text, carried_from, done_at is not null as done from student_weekly_plan_points order by spec_point_id",
    );
    return { refused: null, plan: plan.rows, week: week.rows };
  } catch (e) {
    return { refused: (e as Error).message };
  } finally {
    await db.exec("rollback");
  }
}

// ── The orders checked, valid and not ─────────────────────────────────────
const copy = () => JSON.parse(JSON.stringify(preview)) as PacingBand[];
const future = (bands: PacingBand[]) => bands.filter((b) => b.startWeek >= today);
/** The first point of a band's first week, taken out of it. */
function takeFirst(band: PacingBand) {
  const key = Object.keys(band.pointsByWeek!).sort()[0];
  return { key, point: band.pointsByWeek![key].shift()! };
}
const cases: [string, () => unknown, string | null][] = [
  ["the new order", () => preview, null],
  [
    "a point under another topic's band",
    () => {
      const bands = copy();
      const [a, b] = future(bands);
      const { point } = takeFirst(a);
      b.pointsByWeek![Object.keys(b.pointsByWeek!).sort()[0]].push(point);
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
  [
    "a point from another course",
    () => {
      const bands = copy();
      const band = future(bands)[0];
      const key = Object.keys(band.pointsByWeek!).sort()[0];
      band.pointsByWeek![key][0] = { ...band.pointsByWeek![key][0], specPointId: otherPoints[0] };
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
  [
    "a point in a week outside its band",
    () => {
      const bands = copy();
      const band = future(bands)[0];
      const { point } = takeFirst(band);
      band.pointsByWeek![toDateKey(addWeeks(weekKeyToDate(band.endWeek), 1))] = [point];
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
  [
    "a week that is not a Monday",
    () => {
      const bands = copy();
      const band = future(bands)[0];
      const { point } = takeFirst(band);
      const tuesday = toDateKey(new Date(weekKeyToDate(band.startWeek).getTime() + 86_400_000));
      band.pointsByWeek![tuesday] = [point];
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
  [
    "a point no course has",
    () => {
      const bands = copy();
      const band = future(bands)[0];
      const key = Object.keys(band.pointsByWeek!).sort()[0];
      band.pointsByWeek![key][0] = { ...band.pointsByWeek![key][0], specPointId: uuid(77777) };
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
  [
    "a point id that is not a uuid",
    () => {
      const bands = copy();
      const band = future(bands)[0];
      const key = Object.keys(band.pointsByWeek!).sort()[0];
      band.pointsByWeek![key][0] = { ...band.pointsByWeek![key][0], specPointId: "not-a-uuid" };
      return bands;
    },
    "A point is outside its topic or teaching dates.",
  ],
];

const before = await build(await migration(BEFORE));
const after = await build(await migration(`${FIX}.sql`));

// ── 1 · The same answer as before, for every order ────────────────────────
for (const [label, pacing, refusal] of cases) {
  const old = await outcome(before, pacing());
  const now = await outcome(after, pacing());
  assert.equal(old.refused, refusal, `Fixture: the old reorder's answer to ${label}`);
  assert.deepEqual(now, old, `Not the same answer as before: ${label}`);
}
// A tutor reorders for the student as before.
assert.deepEqual(
  await outcome(after, preview, tutor),
  await outcome(before, preview, tutor),
  "Not the same answer as before: a tutor's reorder",
);
// A topic the student may not read is refused as before: the read rules still apply.
for (const db of [before, after])
  await db.query("delete from readable_topics where topic_id=$1", [future(preview)[0].topicId]);
const hidden = await outcome(before, preview);
assert.equal(hidden.refused, "A point is outside its topic or teaching dates.");
assert.deepEqual(await outcome(after, preview), hidden, "A hidden topic is no longer refused");
for (const db of [before, after])
  await db.query("insert into readable_topics values ($1,$2)", [
    student,
    future(preview)[0].topicId,
  ]);

// ── 2 · spec_points is read whole a few times, not once a week ────────────
/** Whole-table reads of spec_points during one reorder (a looked-up row doesn't count). */
async function specPointScans(db: InstanceType<typeof PGlite>) {
  const read = async () => {
    await db.query("select pg_stat_force_next_flush()");
    await db.query("select pg_stat_clear_snapshot()");
    return Number(
      (
        await db.query<{ n: number }>(
          "select seq_scan as n from pg_stat_user_tables where relname = 'spec_points'",
        )
      ).rows[0].n,
    );
  };
  const start = await read();
  await reorder(db, preview);
  return (await read()) - start;
}
const oldScans = await specPointScans(before);
const newScans = await specPointScans(after);
assert(
  oldScans >= weeksWithPoints,
  `Fixture: the old reorder should read spec_points once a week (${oldScans} reads, ${weeksWithPoints} weeks)`,
);
// Three, however long the plan: the course's points for this check, the
// course count, and the join that finds this week's protected work.
assert(
  newScans <= 3,
  `The reorder still reads spec_points once a week: ${newScans} whole reads over ${weeksWithPoints} weeks (was ${oldScans})`,
);
await before.close();

// ── 3 · The rollback puts the old body back ───────────────────────────────
const source = async (db: InstanceType<typeof PGlite>) =>
  (
    await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'reorder_student_topics'",
    )
  ).rows[0].src;
const reference = await build(await migration(BEFORE));
await after.exec(
  await readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8"),
);
assert.equal(await source(after), await source(reference), "Rollback did not restore the old body");
await after.close();
await reference.close();

console.log(
  `PASS: the reorder refuses exactly what it refused before, with the same message (another topic's band, another course, a week outside the band, a non-Monday, an unknown or malformed point, a topic the student can't read) and saves the same plan and week for a student and a tutor; whole reads of spec_points ${oldScans} → ${newScans} over a ${weeksWithPoints}-week plan; rollback restores the old body.`,
);
