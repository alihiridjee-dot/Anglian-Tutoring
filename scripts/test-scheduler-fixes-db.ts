/** Isolated PostgreSQL checks for 20261028090000_scheduler_fixes. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-scheduler-fixes-db.ts
 *
 * 1. A task handed in an earlier week counts when its point comes back.
 * 2. Calling off a break that began this week calls off the ones after it.
 * 3. Moving an exam date can't put a booked break inside the exam window.
 *
 * Each fault is shown on the functions as they stand live (the earlier
 * migrations, md5-checked against production on 27 Oct 2026), then fixed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tia = uuid(11); // ticks
const bo = uuid(12); // a break that began this week, with more booked after it
const fay = uuid(13); // a break still to come, with one booked after it
const eli = uuid(14); // a break under way since last week, comes back early
const ed = uuid(15); // moves an exam date around a booked break
const pat = uuid(16); // a break that is over, and one called off
const sid = uuid(17); // a programme seeded after a break was booked
const uma = uuid(18); // a break under way
const stranger = uuid(19);
// Spec points and practice.
const P = uuid(100); // a quiz and a task
const P2 = uuid(101); // a task only
const P3 = uuid(102); // a quiz and a task, both done this week
const quiz = uuid(200);
const quiz3 = uuid(203);
const task = uuid(300);
const task2 = uuid(301);
const task3 = uuid(303);

const migration = (file: string) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const FIX = "20261028090000_scheduler_fixes";

// The shape of production the migrations touch, as test-student-breaks-db.ts
// and test-plan-tick-from-work-db.ts have it (live bodies, 4 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema cron;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create type public.app_role as enum ('student', 'tutor', 'admin');
create table public.user_roles(user_id uuid, role public.app_role);
create type public.subject as enum ('biology', 'chemistry', 'physics');
create type public.board as enum ('aqa', 'edexcel');
create type public.level as enum ('gcse');
create type public.plan_source as enum ('ai', 'student', 'tutor');
create type public.plan_point_origin as enum ('ai', 'student', 'tutor', 'carried_over', 'core', 'focus');
create table public.profiles(id uuid primary key references auth.users on delete cascade, role text, display_name text, level public.level, enrolled_courses text[]);

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id = auth.uid() THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'tutor'::public.app_role) THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSE
    RETURN false;
  END IF;
END;
$function$;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;

CREATE OR REPLACE FUNCTION public.plan_override_caller_is_tutor()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select private.has_role(auth.uid(), 'tutor'::app_role)
      or private.has_role(auth.uid(), 'admin'::app_role);
$function$;

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select exists (
           select 1 from public.user_roles r
           where r.user_id = _user_id and r.role in ('tutor', 'admin')
         )
      or exists (
           select 1 from public.profiles p
           where p.id = _user_id and p.role = 'tutor'
         );
$function$;

CREATE OR REPLACE FUNCTION private.refuse_student_row_for_staff()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  _row jsonb := to_jsonb(new);
  _col text;
  _id uuid;
begin
  foreach _col in array tg_argv loop
    if not (_row ? _col) then
      raise exception 'student_row_not_staff on % names a missing column %.', tg_table_name, _col;
    end if;
    _id := (_row ->> _col)::uuid;
    if _id is not null and private.is_staff(_id) then
      raise exception 'A tutor account can''t hold student data (%.%).', tg_table_name, _col
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$function$;

create table public.subscriptions(
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  student_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text, status text not null default 'inactive', plan text,
  current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.student_enrolments(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users on delete cascade,
  subject public.subject not null, board public.board not null,
  created_at timestamptz not null default now(), unique (student_id, subject));
create table public.parent_student_links(
  id uuid primary key default gen_random_uuid(), parent_id uuid not null, student_id uuid not null,
  created_at timestamptz not null default now());
create table public.spec_points(id uuid primary key);
create table public.student_program_plan(
  student_id uuid references auth.users on delete cascade, subject public.subject,
  program_start date, exam_date date, pacing jsonb, acknowledged_at timestamptz default now(),
  updated_at timestamptz default now(), primary key (student_id, subject));
create trigger student_row_not_staff
  before insert or update of student_id on public.student_program_plan
  for each row execute function private.refuse_student_row_for_staff('student_id');
-- The student writes their own programme (RLS in production; a plain grant here).
grant select, insert, update on public.student_program_plan to authenticated;
create table public.student_weekly_plans(
  id uuid primary key default gen_random_uuid(),
  student_id uuid references auth.users on delete cascade, subject public.subject,
  board public.board, level public.level, week_start date, source public.plan_source,
  ai_rationale text, updated_at timestamptz default now(), unique (student_id, subject, week_start));
create table public.student_weekly_plan_points(
  plan_id uuid references public.student_weekly_plans on delete cascade,
  spec_point_id uuid references public.spec_points, origin public.plan_point_origin,
  carried_from date, done_at timestamptz, primary key (plan_id, spec_point_id));
create table public.notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  type text not null, title text not null, body text, link text,
  read_at timestamptz, created_at timestamptz not null default now());
create table cron.job(jobid serial, jobname text, schedule text, command text);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$
  delete from cron.job where jobname = _name returning true $$;

CREATE OR REPLACE FUNCTION private.student_has_access(p_student_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
  select exists (
    select 1 from public.subscriptions s
    where s.student_id = p_student_id
      and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
  );
$function$;

CREATE OR REPLACE FUNCTION private.student_paid_subjects(p_student_id uuid)
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'private'
AS $function$
  select coalesce(
    (
      select case when x.cap is null then x.courses else x.courses[1:x.cap] end
      from (
        select
          coalesce(p.enrolled_courses, '{}'::text[]) as courses,
          (
            select max(case when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int else null end)
            from public.subscriptions s
            where s.student_id = p_student_id
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now())
          ) as cap
        from public.profiles p
        where p.id = p_student_id and private.student_has_access(p_student_id)
      ) x
    ),
    '{}'::text[]
  )
$function$;

-- Practice, as test-plan-tick-from-work-db.ts has it. A task is handed in
-- once: production's homework_submissions is unique on (resource_id, student_id).
create table public.mcq_sets(id uuid primary key, published boolean, spec_point_id uuid);
create table public.mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid, spec_point_id uuid);
create table public.mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid, user_id uuid,
  created_at timestamptz default now(), point_scores jsonb);
create table public.resources(id uuid primary key, kind text, review_status text, publish_at timestamptz, spec_point_id uuid);
create table public.resource_spec_points(resource_id uuid, spec_point_id uuid);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid,
  student_id uuid, submitted_at timestamptz not null default now(), unique (resource_id, student_id));
`);

// ── Weeks, counted from this one (UK time, as the functions count them) ──
const thisMonday = (
  await db.query<{ d: string }>(
    "select to_char(date_trunc('week', now() at time zone 'Europe/London'), 'YYYY-MM-DD') as d",
  )
).rows[0].d;
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The Monday n weeks from this one. */
const mon = (n: number) => shift(thisMonday, 7 * n);
/** The Sunday that ends week n. */
const sun = (n: number) => shift(mon(n), 6);
/** As to_char(d, 'FMDD Mon') writes it. */
const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const dm = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
};

