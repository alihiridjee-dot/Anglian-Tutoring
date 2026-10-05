/** Isolated PostgreSQL checks for erasing a family's cancelled progress after
 * 7 days (PR 3 of the subject-pause work). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-erase-cancelled-progress-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const parent = uuid(9);
const tutor = uuid(8);

// The shape of production the three migrations touch, with the live access
// rules (3 Oct 2026). Only the columns the erase reads are modelled.
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
create function public.plan_override_caller_is_tutor() returns boolean
  language sql stable security definer set search_path = public as $$
  select private.has_role(auth.uid(), 'tutor'::app_role) $$;
create function private.refuse_student_row_for_staff() returns trigger language plpgsql as $$ begin return new; end $$;
create type public.subject as enum ('biology', 'chemistry', 'physics');
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
create table public.billing_feedback(id serial, student_id uuid, action text);
create table public.chat_threads(id serial, student_id uuid);
create table public.session_attendees(id serial, user_id uuid);
create table public.topics(id uuid primary key, subject public.subject, board public.board, level public.level);
create table public.spec_points(id uuid primary key, topic_id uuid references public.topics);
create table public.student_program_plan(student_id uuid references auth.users on delete cascade, subject public.subject, program_start date, exam_date date, pacing jsonb, acknowledged_at timestamptz default now(), updated_at timestamptz default now(), primary key (student_id, subject));
create table public.student_term_plans(id uuid primary key default gen_random_uuid(), student_id uuid, subject public.subject);
create table public.student_weekly_plans(
  id uuid primary key default gen_random_uuid(), student_id uuid references auth.users on delete cascade,
  subject public.subject, board public.board, level public.level, week_start date,
  source public.plan_source, ai_rationale text, updated_at timestamptz default now(),
  term_plan_id uuid references public.student_term_plans(id) on delete set null,
  unique (student_id, subject, week_start));
create table public.student_weekly_plan_points(
  plan_id uuid references public.student_weekly_plans on delete cascade,
  spec_point_id uuid references public.spec_points, origin public.plan_point_origin,
  carried_from date, done_at timestamptz, primary key (plan_id, spec_point_id));
create table public.student_weekly_checkins(id serial, plan_id uuid references public.student_weekly_plans on delete cascade, student_id uuid);
create table public.student_weekly_tutor_notes(plan_id uuid references public.student_weekly_plans on delete cascade, student_id uuid, note text);
create table public.student_plan_overrides(id serial, student_id uuid, subject public.subject, spec_point_id uuid);
create table public.student_spec_point_reviews(id serial, student_id uuid, spec_point_id uuid);
create table public.student_spec_point_schedule(student_id uuid, spec_point_id uuid);
create table public.student_spec_point_confidence(student_id uuid, spec_point_id uuid);
create table public.student_topic_confidence(student_id uuid, topic_id uuid);
create table public.student_tutor_notes(id serial, student_id uuid, body text);
create table public.student_learning_profile(student_id uuid primary key, responses jsonb);
create table public.mcq_sets(id uuid primary key, spec_point_id uuid, subject public.subject);
create table public.mcq_questions(id serial, set_id uuid references public.mcq_sets, spec_point_id uuid);
create table public.mcq_attempts(id serial, set_id uuid references public.mcq_sets on delete cascade, user_id uuid);
create table public.resources(id uuid primary key, kind text, subject public.subject, spec_point_id uuid);
create table public.resource_spec_points(resource_id uuid, spec_point_id uuid);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid references public.resources on delete cascade, student_id uuid);
create table public.homework_answers(id serial, submission_id uuid references public.homework_submissions on delete cascade);
create table public.homework_ai_marks(submission_id uuid references public.homework_submissions on delete cascade);
create table public.notifications(id serial, user_id uuid, submission_id uuid references public.homework_submissions on delete cascade);
create table public.homework_drafts(student_id uuid, resource_id uuid references public.resources on delete cascade);
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

// ── One topic, one point, one quiz and one task per subject ─────────────
const subjects = ["biology", "chemistry"] as const;
const ids = { topic: 100, point: 200, set: 300, sheet: 400 } as const;
const of = (kind: keyof typeof ids, s: (typeof subjects)[number]) =>
  uuid(ids[kind] + subjects.indexOf(s));
for (const s of subjects) {
  await db.query("insert into public.topics values ($1, $2, 'aqa', 'gcse')", [of("topic", s), s]);
  await db.query("insert into public.spec_points values ($1, $2)", [
    of("point", s),
    of("topic", s),
  ]);
  await db.query("insert into public.mcq_sets values ($1, $2, $3)", [
    of("set", s),
    of("point", s),
    s,
  ]);
  await db.query("insert into public.resources values ($1, 'homework', $2, $3)", [
    of("sheet", s),
    s,
    of("point", s),
  ]);
}
for (const id of [parent, tutor]) await db.query("insert into auth.users values ($1)", [id]);
await db.query("insert into public.user_roles values ($1, 'tutor')", [tutor]);

/** A student taking both subjects, with a full record in each. */
async function student(n: number) {
  const id = uuid(n);
  await db.query("insert into auth.users values ($1)", [id]);
  await db.query(
    "insert into public.profiles values ($1, 'student', 'gcse', array['biology','chemistry'])",
    [id],
  );
  await db.query(
    "insert into public.subscriptions (user_id, student_id, status, plan, current_period_end) values ($1, $1, 'active', 'monthly_2', now() + interval '20 days')",
    [id],
  );
  await db.query("insert into public.parent_student_links values ($1, $2)", [parent, id]);
  await db.query("insert into public.billing_feedback (student_id, action) values ($1, 'cancel')", [
    id,
  ]);
  await db.query("insert into public.chat_threads (student_id) values ($1)", [id]);
  await db.query("insert into public.session_attendees (user_id) values ($1)", [id]);
  await db.query("insert into public.student_tutor_notes (student_id, body) values ($1, 'note')", [
    id,
  ]);
  await db.query("insert into public.student_learning_profile values ($1, '{}')", [id]);
  for (const s of subjects) {
    await db.query(
      "insert into public.student_enrolments (student_id, subject, board) values ($1, $2, 'aqa')",
      [id, s],
    );
    await db.query(
      "insert into public.student_program_plan (student_id, subject, program_start, exam_date, pacing) values ($1, $2, '2026-07-13', '2027-06-07', '[]')",
      [id, s],
    );
    const term = (
      await db.query<{ id: string }>(
        "insert into public.student_term_plans (student_id, subject) values ($1, $2) returning id",
        [id, s],
      )
    ).rows[0].id;
    const plan = (
      await db.query<{ id: string }>(
        "insert into public.student_weekly_plans (student_id, subject, board, level, week_start, source, term_plan_id) values ($1, $2, 'aqa', 'gcse', '2026-09-28', 'ai', $3) returning id",
        [id, s, term],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.student_weekly_plan_points (plan_id, spec_point_id, origin, done_at) values ($1, $2, 'core', now())",
      [plan, of("point", s)],
    );
    await db.query(
      "insert into public.student_weekly_checkins (plan_id, student_id) values ($1, $2)",
      [plan, id],
    );
    await db.query("insert into public.student_weekly_tutor_notes values ($1, $2, 'weekly')", [
      plan,
      id,
    ]);
    await db.query(
      "insert into public.student_plan_overrides (student_id, subject, spec_point_id) values ($1, $2, $3)",
      [id, s, of("point", s)],
    );
    for (const t of [
      "student_spec_point_reviews",
      "student_spec_point_schedule",
      "student_spec_point_confidence",
    ])
      await db.query(`insert into public.${t} (student_id, spec_point_id) values ($1, $2)`, [
        id,
        of("point", s),
      ]);
    await db.query("insert into public.student_topic_confidence values ($1, $2)", [
      id,
      of("topic", s),
    ]);
    await db.query("insert into public.mcq_attempts (set_id, user_id) values ($1, $2)", [
      of("set", s),
      id,
    ]);
    const sub = (
      await db.query<{ id: string }>(
        "insert into public.homework_submissions (resource_id, student_id) values ($1, $2) returning id",
        [of("sheet", s), id],
      )
    ).rows[0].id;
    await db.query("insert into public.homework_answers (submission_id) values ($1)", [sub]);
    await db.query("insert into public.homework_ai_marks values ($1)", [sub]);
    await db.query("insert into public.notifications (user_id, submission_id) values ($1, $2)", [
      id,
      sub,
    ]);
    await db.query("insert into public.homework_drafts values ($1, $2)", [id, of("sheet", s)]);
  }
  return id;
}

const alex = await student(1); // cancels the plan, doesn't come back
const bea = await student(2); // cancels, comes back on day 6
const cal = await student(3); // card fails and is never fixed
const dee = await student(4); // pauses the plan for a month
const eve = await student(5); // removes chemistry
const fin = await student(6); // removes chemistry, re-adds it on day 6

for (const file of [
  "20261004090000_subject_pauses.sql",
  "20261004091000_resume_after_pause.sql",
  "20261004092000_erase_cancelled_progress.sql",
  "20261005160000_student_breaks.sql",
])
  await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));

