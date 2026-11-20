/** Isolated PostgreSQL checks for 20261120101455: a tutor publishing marks on a
 * paper someone else published since they opened it is refused, not allowed to
 * write over the other marks unseen. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-confirm-marks-refuse-stale-db.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [ali, nadia, student] = [uuid(1), uuid(2), uuid(3)];
const sheet = uuid(10);
const q1 = uuid(21);
const STALE =
  /Someone else marked this paper while you had it open\. Reopen it to see their marks\./;

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const MIGRATION = await file("migrations/20261120101455_confirm_marks_refuse_stale.sql");
const ROLLBACK = await file("rollbacks/20261120101455_confirm_marks_refuse_stale.down.sql");

// The live schema the function touches, then the live definition it replaces
// (20261119225700) with the live grants.
await db.exec(`
set timezone = 'UTC';
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_uid uuid, _role public.app_role) returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.user_roles r where r.user_id = _uid and r.role = _role) $$;
grant usage on schema private, auth to authenticated, service_role;
create table public.resources(id uuid primary key, title text);
create table public.homework_questions(id uuid primary key, resource_id uuid, marks int);
create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid,
  score_pct numeric, grade text, feedback text, graded_by uuid, graded_at timestamptz,
  tutor_reviewed_at timestamptz);
create table public.homework_answers(
  id uuid primary key default gen_random_uuid(), submission_id uuid, question_id uuid,
  answer_text text, awarded_marks numeric, feedback text, credited jsonb);
create table public.homework_ai_marks(submission_id uuid primary key, marks jsonb, summary text, credited jsonb);
create table public.notifications(
  id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  link text, submission_id uuid);
insert into public.user_roles values ('${ali}','tutor'),('${nadia}','tutor'),('${student}','student');
insert into public.resources values ('${sheet}','Moles');
insert into public.homework_questions values ('${q1}','${sheet}',4);
`);
await db.exec(await file("migrations/20261119225700_tutor_answer_marks.sql"));
await db.exec(`
revoke all on function public.confirm_homework_marks(uuid, jsonb, numeric, text) from public, anon;
grant execute on function public.confirm_homework_marks(uuid, jsonb, numeric, text) to authenticated, service_role;
`);

/** Run one statement as a signed-in user, the way PostgREST would. */
async function as<T = Record<string, unknown>>(
  userId: string,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${userId}',false);`,
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);
  }
}

const paper = async () => {
  const id = (
    await db.query<{ id: string }>(
      `insert into public.homework_submissions(resource_id, student_id) values ($1,$2) returning id`,
      [sheet, student],
    )
  ).rows[0].id;
  await db.query(
    `insert into public.homework_answers(submission_id, question_id, answer_text) values ($1,$2,'2 mol')`,
    [id, q1],
  );
  return id;
};
const marks = (n: number, comment: string) =>
  JSON.stringify([{ question_id: q1, marks: n, feedback: comment }]);

/** The queue's call: named arguments, as PostgREST sends them. */
const publish = (who: string, id: string, n: number, comment: string, seen: string | null) =>
  as(
    who,
    `select public.confirm_homework_marks(_submission_id => $1, _marks => $2::jsonb,
       _score_pct => $3, _feedback => $4, _seen_graded_at => $5::timestamptz, _check_seen => true)`,
    [id, marks(n, comment), n * 25, comment, seen],
  );
/** A page loaded before the change: the four arguments only. */
const publishOld = (who: string, id: string, n: number, comment: string) =>
  as(
    who,
    `select public.confirm_homework_marks(_submission_id => $1, _marks => $2::jsonb,
       _score_pct => $3, _feedback => $4)`,
    [id, marks(n, comment), n * 25, comment],
  );

type Row = {
  feedback: string | null;
  graded_by: string | null;
  graded_at: string | null;
  seen: string | null;
};
/** The row, with graded_at as the text PostgREST hands the browser. */
const row = async (id: string) =>
  (
    await db.query<Row>(
      `select feedback, graded_by, graded_at, to_json(graded_at) #>> '{}' as seen
         from public.homework_submissions where id = $1`,
      [id],
    )
  ).rows[0];