// ── Fixtures, before the migrations ──────────────────────────────────────
const students = [tia, bo, fay, eli, ed, pat, sid, uma];
for (const id of [...students, stranger])
  await db.query("insert into auth.users values ($1)", [id]);
// Every student is enrolled in and paid for biology and chemistry, so no
// subject is paused (refuse_planning_while_paused).
for (const id of students) {
  await db.query(
    "insert into public.profiles (id, role, display_name, level, enrolled_courses) values ($1, 'student', 'Student', 'gcse', array['biology','chemistry'])",
    [id],
  );
  await db.query(
    "insert into public.student_enrolments (student_id, subject, board) values ($1, 'biology', 'aqa'), ($1, 'chemistry', 'aqa')",
    [id],
  );
  await db.query(
    "insert into public.subscriptions (user_id, student_id, status, plan, current_period_end) values ($1, $1, 'active', 'monthly_2', now() + interval '20 days')",
    [id],
  );
}
await db.query("insert into public.profiles (id, role) values ($1, 'parent')", [stranger]);
// Programmes with an exam far off, so every booking below is allowed. Sid has
// none yet: his is seeded later, after his break is booked.
for (const id of [bo, eli, ed, pat, uma])
  await db.query(
    "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', $2, $3, '[]')",
    [id, mon(-10), mon(40)],
  );
