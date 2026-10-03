/** Isolated PostgreSQL regression checks for 20261001201000_mcq_attempt_retry_safe.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-mcq-attempt-retry-db.ts
 *
 * The rollback file holds the live definition from before the migration, so it
 * runs first to show the double count, then the migration to show it gone.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const classmate = uuid(2);
const quiz = uuid(10);
const otherQuiz = uuid(11);
const q1 = uuid(21);
const q2 = uuid(22);
const q3 = uuid(23);

// Only what grade_mcq_attempt touches, shaped as production has them.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$ select false $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable as $$ select true $$;
create table public.mcq_sets(id uuid primary key, published boolean, spec_point_id uuid);
create table public.mcq_questions(id uuid primary key, set_id uuid references public.mcq_sets on delete cascade,
  position int, correct_index int, explanation text, spec_point_id uuid);
create table public.mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid not null references public.mcq_sets on delete cascade,
  user_id uuid not null, score int not null, total int not null, answers jsonb not null, created_at timestamptz default now(), point_scores jsonb);
insert into public.mcq_sets values ('${quiz}', true, null), ('${otherQuiz}', true, null);
insert into public.mcq_questions values
  ('${q1}', '${quiz}', 1, 0, 'one', null),
  ('${q2}', '${quiz}', 2, 1, 'two', null),
  ('${q3}', '${otherQuiz}', 1, 2, 'three', null);
`);

type Graded = { attempt_id: string; score: number; total: number; results: unknown[] };

/** Calls grade_mcq_attempt as `who`; resolves to its reply or the error's message. */
async function grade(who: string, setId: string, answers: object, attemptId?: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
  try {
    const sql =
      attemptId === undefined
        ? "select public.grade_mcq_attempt(_set_id => $1, _answers => $2::jsonb) r"
        : "select public.grade_mcq_attempt(_set_id => $1, _answers => $2::jsonb, _attempt_id => $3) r";
    const params =
      attemptId === undefined
        ? [setId, JSON.stringify(answers)]
        : [setId, JSON.stringify(answers), attemptId];
    return (await db.query<{ r: Graded }>(sql, params)).rows[0].r;
  } catch (err) {
    return (err as Error).message;
  }
}
const attempts = async () =>
  Number((await db.query<{ n: number }>("select count(*)::int n from mcq_attempts")).rows[0].n);

const migration = await readFile(
  new URL("../supabase/migrations/20261001201000_mcq_attempt_retry_safe.sql", import.meta.url),
  "utf8",
);
const before = await readFile(
  new URL("../supabase/rollbacks/20261001201000_mcq_attempt_retry_safe.down.sql", import.meta.url),
  "utf8",
);
const allRight = { [q1]: 0, [q2]: 1 };

// Before: the live definition. A retry after a lost reply files a second attempt.
await db.exec(before);
await grade(student, quiz, allRight);
await grade(student, quiz, allRight);
assert.equal(await attempts(), 2, "Expected the old function to file a retry twice");
await db.exec("delete from mcq_attempts");

// After, applied twice to show it is idempotent.
await db.exec(migration);
await db.exec(migration);

// The app now live still calls with two named arguments.
const legacy = await grade(student, quiz, allRight);
assert.equal(typeof legacy, "object", `A two-argument call failed: ${legacy as string}`);
assert.equal((legacy as Graded).score, 2);
await db.exec("delete from mcq_attempts");

// A retry with the attempt's own id gets the first attempt back.
const attempt = uuid(100);
const first = (await grade(student, quiz, allRight, attempt)) as Graded;
assert.equal(first.attempt_id, attempt);
assert.equal(first.score, 2);
const retry = (await grade(student, quiz, { [q1]: 3 }, attempt)) as Graded;
assert.equal(await attempts(), 1, "A retry filed a second attempt");
assert.deepEqual(retry, first, "A retry didn't return the attempt that was filed");

// A retake is a new attempt, as before.
await grade(student, quiz, { [q1]: 0 }, uuid(101));
assert.equal(await attempts(), 2, "A retake with a new id wasn't filed");

// An id already used can't be borrowed by someone else, or for another quiz.
assert.match(String(await grade(classmate, quiz, allRight, attempt)), /another quiz/);
assert.match(String(await grade(student, otherQuiz, { [q3]: 2 }, attempt)), /another quiz/);
assert.equal(await attempts(), 2);

console.log("grade_mcq_attempt retries: all checks passed");