// A break each (20261005160000). Only a family's cancellation of the whole
// plan erases it: breaks belong to the student, not to one subject.
for (const who of [alex, bea, cal, dee, eve, fin])
  await db.query(
    "insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ($1, '2026-10-12', '2026-10-25', 'holiday')",
    [who],
  );

// ── Helpers ──────────────────────────────────────────────────────────────
const sub = (who: string, set: string) =>
  db.query(`update public.subscriptions set ${set} where student_id = $1`, [who]);
/** Wind a student's cancellation back by `days`, as if that long had passed. */
const age = (who: string, days: number) =>
  db.query(
    `update public.student_subject_pauses set started_at = started_at - interval '${days} days', cancelled_at = cancelled_at - interval '${days} days' where student_id = $1`,
    [who],
  );
const erase = async () =>
  (await db.query<{ n: number }>("select private.erase_cancelled_progress() as n")).rows[0].n;
const count = async (table: string, column: string, who: string, extra = "") =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where ${column} = $1 ${extra}`,
      [who],
    )
  ).rows[0].n;
const PROGRESS: [string, string][] = [
  ["student_program_plan", "student_id"],
  ["student_weekly_plans", "student_id"],
  ["student_weekly_checkins", "student_id"],
  ["student_weekly_tutor_notes", "student_id"],
  ["student_term_plans", "student_id"],
  ["student_plan_overrides", "student_id"],
  ["student_spec_point_reviews", "student_id"],
  ["student_spec_point_schedule", "student_id"],
  ["student_spec_point_confidence", "student_id"],
  ["student_topic_confidence", "student_id"],
  ["mcq_attempts", "user_id"],
  ["homework_submissions", "student_id"],
  ["homework_drafts", "student_id"],
  // Only notifications about a task: they go with the submission they point at.
  ["notifications", "user_id"],
];
const KEPT: [string, string][] = [
  ["profiles", "id"],
  ["student_enrolments", "student_id"],
  ["parent_student_links", "student_id"],
  ["subscriptions", "student_id"],
  ["billing_feedback", "student_id"],
  ["chat_threads", "student_id"],
  ["session_attendees", "user_id"],
];
const progress = async (who: string) =>
  Object.fromEntries(
    await Promise.all(PROGRESS.map(async ([t, c]) => [t, await count(t, c, who)])),
  );
const kept = async (who: string) =>
  Object.fromEntries(await Promise.all(KEPT.map(async ([t, c]) => [t, await count(t, c, who)])));
const full = await progress(alex);
const keptBefore = await kept(alex);
const answers = async () =>
  (await db.query<{ n: number }>("select count(*)::int as n from public.homework_answers")).rows[0]
    .n;

// ── 1. The nightly job is scheduled ─────────────────────────────────────
{
  const job = await db.query<{ schedule: string }>(
    "select schedule from cron.job where jobname = 'erase-cancelled-progress'",
  );
  assert.equal(job.rows[0]?.schedule, "35 3 * * *");
  assert.equal(await erase(), 0, "nothing to erase yet");
}

// ── 2. A family cancels: kept for 7 days, erased after ──────────────────
await sub(alex, "cancel_at_period_end = true");
await sub(alex, "status = 'canceled'");
{
  await age(alex, 6);
  assert.equal(await erase(), 0, "six days in: still kept");
  assert.deepEqual(await progress(alex), full);
  await age(alex, 2);
  const before = await answers();
  assert.ok((await erase()) >= 1, "eight days in: erased");
  for (const [table, n] of Object.entries(await progress(alex)))
    assert.equal(n, 0, `${table} erased`);
  assert.equal(await count("student_tutor_notes", "student_id", alex), 0, "tutor's notes erased");
  assert.equal(
    await count("student_learning_profile", "student_id", alex),
    0,
    "profile answers erased",
  );
  assert.equal(
    await count("student_subject_pauses", "student_id", alex),
    0,
    "and the pause records",
  );
  assert.equal(await count("student_breaks", "student_id", alex), 0, "and their breaks");
  assert.equal(before - (await answers()), 2, "task answers went with their submissions");
  assert.deepEqual(await kept(alex), keptBefore, "the account, links, billing and messages stay");
  assert.equal(await erase(), 0, "nothing left to do");
}

// ── 3. Coming back within the 7 days is a pause ─────────────────────────
{
  await sub(bea, "cancel_at_period_end = true");
  await sub(bea, "status = 'canceled'");
  await age(bea, 6);
  await sub(bea, "status = 'active', cancel_at_period_end = false");
  await age(bea, 30); // the closed stop ages too: it must not matter
  assert.equal(await erase(), 0);
  assert.deepEqual(await progress(bea), full, "everything still there");
  assert.equal(await count("student_breaks", "student_id", bea), 1);
}

// ── 4. A failed card, even once Stripe gives up, is never erased ────────
{
  await sub(cal, "status = 'past_due'");
  await sub(cal, "status = 'canceled'");
  await age(cal, 60);
  assert.equal(await erase(), 0);
  assert.deepEqual(await progress(cal), full);
  assert.equal(await count("student_breaks", "student_id", cal), 1);
}

// ── 5. A paused plan is never erased ────────────────────────────────────
{
  await sub(dee, "status = 'paused'");
  await age(dee, 60);
  assert.equal(await erase(), 0);
  assert.deepEqual(await progress(dee), full);
  assert.equal(await count("student_tutor_notes", "student_id", dee), 1);
  assert.equal(
    await count("student_breaks", "student_id", dee),
    1,
    "nor a paused student's breaks",
  );
}

// ── 6. Removing a subject erases only that subject, 7 days on ───────────
const removeChemistry = (who: string) =>
  db.exec(`
    begin;
    delete from public.student_enrolments where student_id = '${who}' and subject = 'chemistry';
    update public.profiles set enrolled_courses = array['biology'] where id = '${who}';
    update public.subscriptions set plan = 'monthly_1' where student_id = '${who}';
    commit;`);
{
  await removeChemistry(eve);
  await age(eve, 8);
  assert.equal(await erase(), 1);
  const chem = await count("student_weekly_plans", "student_id", eve, "and subject = 'chemistry'");
  const bio = await count("student_weekly_plans", "student_id", eve, "and subject = 'biology'");
  assert.equal(chem, 0, "chemistry's plans erased");
  assert.equal(bio, 1, "biology's untouched");
  const after = await progress(eve);
  for (const [table, n] of Object.entries(after))
    assert.equal(n, full[table] / 2, `${table}: only chemistry's half went`);
  assert.equal(await count("student_tutor_notes", "student_id", eve), 1, "the tutor's notes stay");
  assert.equal(await count("student_learning_profile", "student_id", eve), 1);
  assert.equal(
    await count("student_breaks", "student_id", eve),
    1,
    "and the student's breaks stay",
  );
}

// ── 7. A subject added back within the 7 days is safe ───────────────────
{
  await removeChemistry(fin);
  await age(fin, 6);
  await db.exec(`
    begin;
    insert into public.student_enrolments (student_id, subject, board) values ('${fin}', 'chemistry', 'aqa');
    update public.profiles set enrolled_courses = array['biology','chemistry'] where id = '${fin}';
    commit;`);
  // The plan hasn't caught up yet, and the stop is now old enough.
  await age(fin, 30);
  assert.equal(await erase(), 0, "back on the list: not a cancellation any more");
  assert.deepEqual(await progress(fin), full);
}

// ── 8. A stale record can't erase a student who came back ───────────────
{
  // Stand in for a missed check: a cancelled stop left open on a paying student.
  await db.query(
    "insert into public.student_subject_pauses (student_id, subject, reason, started_at, cancelled_at) values ($1, 'biology', 'cancelled', now() - interval '20 days', now() - interval '20 days')",
    [bea],
  );
  assert.equal(await erase(), 0, "re-checked first, so nothing goes");
  assert.deepEqual(await progress(bea), full);
}

console.log("erase cancelled progress: all checks passed");
