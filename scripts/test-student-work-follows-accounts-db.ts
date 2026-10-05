/** Isolated PostgreSQL checks for 20261005171000_student_work_follows_accounts.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-student-work-follows-accounts-db.ts
 *
 * The tables are production's (5 Oct 2026), trimmed to the columns and keys the
 * migration and its cascades touch. The triggers on them, and the grading and
 * tutor guards they call, are production's own definitions. As in production,
 * the tables belong to a role that isn't a superuser and have row-level
 * security on, and an account is deleted by GoTrue's own role, which has no
 * rights on them. So the cascade is shown to work the way the dashboard and the
 * Admin API delete accounts.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = await file("migrations/20261005171000_student_work_follows_accounts.sql");
const rollback = await file("rollbacks/20261005171000_student_work_follows_accounts.down.sql");

await db.exec(`
create role supabase_auth_admin; create role app_owner;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
grant usage on schema auth to supabase_auth_admin;
grant select, delete on auth.users to supabase_auth_admin;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create table user_roles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, role app_role not null, unique (user_id, role));
create table profiles(id uuid primary key references auth.users on delete cascade, role profile_role not null default 'student');
create table resources(id uuid primary key default gen_random_uuid(), kind text not null);
create table mcq_sets(id uuid primary key default gen_random_uuid());
create table homework_submissions(id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources(id) on delete cascade, student_id uuid not null,
  submitted_at timestamptz not null default now(), grade text, score_pct numeric, feedback text,
  graded_by uuid, graded_at timestamptz, ai_marked_at timestamptz, release_at timestamptz,
  tutor_reviewed_at timestamptz, unique (resource_id, student_id));
create index idx_homework_submissions_student on homework_submissions(student_id);
create table homework_answers(id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references homework_submissions(id) on delete cascade,
  question_id uuid not null, answer_text text, unique (submission_id, question_id));
create table homework_ai_marks(submission_id uuid primary key references homework_submissions(id) on delete cascade,
  marks jsonb not null);
create table notifications(id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, type text not null, title text not null,
  submission_id uuid references homework_submissions(id) on delete cascade);
create table mcq_attempts(id uuid primary key default gen_random_uuid(),
  set_id uuid not null references mcq_sets(id) on delete cascade, user_id uuid not null,
  score integer not null, total integer not null, answers jsonb not null);
create index idx_mcq_attempts_user on mcq_attempts(user_id, set_id);
create table session_attendees(id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources(id) on delete cascade, user_id uuid not null,
  unique (resource_id, user_id));
create index idx_session_attendees_resource on session_attendees(resource_id);

do $$
declare _t text;
begin
  foreach _t in array array['user_roles', 'profiles', 'resources', 'mcq_sets', 'homework_submissions',
      'homework_answers', 'homework_ai_marks', 'notifications', 'mcq_attempts', 'session_attendees'] loop
    execute format('alter table public.%I owner to app_owner', _t);
    execute format('alter table public.%I enable row level security', _t);
  end loop;
end $$;

-- As Supabase defines them.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
`);

// Production's definitions, verbatim.
await db.exec(`
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _row jsonb := to_jsonb(new);
  _col text;
  _id uuid;
begin
  foreach _col in array tg_argv loop
    -- A renamed column would otherwise read as null and wave every row through.
    if not (_row ? _col) then
      raise exception 'student_row_not_staff on % names a missing column %.', tg_table_name, _col;
    end if;
    _id := (_row ->> _col)::uuid;
    if _id is not null and private.is_staff(_id) then
      raise exception 'A tutor account can''t hold student data (%.%).', tg_table_name, _col
        using errcode = '23514',
              hint = 'Tutors and students are separate accounts. See docs/AUTHENTICATION.md.';
    end if;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_grading_privileges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_privileged boolean;
begin
  v_privileged :=
    coalesce(current_setting('app.publishing_marks', true), '') = 'on'
    or coalesce(auth.role(), '') = 'service_role'
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role);

  if v_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.grade is not null
       or new.score_pct is not null
       or new.feedback is not null
       or new.graded_by is not null
       or new.graded_at is not null
       or new.ai_marked_at is not null
       or new.release_at is not null
       or new.tutor_reviewed_at is not null then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  else
    if new.grade is distinct from old.grade
       or new.score_pct is distinct from old.score_pct
       or new.feedback is distinct from old.feedback
       or new.graded_by is distinct from old.graded_by
       or new.graded_at is distinct from old.graded_at
       or new.ai_marked_at is distinct from old.ai_marked_at
       or new.release_at is distinct from old.release_at
       or new.tutor_reviewed_at is distinct from old.tutor_reviewed_at then
      raise exception 'Only tutors or admins may set grading fields'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

CREATE TRIGGER student_row_not_staff BEFORE INSERT OR UPDATE OF student_id ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION private.refuse_student_row_for_staff('student_id');
CREATE TRIGGER trg_enforce_grading_privileges BEFORE INSERT OR UPDATE ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION enforce_grading_privileges();
CREATE TRIGGER student_row_not_staff BEFORE INSERT OR UPDATE OF user_id ON public.mcq_attempts FOR EACH ROW EXECUTE FUNCTION private.refuse_student_row_for_staff('user_id');
CREATE TRIGGER student_row_not_staff BEFORE INSERT OR UPDATE OF user_id ON public.session_attendees FOR EACH ROW EXECUTE FUNCTION private.refuse_student_row_for_staff('user_id');
`);

// ── Helpers ───────────────────────────────────────────────────────────────
let n = 0;
const nextId = (head: string) => `${head}-0000-0000-0000-${String(++n).padStart(12, "0")}`;
/** An account as sign-up (or a tutor grant) leaves it: the login, the role and a profile. */
const account = async (role: "student" | "tutor") => {
  const id = nextId("00000000");
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into user_roles(user_id, role) values ($1, $2)", [id, role]);
  await db.query("insert into profiles(id, role) values ($1, $2)", [id, role]);
  return id;
};
/** An id with no account behind it: what a deleted account leaves in a row. */
const gone = () => nextId("ffffffff");
/** How the dashboard and the Admin API delete an account: GoTrue's own role. */
const deleteAccount = async (id: string) => {
  await db.exec("set role supabase_auth_admin");
  try {
    await db.query("delete from auth.users where id = $1", [id]);
  } finally {
    await db.exec("reset role");
  }
};
const one = async (sql: string, args: unknown[] = []) =>
  (await db.query<{ id: string }>(sql, args)).rows[0].id;
