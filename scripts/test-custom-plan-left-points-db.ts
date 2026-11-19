/** Isolated PostgreSQL checks: a custom calendar can still be re-planned after
 * a point one of its past weeks set leaves the course (20261119222800, audit
 * finding H2). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-custom-plan-left-points-db.ts
 *
 * A custom calendar stores the points each week set. When one of those points
 * later leaves the course (marked not examined, deleted) or moves topic, the
 * planner sends the weeks gone by back as stored, as both functions require,
 * and the same functions then refused the point for not being on today's
 * course, and the count for not matching the course. Every later reorder and
 * pause pick-up failed. This builds production's functions twice, before and
 * after the fix, and shows that only those plans change answer: the left point
 * is accepted in a week gone by, and refused as before in a week being
 * re-planned, and every other order gets the same answer as before.
 *
 * Production's functions come from the migrations that hold them, as in
 * test-reorder-reads-course-once-db.ts, with production's read rules.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, type PacingBand } from "../src/lib/planner/pacing";
import {
  orderInputs,
  reorderTopics,
  resumeAfterPause,
  type OrderTopic,
} from "../src/lib/planner/topicOrder";
import { addWeeks, currentWeekKey, toDateKey, weekKeyToDate } from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const FIX = "20261119222800_custom_plan_left_points";
const BEFORE = "20261116210000_not_examined_points.sql";
const BREAKS = "20261005160000_student_breaks.sql";
const PAUSES = "20261004090000_subject_pauses.sql";
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
const start = week(-4);
const examDate = week(20);
/** The week the pause began, and the week the student came back. */
const pausedFrom = week(-2);
const resumeFrom = today;

/** Three Biology topics of ten points each. */
const topics: OrderTopic[] = [1, 2, 3].map((n) => ({
  topicId: uuid(100 + n),
  title: `Topic ${n}`,
  points: Array.from({ length: 10 }, (_, i) => ({
    specPointId: uuid((100 + n) * 100 + i),
    code: `${n}.${i}`,
    title: `Point ${i}`,
    weight: 1,
  })),
}));
/** The student's own order, saved on the programme's first Monday: a custom calendar. */
const spine = computePacing(
  topics.map((t) => ({ ...t, weight: t.points.length })),
  weekKeyToDate(start),
  weekKeyToDate(examDate),
);
const stored: PacingBand[] = reorderTopics({
  bands: spine,
  topics,
  from: start,
  examDate,
  today: start,
  order: orderInputs(spine, topics, start)
    .remaining.map((t) => t.topicId)
    .reverse(),
});
/** The point the programme's first week set, and one the second week set. */
const firstBand = stored.find((b) => b.startWeek === start)!;
const firstWeeks = Object.entries(firstBand.pointsByWeek!).sort(([a], [b]) => a.localeCompare(b));
assert.equal(firstWeeks[0][0], start, "Fixture: the first week sets points");
assert(firstWeeks[1][0] < pausedFrom, "Fixture: the second week is before the pause");
const left = firstWeeks[0][1][0].specPointId;
const moved = firstWeeks[1][1][0].specPointId;
const movedTo = topics.find((t) => t.topicId !== firstBand.topicId)!.topicId;
/** The course as the planner reads it once `left` is no longer examined. */
const withoutLeft = topics.map((t) => ({
  ...t,
  points: t.points.filter((p) => p.specPointId !== left),
}));
/** The course as the planner reads it once `moved` belongs to another topic. */
const withMoved = topics.map((t) => {
  const point = topics.flatMap((x) => x.points).find((p) => p.specPointId === moved)!;
  const points = t.points.filter((p) => p.specPointId !== moved);
  return { ...t, points: t.topicId === movedTo ? [...points, point] : points };
});

