/** Isolated PostgreSQL regression checks for 20261028113000_mcq_quiz_edges.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-mcq-quiz-edges-db.ts
 *
 * Runs the live definition first (20261027131300, whose pg_get_functiondef md5
 * is checked against production's) to show each edge, then the migration to
 * show it closed with the retry and the weekly lock unchanged, then the
 * rollback to show it restores the live definition exactly.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const classmate = uuid(2);
const quiz = uuid(10);
const rewritten = uuid(11); // a tutor replaces its questions after it is taken
const q1 = uuid(20);
const q2 = uuid(21);
const oldQ = uuid(22);
const newQ = uuid(23);

/** pg_get_functiondef md5 of grade_mcq_attempt in production, 28 Oct 2026. */
const LIVE_MD5 = "8df1b04abad41a42d2889c108fe68135";

// What grade_mcq_attempt touches, shaped as production has it (see
// test-quizzes-follow-paid-subjects-db.ts, which this trims).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create table profiles(id uuid primary key, role profile_role not null default 'student');
create function private.is_staff(_user_id uuid) returns boolean language sql stable as $$ select false $$;
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$ select false $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable as $$ select true $$;
create function private.my_content_subjects() returns text[] language sql stable as $$ select '{chemistry}'::text[] $$;

create table topics(id uuid primary key, subject subject);
create table spec_points(id uuid primary key, topic_id uuid references topics);
create table mcq_sets(id uuid primary key, published boolean not null, spec_point_id uuid references spec_points, subject subject);
create table mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid references mcq_sets on delete cascade,
  position int, question text, options jsonb, correct_index int, explanation text, spec_point_id uuid);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid not null references mcq_sets on delete cascade,
  user_id uuid not null, score int not null, total int not null, answers jsonb not null, created_at timestamptz default now(), point_scores jsonb);
alter table mcq_sets enable row level security;
alter table mcq_questions enable row level security;
create policy "mcq_sets read" on mcq_sets for select to authenticated using (false);
create policy "mcq_questions read via set" on mcq_questions for select to authenticated using (false);
grant usage on schema public, auth to authenticated;
grant execute on function auth.uid() to authenticated;

-- Unused since tutors stopped building quizzes; signed-in users can run it.
create function public.fill_mcq_set_from_shared(_set_id uuid, _spec_point_ids uuid[]) returns integer
  language sql security definer set search_path = '' as $$ select 0 $$;
revoke all on function public.fill_mcq_set_from_shared(uuid, uuid[]) from public;
grant execute on function public.fill_mcq_set_from_shared(uuid, uuid[]) to authenticated, service_role;

insert into profiles values ('${student}', 'student'), ('${classmate}', 'student');
insert into mcq_sets values ('${quiz}', true, null, 'chemistry'), ('${rewritten}', true, null, 'chemistry');
insert into mcq_questions (id, set_id, position, question, options, correct_index, explanation) values
  ('${q1}', '${quiz}', 1, 'one', '["a","b","c","d"]', 0, 'because one'),
  ('${q2}', '${quiz}', 2, 'two', '["a","b","c","d"]', 1, 'because two'),
  ('${oldQ}', '${rewritten}', 1, 'old', '["a","b","c","d"]', 2, 'old reason');