const count = async (sql: string, args: unknown[] = []) =>
  (await db.query<{ n: number }>(`select (${sql})::int as n`, args)).rows[0].n;

// The app's server writes marks with the service role, which the grading guard
// lets through.
await db.query("select set_config('request.jwt.claim.role', 'service_role', false)");
const sheet = await one("insert into resources(kind) values ('homework') returning id");
const lesson = await one("insert into resources(kind) values ('live_session') returning id");
const quiz = await one("insert into mcq_sets default values returning id");

const task = (student: string) =>
  one("insert into homework_submissions(resource_id, student_id) values ($1, $2) returning id", [
    sheet,
    student,
  ]);
const answers = (submission: string, how: number) =>
  db.query(
    `insert into homework_answers(submission_id, question_id, answer_text)
     select $1::uuid, gen_random_uuid(), 'answer' from generate_series(1, $2::int)`,
    [submission, how],
  );
const aiMark = (submission: string) =>
  db.query("insert into homework_ai_marks(submission_id, marks) values ($1, '[]')", [submission]);
const notify = (user: string, submission: string | null) =>
  db.query(
    "insert into notifications(user_id, type, title, submission_id) values ($1, 'task', 'Task', $2)",
    [user, submission],
  );
const attempt = (user: string) =>
  db.query(
    "insert into mcq_attempts(set_id, user_id, score, total, answers) values ($1, $2, 3, 5, '[]')",
    [quiz, user],
  );