/** Production as it stands, with the two functions from `body`. */
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
create table readable_topics(student_id uuid, topic_id uuid);
`);
  await db.exec(await migration("20260922104641_planner_tutor_overrides.sql"));
  await db.exec(await migration("20261001125425_plan_override_tutor_check_definer.sql"));
  await db.exec(await slice(PAUSES, "create table public.student_subject_pauses (", "\n);"));
  await db.exec(await slice(BREAKS, "create table public.student_breaks (", "\n);"));
  await db.exec(
    await slice(
      BREAKS,
      "create or replace function private.refuse_planning_on_a_break()",
      "$function$;",
    ),
  );
  await db.exec(await slice(BREAKS, "create trigger plan_not_on_a_break", ";"));
  await db.exec(body);
  await db.exec(body); // idempotent

  for (const t of topics) {
    await db.query("insert into topics values ($1,'biology','edexcel','gcse')", [t.topicId]);
    await db.query("insert into readable_topics values ($1,$2)", [student, t.topicId]);
    for (const p of t.points)
      await db.query("insert into spec_points (id, topic_id) values ($1,$2)", [
        p.specPointId,
        t.topicId,
      ]);
  }
  for (const id of [student, tutor]) await db.query("insert into auth.users values($1)", [id]);
  await db.query("insert into user_roles values($1,'tutor')", [tutor]);
  await db.query("insert into profiles values($1,'gcse')", [student]);
  await db.query("insert into student_enrolments values($1,'biology','edexcel')", [student]);
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [student, start, examDate, JSON.stringify(stored)],
  );
  // Paused from the Monday two weeks ago, back this Monday.
  await db.query(
    "insert into public.student_subject_pauses (id, student_id, subject, reason, started_at, ended_at) values ($1,$2,'biology','paused',$3,$4)",
    [uuid(60), student, `${pausedFrom}T12:00:00Z`, `${resumeFrom}T12:00:00Z`],
  );

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

type Db = InstanceType<typeof PGlite>;
/** A reorder from this week, as ProgramDAL.reorder sends it. */
const reorder = (pacing: unknown, as: string) => async (db: Db) => {
  await db.query("select reorder_student_topics('biology','edexcel','gcse',$1,$2,$3,$4,$5,$6,$7)", [
    today,
    JSON.stringify(stored),
    examDate,
    JSON.stringify(pacing),
    [],
    "[]",
    as === student ? null : student,
  ]);
};
/** The pick-up after the pause, as ProgramDAL sends it. */
const resume = (pacing: unknown) => async (db: Db) => {
  await db.query("select public.resume_programme_after_pause($1,$2,$3)", [
    uuid(60),
    JSON.stringify(stored),
    JSON.stringify(pacing),
  ]);
};

/**
 * What one call did, after `setup` changed the course: its refusal, or the
 * plan as saved. Everything is rolled back afterwards.
 */
async function outcome(
  db: Db,
  setup: string,
  call: (db: Db) => Promise<void>,
  as = student,
): Promise<{ refused: string | null; plan?: unknown }> {
  await db.exec("begin");
  try {
    if (setup) await db.exec(setup);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [as]);
    await db.exec("set local role authenticated");
    await call(db);
    await db.exec("reset role");
    const plan = await db.query<{ pacing: unknown }>("select pacing from student_program_plan");
    return { refused: null, plan: plan.rows[0].pacing };
  } catch (e) {
    return { refused: (e as Error).message };
  } finally {
    await db.exec("rollback");
  }
}

// As the database hands JSON back: no undefined fields.
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const placedIn = (bands: PacingBand[], from: string, to: string) =>
  bands.flatMap((b) =>
    Object.entries(b.pointsByWeek ?? {})
      .filter(([w]) => w >= from && w < to)
      .flatMap(([, points]) => points.map((p) => p.specPointId)),
  );
/** The same order, with `point` also put into the first week the change re-plans. */
function plus(bands: PacingBand[], point: string, from: string): PacingBand[] {
  const out = structuredClone(bands);
  const band = out.find((b) => b.startWeek >= from)!;
  const key = Object.keys(band.pointsByWeek!).sort()[0];
  band.pointsByWeek![key] = [
    ...band.pointsByWeek![key],
    { specPointId: point, code: "x", title: "x", weight: 1 },
  ];
  return out;
}
/** The same order, with the first re-planned week's first point set again in its band's last week. */
function twice(bands: PacingBand[], from: string): PacingBand[] {
  const out = structuredClone(bands);
  const band = out.find((b) => b.startWeek >= from)!;
  const keys = Object.keys(band.pointsByWeek!).sort();
  assert(keys.length > 1, "Fixture: the band spans more than one week");
  band.pointsByWeek![keys.at(-1)!].push(band.pointsByWeek![keys[0]][0]);
  return out;
}
/** The same order, without the first point of its last re-planned week. */
function minusLast(bands: PacingBand[]): PacingBand[] {
  const out = structuredClone(bands);
  const band = out.at(-1)!;
  const key = Object.keys(band.pointsByWeek!).sort().at(-1)!;
  band.pointsByWeek![key] = band.pointsByWeek![key].slice(1);
  return out;
}

const NOT_EXAMINED = `update spec_points set not_examined = true where id = '${left}';`;
const DELETED = `delete from spec_points where id = '${left}';`;
const MOVED = `update spec_points set topic_id = '${movedTo}' where id = '${moved}';`;
const OUTSIDE = "A point is outside its topic or teaching dates.";
const ONCE = "Every course point must appear exactly once. Reload if the curriculum changed.";

/** The orders the planner sends for each course. */
const order = (course: OrderTopic[]) =>
  reorderTopics({
    bands: stored,
    topics: course,
    from: today,
    examDate,
    order: orderInputs(stored, course, today)
      .remaining.map((t) => t.topicId)
      .reverse(),
  });
const pickUp = (course: OrderTopic[]) =>
  resumeAfterPause({ bands: stored, topics: course, pausedFrom, resumeFrom, examDate });
const reorderLeft = order(withoutLeft);
const reorderMoved = order(withMoved);
const resumeLeft = pickUp(withoutLeft);
const resumeMoved = pickUp(withMoved);
// The planner keeps the weeks gone by as stored, so the left point is still in them.
for (const bands of [reorderLeft, reorderMoved])
  assert(placedIn(bands, start, today).includes(left), "Fixture: the past weeks keep the point");
for (const bands of [resumeLeft, resumeMoved])
  assert(placedIn(bands, start, pausedFrom).includes(left), "Fixture: the past weeks keep it");
assert(!placedIn(reorderLeft, today, examDate).includes(left), "Fixture: not placed again");
assert(!placedIn(resumeLeft, pausedFrom, examDate).includes(left), "Fixture: not placed again");

type Case = {
  label: string;
  /** How the course changed since the calendar was saved. */
  setup: string;
  call: (db: Db) => Promise<void>;
  as?: string;
  /** The refusal before the fix, and after it (null: saved). */
  before: string | null;
  after: string | null;
  /** What the fix saves, when it newly accepts the call. */
  saves?: PacingBand[];
};
const cases: Case[] = [
  // ── Re-plannable again ────────────────────────────────────────────────
  {
    label: "reorder: a past week's point no longer examined",
    setup: NOT_EXAMINED,
    call: reorder(reorderLeft, student),
    before: OUTSIDE,
    after: null,
    saves: reorderLeft,
  },
  {
    label: "reorder by a tutor: a past week's point no longer examined",
    setup: NOT_EXAMINED,
    call: reorder(reorderLeft, tutor),
    as: tutor,
    before: OUTSIDE,
    after: null,
    saves: reorderLeft,
  },
  {
    label: "reorder: a past week's point deleted",
    setup: DELETED,
    call: reorder(reorderLeft, student),
    before: OUTSIDE,
    after: null,
    saves: reorderLeft,
  },
  {
    label: "reorder: a past week's point moved topic",
    setup: MOVED,
    call: reorder(reorderMoved, student),
    before: OUTSIDE,
    after: null,
    saves: reorderMoved,
  },
  {
    label: "pick-up: a past week's point no longer examined",
    setup: NOT_EXAMINED,
    call: resume(resumeLeft),
    before: OUTSIDE,
    after: null,
    saves: resumeLeft,
  },
  {
    label: "pick-up: a past week's point moved topic",
    setup: MOVED,
    call: resume(resumeMoved),
    before: OUTSIDE,
    after: null,
    saves: resumeMoved,
  },
  // ── Still refused ─────────────────────────────────────────────────────
  {
    label: "reorder: the left point placed again from this week",
    setup: NOT_EXAMINED,
    call: reorder(plus(reorderLeft, left, today), student),
    before: OUTSIDE,
    after: OUTSIDE,
  },
  {
    label: "pick-up: the left point placed again after the pause",
    setup: NOT_EXAMINED,
    call: resume(plus(resumeLeft, left, resumeFrom)),
    before: OUTSIDE,
    after: OUTSIDE,
  },
  {
    label: "reorder: a point no course has, from this week",
    setup: "",
    call: reorder(plus(order(topics), uuid(77777), today), student),
    before: OUTSIDE,
    after: OUTSIDE,
  },
  {
    label: "pick-up: a point no course has, after the pause",
    setup: "",
    call: resume(plus(pickUp(topics), uuid(77777), resumeFrom)),
    before: OUTSIDE,
    after: OUTSIDE,
  },
  {
    label: "reorder: a course point left out",
    setup: NOT_EXAMINED,
    call: reorder(minusLast(reorderLeft), student),
    before: OUTSIDE,
    after: ONCE,
  },
  {
    label: "pick-up: a course point left out",
    setup: NOT_EXAMINED,
    call: resume(minusLast(resumeLeft)),
    before: OUTSIDE,
    after: ONCE,
  },
  {
    label: "reorder: a course point placed twice",
    setup: NOT_EXAMINED,
    call: reorder(twice(reorderLeft, today), student),
    before: OUTSIDE,
    after: ONCE,
  },
  {
    label: "pick-up: a course point placed twice",
    setup: NOT_EXAMINED,
    call: resume(twice(resumeLeft, resumeFrom)),
    before: OUTSIDE,
    after: ONCE,
  },
  // ── A plan no point has left gets the same answer as before ───────────
  {
    label: "reorder: the course as it was",
    setup: "",
    call: reorder(order(topics), student),
    before: null,
    after: null,
  },
  {
    label: "reorder: the course as it was, a point placed twice",
    setup: "",
    call: reorder(twice(order(topics), today), student),
    before: ONCE,
    after: ONCE,
  },
  {
    label: "pick-up: the course as it was",
    setup: "",
    call: resume(pickUp(topics)),
    before: null,
    after: null,
  },
  {
    label: "pick-up: the course as it was, a point left out",
    setup: "",
    call: resume(minusLast(pickUp(topics))),
    before: ONCE,
    after: ONCE,
  },
];

const before = await build(
  (await functionFrom(BEFORE, "resume_programme_after_pause")) +
    "\n" +
    (await functionFrom(BEFORE, "reorder_student_topics")),
);
const after = await build(await migration(`${FIX}.sql`));

for (const c of cases) {
  const old = await outcome(before, c.setup, c.call, c.as);
  assert.equal(old.refused, c.before, `Fixture: before the fix, ${c.label}`);
  const now = await outcome(after, c.setup, c.call, c.as);
  assert.equal(now.refused, c.after, c.label);
  if (c.before === null) assert.deepEqual(now, old, `Not the same plan as before: ${c.label}`);
  if (c.saves) assert.deepEqual(now.plan, plain(c.saves), `Not saved as sent: ${c.label}`);
}

// ── The rollback puts the old bodies back ────────────────────────────────
const source = async (db: Db, name: string) =>
  (await db.query<{ src: string }>("select prosrc as src from pg_proc where proname = $1", [name]))
    .rows[0].src;
await after.exec(
  await readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8"),
);
for (const name of ["reorder_student_topics", "resume_programme_after_pause"])
  assert.equal(
    await source(after, name),
    await source(before, name),
    `Rollback did not restore ${name}`,
  );
await before.close();
await after.close();

console.log(
  `PASS: a custom calendar whose past week holds a point that left the course (no longer examined, deleted, moved topic) can be reordered (by the student or a tutor) and picked up after a pause; the left point placed again in a re-planned week, a point from no course, a course point left out or placed twice are still refused; a plan no point has left gets the same answer as before; rollback restores both bodies (${cases.length} cases).`,
);