await db.query("insert into public.spec_points values ($1), ($2), ($3)", [P, P2, P3]);
await db.exec(`
insert into public.mcq_sets values ('${quiz}', true, '${P}'), ('${quiz3}', true, '${P3}');
insert into public.resources values ('${task}', 'homework', 'approved', null, '${P}'),
  ('${task2}', 'homework', 'approved', null, null), ('${task3}', 'homework', 'approved', null, '${P3}');
insert into public.resource_spec_points values ('${task2}', '${P2}');
`);

for (const file of [
  "20261004090000_subject_pauses.sql",
  "20261004091000_resume_after_pause.sql",
  "20261004092000_erase_cancelled_progress.sql",
  "20261005160000_student_breaks.sql",
  "20261005161000_break_pickup.sql",
  "20261005163000_break_notice_existing_parents.sql",
  "20261007094747_plan_tick_from_work.sql",
])
  await db.exec(await migration(file));

// ── Helpers ──────────────────────────────────────────────────────────────
/** Run as a signed-in user. */
const as = async <T = Record<string, unknown>>(
  uid: string,
  sql: string,
  params: unknown[] = [],
) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
};
/** Run, then undo: shows what the functions did before the fix. */
const undone = async (run: () => Promise<void>) => {
  await db.exec("begin");
  try {
    await run();
  } finally {
    await db.exec("rollback");
  }
};
const book = async (student: string, startsOn: string, weeks: number) =>
  (
    await as<{ id: string }>(
      student,
      "select public.book_break($1, $2::date, $3, 'holiday') as id",
      [student, startsOn, weeks],
    )
  ).rows[0].id;
/** A break written straight in, for one that began before this week. */
const insertBreak = async (student: string, from: string, to: string, cancelled = false) =>
  (
    await db.query<{ id: string }>(
      "insert into public.student_breaks (student_id, starts_on, ends_on, reason, booked_by, cancelled_at) values ($1, $2, $3, 'holiday', $1, $4) returning id",
      [student, from, to, cancelled ? new Date() : null],
    )
  ).rows[0].id;
const end = async (who: string, id: string) =>
  (await as<{ r: string }>(who, "select public.end_break($1) as r", [id])).rows[0].r;
type Break = {
  starts_on: string;
  ends_on: string;
  cancelled_at: Date | null;
  ended_early_at: Date | null;
  ended_by: string | null;
  recorded_at: Date | null;
};
const breakRow = async (id: string) =>
  (
    await db.query<Break>(
      "select starts_on::text, ends_on::text, cancelled_at, ended_early_at, ended_by, recorded_at from public.student_breaks where id = $1",
      [id],
    )
  ).rows[0];
const refuses = async (
  run: () => Promise<unknown>,
  code: string,
  label: string,
  message?: string | RegExp,
) => {
  await assert.rejects(
    run,
    (e: { code?: string; message?: string; hint?: string }) => {
      assert.equal(e.code, code, `${label} (code; message: ${e.message})`);
      if (typeof message === "string") assert.equal(e.message, message, `${label} (message)`);
      else if (message) assert.match(e.message ?? "", message, `${label} (message)`);
      return true;
    },
    label,
  );
};
const planWeek = async (student: string, weekStart: string, subject = "biology") =>
  (
    await db.query<{ id: string }>(
      "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source) values ($1, $2, 'aqa', 'gcse', $3, 'ai') returning id",
      [student, subject, weekStart],
    )
  ).rows[0].id;
const addPoint = (plan: string, spec: string, origin = "core") =>
  db.query(
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, $3)",
    [plan, spec, origin],
  );
const ticked = async (plan: string, point: string) =>
  (
    await db.query<{ done_at: Date | null }>(
      "select done_at from public.student_weekly_plan_points where plan_id = $1 and spec_point_id = $2",
      [plan, point],
    )
  ).rows[0].done_at !== null;
/** A UK wall-clock moment: `days` after Monday of week `n`, at 10:00. */
const ukAt = (n: number, days: number) => `${shift(mon(n), days)} 10:00 Europe/London`;
const handIn = (resource: string, student: string, when?: string) =>
  db.query(
    "insert into public.homework_submissions (resource_id, student_id, submitted_at) values ($1, $2, coalesce($3::timestamptz, now()))",
    [resource, student, when ?? null],
  );
const attempt = (set: string, student: string, when?: string) =>
  db.query(
    "insert into public.mcq_attempts (set_id, user_id, created_at) values ($1, $2, coalesce($3::timestamptz, now()))",
    [set, student, when ?? null],
  );