const attend = (user: string) =>
  db.query("insert into session_attendees(resource_id, user_id) values ($1, $2)", [lesson, user]);

/** A student's work as the app leaves it: a task marked by the tutor, with two
 * answers, an AI mark and a notification each way, a quiz attempt and a live
 * lesson attended. */
const work = async (student: string, tutor: string) => {
  const submission = await one(
    `insert into homework_submissions(resource_id, student_id, grade, graded_by, graded_at, ai_marked_at)
     values ($1, $2, '7', $3, now(), now()) returning id`,
    [sheet, student, tutor],
  );
  await answers(submission, 2);
  await aiMark(submission);
  await notify(tutor, submission);
  await notify(student, submission);
  await attempt(student);
  await attend(student);
  return submission;
};

/** This account's rows in the three tables. */
const held = (id: string) =>
  count(
    `select (select count(*) from homework_submissions where student_id = $1)
          + (select count(*) from mcq_attempts where user_id = $1)
          + (select count(*) from session_attendees where user_id = $1)`,
    [id],
  );
/** What hangs off one submission: its answers, AI mark and notifications. */
const hanging = (submission: string) =>
  count(
    `select (select count(*) from homework_answers where submission_id = $1)
          + (select count(*) from homework_ai_marks where submission_id = $1)
          + (select count(*) from notifications where submission_id = $1)`,
    [submission],
  );
