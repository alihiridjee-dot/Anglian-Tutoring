/** Isolated PostgreSQL regression checks for 20261001200000_submit_homework_visibility.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-submit-homework-visibility-db.ts
 *
 * The rollback file holds the live definitions from before the migration, so
 * it runs first to show the hole, then the migration to show it closed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1); // pays for biology
const lapsed = uuid(2); // plan ended: no paid subjects
const parent = uuid(3); // linked to the student, pays for nothing of their own
const tutor = uuid(4);

const open = uuid(101); // biology, approved
const held = uuid(102); // biology, held for review
const scheduled = uuid(103); // biology, to_review with a publish time still ahead
const chemistry = uuid(104); // approved, but not a subject the student pays for
const q = (sheet: string) => `${sheet.slice(0, -3)}9${sheet.slice(-2)}`; // one question per sheet

// Only what the function and the policy touch, shaped as production has them.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create table public.user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;
-- Stands in for the real one (plan cap over enrolled courses): what matters
-- here is only which subjects a caller has paid for.
create table private.paid(student_id uuid primary key, subjects text[]);
create function private.student_paid_subjects(p_student_id uuid) returns text[] language sql stable security definer set search_path = public, private as $$
  select coalesce((select subjects from private.paid where student_id = p_student_id), '{}'::text[]) $$;

create table public.resources(id uuid primary key, kind text, subject subject, review_status text, publish_at timestamptz);
create table public.homework_questions(id uuid primary key, resource_id uuid references public.resources);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid not null,
  student_id uuid not null, notes text, submitted_at timestamptz default now(), unique (resource_id, student_id));
create table public.homework_answers(id uuid primary key default gen_random_uuid(), submission_id uuid, question_id uuid, answer_text text);
create table public.homework_drafts(student_id uuid, resource_id uuid, primary key (student_id, resource_id));

alter table public.homework_submissions enable row level security;
create policy "hs read scoped" on public.homework_submissions for select to authenticated using (auth.uid() = student_id);
grant select, insert on public.homework_submissions to authenticated;
grant usage on schema private to authenticated;

insert into public.user_roles values ('${tutor}', 'tutor');
insert into private.paid values ('${student}', '{biology}'), ('${lapsed}', '{}');
insert into public.resources values
  ('${open}', 'homework', 'biology', 'approved', null),
  ('${held}', 'homework', 'biology', 'held', null),
  ('${scheduled}', 'homework', 'biology', 'to_review', now() + interval '2 days'),
  ('${chemistry}', 'homework', 'chemistry', 'approved', null);
insert into public.homework_questions
  select ('00000000-0000-0000-0000-' || lpad((900 + row_number() over ())::text, 12, '0'))::uuid, id from public.resources;
`);

const questionOf = async (sheet: string) =>
  (
    await db.query<{ id: string }>("select id from homework_questions where resource_id = $1", [
      sheet,
    ])
  ).rows[0].id;

/** Calls submit_homework_answers as `who`, and says whether it went through. */
async function submit(who: string, sheet: string): Promise<string> {
  const question = await questionOf(sheet);
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
    await db.query("select public.submit_homework_answers($1, $2::jsonb)", [
      sheet,
      JSON.stringify([{ question_id: question, answer_text: "an answer" }]),
    ]);
    return "submitted";
  } catch (err) {
    return (err as Error).message;
  } finally {
    await db.exec("rollback");
  }
}

/** A direct INSERT into homework_submissions as a signed-in student, around the function. */
async function insertDirectly(who: string, sheet: string): Promise<string> {
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
    await db.exec("set local role authenticated");
    await db.query(
      "insert into public.homework_submissions(resource_id, student_id) values ($1, $2)",
      [sheet, who],
    );
    return "inserted";
  } catch (err) {
    return (err as Error).message;
  } finally {
    await db.exec("rollback");
  }
}

const migration = await readFile(
  new URL("../supabase/migrations/20261001200000_submit_homework_visibility.sql", import.meta.url),
  "utf8",
);
const before = await readFile(
  new URL(
    "../supabase/rollbacks/20261001200000_submit_homework_visibility.down.sql",
    import.meta.url,
  ),
  "utf8",
);

// Before: the live definitions.
await db.exec(before);
assert.equal(
  await submit(student, held),
  "submitted",
  "Expected the old function to accept a held sheet",
);
assert.equal(
  await submit(student, chemistry),
  "submitted",
  "Expected the old function to accept an unpaid subject",
);
assert.equal(
  await submit(lapsed, open),
  "submitted",
  "Expected the old function to accept a lapsed plan",
);
assert.equal(
  await insertDirectly(student, held),
  "inserted",
  "Expected the old policy to allow a direct insert",
);

// After, applied twice to show it is idempotent.
await db.exec(migration);
await db.exec(migration);

assert.equal(
  await submit(student, open),
  "submitted",
  "A paying student couldn't hand in an open sheet",
);
assert.equal(
  await submit(tutor, held),
  "submitted",
  "A tutor is refused, unlike the resources policy",
);

for (const [who, sheet, why] of [
  [student, held, "a sheet held for review"],
  [student, scheduled, "a sheet not yet published"],
  [student, chemistry, "a subject they don't pay for"],
  [lapsed, open, "a lapsed plan"],
  [parent, open, "a parent"],
] as const) {
  assert.match(await submit(who, sheet), /not open to you/, `Still accepted: ${why}`);
}

assert.match(
  await insertDirectly(student, open),
  /row-level security/,
  "A student can still insert a submission directly",
);

console.log("submit_homework_answers visibility: all checks passed");