const answer = async (id: string) =>
  (
    await db.query<{ awarded_marks: string; feedback: string }>(
      `select awarded_marks, feedback from public.homework_answers where submission_id = $1`,
      [id],
    )
  ).rows[0];
const told = async (id: string) =>
  Number(
    (
      await db.query<{ n: number }>(
        `select count(*)::int n from public.notifications where submission_id = $1`,
        [id],
      )
    ).rows[0].n,
  );
const refused = (p: Promise<unknown>) =>
  assert.rejects(p, (e: { code?: string; message?: string }) => {
    assert.equal(e.code, "40001");
    assert.match(e.message ?? "", STALE);
    return true;
  });
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const functions = async () =>
  (
    await db.query<{ sig: string; md5: string; acl: string; definer: boolean; config: string[] }>(
      `select p.oid::regprocedure::text sig, md5(p.prosrc) md5, p.proacl::text acl,
              p.prosecdef definer, p.proconfig config
         from pg_proc p where p.proname = 'confirm_homework_marks' order by 1`,
    )
  ).rows;
const body = (sql: string) => sql.match(/as (\$function\$)([\s\S]*?)\1/)![2];

// 0. The defect, on the live definition: Nadia publishes from a list loaded
//    before Ali did, and Ali's mark and comment are gone without a word.
{
  const id = await paper();
  await publishOld(ali, id, 3, "Ali: good, but give the units");
  await publishOld(nadia, id, 1, "Nadia: one mark");
  assert.equal((await row(id)).feedback, "Nadia: one mark", "the defect did not reproduce");
  assert.equal((await row(id)).graded_by, nadia);
}

await db.exec(MIGRATION);