const TABLES = [
  "homework_submissions",
  "homework_answers",
  "homework_ai_marks",
  "notifications",
  "mcq_attempts",
  "session_attendees",
];
const census = async () => {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = await count(`select count(*) from ${t}`);
  return out;
};
/** Submissions, answers, AI marks, notifications, attempts, attendance. */
const rows = (...counts: number[]) => Object.fromEntries(TABLES.map((t, i) => [t, counts[i]]));
const keys = async () =>
  (
    await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where contype = 'f'
          and conrelid in ('homework_submissions'::regclass, 'mcq_attempts'::regclass,
                           'session_attendees'::regclass)
        order by conname`,
    )
  ).rows;
const attendanceIndex = async () =>
  (
    await db.query<{ def: string }>(
      "select indexdef as def from pg_indexes where indexname = 'idx_session_attendees_user'",
    )
  ).rows[0]?.def;
const failsWith = async (q: () => Promise<unknown>, pattern: RegExp, what: string) => {
  let message = "";
  try {
    await q();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message, `${what}: it was allowed`);
  assert.match(message, pattern, `${what}: failed for the wrong reason`);
};
const OLD_KEYS = [
  {
    conname: "homework_submissions_resource_id_fkey",
    def: "FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE",
  },
  {
    conname: "mcq_attempts_set_id_fkey",
    def: "FOREIGN KEY (set_id) REFERENCES mcq_sets(id) ON DELETE CASCADE",
  },
  {
    conname: "session_attendees_resource_id_fkey",
    def: "FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE",
  },
];
const KEYS = [
  OLD_KEYS[0],
  {
    conname: "homework_submissions_student_id_fkey",
    def: "FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE",
  },
  OLD_KEYS[1],
  {
    conname: "mcq_attempts_user_id_fkey",
    def: "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE",
  },
  OLD_KEYS[2],
  {
    conname: "session_attendees_user_id_fkey",
    def: "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE",
  },
];
const INDEX =
  "CREATE INDEX idx_session_attendees_user ON public.session_attendees USING btree (user_id)";

// ── Before: production on 5 Oct, plus the shapes it happens not to have ───
const tutor = await account("tutor");
const alex = await account("student");
const bea = await account("student");
const alexTask = await work(alex, tutor);
const beaTask = await work(bea, tutor);
await notify(tutor, null); // the tutor's own, about nothing here
// Production's orphan: a deleted account's task, sent and never marked, with 5
// answers and an AI mark.
const ghostTask = await task(gone());
await answers(ghostTask, 5);
await aiMark(ghostTask);
// Production has none of these: a notification about that task, and a deleted
// account's quiz attempt and attendance.
await notify(tutor, ghostTask);
await attempt(gone());
await attend(gone());
assert.deepEqual(await keys(), OLD_KEYS);
assert.deepEqual(await census(), rows(3, 9, 3, 6, 3, 3));

await db.exec(migration);

// ── Only rows of real accounts are left ───────────────────────────────────
assert.equal(await hanging(ghostTask), 0, "The orphan task's answers, mark or notice stayed");
assert.deepEqual(
  await census(),
  rows(2, 4, 2, 5, 2, 2),
  "The clean-up kept an orphan or lost work",
);
assert.equal(await held(alex), 3);
assert.equal(await held(bea), 3);
assert.equal(await hanging(alexTask), 5);

// ── Each id must name an account ──────────────────────────────────────────
assert.deepEqual(await keys(), KEYS);
assert.equal(await attendanceIndex(), INDEX);
await failsWith(
  () => task(gone()),
  /violates foreign key constraint "homework_submissions_student_id_fkey"/,
  "A task for an account that doesn't exist",
);
await failsWith(
  () => attempt(gone()),
  /violates foreign key constraint "mcq_attempts_user_id_fkey"/,
  "A quiz attempt for an account that doesn't exist",
);
await failsWith(
  () => attend(gone()),
  /violates foreign key constraint "session_attendees_user_id_fkey"/,
  "Attendance for an account that doesn't exist",
);

// ── Deleting an account takes its work, though the deleter can't touch it ─
await db.exec("set role supabase_auth_admin");
await failsWith(
  () => db.query("delete from homework_submissions"),
  /permission denied/,
  "GoTrue's role deleting a task itself",
);
await db.exec("reset role");
await deleteAccount(alex);
assert.equal(await held(alex), 0, "A deleted student's work stayed");
assert.equal(await hanging(alexTask), 0, "A deleted student's answers, mark or notices stayed");
assert.deepEqual(await census(), rows(1, 2, 1, 3, 1, 1), "Deleting a student took someone else's");
assert.equal(await held(bea), 3);
assert.equal(await count("select count(*) from resources"), 2, "The task sheet or lesson went too");
assert.equal(await count("select count(*) from mcq_sets"), 1, "The quiz went too");

// ── Deleting the tutor who marked a task leaves the student's work ────────
await deleteAccount(tutor);
assert.equal(await held(bea), 3, "Deleting the marker took the student's work");
assert.deepEqual(await census(), rows(1, 2, 1, 1, 1, 1));

// ── The purge's order still works: its own deletes, then the account ──────
const tia = await account("tutor");
const eve = await account("student");
const eveTask = await work(eve, tia);
await db.query("delete from homework_submissions where student_id = $1", [eve]);
await db.query("delete from mcq_attempts where user_id = $1", [eve]);
await db.query("delete from session_attendees where user_id = $1", [eve]);
await deleteAccount(eve);
assert.equal(await held(eve), 0);
assert.equal(await hanging(eveTask), 0);

// ── Running it again changes nothing ──────────────────────────────────────
const settled = await census();
await db.exec(migration);
assert.deepEqual(await keys(), KEYS, "A second run changed the keys");
assert.deepEqual(await census(), settled, "A second run touched live work");

// ── The rollback drops the keys and the index; the migration then runs clean
await db.exec(rollback);
assert.deepEqual(await keys(), OLD_KEYS, "The rollback left a key behind");
assert.equal(await attendanceIndex(), undefined, "The rollback left the index behind");
const ghost = gone(); // orphans are possible again, as before
await task(ghost);
await attempt(ghost);
await attend(ghost);
assert.equal(await held(ghost), 3);
await db.exec(rollback);
await db.exec(migration);
assert.deepEqual(await keys(), KEYS);
assert.equal(await attendanceIndex(), INDEX);
assert.equal(await held(ghost), 0, "Orphans made while rolled back stayed");
assert.deepEqual(await census(), settled);

console.log("student-work-follows-accounts: all checks passed");
