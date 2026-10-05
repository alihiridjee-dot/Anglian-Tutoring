/** Isolated PostgreSQL checks for the student breaks migration (PR 1 of the
 * break work). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-student-breaks-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const alex = uuid(1); // two subjects, a programme for each, two parents
const sam = uuid(2); // one subject, no programme yet, no parent
const kim = uuid(3); // one subject, no programme, for breaks already under way
const lee = uuid(9); // one subject with a programme, for breaks that are over
const mum = uuid(4);
const dad = uuid(5);
const stranger = uuid(6); // a parent of someone else
const tutor = uuid(7);
const admin = uuid(8);
const point = uuid(100);
const point2 = uuid(101);

// The shape of production the migrations touch. has_role, is_staff,
// refuse_student_row_for_staff and plan_override_caller_is_tutor are the live
// bodies (4 Oct 2026), as are student_has_access and student_paid_subjects.
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
alter table public.parent_student_links enable row level security;
create policy "psl parent reads own" on public.parent_student_links for select using (
  (select auth.uid()) = parent_id or (select auth.uid()) = student_id
  or private.has_role((select auth.uid()), 'tutor'::public.app_role));
grant select on public.parent_student_links to authenticated;
create table public.spec_points(id uuid primary key);
create table public.student_program_plan(
  student_id uuid references auth.users on delete cascade, subject public.subject,
  program_start date, exam_date date, pacing jsonb, acknowledged_at timestamptz default now(),
  updated_at timestamptz default now(), primary key (student_id, subject));
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
      select case
        when x.cap is null then x.courses
        else x.courses[1:x.cap]
      end
      from (
        select
          coalesce(p.enrolled_courses, '{}'::text[]) as courses,
          (
            select max(
              case
                when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int
                else null
              end
            )
            from public.subscriptions s
            where s.student_id = p_student_id
              and s.status in ('active', 'trialing')
              and (s.current_period_end is null or s.current_period_end > now())
          ) as cap
        from public.profiles p
        where p.id = p_student_id
          and private.student_has_access(p_student_id)
      ) x
    ),
    '{}'::text[]
  )
$function$;
`);

// ── Weeks, counted from this one (UK time, as the migration counts them) ──
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
/** As to_char(d, 'Dy FMDD Mon') writes it. */
const dy = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
};

// ── Fixtures, before the migrations ──────────────────────────────────────
for (const id of [alex, sam, kim, mum, dad, stranger, tutor, admin, lee])
  await db.query("insert into auth.users values ($1)", [id]);
await db.query("insert into public.user_roles values ($1, 'tutor'), ($2, 'admin')", [tutor, admin]);
await db.query(
  `insert into public.profiles (id, role, display_name, level, enrolled_courses) values
     ($1, 'student', 'Alex Smith', 'gcse', array['chemistry','biology']),
     ($2, 'student', 'Sam', 'gcse', array['biology']),
     ($3, 'student', 'Kim Lee', 'gcse', array['biology']),
     ($4, 'parent', 'Pat Smith', null, null), ($5, 'parent', 'Chris Smith', null, null),
     ($6, 'parent', 'Jo Bloggs', null, null), ($7, 'tutor', 'Dr Tutor', null, null),
     ($8, 'tutor', 'Admin', null, null), ($9, 'student', 'Lee', 'gcse', array['biology'])`,
  [alex, sam, kim, mum, dad, stranger, tutor, admin, lee],
);
await db.query(
  "insert into public.parent_student_links (parent_id, student_id) values ($1, $3), ($2, $3)",
  [mum, dad, alex],
);
await db.query(
  `insert into public.student_enrolments (student_id, subject, board) values
     ($1, 'chemistry', 'edexcel'), ($1, 'biology', 'edexcel'), ($2, 'biology', 'aqa'), ($3, 'biology', 'aqa'),
     ($4, 'biology', 'aqa')`,
  [alex, sam, kim, lee],
);
await db.query(
  `insert into public.subscriptions (user_id, student_id, status, plan, current_period_end) values
     ($1, $1, 'active', 'monthly_2', now() + interval '20 days'),
     ($2, $2, 'active', 'monthly_1', now() + interval '20 days'),
     ($3, $3, 'active', 'monthly_1', now() + interval '20 days'),
     ($4, $4, 'active', 'monthly_1', now() + interval '20 days')`,
  [alex, sam, kim, lee],
);
// Chemistry's exam is on the Monday 20 weeks on; biology's on a Wednesday 30 on.
await db.query(
  "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'chemistry', $2, $3, '[]'), ($1, 'biology', $2, $4, '[]')",
  [alex, mon(-10), mon(20), shift(mon(30), 2)],
);
await db.query(
  "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, 'biology', $2, $3, '[]')",
  [lee, mon(-10), mon(30)],
);
await db.query("insert into public.spec_points values ($1), ($2)", [point, point2]);