const moveExam = (student: string, date: string) =>
  as(
    student,
    "update public.student_program_plan set exam_date = $2 where student_id = $1 and subject = 'biology'",
    [student, date],
  );
const examOf = async (student: string) =>
  (
    await db.query<{ d: string }>(
      "select exam_date::text as d from public.student_program_plan where student_id = $1 and subject = 'biology'",
      [student],
    )
  ).rows[0].d;
const nearExam = (from: string, to: string) =>
  `You have a break booked from ${dm(from)} to ${dm(to)}. A break can't fall in the 6 weeks before an exam, so move or call off the break first.`;

// ── Fixtures under the live functions ────────────────────────────────────
// Tia: point P (quiz + task) planned two weeks ago and again this week as a
// review; P2 (task only) three weeks ago, carried to last week.
const twoAgo = await planWeek(tia, mon(-2));
const review = await planWeek(tia, mon(0));
const threeAgo = await planWeek(tia, mon(-3), "chemistry");
const lastWeek = await planWeek(tia, mon(-1), "chemistry");
await addPoint(twoAgo, P);
await addPoint(review, P, "focus");
await addPoint(threeAgo, P2);
await addPoint(lastWeek, P2, "carried_over");
// Two weeks ago: P's task handed in on the Wednesday, its quiz on the Thursday.
await handIn(task, tia, ukAt(-2, 2));
await attempt(quiz, tia, ukAt(-2, 3));
assert.equal(await ticked(twoAgo, P), true, "the in-week case ticks under the live rule");
assert.equal(await ticked(review, P), false);
// P2's task handed in last Wednesday, after its first week had ended.
await handIn(task2, tia, ukAt(-1, 2));
assert.equal(await ticked(lastWeek, P2), true);
assert.equal(await ticked(threeAgo, P2), false);

// Breaks.
const boNow = await book(bo, mon(0), 1);
const boNext = await book(bo, mon(1), 2);
const boThird = await book(bo, mon(3), 1);
const boLater = await book(bo, mon(6), 1); // not touching: a separate break
const fayFirst = await book(fay, mon(2), 1);
const fayNext = await book(fay, mon(3), 1);
const eliAway = await insertBreak(eli, mon(-1), sun(0));
const eliNext = await insertBreak(eli, mon(1), sun(1));
const eliThen = await insertBreak(eli, mon(2), sun(2));
const edBreak = await book(ed, mon(10), 1);
await insertBreak(pat, mon(-3), sun(-2)); // over
await insertBreak(pat, mon(2), sun(2), true); // called off
await insertBreak(uma, mon(-1), sun(0)); // under way
const sidBreak = await book(sid, mon(5), 1); // no programme yet, so no exam known

// ── Before: each fault, on the live functions ───────────────────────────
await undone(async () => {
  await attempt(quiz, tia);
  assert.equal(
    await ticked(review, P),
    false,
    "live: this week's quiz can't tick P's review, the hand-in was two weeks ago",
  );
});
await undone(async () => {
  assert.equal(await end(bo, boNow), "cancelled");
  assert.equal((await breakRow(boNext)).cancelled_at, null, "live: next week is still a break");
});
await undone(async () => {
  await moveExam(ed, mon(14));
  assert.equal(await examOf(ed), mon(14), "live: the exam moves next to the break unchecked");
});

// ── The fix, applied twice to show it is safe to run again ──────────────
const fix = await migration(`${FIX}.sql`);
await db.exec(fix);
await db.exec(fix);

// ── 1. Ticks ─────────────────────────────────────────────────────────────
{
  assert.equal(await ticked(review, P), false, "no backfill: saved rows wait for the next refresh");
  // This week's quiz on P: the task from two weeks ago now counts.
  await attempt(quiz, tia);
  assert.equal(await ticked(review, P), true, "the review ticks: task earlier, quiz this week");
  assert.equal(await ticked(twoAgo, P), true, "the original week stays ticked");

  // A hand-in made after a week ended still doesn't tick that week.
  await db.query("select private.refresh_plan_ticks($1, $2)", [tia, [P2]]);
  assert.equal(await ticked(threeAgo, P2), false, "a hand-in after the week ended ticks nothing");
  assert.equal(await ticked(lastWeek, P2), true, "the week it was handed in stays ticked");

  // The quiz still has to be taken inside the week.
  const nextWeek = await planWeek(tia, mon(1));
  await addPoint(nextWeek, P, "focus");
  assert.equal(await ticked(nextWeek, P), false, "next week's P waits for next week's quiz");
  // A task-only point that comes back after its hand-in arrives ticked.
  const nextChem = await planWeek(tia, mon(1), "chemistry");
  await addPoint(nextChem, P2, "focus");
  assert.equal(await ticked(nextChem, P2), true, "a task-only point handed in earlier is done");

  // The in-week case, under the new rule.
  await addPoint(review, P3);
  assert.equal(await ticked(review, P3), false);
  await handIn(task3, tia);
  assert.equal(
    await ticked(review, P3),
    false,
    "the task alone doesn't tick a quiz-and-task point",
  );
  await attempt(quiz3, tia);
  assert.equal(await ticked(review, P3), true, "task and quiz in the same week tick it");
}

