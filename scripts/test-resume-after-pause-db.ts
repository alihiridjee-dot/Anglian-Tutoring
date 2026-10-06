/** Isolated PostgreSQL checks for resume_programme_after_pause (PR 2 of the
 * subject-pause work). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-resume-after-pause-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints, type PacingBand } from "../src/lib/planner/pacing";
import { resumeAfterPause, type OrderTopic } from "../src/lib/planner/topicOrder";
import { weekKeyToDate } from "../src/lib/planner/week";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const alex = uuid(1);
const sam = uuid(2);
const tutor = uuid(3);
const examDate = "2027-06-07";

// The tables both migrations touch, with the live access rules (3 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema cron;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.app_role as enum ('student', 'tutor', 'admin', 'parent');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_user_id uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;
create function public.plan_override_caller_is_tutor() returns boolean
  language sql stable security definer set search_path = public as $$
  select private.has_role(auth.uid(), 'tutor'::app_role) or private.has_role(auth.uid(), 'admin'::app_role) $$;
grant execute on function public.plan_override_caller_is_tutor() to authenticated;
create function private.refuse_student_row_for_staff() returns trigger language plpgsql as $$ begin return new; end $$;
create type public.subject as enum ('biology', 'chemistry');
create type public.board as enum ('aqa', 'edexcel');
create type public.level as enum ('gcse');
create type public.plan_source as enum ('ai', 'student', 'tutor');
create type public.plan_point_origin as enum ('ai', 'student', 'tutor', 'carried_over', 'core', 'focus');
create table public.profiles(id uuid primary key references auth.users on delete cascade, role text, level public.level, enrolled_courses text[]);
create table public.subscriptions(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'inactive', plan text, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_enrolments(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  subject public.subject not null, board public.board not null, unique (student_id, subject));
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.topics(id uuid primary key, subject public.subject, board public.board, level public.level);
create table public.spec_points(id uuid primary key, topic_id uuid references public.topics);
create table public.student_program_plan(
  student_id uuid references auth.users on delete cascade, subject public.subject,
  program_start date, exam_date date, pacing jsonb,
  acknowledged_at timestamptz default now(), updated_at timestamptz default now(),
  primary key (student_id, subject));
create table public.student_weekly_plans(
  id uuid primary key default gen_random_uuid(),
  student_id uuid references auth.users on delete cascade, subject public.subject,
  board public.board, level public.level, week_start date, source public.plan_source,
  ai_rationale text, updated_at timestamptz default now(), unique (student_id, subject, week_start));
create table public.student_weekly_plan_points(
  plan_id uuid references public.student_weekly_plans on delete cascade,
  spec_point_id uuid references public.spec_points, origin public.plan_point_origin,
  carried_from date, done_at timestamptz, primary key (plan_id, spec_point_id));
create table cron.job(jobid serial, jobname text, schedule text, command text);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$
  delete from cron.job where jobname = _name returning true $$;
CREATE FUNCTION private.student_has_access(p_student_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $function$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now()));
$function$;
CREATE FUNCTION private.student_paid_subjects(p_student_id uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private' AS $function$
  select coalesce((select case when x.cap is null then x.courses else x.courses[1:x.cap] end
    from (select coalesce(p.enrolled_courses, '{}'::text[]) as courses,
      (select max(case when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int else null end)
         from public.subscriptions s where s.student_id = p_student_id and s.status in ('active', 'trialing')
          and (s.current_period_end is null or s.current_period_end > now())) as cap
      from public.profiles p where p.id = p_student_id and private.student_has_access(p_student_id)) x), '{}'::text[])
$function$;
`);

// ── A course of three topics, four points each, and Alex's programme ─────
const topics: OrderTopic[] = [10, 20, 30].map((n) => ({
  topicId: uuid(n),
  title: `Topic ${n}`,
  points: Array.from({ length: 4 }, (_, i) => ({
    specPointId: uuid(n * 10 + i),
    code: `${n}.${i}`,
    title: `Point ${i}`,
    weight: 1,
  })),
}));
for (const id of [alex, sam, tutor]) await db.query("insert into auth.users values ($1)", [id]);
await db.query("insert into public.user_roles values ($1, 'tutor')", [tutor]);
await db.query(
  "insert into public.profiles values ($1, 'student', 'gcse', array['biology']), ($2, 'student', 'gcse', array['biology'])",
  [alex, sam],
);
await db.query(
  "insert into public.student_enrolments (student_id, subject, board) values ($1, 'biology', 'aqa'), ($2, 'biology', 'aqa')",
  [alex, sam],
);
await db.query(
  "insert into public.subscriptions (user_id, student_id, status, plan) values ($1, $1, 'active', 'monthly_1'), ($2, $2, 'active', 'monthly_1')",
  [alex, sam],
);
for (const t of topics) {
  await db.query("insert into public.topics values ($1, 'biology', 'aqa', 'gcse')", [t.topicId]);
  for (const p of t.points)
    await db.query("insert into public.spec_points values ($1, $2)", [p.specPointId, t.topicId]);
}
const pointMap = new Map(topics.map((t) => [t.topicId, t.points]));
const programme = withWeeklyPoints(
  computePacing(
    topics.map((t) => ({ ...t, weight: t.points.length })),
    weekKeyToDate("2026-08-24"),
    weekKeyToDate(examDate),
  ),
  pointMap,
).map((b) => ({ ...b, fixedPoints: true }));
await db.query(
  "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', '2026-08-24', $2, $3)",
  [alex, examDate, JSON.stringify(programme)],
);

for (const file of ["20261004090000_subject_pauses.sql", "20261004091000_resume_after_pause.sql"])
  await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

// ── Helpers ──────────────────────────────────────────────────────────────
const stop = async (started: string, ended: string | null, student = alex) =>
  (
    await db.query<{ id: string }>(
      "insert into public.student_subject_pauses (student_id, subject, reason, started_at, ended_at) values ($1, 'biology', 'paused', $2, $3) returning id",
      [student, started, ended],
    )
  ).rows[0].id;
const stored = async () =>
  (
    await db.query<{ pacing: PacingBand[] }>(
      "select pacing from public.student_program_plan where student_id = $1 and subject = 'biology'",
      [alex],
    )
  ).rows[0].pacing;
const resumedAt = async (id: string) =>
  (
    await db.query<{ at: Date | null }>(
      "select programme_resumed_at as at from public.student_subject_pauses where id = $1",
      [id],
    )
  ).rows[0].at;
const as = async (uid: string, pauseId: string, expected: unknown, pacing: unknown) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
  );
  try {
    await db.query("select public.resume_programme_after_pause($1, $2, $3)", [
      pauseId,
      JSON.stringify(expected),
      pacing === null ? null : JSON.stringify(pacing),
    ]);
  } finally {
    await db.exec("reset role;");
  }
};
// As the database hands JSON back: no undefined fields.
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const weeksTaught = (bands: PacingBand[]) =>
  bands.flatMap((b) => Object.keys(b.pointsByWeek ?? {}));
const resume = (bands: PacingBand[], pausedFrom: string, resumeFrom: string) =>
  resumeAfterPause({ bands, topics, pausedFrom, resumeFrom, examDate });

// Paused Wednesday 9 Sept, back Tuesday 22 Sept: the weeks of 7 and 14 Sept lost.
const first = await stop("2026-09-09T10:00:00Z", "2026-09-22T09:00:00Z");
const firstPacing = resume(programme, "2026-09-07", "2026-09-21");

// ── 1. Only the student or a tutor ──────────────────────────────────────
await assert.rejects(
  () => as(sam, first, programme, firstPacing),
  (e: { code?: string }) => e.code === "42501",
  "another student can't pick up Alex's plan",
);

// ── 2. A tampered calendar is refused, and nothing is saved ─────────────
{
  const stale = programme.map((b, i) => (i === 0 ? { ...b, weeks: b.weeks + 1 } : b));
  await assert.rejects(
    () => as(alex, first, stale, firstPacing),
    /changed in another window/,
    "an out-of-date view can't overwrite the plan",
  );
  const moved = structuredClone(firstPacing);
  const later = moved.find((b) => b.startWeek >= "2026-09-21")!;
  const [week, points] = Object.entries(later.pointsByWeek!)[0];
  later.pointsByWeek = { ...later.pointsByWeek, [week]: points.slice(1) };
  const band = { ...later, startWeek: "2026-09-14", endWeek: "2026-09-14", weeks: 1 };
  band.pointsByWeek = { "2026-09-14": points.slice(0, 1) };
  await assert.rejects(
    () => as(alex, first, programme, [...moved, band]),
    /paused|overlap|outside/i,
    "nothing can be taught in a paused week",
  );
  // Move a point promised before the pause to after it, within its own topic,
  // so only the earlier-weeks rule can object.
  const rewritten = structuredClone(firstPacing);
  const early = rewritten.find((b) => b.startWeek < "2026-09-07")!;
  const rest = rewritten.find((b) => b.topicId === early.topicId && b.startWeek >= "2026-09-21")!;
  assert.ok(rest, "the topic carries on after the pause");
  const [earlyWeek, earlyPoints] = Object.entries(early.pointsByWeek!)[0];
  early.pointsByWeek![earlyWeek] = earlyPoints.slice(1);
  const restWeek = Object.keys(rest.pointsByWeek!)[0];
  rest.pointsByWeek![restWeek] = [...rest.pointsByWeek![restWeek], earlyPoints[0]];
  await assert.rejects(
    () => as(alex, first, programme, rewritten),
    /before the pause/,
    "weeks before the pause stay exactly as they were",
  );
  const dropped = structuredClone(firstPacing);
  const last = dropped.at(-1)!;
  const lastWeek = Object.keys(last.pointsByWeek!).at(-1)!;
  last.pointsByWeek![lastWeek] = last.pointsByWeek![lastWeek].slice(1);
  await assert.rejects(
    () => as(alex, first, programme, dropped),
    /exactly once/,
    "every point must still be covered",
  );
  assert.deepEqual(await stored(), plain(programme), "nothing was saved");
  assert.equal(await resumedAt(first), null);
}

// ── 3. The student saves it: picked up once, nothing taught while paused ─
{
  await as(alex, first, programme, firstPacing);
  const now = await stored();
  assert.deepEqual(now, plain(firstPacing), "the new calendar is the plan");
  assert.deepEqual(
    weeksTaught(now).filter((w) => w >= "2026-09-07" && w < "2026-09-21"),
    [],
  );
  assert.ok(await resumedAt(first), "stamped as picked up");
  // A second window gets there late: nothing happens.
  await as(alex, first, programme, programme);
  assert.deepEqual(await stored(), plain(firstPacing), "applied once");
}

// ── 4. Stops are picked up in order ─────────────────────────────────────
// Tuesday to Friday of one week, then Wednesday 4 Nov to Tuesday 17 Nov.
const second = await stop("2026-10-13T10:00:00Z", "2026-10-16T10:00:00Z");
const third = await stop("2026-11-04T10:00:00Z", "2026-11-17T10:00:00Z");
{
  const thirdPacing = resume(firstPacing, "2026-11-02", "2026-11-16");
  await assert.rejects(
    () => as(alex, third, firstPacing, thirdPacing),
    /earlier pause/,
    "the later stop waits for the earlier one",
  );
  // The second began and ended in one week, so it moves nothing. A tutor can stamp it.
  assert.equal(resume(firstPacing, "2026-10-12", "2026-10-12"), firstPacing);
  await as(tutor, second, firstPacing, null);
  assert.ok(await resumedAt(second), "a tutor can pick it up");
  assert.deepEqual(await stored(), plain(firstPacing), "a one-week stop moves nothing");
  // "Nothing to move" from the planner stamps it and keeps the plan.
  await as(alex, third, firstPacing, null);
  assert.ok(await resumedAt(third));
  assert.deepEqual(await stored(), plain(firstPacing));
}

// ── 5. A stop still in force can't be picked up ─────────────────────────
{
  const open = await stop("2026-12-01T10:00:00Z", null);
  await assert.rejects(
    () => as(alex, open, firstPacing, null),
    (e: { hint?: string }) => e.hint === "subject_paused",
    "still paused",
  );
}

console.log("resume after pause: all checks passed");
