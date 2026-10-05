/** Isolated PostgreSQL regression checks for 20261005150000_mcq_retake_lock.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-mcq-retake-lock-db.ts
 *
 * The rollback file holds the live definition from before the migration, so it
 * runs first to show an instant retake being filed, then the migration to show
 * it refused.
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

type Graded = {
  attempt_id: string;
  score: number;
  total: number;
  results: { question_id: string; chosen_index: number | null }[];
  retake_opens_at?: string;
};

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
/** Moves every attempt `days` into the past, as if the week had gone by. */
const age = (days: number) =>
  db.exec(`update mcq_attempts set created_at = created_at - interval '${days} days'`);

const migration = await readFile(
  new URL("../supabase/migrations/20261005150000_mcq_retake_lock.sql", import.meta.url),
  "utf8",
);
const before = await readFile(
  new URL("../supabase/rollbacks/20261005150000_mcq_retake_lock.down.sql", import.meta.url),
  "utf8",
);
const wrong = { [q1]: 1, [q2]: 0 };
const allRight = { [q1]: 0, [q2]: 1 };

// Before: the live definition. A retake straight after marking is filed.
await db.exec(before);
await grade(student, quiz, wrong, uuid(90));
await grade(student, quiz, allRight, uuid(91));
assert.equal(await attempts(), 2, "Expected the old function to file an instant retake");
await db.exec("delete from mcq_attempts");

// After, applied twice to show it is idempotent.
await db.exec(migration);
await db.exec(migration);

// The first attempt is filed, and says when the quiz opens again.
const first = (await grade(student, quiz, wrong, uuid(100))) as Graded;
assert.equal(typeof first, "object", `The first attempt failed: ${first as unknown as string}`);
assert.equal(first.score, 0);
const filedAt = (
  await db.query<{ t: string }>("select created_at::text t from mcq_attempts where id = $1", [
    uuid(100),
  ])
).rows[0].t;
assert.equal(
  new Date(first.retake_opens_at!).getTime(),
  new Date(filedAt).getTime() + 7 * 86_400_000,
  "retake_opens_at isn't a week after the attempt",
);

// A retake inside the week, with a fresh id: nothing filed, the first attempt back.
const retake = (await grade(student, quiz, allRight, uuid(101))) as Graded;
assert.equal(await attempts(), 1, "An instant retake was filed");
assert.deepEqual(retake, first, "An instant retake didn't return the attempt already filed");
assert.deepEqual(
  retake.results.map((r) => r.chosen_index),
  [1, 0],
  "The reply should carry the answers that were filed, not the ones resent",
);

// The app now live sends no id at all. Same answer.
assert.deepEqual(await grade(student, quiz, allRight), first);
assert.equal(await attempts(), 1, "A retake without an id was filed");

// The page's review: the filed attempt's own id, no answers. Nothing written.
assert.deepEqual(await grade(student, quiz, {}, uuid(100)), first);
assert.equal(await attempts(), 1);

// The lock is per student and per quiz.
const classmates = (await grade(classmate, quiz, allRight, uuid(102))) as Graded;
assert.equal(classmates.score, 2, "One student's attempt locked a classmate out");
const other = (await grade(student, otherQuiz, { [q3]: 2 }, uuid(103))) as Graded;
assert.equal(other.score, 1, "One quiz's attempt locked a different quiz");
assert.equal(await attempts(), 3);

// An id already used still can't be borrowed by someone else, or for another quiz.
assert.match(String(await grade(classmate, quiz, allRight, uuid(100))), /another quiz/);
assert.match(String(await grade(student, otherQuiz, { [q3]: 2 }, uuid(100))), /another quiz/);
assert.equal(await attempts(), 3);

// A week on, the retake is filed, and it is the one the next week's lock holds.
await age(7);
const nextWeek = (await grade(student, quiz, allRight, uuid(104))) as Graded;
assert.equal(nextWeek.attempt_id, uuid(104), "The retake a week later wasn't filed");
assert.equal(nextWeek.score, 2);
assert.equal(await attempts(), 4);
const again = (await grade(student, quiz, wrong, uuid(105))) as Graded;
assert.equal(again.attempt_id, uuid(104), "The lock didn't follow the latest attempt");
assert.equal(await attempts(), 4);

// A retry of the old attempt still returns it, a week on — with its own date.
const old = (await grade(student, quiz, {}, uuid(100))) as Graded;
assert.equal(old.attempt_id, uuid(100));
assert.equal(old.score, 0);
assert.ok(new Date(old.retake_opens_at!).getTime() <= Date.now(), "An old attempt reads as locked");

console.log("grade_mcq_attempt retake lock: all checks passed");