// ── 2. Calling a break off ───────────────────────────────────────────────
{
  // Began this week, with two breaks booked to run on from it.
  assert.equal(await end(bo, boNow), "cancelled", "still reported as called off");
  const now = await breakRow(boNow);
  assert.ok(now.cancelled_at, "the break that began this week is called off");
  assert.equal(now.ends_on, sun(0), "and keeps its dates");
  assert.equal(now.ended_early_at, null, "it is called off, not ended early");
  assert.equal(now.recorded_at, null, "a called-off break is never recorded");
  assert.equal(now.ended_by, bo);
  for (const [id, label] of [
    [boNext, "the break booked to run on from it"],
    [boThird, "and the one after that"],
  ]) {
    const row = await breakRow(id);
    assert.ok(row.cancelled_at, `${label} is called off`);
    assert.equal(row.ended_by, bo);
  }
  assert.equal((await breakRow(boLater)).cancelled_at, null, "a break that doesn't touch stays");
  const pauses = await db.query<{ n: number }>(
    "select count(*)::int as n from public.student_subject_pauses where student_id = $1",
    [bo],
  );
  assert.equal(pauses.rows[0].n, 0, "nothing is recorded as a stop");
  await planWeek(bo, mon(0));
  await planWeek(bo, mon(1));
  await planWeek(bo, mon(3));
  await refuses(() => planWeek(bo, mon(6)), "23514", "the separate break stays a break week");
  await refuses(() => end(bo, boNext), "P0002", "calling off a break already gone");

  // Still to come: only that booking is called off.
  assert.equal(await end(fay, fayFirst), "cancelled");
  assert.ok((await breakRow(fayFirst)).cancelled_at);
  assert.equal(
    (await breakRow(fayNext)).cancelled_at,
    null,
    "a break still to come takes nothing after it with it",
  );

  // Under way since last week: ended early, and the run after it goes.
  assert.equal(await end(eli, eliAway), "ended_early");
  const back = await breakRow(eliAway);
  assert.equal(back.ends_on, sun(-1), "it ends the Sunday before this week");
  assert.ok(back.ended_early_at);
  assert.equal(back.cancelled_at, null, "last week still happened");
  assert.ok(back.recorded_at, "and is recorded at once");
  assert.ok((await breakRow(eliNext)).cancelled_at, "the break after it is called off");
  assert.ok((await breakRow(eliThen)).cancelled_at, "and the one after that");

  await refuses(() => end(stranger, fayNext), "42501", "someone else can't call it off");
  const over = await insertBreak(fay, mon(-4), sun(-4));
  await refuses(() => end(fay, over), "22023", "a break that is over", /already over/);
}

