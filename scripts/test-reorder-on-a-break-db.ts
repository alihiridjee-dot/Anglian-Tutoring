/** Isolated PostgreSQL regression checks: a topic reorder while the student is
 * on a break (20261007112100). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-reorder-on-a-break-db.ts
 *
 * Production's functions come from the migrations that hold them, md5-checked
 * against production on 7 Oct 2026: reorder_student_topics from
 * 20261007103000, save_weekly_plan from 20260922104641 (comment lines aside),
 * student_breaks with its read policies, refuse_planning_on_a_break and its
 * two triggers from 20261005160000, enforce_plan_point_admissible from
 * 20260915120000 and enforce_plan_matches_enrolment from 20260907140000.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints, type PacingBand } from "../src/lib/planner/pacing";
import { orderInputs, reorderTopics } from "../src/lib/planner/topicOrder";
import {
  addWeeks,
  currentWeekKey,
  sundayOf,
  toDateKey,
  weekKeyToDate,
} from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const FIX = "20261007112100_reorder_skips_break_weeks";
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
const classmate = uuid(2); // another student: their break is not this student's
const tutor = uuid(3);
const today = currentWeekKey();
const week = (n: number) => toDateKey(addWeeks(weekKeyToDate(today), n));
const examDate = week(10);
const RECUT = "Updated to the chosen topic order. Reviews retain their assessed timing.";

/** Three Biology topics of eight points each. */
const topics = [1, 2, 3].map((n) => ({
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
  weekKeyToDate(week(-2)),
  weekKeyToDate(examDate),
);
/** The order a student picks from this week: the remaining topics backwards. */
const reorderFrom = (bands: PacingBand[], order?: string[]) =>
  reorderTopics({
    bands,
    topics,
    from: today,
    examDate,
    order:
      order ??
      orderInputs(bands, topics, today)
        .remaining.map((t) => t.topicId)
        .reverse(),
  });
const preview = reorderFrom(spine);
/** The points a spine teaches in week `w`; a curriculum-order spine is cut as the planner cuts it. */
const teachingIn = (bands: PacingBand[], w: number) =>
  withWeeklyPoints(bands, new Map(topics.map((t) => [t.topicId, t.points]))).flatMap(
    (b) => b.pointsByWeek?.[week(w)]?.map((p) => p.specPointId) ?? [],
  );

// What the student had saved before any break was booked. This week is the
// programme's cut, made on Monday: one point ticked off, one they added
// themselves. A tutor pinned a point into each of the next two weeks.
const cut = teachingIn(spine, 0);
const [ticked] = cut;
assert(ticked, "Fixture: the spine teaches nothing this week");
const ownPick = topics[1].points[0].specPointId;
const pins = { 1: topics[1].points[1].specPointId, 2: topics[1].points[2].specPointId };
const plans = { 0: uuid(50), 1: uuid(51), 2: uuid(52) } as const;
type Week = keyof typeof plans;
const WEEKS = [0, 1, 2] as const;

type Break = { from: number; weeks: number; cancelled?: boolean; of?: string };

/** Production as it stands, holding one student who has booked `breaks`. */
async function build(breaks: Break[], withFix: boolean) {
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
  await db.exec(await migration("20261007103000_reorder_skips_other_course.sql"));
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
  if (withFix) {
    const fix = await migration(`${FIX}.sql`);
    await db.exec(fix);
    await db.exec(fix); // idempotent
  }

  for (const t of topics) {
    await db.query("insert into topics values ($1,'biology','edexcel','gcse')", [t.topicId]);
    for (const p of t.points)
      await db.query("insert into spec_points values($1,$2)", [p.specPointId, t.topicId]);
  }
  for (const id of [student, classmate, tutor])
    await db.query("insert into auth.users values($1)", [id]);
  await db.query("insert into user_roles values($1,'tutor')", [tutor]);
  for (const id of [student, classmate]) {
    await db.query("insert into profiles values($1,'gcse')", [id]);
    await db.query("insert into student_enrolments values($1,'biology','edexcel')", [id]);
  }
  await db.query(
    "insert into student_program_plan(student_id,subject,program_start,exam_date,pacing) values($1,'biology',$2,$3,$4)",
    [student, week(-2), examDate, JSON.stringify(spine)],
  );
  const savePlan = (w: Week, source: string) =>
    db.query(
      "insert into student_weekly_plans(id,student_id,subject,board,level,week_start,source) values($1,$2,'biology','edexcel','gcse',$3,$4)",
      [plans[w], student, week(w), source],
    );
  const addPoint = (w: Week, point: string, origin: string, done: string | null = null) =>
    db.query("insert into student_weekly_plan_points values($1,$2,$3,null,$4)", [
      plans[w],
      point,
      origin,
      done,
    ]);
  await savePlan(0, "ai");
  for (const point of cut)
    await addPoint(0, point, "core", point === ticked ? new Date().toISOString() : null);
  await addPoint(0, ownPick, "student");
  await savePlan(1, "tutor");
  await addPoint(1, pins[1], "tutor");
  await savePlan(2, "tutor");
  await addPoint(2, pins[2], "tutor");

  // Then the breaks are booked. book_break leaves saved weeks as they are.
  for (const b of breaks)
    await db.query(
      "insert into student_breaks(student_id,starts_on,ends_on,reason,booked_by,cancelled_at) values($1,$2,$3,'holiday',$1,$4)",
      [
        b.of ?? student,
        week(b.from),
        toDateKey(sundayOf(weekKeyToDate(week(b.from + b.weeks - 1)))),
        b.cancelled ? new Date().toISOString() : null,
      ],
    );

  await db.exec(`grant usage on schema public,auth to authenticated;
 grant all on all tables in schema public to authenticated;
 alter table student_program_plan enable row level security;
 create policy own on student_program_plan to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));
 alter table student_weekly_plans enable row level security;
 create policy own on student_weekly_plans to authenticated using(student_id=auth.uid() or private.has_role(auth.uid(),'tutor')) with check(student_id=auth.uid() or private.has_role(auth.uid(),'tutor'));`);
  // The reorder reads breaks as its caller, so they are read as production
  // reads them: the student their own, a tutor anyone's, select only.
  await db.exec(
    await slice(
      BREAKS,
      "alter table public.student_breaks enable row level security;",
      "grant select on public.student_breaks to authenticated;",
    ),
  );

  /** The reorder from this week, as ProgramDAL.reorder sends it; a tutor names the student. */
  const reorder = async (
    as: string,
    pacing: PacingBand[] = preview,
    expected: PacingBand[] = spine,
  ) => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [as]);
    return db.query(
      "select reorder_student_topics('biology','edexcel','gcse',$1,$2,$3,$4,$5,$6,$7)",
      [
        today,
        JSON.stringify(expected),
        examDate,
        JSON.stringify(pacing),
        [],
        "[]",
        as === student ? null : student,
      ],
    );
  };
  /** Everything a week holds: its row, and every point with how it got there. */
  const snapshot = async (w: Week) => ({
    plan: (
      await db.query(
        "select source::text, ai_rationale, updated_at from student_weekly_plans where id=$1",
        [plans[w]],
      )
    ).rows[0] as { source: string; ai_rationale: string | null; updated_at: string },
    points: (
      await db.query<{
        spec_point_id: string;
        origin: string;
        carried_from: string | null;
        done_at: string | null;
      }>(
        "select spec_point_id, origin::text, carried_from, done_at from student_weekly_plan_points where plan_id=$1 order by spec_point_id",
        [plans[w]],
      )
    ).rows,
  });
  const savedSpine = async () =>
    (
      await db.query<{ pacing: unknown }>(
        "select pacing from student_program_plan where student_id=$1",
        [student],
      )
    ).rows[0].pacing;
  const before: Record<number, Awaited<ReturnType<typeof snapshot>>> = {};
  for (const w of WEEKS) before[w] = await snapshot(w);
  // From here on the caller is the student or their tutor, who both read the
  // student's plan under these policies.
  await db.exec("set role authenticated");
  return { db, reorder, before, snapshot, savedSpine };
}