for (const file of [
  "20261004090000_subject_pauses.sql",
  "20261004091000_resume_after_pause.sql",
  "20261004092000_erase_cancelled_progress.sql",
  "20261005160000_student_breaks.sql",
  "20261005161000_break_pickup.sql",
])
  await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

// ── Helpers ──────────────────────────────────────────────────────────────
/** Run as a signed-in user (null: signed in as nobody). */
const as = async <T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
) => {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`,
  );
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
};
const book = async (
  who: string | null,
  student: string,
  startsOn: string,
  weeks: number | null,
  reason = "holiday",
) =>
  (
    await as<{ id: string }>(who, "select public.book_break($1, $2::date, $3, $4) as id", [
      student,
      startsOn,
      weeks,
      reason,
    ])
  ).rows[0].id;
const end = async (who: string, id: string) =>
  (await as<{ r: string }>(who, "select public.end_break($1) as r", [id])).rows[0].r;
type Break = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: string;
  booked_by: string | null;
  cancelled_at: Date | null;
  ended_early_at: Date | null;
  ended_by: string | null;
};
const breakRow = async (id: string) =>
  (
    await db.query<Break>(
      "select id, starts_on::text, ends_on::text, reason, booked_by, cancelled_at, ended_early_at, ended_by from public.student_breaks where id = $1",
      [id],
    )
  ).rows[0];
type Note = { type: string; title: string; body: string; link: string };
const notes = async (uid: string) =>
  (
    await db.query<Note>(
      "select type, title, body, link from public.notifications where user_id = $1 order by created_at",
      [uid],
    )
  ).rows;
const clearNotes = () => db.exec("delete from public.notifications");
const refuses = async (
  run: () => Promise<unknown>,
  code: string,
  hint: string | null,
  label: string,
  message?: RegExp,
) => {
  await assert.rejects(
    run,
    (e: { code?: string; hint?: string; message?: string }) => {
      assert.equal(e.code, code, `${label} (code; message: ${e.message})`);
      if (hint) assert.equal(e.hint, hint, `${label} (hint)`);
      if (message) assert.match(e.message ?? "", message, `${label} (message)`);
      return true;
    },
    label,
  );
};
const planWeek = (student: string, weekStart: string, subject = "biology") =>
  db.query<{ id: string }>(
    "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source) values ($1, $2, 'edexcel', 'gcse', $3, 'ai') returning id",
    [student, subject, weekStart],
  );
const addPoint = (plan: string, spec: string) =>
  db.query(
    "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin) values ($1, $2, 'core')",
    [plan, spec],
  );

// ── 1. The student books a break: both parents are told ────────────────
const holiday = await book(alex, alex, mon(1), 2, "holiday");
{
  const row = await breakRow(holiday);
  assert.equal(row.starts_on, mon(1));
  assert.equal(row.ends_on, sun(2), "two whole weeks, Monday to Sunday");
  assert.equal(row.reason, "holiday");
  assert.equal(row.booked_by, alex);
  assert.equal(row.cancelled_at, null);
  const told: Note = {
    type: "break_booked",
    title: "Alex is taking a break",
    body: `No new work from ${dy(mon(1))} to ${dy(sun(2))}. Alex booked it.`,
    link: "/parent-dashboard",
  };
  assert.deepEqual(await notes(mum), [told], "a parent is told, with the first name");
  assert.deepEqual(await notes(dad), [told], "and so is the other parent");
  assert.deepEqual(await notes(alex), [], "the student booked it, so isn't told");
  await clearNotes();
}

// ── 2. A parent books one: the student and the other parent are told ───
const schoolWeek = await book(mum, alex, mon(6), 1, "school");
{
  const when = `No new work from ${dy(mon(6))} to ${dy(sun(6))}.`;
  assert.deepEqual(await notes(alex), [
    {
      type: "break_booked",
      title: "You're taking a break",
      body: `${when} Your parent booked it.`,
      link: "/planner",
    },
  ]);
  assert.equal((await notes(dad))[0]?.body, `${when} A parent booked it.`);
  assert.deepEqual(await notes(mum), [], "the parent who booked it isn't told");
  await clearNotes();
}

// ── 3. A tutor books one ─────────────────────────────────────────────────
const examsWeek = await book(tutor, alex, mon(8), 1, "exams");
{
  const when = `No new work from ${dy(mon(8))} to ${dy(sun(8))}.`;
  assert.equal((await notes(alex))[0]?.body, `${when} Your tutor booked it.`);
  assert.equal((await notes(mum))[0]?.body, `${when} Their tutor booked it.`);
  assert.equal((await notes(dad))[0]?.body, `${when} Their tutor booked it.`);
  assert.deepEqual(await notes(tutor), []);
  // An admin counts as a tutor. Sam has no parent, so only Sam is told.
  await book(admin, sam, mon(10), 1, "other");
  assert.equal(
    (await notes(sam))[0]?.body,
    `No new work from ${dy(mon(10))} to ${dy(sun(10))}. Your tutor booked it.`,
  );
  await clearNotes();
}

// ── 4. Nobody else can book one, and only for a student ─────────────────
{
  await refuses(() => book(stranger, alex, mon(11), 1), "42501", null, "another family's parent");
  await refuses(() => book(sam, alex, mon(11), 1), "42501", null, "another student");
  await refuses(() => book(alex, sam, mon(11), 1), "42501", null, "a student for someone else");
  await refuses(
    () => book(null, alex, mon(11), 1),
    "42501",
    null,
    "signed in as nobody",
    /Sign in/,
  );
  await refuses(
    () => book(tutor, mum, mon(11), 1),
    "22023",
    null,
    "a parent's own account",
    /Only a student/,
  );
  await refuses(() => book(tutor, tutor, mon(11), 1), "22023", null, "a tutor's own account");
  await db.exec("set role anon;");
  await assert.rejects(
    () => db.query("select public.book_break($1, $2::date, 1, 'holiday')", [alex, mon(11)]),
    /permission denied/,
    "anonymous visitors can't call it at all",
  );
  await db.exec("reset role;");
  assert.deepEqual(await notes(mum), [], "a refused booking tells nobody");
}

// ── 5. Whole weeks, 1 to 4 of them, from this week to a year ahead ──────
{
  for (const weeks of [0, 5, null])
    await refuses(
      () => book(alex, alex, mon(11), weeks),
      "23514",
      "break_too_long",
      `${weeks} weeks`,
    );
  await refuses(
    () => book(alex, alex, shift(mon(11), 1), 1),
    "22023",
    null,
    "a Tuesday start",
    /Monday/,
  );
  await refuses(
    () => book(sam, sam, mon(-1), 1),
    "22023",
    null,
    "a week that has gone",
    /already gone/,
  );
  await refuses(() => book(alex, alex, mon(11), 1, "ill"), "22023", null, "a reason off the list");
  const farthest = await book(sam, sam, mon(52), 1);
  assert.equal((await breakRow(farthest)).starts_on, mon(52), "a year ahead is fine");
  await refuses(() => book(sam, sam, mon(53), 1), "22023", null, "more than a year ahead");
  const now = await book(sam, sam, mon(0), 1);
  assert.equal((await breakRow(now)).starts_on, mon(0), "this week is fine");
}

// ── 6. No overlaps, and breaks that touch count as one ───────────────────
const extension = await book(alex, alex, mon(3), 2, "holiday");
{
  await refuses(
    () => book(alex, alex, mon(2), 1),
    "23514",
    "break_overlaps",
    "inside a booked break",
  );
  await refuses(() => book(mum, alex, mon(7), 2), "23514", "break_overlaps", "running into one");
  // mon(1)–mon(4) is already 4 weeks; mon(5) would join it to mon(6) too.
  await refuses(() => book(alex, alex, mon(5), 1), "23514", "break_too_long", "joining two runs");
  await refuses(
    () => book(alex, alex, mon(0), 1),
    "23514",
    "break_too_long",
    "a fifth week in front",
  );
  assert.equal(
    (await breakRow(extension)).ends_on,
    sun(4),
    "running on to exactly 4 weeks is fine",
  );
}

// ── 7. None in the 6 weeks before an exam, or the exam week ─────────────
{
  // Chemistry: exam Monday mon(20), so mon(14) to the exam week are out.
  const chemExam = new Date(`${mon(20)}T00:00:00Z`);
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  const chemLabel = `${chemExam.getUTCDate()} ${months[chemExam.getUTCMonth()]} ${chemExam.getUTCFullYear()}`;
  await refuses(
    () => book(alex, alex, mon(14), 1),
    "23514",
    "break_near_exam",
    "6 weeks before chemistry",
    new RegExp(`exam on ${chemLabel}`),
  );
  await refuses(
    () => book(alex, alex, mon(13), 2),
    "23514",
    "break_near_exam",
    "running into the 6 weeks",
  );
  await refuses(() => book(alex, alex, mon(20), 1), "23514", "break_near_exam", "the exam week");
  const justBefore = await book(alex, alex, mon(12), 2);
  assert.equal((await breakRow(justBefore)).ends_on, sun(13), "ending the Sunday before is fine");
  // Biology: exam Wednesday of week 30, so mon(24) to that week are out.
  await refuses(
    () => book(alex, alex, mon(24), 1),
    "23514",
    "break_near_exam",
    "6 weeks before biology",
  );
  await refuses(
    () => book(alex, alex, mon(30), 1),
    "23514",
    "break_near_exam",
    "biology's exam week",
  );
  await book(alex, alex, mon(21), 1); // after chemistry's exam week, before biology's 6 weeks
  await book(alex, alex, mon(31), 1); // after both exams
  // No programme, no known exam.
  await book(kim, kim, mon(20), 1);
  await clearNotes();
}

// ── 8. Nothing new is planned in a break week ────────────────────────────
{
  await refuses(() => planWeek(alex, mon(1)), "23514", "on_a_break", "the first week of a break");
  await refuses(
    () => planWeek(alex, mon(4), "chemistry"),
    "23514",
    "on_a_break",
    "a week it ran on to",
  );
  const working = (await planWeek(alex, mon(9))).rows[0].id;
  await addPoint(working, point);
  // A tutor books the week after the plan was made: the plan stays, ticks
  // still work, nothing new goes in.
  const late = await book(tutor, alex, mon(9), 1, "school");
  await refuses(
    () => addPoint(working, point2),
    "23514",
    "on_a_break",
    "a point added to a break week",
  );
  await db.query(
    "update public.student_weekly_plan_points set done_at = now() where plan_id = $1 and spec_point_id = $2",
    [working, point],
  );
  const other = (await planWeek(alex, mon(11))).rows[0].id;
  await addPoint(other, point2);
  await refuses(
    () =>
      db.query("update public.student_weekly_plan_points set plan_id = $1 where plan_id = $2", [
        working,
        other,
      ]),
    "23514",
    "on_a_break",
    "a point moved into a break week",
  );
  assert.equal(await end(alex, late), "cancelled");
  await addPoint(working, point2);
  await refuses(() => planWeek(sam, mon(0)), "23514", "on_a_break", "this week, on a break");
  await clearNotes();
}

// ── 9. Calling one off, and coming back early ────────────────────────────
{
  await refuses(() => end(stranger, holiday), "42501", null, "another family's parent");
  await refuses(() => end(sam, holiday), "42501", null, "another student");

  assert.equal(await end(mum, schoolWeek), "cancelled", "a break not yet begun is called off");
  const off = await breakRow(schoolWeek);
  assert.ok(off.cancelled_at);
  assert.equal(off.ended_by, mum);
  assert.equal(off.ends_on, sun(6), "a called-off break keeps its dates");
  await planWeek(alex, mon(6));
  await refuses(() => end(alex, schoolWeek), "P0002", null, "calling it off twice");
  assert.equal(await end(admin, examsWeek), "cancelled", "an admin can call one off");

  // One that began this week is called off too: this week is a working week.
  const samNow = (
    await db.query<{ id: string }>(
      "select id from public.student_breaks where student_id = $1 and starts_on = $2",
      [sam, mon(0)],
    )
  ).rows[0].id;
  assert.equal(await end(sam, samNow), "cancelled");
  await planWeek(sam, mon(0));

  // Kim went away last week for two weeks, and booked two more single weeks
  // to run on from it.
  const kimBreak = async (from: string, to: string) =>
    (
      await db.query<{ id: string }>(
        "insert into public.student_breaks (student_id, starts_on, ends_on, reason, booked_by) values ($1, $2, $3, 'holiday', $1) returning id",
        [kim, from, to],
      )
    ).rows[0].id;
  const away = await kimBreak(mon(-1), sun(0));
  const after = await kimBreak(mon(1), sun(1));
  const afterThat = await kimBreak(mon(2), sun(2));
  assert.equal(await end(kim, away), "ended_early");
  const back = await breakRow(away);
  assert.equal(back.ends_on, sun(-1), "it ends the Sunday before the week they came back in");
  assert.ok(back.ended_early_at);
  assert.equal(back.cancelled_at, null, "last week still happened");
  assert.equal(back.ended_by, kim);
  assert.ok((await breakRow(after)).cancelled_at, "the break booked to run on from it goes too");
  assert.ok((await breakRow(afterThat)).cancelled_at, "and the one after that");
  await planWeek(kim, mon(0));
  await planWeek(kim, mon(1));
  await planWeek(kim, mon(2));
  await refuses(
    () => planWeek(kim, mon(-1)),
    "23514",
    "on_a_break",
    "last week stays a break week",
  );

  const old = (
    await db.query<{ id: string }>(
      "insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ($1, $2, $3, 'other') returning id",
      [kim, mon(-4), sun(-4)],
    )
  ).rows[0].id;
  await refuses(() => end(kim, old), "22023", null, "a break that is over", /already over/);
  assert.deepEqual(await notes(mum), [], "calling off or coming back tells nobody");
}

// ── 10. The table's own rules hold even for a direct write ───────────────
{
  const bad = (starts: string, ends: string) =>
    db.query(
      "insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ($1, $2, $3, 'other')",
      [sam, starts, ends],
    );
  await assert.rejects(() => bad(shift(mon(40), 1), mon(41)), /whole_weeks/, "Tuesday to Monday");
  await assert.rejects(() => bad(mon(40), sun(44)), /one_to_four_weeks/);
  await assert.rejects(
    () =>
      db.query(
        "insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ($1, $2, $3, 'other')",
        [tutor, mon(40), sun(40)],
      ),
    /tutor account/,
    "a tutor can't hold a break",
  );
}

// ── 11. Who can read the record, and nobody writes it ───────────────────
{
  const count = (who: string) =>
    as<{ n: number }>(who, "select count(*)::int as n from public.student_breaks").then(
      (r) => r.rows[0].n,
    );
  const of = async (student: string) =>
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.student_breaks where student_id = $1",
        [student],
      )
    ).rows[0].n;
  const total = (
    await db.query<{ n: number }>("select count(*)::int as n from public.student_breaks")
  ).rows[0].n;
  assert.equal(await count(alex), await of(alex), "the student reads their own");
  assert.equal(await count(mum), await of(alex), "a linked parent reads their child's");
  assert.equal(await count(tutor), total, "a tutor reads them all");
  assert.equal(await count(stranger), 0, "another family's parent reads none");
  assert.equal(await count(sam), await of(sam), "another student reads only their own");
  await assert.rejects(
    () =>
      as(
        alex,
        `insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ('${alex}', '${mon(40)}', '${sun(40)}', 'holiday')`,
      ),
    /permission denied/,
    "nobody writes the record through the API",
  );
  await assert.rejects(
    () => as(alex, "update public.student_breaks set cancelled_at = now()"),
    /permission denied/,
  );
  await assert.rejects(() => as(alex, "delete from public.student_breaks"), /permission denied/);
}

// ── 12. A family's cancellation erases breaks; nothing else does ────────
{
  const src = (
    await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'erase_cancelled_progress'",
    )
  ).rows[0].src;
  const lines = src.split("\n").filter((l) => l.includes("student_breaks"));
  assert.deepEqual(
    lines.map((l) => l.trim()),
    ["delete from public.student_breaks where student_id = _stop.student_id;"],
    "one delete, in the whole-plan branch only (tested end to end in test-erase-cancelled-progress-db.ts)",
  );
}

// ── 12b. A break that is over becomes a finished stop of each subject, once ─
{
  const leeBreak = async (from: string, to: string, cancelled = false) =>
    (
      await db.query<{ id: string }>(
        "insert into public.student_breaks (student_id, starts_on, ends_on, reason, cancelled_at) values ($1, $2, $3, 'holiday', $4) returning id",
        [lee, from, to, cancelled ? new Date() : null],
      )
    ).rows[0].id;
  const over = await leeBreak(mon(-6), sun(-5));
  const calledOff = await leeBreak(mon(-3), sun(-3), true);
  const underWay = await leeBreak(mon(-1), sun(1));
  const ahead = await book(lee, lee, mon(4), 1);
  type Stop = { id: string; subject: string; reason: string; started: string; ended: string };
  const stops = async () =>
    (
      await db.query<Stop>(
        `select id, subject::text, reason,
                to_char(started_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') as started,
                to_char(ended_at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') as ended
           from public.student_subject_pauses where student_id = $1 order by started_at`,
        [lee],
      )
    ).rows;
  const recordedAt = async (id: string) =>
    (
      await db.query<{ at: Date | null }>(
        "select recorded_at as at from public.student_breaks where id = $1",
        [id],
      )
    ).rows[0].at;

  const job = await db.query<{ schedule: string }>(
    "select schedule from cron.job where jobname = 'record-finished-breaks'",
  );
  assert.equal(job.rows[0]?.schedule, "10 * * * *", "the hourly backstop is scheduled");

  await db.query("select private.record_finished_breaks()");
  assert.deepEqual(
    (await stops()).map(({ subject, reason, started, ended }) => ({
      subject,
      reason,
      started,
      ended,
    })),
    [
      {
        subject: "biology",
        reason: "break",
        started: `${mon(-6)} 00:00`,
        ended: `${mon(-4)} 00:00`,
      },
    ],
    "UK midnight on the Monday it began, to UK midnight on the Monday after it ended",
  );
  assert.ok(await recordedAt(over), "a break that is over is recorded");
  assert.equal(await recordedAt(calledOff), null, "a called-off break never is");
  assert.equal(await recordedAt(underWay), null, "nor one under way");
  assert.equal(await recordedAt(ahead), null, "nor one still to come");

  await db.query("select private.record_finished_breaks()");
  await db.query("select private.sync_subject_pauses($1)", [lee]);
  assert.equal((await stops()).length, 1, "recorded once, and the billing sync leaves it be");
  // Asked directly, it still records each break at most once, and never one called off.
  await db.query("select private.record_break($1)", [over]);
  await db.query("select private.record_break($1)", [calledOff]);
  assert.equal((await stops()).length, 1);
  assert.equal(await recordedAt(calledOff), null);

  assert.equal(await end(lee, underWay), "ended_early");
  const [, back] = await stops();
  assert.deepEqual(
    { reason: back?.reason, started: back?.started, ended: back?.ended },
    { reason: "break", started: `${mon(-1)} 00:00`, ended: `${mon(0)} 00:00` },
    "coming back early records the break at once, ending this Monday",
  );
  assert.ok(await recordedAt(underWay));

  // Picked up as a billing pause is: the student saves the calendar after it.
  const [first] = await stops();
  await as(lee, "select public.resume_programme_after_pause($1, '[]'::jsonb, null)", [first.id]);
  const resumed = await db.query<{ at: Date | null }>(
    "select programme_resumed_at as at from public.student_subject_pauses where id = $1",
    [first.id],
  );
  assert.ok(resumed.rows[0].at, "the resume step takes a break like any other stop");

  await assert.rejects(
    () =>
      db.query(
        "insert into public.student_subject_pauses (student_id, subject, reason, started_at, ended_at) values ($1, 'biology', 'holiday', now() - interval '2 days', now() - interval '1 day')",
        [lee],
      ),
    /reason_check/,
    "only the known reasons",
  );
}

// ── 13. An account deleted outright takes its breaks with it ────────────
{
  await db.query("delete from auth.users where id = $1", [kim]);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.student_breaks where student_id = $1",
        [kim],
      )
    ).rows[0].n,
    0,
  );
}

// ── 14. The rollback removes all of it, and puts the erase back ─────────
{
  await refuses(() => planWeek(alex, mon(2)), "23514", "on_a_break", "still a break week");
  // The pick-up first: end_break as 20261005160000 left it, the record gone.
  await db.exec(
    await readFile(
      new URL("../supabase/rollbacks/20261005161000_break_pickup.down.sql", import.meta.url),
      "utf8",
    ),
  );
  const endSrc = (
    await db.query<{ src: string }>("select prosrc as src from pg_proc where proname = 'end_break'")
  ).rows[0].src;
  const firstPr = await readFile(
    new URL("../supabase/migrations/20261005160000_student_breaks.sql", import.meta.url),
    "utf8",
  );
  assert.ok(firstPr.includes(`as $function$${endSrc}$function$;`), "end_break as it was");
  const pickupLeft = await db.query<{ n: number }>(
    `select (select count(*) from pg_proc where proname in ('record_break', 'record_finished_breaks'))::int
          + (select count(*) from cron.job where jobname = 'record-finished-breaks')::int
          + (select count(*) from information_schema.columns
              where table_name = 'student_breaks' and column_name = 'recorded_at')::int
          + (select count(*) from public.student_subject_pauses where reason = 'break')::int as n`,
  );
  assert.equal(pickupLeft.rows[0].n, 0, "no function, job, column or recorded break left");
  await assert.rejects(
    () =>
      db.query(
        "insert into public.student_subject_pauses (student_id, subject, reason, started_at, ended_at) values ($1, 'biology', 'break', now() - interval '2 days', now() - interval '1 day')",
        [lee],
      ),
    /reason_check/,
    "'break' is no longer a reason",
  );
  await db.exec(
    await readFile(
      new URL("../supabase/rollbacks/20261005160000_student_breaks.down.sql", import.meta.url),
      "utf8",
    ),
  );
  await planWeek(alex, mon(2));
  const left = await db.query<{ n: number }>(
    "select (select count(*) from pg_trigger where tgname like '%on_a_break%')::int + (select count(*) from pg_proc where proname in ('book_break', 'end_break', 'may_manage_breaks', 'refuse_planning_on_a_break'))::int + (select count(*) from pg_class where relname = 'student_breaks')::int as n",
  );
  assert.equal(left.rows[0].n, 0, "no trigger, function or table left behind");
  const src = (
    await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'erase_cancelled_progress'",
    )
  ).rows[0].src;
  const original = await readFile(
    new URL("../supabase/migrations/20261004092000_erase_cancelled_progress.sql", import.meta.url),
    "utf8",
  );
  assert.ok(
    original.includes(`as $function$${src}$function$;`),
    "the erase is exactly as 20261004092000 left it",
  );
}

console.log("student breaks: all checks passed");