`);

const read = (name: string) => readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");
const live = await read("migrations/20261027131300_quizzes_follow_paid_subjects.sql");
const migration = await read("migrations/20261028113000_mcq_quiz_edges.sql");
const rollback = await read("rollbacks/20261028113000_mcq_quiz_edges.down.sql");

type Result = { question_id: string; correct_index: number; chosen_index: number | null };
type Graded = { attempt_id: string; score: number; total: number; results: Result[] };

/** Calls grade_mcq_attempt as `who`; resolves to its reply or the error's message. */
async function grade(who: string, setId: string, answers: unknown, attemptId?: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
  await db.exec("set role authenticated");
  try {
    return (
      await db.query<{ r: Graded }>(
        "select public.grade_mcq_attempt(_set_id => $1, _answers => $2::jsonb, _attempt_id => $3) r",
        [setId, JSON.stringify(answers), attemptId ?? null],
      )
    ).rows[0].r;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await db.exec("reset role");
  }
}
const stored = async (id: string) =>
  (await db.query<{ answers: unknown }>("select answers from mcq_attempts where id = $1", [id]))
    .rows[0]?.answers;
const count = async () =>
  Number((await db.query<{ n: number }>("select count(*)::int n from mcq_attempts")).rows[0].n);
const md5 = async () =>
  (
    await db.query<{ m: string }>(
      "select md5(pg_get_functiondef('public.grade_mcq_attempt(uuid,jsonb,uuid)'::regprocedure)) m",
    )
  ).rows[0].m;
const canRun = async (role: string) =>
  (
    await db.query<{ ok: boolean }>(
      "select has_function_privilege($1, 'public.fill_mcq_set_from_shared(uuid, uuid[])', 'execute') ok",
      [role],
    )
  ).rows[0].ok;
/** A tutor's "Replace questions": every question deleted and written again under new ids. */
const replaceQuestions = () =>
  db.exec(`
    delete from mcq_questions where set_id = '${rewritten}';
    insert into mcq_questions (id, set_id, position, question, options, correct_index, explanation)
      values ('${newQ}', '${rewritten}', 1, 'new', '["a","b","c","d"]', 3, 'new reason');`);
const restoreQuestions = () =>
  db.exec(`
    delete from mcq_questions where set_id = '${rewritten}';
    insert into mcq_questions (id, set_id, position, question, options, correct_index, explanation)
      values ('${oldQ}', '${rewritten}', 1, 'old', '["a","b","c","d"]', 2, 'old reason');`);

// ── Before: the live definition ─────────────────────────────────────────────
await db.exec(live);
assert.equal(await md5(), LIVE_MD5, "The test's starting point is not production's definition");
assert.equal(await canRun("authenticated"), true);

// The answers were stored as sent: an option that doesn't exist, and keys that
// are not questions at all.
const junk = (await grade(student, quiz, {
  [q1]: 0,
  [q2]: 99,
  "not-a-question": 5,
  x: { deep: [1, 2, 3] },
})) as Graded;
assert.deepEqual(await stored(junk.attempt_id), {
  [q1]: 0,
  [q2]: 99,
  "not-a-question": 5,
  x: { deep: [1, 2, 3] },
});
assert.equal(junk.results[1].chosen_index, 99, "Expected the old reply to hand back option 99");

// A paper opened before a rewrite was filed with every answer wrong.
await replaceQuestions();
const stale = (await grade(classmate, rewritten, { [oldQ]: 2 })) as Graded;
assert.equal(stale.score, 0, "Expected the old function to file a stale paper as all wrong");
await db.exec("delete from mcq_attempts");
await restoreQuestions();

// Inside the week after a rewrite, showing the old attempt revealed the new key.
const sat = (await grade(classmate, rewritten, { [oldQ]: 2 })) as Graded;
assert.equal(sat.score, 1);
await replaceQuestions();
const shown = (await grade(classmate, rewritten, {}, sat.attempt_id)) as Graded;
assert.equal(shown.results[0]?.correct_index, 3, "Expected the old replay to reveal the new key");
await db.exec("delete from mcq_attempts");
await restoreQuestions();

// ── After, applied twice to show it is idempotent ───────────────────────────
await db.exec(migration);
await db.exec(migration);
assert.notEqual(await md5(), LIVE_MD5);

// Only an option each question has is kept; nothing else is stored.
const clean = (await grade(student, quiz, { [q1]: 0, [q2]: 99 })) as Graded;
assert.equal(clean.score, 1, `A valid answer should still mark: ${String(clean)}`);
assert.equal(clean.total, 2);
assert.deepEqual(await stored(clean.attempt_id), { [q1]: 0 });
assert.deepEqual(
  clean.results.map((r) => r.chosen_index),
  [0, null],
  "An option that doesn't exist should come back unanswered",
);
assert.equal(clean.results.length, 2, "A fresh marking still shows every question's answer");

// Other shapes under a real question: unanswered, never an error.
for (const odd of [-1, 1.5, "1x", { deep: [1] }, [0], true, null]) {
  await db.exec("delete from mcq_attempts");
  const r = (await grade(student, quiz, { [q1]: odd, [q2]: 1 })) as Graded;
  assert.equal(typeof r, "object", `${JSON.stringify(odd)} should not error: ${String(r)}`);
  assert.deepEqual(await stored(r.attempt_id), { [q2]: 1 }, `${JSON.stringify(odd)} was stored`);
}
await db.exec("delete from mcq_attempts");

// Keys that are not this quiz's questions: refused, and nothing filed.
assert.equal(await grade(student, quiz, { [q1]: 0, "not-a-question": 5 }), "quiz has changed");
assert.equal(await count(), 0);

// A paper opened before a rewrite: refused, nothing filed. The new paper files.
await replaceQuestions();
assert.equal(await grade(classmate, rewritten, { [oldQ]: 2 }), "quiz has changed");
assert.equal(await count(), 0);
const fresh = (await grade(classmate, rewritten, { [newQ]: 3 })) as Graded;
assert.equal(fresh.score, 1);
await db.exec("delete from mcq_attempts");
await restoreQuestions();

// Inside the week after a rewrite: the filed score, and none of the new key.
const before = (await grade(classmate, rewritten, { [oldQ]: 2 }, uuid(50))) as Graded;
assert.equal(before.attempt_id, uuid(50));
await replaceQuestions();
const replay = (await grade(classmate, rewritten, {}, uuid(50))) as Graded;
assert.equal(replay.attempt_id, uuid(50));
assert.equal(replay.score, 1, "The filed score should still be shown");
assert.deepEqual(replay.results, [], "The new questions' answers were revealed");
// The same through the weekly lock, from another tab with a new id.
const otherTab = (await grade(classmate, rewritten, { [newQ]: 0 }, uuid(51))) as Graded;
assert.equal(otherTab.attempt_id, uuid(50), "The weekly lock no longer holds");
assert.deepEqual(otherTab.results, []);
assert.equal(await count(), 1);
await db.exec("delete from mcq_attempts");
await restoreQuestions();

// A retry of the same attempt still replays it in full, writing nothing.
const first = (await grade(student, quiz, { [q1]: 0, [q2]: 0 }, uuid(60))) as Graded;
const retry = (await grade(student, quiz, { [q1]: 1, [q2]: 1 }, uuid(60))) as Graded;
assert.equal(retry.attempt_id, first.attempt_id);
assert.equal(retry.score, 1);
assert.deepEqual(
  retry.results.map((r) => [r.chosen_index, r.correct_index]),
  [
    [0, 0],
    [0, 1],
  ],
);
// And the weekly lock: a second go with a new id gets the first back.
const again = (await grade(student, quiz, { [q1]: 1, [q2]: 1 }, uuid(61))) as Graded;
assert.equal(again.attempt_id, first.attempt_id);
assert.equal(await count(), 1);

// The visibility checks still come first.
assert.equal(await grade(student, uuid(99), {}), "quiz not found");

// fill_mcq_set_from_shared: the server's credential only.
assert.equal(await canRun("authenticated"), false, "Signed-in users can still run it");
assert.equal(await canRun("anon"), false);
assert.equal(await canRun("service_role"), true);

// ── The rollback restores the live definition exactly ───────────────────────
await db.exec(rollback);
assert.equal(await md5(), LIVE_MD5, "The rollback didn't restore production's definition");
assert.equal(await canRun("authenticated"), true);

console.log("mcq quiz edges: all checks passed");