/**
 * The order as saved, without `openedWeek`: the reorder also marks a topic the
 * student already has work in as opened that week, which isn't this test's concern.
 */
const topicOrderOf = (bands: unknown) =>
  (JSON.parse(JSON.stringify(bands)) as PacingBand[]).map((b) => {
    delete b.openedWeek;
    return b;
  });

/** After a reorder: break weeks exactly as they were, every other week re-cut to `pacing`. */
async function expectReorder(
  t: Awaited<ReturnType<typeof build>>,
  label: string,
  breakWeeks: Week[],
  pacing: PacingBand[] = preview,
) {
  assert.deepEqual(
    topicOrderOf(await t.savedSpine()),
    topicOrderOf(pacing),
    `Order not saved: ${label}`,
  );
  for (const w of WEEKS) {
    const now = await t.snapshot(w);
    if (breakWeeks.includes(w)) {
      assert.deepEqual(now, t.before[w], `Break week ${w} changed: ${label}`);
      continue;
    }
    assert.equal(now.plan.ai_rationale, RECUT, `Week ${w} not re-cut: ${label}`);
    const held = now.points.map((p) => p.spec_point_id);
    const teaching = teachingIn(pacing, w);
    assert(teaching.length > 0, `Fixture: the order teaches nothing in week ${w}`);
    assert(
      teaching.every((id) => held.includes(id)),
      `Week ${w} lacks the new order's teaching: ${label}`,
    );
    // What a re-cut always keeps: the tick, the student's pick, the tutor's pins.
    const kept = w === 0 ? [ticked, ownPick] : [pins[w]];
    assert(
      kept.every((id) => held.includes(id)),
      `Week ${w} lost the student's work or a pin: ${label}`,
    );
    if (w === 0)
      assert(now.points.find((p) => p.spec_point_id === ticked)?.done_at, `Tick lost: ${label}`);
  }
}