// 1. One function, the new one: same security, search_path and grants; the
//    body is the live one plus the check.
{
  const fns = await functions();
  assert.equal(fns.length, 1, "the old overload was left beside the new one");
  assert.equal(
    fns[0].sig,
    "confirm_homework_marks(uuid,jsonb,numeric,text,timestamp with time zone,boolean)",
  );
  assert.equal(fns[0].md5, md5(body(MIGRATION)));
  assert.equal(fns[0].definer, true);
  assert.deepEqual(fns[0].config, ['search_path=""']);
  assert.match(fns[0].acl, /authenticated=X/);
  assert.match(fns[0].acl, /service_role=X/);
  assert.doesNotMatch(fns[0].acl, /anon=|[{,]=X/, "anon or PUBLIC can run it");
}

// 2. A paper nobody else touched publishes, and the student hears once.
const first = await paper();
await publish(ali, first, 3, "Ali: good, but give the units", null);
assert.equal((await row(first)).graded_by, ali);
assert.equal((await answer(first)).feedback, "Ali: good, but give the units");
assert.equal(await told(first), 1);

// 3. Nadia's list was loaded before Ali published: refused, and Ali's marks,
//    comment and name stay. No second notification.
await refused(publish(nadia, first, 1, "Nadia: one mark", null));
assert.equal((await row(first)).graded_by, ali);
assert.equal((await row(first)).feedback, "Ali: good, but give the units");
assert.equal(Number((await answer(first)).awarded_marks), 3);
assert.equal(await told(first), 1);

// 4. Reopened, Nadia's list carries Ali's graded_at, as the server's own text
//    (to the microsecond): "Update mark" saves.
await db.query(
  `update public.homework_submissions set graded_at = '2026-11-20 06:00:00.123456+00' where id = $1`,
  [first],
);
const seen = (await row(first)).seen!;
assert.equal(seen, "2026-11-20T06:00:00.123456+00:00");
//    The same moment after a trip through a JS Date has lost its microseconds
//    and no longer matches: the queue must send the text back untouched.
await refused(publish(nadia, first, 2, "Nadia: two", new Date(seen).toISOString()));
await publish(nadia, first, 2, "Nadia: two", seen);
assert.equal((await row(first)).graded_by, nadia);
assert.equal((await row(first)).feedback, "Nadia: two");
assert.equal(await told(first), 1, "an update told the student again");

// 5. The same tutor in a second tab, opened before the first tab updated it:
//    refused too (the check is the paper, not the person).
const tabOne = (await row(first)).seen!;
await publish(nadia, first, 3, "Nadia, tab 1", tabOne);
await refused(publish(nadia, first, 0, "Nadia, tab 2", tabOne));
assert.equal((await row(first)).feedback, "Nadia, tab 1");

// 6. The release clock published it while a tutor had it open (it sets
//    graded_at and leaves graded_by empty): not refused. The tutor's marks
//    replace the marker's, and the student is not told twice.
const timed = await paper();
await db.query(
  `update public.homework_submissions set score_pct = 50, grade = '5', feedback = 'Marker summary',
          graded_at = now() where id = $1`,
  [timed],
);
await publish(ali, timed, 4, "Ali: full marks after all", null);
assert.equal((await row(timed)).graded_by, ali);
assert.equal((await row(timed)).feedback, "Ali: full marks after all");
assert.equal(await told(timed), 0, "the tutor's publish told the student about timer-sent marks");

// 7. A page loaded before this change sends neither parameter: it saves as
//    before, stale or not. So does a caller that turns the check off.
await publishOld(ali, first, 1, "Old page");
assert.equal((await row(first)).feedback, "Old page");
await as(
  nadia,
  `select public.confirm_homework_marks(_submission_id => $1, _marks => $2::jsonb, _score_pct => 50,
     _feedback => 'Check off', _seen_graded_at => null, _check_seen => false)`,
  [first, marks(2, "Check off")],
);
assert.equal((await row(first)).feedback, "Check off");
//    And by position, as a SQL caller would.
await as(nadia, `select public.confirm_homework_marks($1, $2::jsonb, 50, 'Positional')`, [
  first,
  marks(2, "Positional"),
]);
assert.equal((await row(first)).feedback, "Positional");

// 8. Still only staff, and the old refusals still come first.
await assert.rejects(publish(student, first, 4, "me", null), /Only tutors or admins/);
await assert.rejects(publish(ali, uuid(999), 1, "x", null), /No such submission/);
await assert.rejects(
  as(ali, `select public.confirm_homework_marks($1, '[]'::jsonb, 101, null, null, true)`, [first]),
  /between 0 and 100/,
);
for (const role of ["anon", "public"]) {
  const r = await db.query<{ ok: boolean }>(
    `select has_function_privilege($1, 'public.confirm_homework_marks(uuid,jsonb,numeric,text,timestamptz,boolean)', 'execute') ok`,
    [role],
  );
  assert.equal(r.rows[0].ok, false, `${role} can run it`);
}

// 9. Idempotent.
await db.exec(MIGRATION);
assert.equal((await functions()).length, 1);
await refused(publish(ali, first, 1, "stale", null));

// 10. The rollback puts back the live four-argument function exactly and
//     removes the new one; run twice it changes nothing more. Re-applied, the
//     check is back.
await db.exec(ROLLBACK);
await db.exec(ROLLBACK);
{
  const fns = await functions();
  assert.equal(fns.length, 1);
  assert.equal(fns[0].sig, "confirm_homework_marks(uuid,jsonb,numeric,text)");
  assert.equal(fns[0].md5, "b907182fac8ce5595c7850e1101b60df", "rollback is not the live body");
  assert.equal(fns[0].definer, true);
  assert.deepEqual(fns[0].config, ['search_path=""']);
  assert.match(fns[0].acl, /authenticated=X/);
  assert.match(fns[0].acl, /service_role=X/);
  assert.doesNotMatch(fns[0].acl, /anon=|[{,]=X/);
}
await publishOld(ali, first, 1, "After rollback");
assert.equal((await row(first)).feedback, "After rollback");
await db.exec(MIGRATION);
await refused(publish(nadia, first, 1, "stale again", null));

console.log("confirm marks refuse stale: all checks passed");