// ── 3. Moving an exam date ───────────────────────────────────────────────
{
  // Ed's break is week 10. The window is the exam's Monday minus 6 weeks to
  // that week's Sunday.
  await refuses(
    () => moveExam(ed, shift(mon(14), 2)),
    "23514",
    "a Wednesday exam 4 weeks after the break",
    nearExam(mon(10), sun(10)),
  );
  await refuses(() => moveExam(ed, mon(16)), "23514", "the break in the window's first week");
  await moveExam(ed, mon(17));
  assert.equal(await examOf(ed), mon(17), "a break ending the Sunday before the window is fine");
  await moveExam(ed, sun(9));
  assert.equal(await examOf(ed), sun(9), "a break starting the Monday after the exam week is fine");
  await refuses(() => moveExam(ed, sun(10)), "23514", "an exam on the break's own Sunday");
  // The refusal carries book_break's hint, and leaves the date where it was.
  await assert.rejects(
    () => moveExam(ed, mon(12)),
    (e: { hint?: string }) => e.hint === "break_near_exam",
  );
  assert.equal(await examOf(ed), sun(9));
  // Once the break is called off, the date can move.
  await end(ed, edBreak);
  await moveExam(ed, mon(12));
  assert.equal(await examOf(ed), mon(12));

  // A break under way counts.
  await refuses(
    () => moveExam(uma, mon(5)),
    "23514",
    "a break under way",
    nearExam(mon(-1), sun(0)),
  );

  // A break that is over, or called off, doesn't block.
  await moveExam(pat, mon(3));
  assert.equal(await examOf(pat), mon(3), "only breaks that still stand are checked");

  // Seeding: an insert is never checked, even with a break in the window.
  await as(
    sid,
    "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', $2, $3, '[]')",
    [sid, mon(0), mon(8)],
  );
  await as(
    sid,
    "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'chemistry', $2, $3, '[]') on conflict (student_id, subject) do update set exam_date = excluded.exam_date",
    [sid, mon(0), mon(8)],
  );
  assert.equal(await examOf(sid), mon(8), "the first view's seed is saved");
  // An update that leaves the date alone isn't checked either.
  await as(
    sid,
    'update public.student_program_plan set pacing = \'[{"topicId":"x"}]\', updated_at = now() where student_id = $1',
    [sid],
  );
  await as(
    sid,
    "update public.student_program_plan set exam_date = exam_date where student_id = $1",
    [sid],
  );
  await as(
    sid,
    "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', $2, $3, '[]') on conflict (student_id, subject) do update set exam_date = excluded.exam_date, pacing = excluded.pacing",
    [sid, mon(0), mon(8)],
  );
  // A real move by the seed's upsert path is checked like any other.
  await refuses(
    () =>
      as(
        sid,
        "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', $2, $3, '[]') on conflict (student_id, subject) do update set exam_date = excluded.exam_date",
        [sid, mon(0), mon(9)],
      ),
    "23514",
    "a move through an upsert",
    nearExam(mon(5), sun(5)),
  );
  // A move that keeps the break clear is fine.
  await moveExam(sid, mon(20));
  assert.equal(await examOf(sid), mon(20));
  assert.equal((await breakRow(sidBreak)).cancelled_at, null);

  // Nobody calls the check directly.
  await assert.rejects(
    () => as(sid, "select private.exam_date_clear_of_breaks()"),
    /permission denied|trigger functions can only be called as triggers/,
  );
  const acl = await db.query<{ ok: boolean }>(
    `select not has_function_privilege('authenticated', 'private.exam_date_clear_of_breaks()', 'execute')
        and not has_function_privilege('anon', 'private.exam_date_clear_of_breaks()', 'execute') as ok`,
  );
  assert.equal(acl.rows[0].ok, true, "no client role can execute the trigger function");
}

// ── 4. The rollback puts back exactly what was there ────────────────────
{
  await db.exec(
    await readFile(new URL(`../supabase/rollbacks/${FIX}.down.sql`, import.meta.url), "utf8"),
  );
  const src = async (name: string) =>
    (await db.query<{ s: string }>("select prosrc as s from pg_proc where proname = $1", [name]))
      .rows[0].s;
  assert.ok(
    (await migration("20261007094747_plan_tick_from_work.sql")).includes(
      `as $$${await src("plan_point_tick_state")}$$;`,
    ),
    "plan_point_tick_state as 20261007094747 left it",
  );
  assert.ok(
    (await migration("20261005161000_break_pickup.sql")).includes(
      `as $function$${await src("end_break")}$function$;`,
    ),
    "end_break as 20261005161000 left it",
  );
  const left = await db.query<{ n: number }>(
    `select (select count(*) from pg_trigger where tgname = 'exam_date_clear_of_breaks')::int
          + (select count(*) from pg_proc where proname = 'exam_date_clear_of_breaks')::int as n`,
  );
  assert.equal(left.rows[0].n, 0, "no trigger or function left behind");
  await undone(async () => {
    await moveExam(uma, mon(5));
    assert.equal(await examOf(uma), mon(5), "the exam date moves unchecked again");
  });
  // And the fix applies again on top of the rollback.
  await db.exec(fix);
  await refuses(() => moveExam(uma, mon(5)), "23514", "re-applied");
}

console.log("scheduler fixes: all checks passed");