const THIS_WEEK = { from: 0, weeks: 1 };
const NEXT_WEEK = { from: 1, weeks: 1 };
const TWO_WEEKS = { from: 0, weeks: 2 };

// ── 1 · Production before this migration: the reorder is refused ─────────
for (const [label, b] of [
  ["a break this week", THIS_WEEK],
  ["a break next week, with a tutor's pin saved in it", NEXT_WEEK],
] as const) {
  const t = await build([b], false);
  await assert.rejects(
    t.reorder(student),
    (e: { message?: string; code?: string; hint?: string }) =>
      /This is a break week/.test(e.message ?? "") && e.code === "23514" && e.hint === "on_a_break",
    `Expected the unfixed reorder to be refused with ${label}`,
  );
  await t.db.close();
}

// ── 2 · With it: break weeks stay as they are, the rest follow the order ──
for (const [label, b, breakWeeks] of [
  ["a break this week", THIS_WEEK, [0]],
  ["a break next week", NEXT_WEEK, [1]],
  ["a two-week break from this week", TWO_WEEKS, [0, 1]],
] as const) {
  const t = await build([b], true);
  await t.reorder(student);
  await expectReorder(t, label, [...breakWeeks]);
  await t.db.close();
}

// A tutor reordering for the student sees the break too.
{
  const t = await build([THIS_WEEK], true);
  await t.reorder(tutor);
  await expectReorder(t, "a tutor's reorder during a break", [0]);
  await t.db.close();
}

// A called-off break is no break, and another student's break is not theirs:
// a tutor, who can read every student's breaks, must not skip for it either.
for (const [who, as] of [
  ["student", student],
  ["tutor", tutor],
] as const) {
  const t = await build(
    [
      { ...THIS_WEEK, cancelled: true },
      { ...TWO_WEEKS, of: classmate },
    ],
    true,
  );
  await t.reorder(as);
  await expectReorder(t, `a called-off break and a classmate's break, the ${who} reordering`, []);
  await t.db.close();
}

// And again: back to curriculum order, still on the break.
{
  const t = await build([THIS_WEEK], true);
  await t.reorder(student);
  // The editor starts from the spine as stored, as ProgramDAL.reorder does.
  const saved = (await t.savedSpine()) as PacingBand[];
  const back = reorderFrom(
    saved,
    orderInputs(saved, topics, today)
      .remaining.map((x) => x.topicId)
      .reverse(),
  );
  await t.reorder(student, back, saved);
  await expectReorder(t, "a second reorder during the break", [0], back);
  await t.db.close();
}

// ── 3 · The rollback puts the old reorder back ────────────────────────────
{
  const t = await build([THIS_WEEK], true);
  await t.db.exec("reset role");
  await t.db.exec(
    await readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8"),
  );
  await t.db.exec("set role authenticated");
  await assert.rejects(t.reorder(student), /This is a break week/, "Rollback did not restore");
  await t.db.close();
}

console.log(
  "PASS: unfixed reorder refused with a saved week in a break (this week or later); fixed reorder saves the new order, leaves break weeks exactly as they were, re-cuts every other week keeping ticks, picks and pins, works for a tutor and a second time, ignores called-off and other students' breaks; rollback restores the old body.",
);
