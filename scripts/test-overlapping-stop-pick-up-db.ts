/** Isolated PostgreSQL checks for 20261123130000_overlapping_stop_pick_up.sql:
 * a stop picked up after an overlapping one moves nothing into its weeks. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-overlapping-stop-pick-up-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computePacing, withWeeklyPoints, type PacingBand } from "../src/lib/planner/pacing";
import { backOnWeek, resumeAfterPause, type OrderTopic } from "../src/lib/planner/topicOrder";
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
create table public.spec_points(id uuid primary key, topic_id uuid references public.topics, not_examined boolean not null default false);
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

const sql = (file: string) =>
  readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8").then((text) => db.exec(text));
// The function as it is live today (19 Nov), on the pauses table.
await sql("migrations/20261004090000_subject_pauses.sql");
await sql("migrations/20261119222800_custom_plan_left_points.sql");
const migration = "migrations/20261123130000_overlapping_stop_pick_up.sql";
const rollback = "rollbacks/20261123130000_overlapping_stop_pick_up.down.sql";

// ── Helpers ──────────────────────────────────────────────────────────────
const stop = async (started: string, ended: string) =>
  (
    await db.query<{ id: string }>(
      "insert into public.student_subject_pauses (student_id, subject, reason, started_at, ended_at) values ($1, 'biology', 'payment', $2, $3) returning id",
      [alex, started, ended],
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
const pickUp = async (pauseId: string, expected: PacingBand[], pacing: PacingBand[] | null) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${alex}', false);`,
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
const reset = async () => {
  await db.query("delete from public.student_subject_pauses where student_id = $1", [alex]);
  await db.query(
    "update public.student_program_plan set pacing = $2 where student_id = $1 and subject = 'biology'",
    [alex, JSON.stringify(programme)],
  );
};
const resume = (bands: PacingBand[], pausedFrom: string, resumeFrom: string) =>
  resumeAfterPause({ bands, topics, pausedFrom, resumeFrom, examDate });
/** A band that starts in [from, to): teaching in a stopped week. */
const startsIn = (bands: PacingBand[], from: string, to: string) =>
  bands.filter((b) => b.startWeek >= from && b.startWeek < to).map((b) => b.startWeek);

// The lapse: Wednesday 14 Oct, back Tuesday 3 Nov (weeks of 12 Oct to 26 Oct).
const lapseWeeks = { pausedFrom: "2026-10-12", resumeFrom: "2026-11-02" };
// The break began earlier (Wednesday 7 Oct, back Tuesday 27 Oct) but is recorded
// only after the lapse was picked up.
const breakWeeks = { pausedFrom: "2026-10-05", resumeFrom: "2026-10-26" };

/** The lapse picked up, then the late break recorded. Returns the break's id and the plan. */
const lapseThenLateBreak = async () => {
  await reset();
  const lapse = await stop("2026-10-14T10:00:00Z", "2026-11-03T09:00:00Z");
  await pickUp(lapse, programme, resume(programme, lapseWeeks.pausedFrom, lapseWeeks.resumeFrom));
  assert.ok(await resumedAt(lapse), "the lapse is picked up");
  const brk = await stop("2026-10-07T10:00:00Z", "2026-10-27T09:00:00Z");
  return { brk, plan: await stored() };
};

// ── 1. Before: the break's own weeks are all that is checked ─────────────
{
  const { brk, plan } = await lapseThenLateBreak();
  const own = resume(plan, breakWeeks.pausedFrom, breakWeeks.resumeFrom);
  assert.ok(
    startsIn(own, "2026-10-12", "2026-11-02").length > 0,
    "the old pick-up teaches in the lapse",
  );
  await pickUp(brk, plan, own);
  assert.ok(
    startsIn(await stored(), "2026-10-12", "2026-11-02").length > 0,
    "before the migration the database saves teaching inside the lapse",
  );
}

// ── 2. After: the break picks up from the lapse's back-on week ───────────
await sql(migration);
await sql(migration); // idempotent
const back = backOnWeek(breakWeeks, [lapseWeeks]);
assert.equal(back, "2026-11-02", "the planner and the database agree on the week");
{
  const { brk, plan } = await lapseThenLateBreak();
  await assert.rejects(
    () => pickUp(brk, plan, resume(plan, breakWeeks.pausedFrom, breakWeeks.resumeFrom)),
    /Invalid calendar allocation/,
    "a plan cut from the break's own back-on week is refused",
  );
  assert.equal(await resumedAt(brk), null, "and the break is not marked picked up");
  await pickUp(brk, plan, resume(plan, breakWeeks.pausedFrom, back));
  assert.ok(await resumedAt(brk), "a plan cut from the lapse's back-on week is taken");
  assert.deepEqual(
    startsIn(await stored(), "2026-10-05", "2026-11-02"),
    [],
    "nothing taught in either stop",
  );
}

// ── 3. A stop that touches one picked up counts too ──────────────────────
{
  await reset();
  const lapse = await stop("2026-10-14T10:00:00Z", "2026-11-03T09:00:00Z");
  await pickUp(lapse, programme, resume(programme, lapseWeeks.pausedFrom, lapseWeeks.resumeFrom));
  // Back on Tuesday 13 Oct, the week the lapse began.
  const touching = { pausedFrom: "2026-09-28", resumeFrom: "2026-10-12" };
  const brk = await stop("2026-09-30T10:00:00Z", "2026-10-13T09:00:00Z");
  const plan = await stored();
  assert.equal(backOnWeek(touching, [lapseWeeks]), "2026-11-02");
  await assert.rejects(
    () => pickUp(brk, plan, resume(plan, touching.pausedFrom, touching.resumeFrom)),
    /Invalid calendar allocation/,
  );
  await pickUp(brk, plan, resume(plan, touching.pausedFrom, "2026-11-02"));
  assert.deepEqual(startsIn(await stored(), "2026-09-28", "2026-11-02"), []);
}

// ── 4. A stop that overlaps nothing is picked up exactly as before ───────
{
  await reset();
  const alone = await stop("2026-09-09T10:00:00Z", "2026-09-22T09:00:00Z");
  const pacing = resume(programme, "2026-09-07", "2026-09-21");
  await pickUp(alone, programme, pacing);
  assert.deepEqual(await stored(), JSON.parse(JSON.stringify(pacing)), "saved as sent");
}

// ── 5. The rollback restores the old check, and runs twice ───────────────
await sql(rollback);
await sql(rollback);
{
  const { brk, plan } = await lapseThenLateBreak();
  await pickUp(brk, plan, resume(plan, breakWeeks.pausedFrom, breakWeeks.resumeFrom));
  assert.ok(await resumedAt(brk), "after the rollback the break's own back-on week is taken again");
}

console.log(
  "PASS: before the migration a break recorded after an overlapping lapse was picked up saved teaching inside the lapse; with it the break picks up from the lapse's back-on week (touching counts), the old plan is refused and nothing is marked, a stop on its own is picked up as before, and the planner works out the same week; idempotent; the rollback restores the old check.",
);
