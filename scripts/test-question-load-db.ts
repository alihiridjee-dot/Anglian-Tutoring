/** Isolated PostgreSQL regression checks for 20261126130000_question_load:
 * a student's level (Reduced, Normal, Enhanced) decides how many of a shared
 * quiz's or task's first questions they are set, the server marks out of that
 * many, and the count is filed with the work. No production data is read or
 * written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-question-load-db.ts
 *
 * The rollback file holds the live definitions from before the migration (its
 * bodies' md5s are checked against production's), so it runs first. Then the
 * migration, twice, and the rollback again to show it restores them.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { QUESTION_LOADS, shownCount, type LoadKind } from "../src/lib/practice/questionLoad";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const reduced = uuid(1);
const normal = uuid(2);
const enhanced = uuid(3);
const sharedQuiz = uuid(10); // generated, 8 questions
const longQuiz = uuid(11); // generated, 10 questions
const shortQuiz = uuid(12); // generated, 6 questions
const tutorQuiz = uuid(13); // a tutor's own, 8 questions
const tiedQuiz = uuid(14); // generated, 8 questions all at position 0
const sharedTask = uuid(20); // generated, 5 questions worth 2, 3, 4, 5, 6
const shortTask = uuid(21); // generated, 4 questions
const tutorTask = uuid(22); // a tutor's own, 5 questions
/** Question n (from 1) of a quiz or task: ids sort in the order of n. */
const qid = (of: string, n: number) => uuid(Number(of.slice(-2)) * 100 + n);

/** md5(prosrc) in production, 26 Nov 2026. */
const LIVE = {
  grade_mcq_attempt: "339ded353510b24602c4a152cfc0a11b",
  submit_homework_answers: "287bc527ee33d63e6e5d409ca01aa6d2",
  publish_homework_marks: "e93e825ab42dda8a6fe03447a1eafbe3",
};

// What the three functions touch, shaped as production has it.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create type resource_origin as enum ('tutor','generated');
create table profiles(id uuid primary key, role profile_role not null default 'student');
create function private.is_staff(_user_id uuid) returns boolean language sql stable as $$ select false $$;
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable as $$ select false $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable as $$ select true $$;
create function private.my_content_subjects() returns text[] language sql stable as $$ select '{chemistry}'::text[] $$;
create function private.spec_point_subject(_id uuid) returns text language sql stable as $$ select 'chemistry' $$;
create function private.student_paid_subjects(p_student_id uuid) returns text[] language sql stable as $$ select '{chemistry}'::text[] $$;

create table mcq_sets(id uuid primary key, published boolean not null default true, spec_point_id uuid,
  subject subject default 'chemistry', origin resource_origin not null default 'tutor');
create table mcq_questions(id uuid primary key, set_id uuid references mcq_sets on delete cascade,
  position int not null default 0, question text default 'Q', options jsonb default '["a","b","c","d"]',
  correct_index int default 0, explanation text default 'because', spec_point_id uuid);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid not null references mcq_sets on delete cascade,
  user_id uuid not null, score int not null, total int not null, answers jsonb not null,
  created_at timestamptz not null default now(), point_scores jsonb);

create table resources(id uuid primary key, kind text default 'homework', title text default 'Task',
  subject subject default 'chemistry', review_status text default 'approved', publish_at timestamptz,
  origin resource_origin not null default 'tutor');
create table homework_questions(id uuid primary key, resource_id uuid not null references resources on delete cascade,
  position int not null, marks int not null default 1, created_at timestamptz not null default now() - interval '1 day');
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid not null,
  student_id uuid not null, notes text, submitted_at timestamptz not null default now(), grade text, score_pct numeric,
  feedback text, graded_by uuid, graded_at timestamptz, unique (resource_id, student_id));
create table homework_answers(id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references homework_submissions on delete cascade,
  question_id uuid not null references homework_questions on delete cascade,
  answer_text text, awarded_marks numeric, feedback text, credited jsonb, unique (submission_id, question_id));
create table homework_drafts(student_id uuid, resource_id uuid, primary key (student_id, resource_id));
create table homework_ai_marks(submission_id uuid primary key references homework_submissions on delete cascade,
  marks jsonb not null, summary text, credited jsonb);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text,
  title text, body text, link text, submission_id uuid);

insert into profiles(id) values ('${reduced}'), ('${normal}'), ('${enhanced}');
insert into mcq_sets(id, origin) values ('${sharedQuiz}', 'generated'), ('${longQuiz}', 'generated'),
  ('${shortQuiz}', 'generated'), ('${tutorQuiz}', 'tutor'), ('${tiedQuiz}', 'generated');
insert into resources(id, origin) values ('${sharedTask}', 'generated'), ('${shortTask}', 'generated'), ('${tutorTask}', 'tutor');
`);
/** Questions 1..n, in position order; every right answer is option 0. */
const quizOf = async (set: string, n: number, position = (i: number) => i) => {
  for (let i = 0; i < n; i++)
    await db.query("insert into mcq_questions(id, set_id, position) values($1, $2, $3)", [
      qid(set, i + 1),
      set,
      position(i),
    ]);
};
await quizOf(sharedQuiz, 8);
// The spec point the shared quiz tests. An attempt freezes its score on the
// point (`point_scores`), which is what the planner's memory model reads.
const point = uuid(500);
await db.query("update mcq_sets set spec_point_id = $1 where id = $2", [point, sharedQuiz]);
/** An attempt's frozen score on the point, to two places. */
const pointScore = (scores: unknown) =>
  Math.round(Number((scores as Record<string, number>)[point]) * 100) / 100;
await quizOf(longQuiz, 10);
await quizOf(shortQuiz, 6);
await quizOf(tutorQuiz, 8);
await quizOf(tiedQuiz, 8, () => 0);
const taskOf = async (task: string, marks: number[]) => {
  for (const [i, m] of marks.entries())
    await db.query(
      "insert into homework_questions(id, resource_id, position, marks) values($1, $2, $3, $4)",
      [qid(task, i + 1), task, i, m],
    );
};
await taskOf(sharedTask, [2, 3, 4, 5, 6]);
await taskOf(shortTask, [2, 3, 4, 5]);
await taskOf(tutorTask, [2, 3, 4, 5, 6]);

const sql = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = await sql("migrations/20261126130000_question_load.sql");
const rollback = await sql("rollbacks/20261126130000_question_load.down.sql");

const as = (id: string | null) =>
  db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
const bodyMd5 = async (name: string) =>
  (await db.query<{ m: string }>("select md5(prosrc) m from pg_proc where proname = $1", [name]))
    .rows[0].m;
const isLive = async () => {
  for (const [name, md5] of Object.entries(LIVE))
    assert.equal(await bodyMd5(name), md5, `${name} is not production's definition`);
};

type Result = { question_id: string; chosen_index: number | null; correct: boolean };
type Graded = {
  attempt_id: string;
  score: number;
  total: number;
  shown_count?: number | null;
  results: Result[];
};
/** Calls grade_mcq_attempt as `who`; resolves to its reply or the error's message. */
async function grade(
  who: string,
  set: string,
  answers: Record<string, number>,
  attemptId?: string,
) {
  await as(who);
  try {
    return (
      await db.query<{ r: Graded }>(
        "select public.grade_mcq_attempt(_set_id => $1, _answers => $2::jsonb, _attempt_id => $3) r",
        [set, JSON.stringify(answers), attemptId ?? null],
      )
    ).rows[0].r;
  } catch (err) {
    return (err as Error).message;
  }
}
/** Option 0 (right) for questions 1..n of a quiz, bar the ones listed as wrong. */
const answersTo = (set: string, n: number, wrong: number[] = []) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [qid(set, i + 1), wrong.includes(i + 1) ? 1 : 0]),
  );
const attempt = async (id: string) =>
  (
    await db.query<{
      score: number;
      total: number;
      shown_count: number | null;
      answers: Record<string, number>;
      point_scores: unknown;
    }>("select score, total, shown_count, answers, point_scores from mcq_attempts where id = $1", [
      id,
    ])
  ).rows[0];
const attempts = async () =>
  Number((await db.query<{ n: number }>("select count(*)::int n from mcq_attempts")).rows[0].n);

/** Hands a task in as `who`, with an answer sent for each of these question numbers. */
async function handIn(who: string, task: string, sent: number[]) {
  await as(who);
  try {
    return (
      await db.query<{ id: string }>("select public.submit_homework_answers($1, $2::jsonb) id", [
        task,
        JSON.stringify(
          sent.map((n) => ({ question_id: qid(task, n), answer_text: `answer ${n}` })),
        ),
      ])
    ).rows[0].id;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
const submission = async (id: string) =>
  (
    await db.query<{ shown_count: number | null; score_pct: string | null }>(
      "select shown_count, score_pct from homework_submissions where id = $1",
      [id],
    )
  ).rows[0];
/** The answer rows of a submission, as [question number, text], in question order. */
const answerRows = async (id: string) =>
  (
    await db.query<{ n: number; answer_text: string | null }>(
      `select q.position + 1 as n, a.answer_text from homework_answers a
         join homework_questions q on q.id = a.question_id
        where a.submission_id = $1 order by q.position`,
      [id],
    )
  ).rows.map((r) => [Number(r.n), r.answer_text]);
/** Stages a mark for each question number, then publishes as the release clock does. */
async function publish(sub: string, task: string, marks: Record<number, number>) {
  await as(null);
  await db.query(
    "insert into homework_ai_marks(submission_id, marks, summary) values($1, $2, 'Good work')",
    [
      sub,
      JSON.stringify(
        Object.entries(marks).map(([n, m]) => ({
          question_id: qid(task, Number(n)),
          marks: m,
          feedback: "",
        })),
      ),
    ],
  );
  await db.query("select public.publish_homework_marks($1)", [sub]);
  return Number((await submission(sub)).score_pct);
}
const clearWork = () =>
  db.exec("delete from mcq_attempts; delete from homework_submissions; delete from notifications;");

// ── Before: production's definitions ────────────────────────────────────────
await db.exec(rollback);
await isLive();
{
  // Everyone is marked out of every question, whatever was answered.
  const before = (await grade(reduced, sharedQuiz, answersTo(sharedQuiz, 6))) as Graded;
  assert.equal(before.total, 8, "Fixture check: the live function marks out of all eight");
  assert.equal(before.score, 6);
  await clearWork();
}

// ── After, applied twice to show it is idempotent ───────────────────────────
await db.exec(migration);
await db.exec(migration);
await db.query("update profiles set question_load = 'reduced' where id = $1", [reduced]);
await db.query("update profiles set question_load = 'enhanced' where id = $1", [enhanced]);

// The setting: normal unless chosen, one of three, and a student may write it.
assert.equal(
  (await db.query<{ l: string }>("select question_load l from profiles where id = $1", [normal]))
    .rows[0].l,
  "normal",
);
await assert.rejects(
  () => db.query("update profiles set question_load = 'huge' where id = $1", [normal]),
  /profiles_question_load_known/,
);
assert.equal(
  (
    await db.query<{ ok: boolean }>(
      "select has_column_privilege('authenticated', 'public.profiles', 'question_load', 'update') ok",
    )
  ).rows[0].ok,
  true,
  "A student can't save their level",
);
assert.equal(
  (
    await db.query<{ ok: boolean }>(
      "select has_function_privilege('authenticated', 'private.shown_question_count(text, integer, text)', 'execute') ok",
    )
  ).rows[0].ok,
  false,
);

// The caps are the app's own (src/lib/practice/questionLoad.ts), for every
// level and every stored count, short sets included.
for (const kind of ["quiz", "task"] as LoadKind[])
  for (const load of QUESTION_LOADS)
    for (let stored = 0; stored <= 12; stored++) {
      const { n } = (
        await db.query<{ n: number }>("select private.shown_question_count($1, $2, $3) n", [
          kind,
          stored,
          load,
        ])
      ).rows[0];
      assert.equal(n, shownCount(kind, stored, load), `${kind} ${load} of ${stored}`);
    }

// ── Quizzes ─────────────────────────────────────────────────────────────────
{
  // Reduced: marked out of the first six. Right answers to 7 and 8 are ignored
  // and not kept; a shown question left out still counts as wrong.
  const sent = answersTo(sharedQuiz, 8, [2]);
  delete sent[qid(sharedQuiz, 5)];
  const r = (await grade(reduced, sharedQuiz, sent)) as Graded;
  assert.equal(typeof r, "object", String(r));
  assert.equal(r.total, 6);
  assert.equal(r.score, 4, "Six shown, one wrong, one left out");
  assert.equal(r.shown_count, 6);
  assert.deepEqual(
    r.results.map((x) => x.question_id),
    [1, 2, 3, 4, 5, 6].map((n) => qid(sharedQuiz, n)),
    "The reply gives the key to the six questions set, in order, and no others",
  );
  const filed = await attempt(r.attempt_id);
  assert.deepEqual([filed.score, filed.total, filed.shown_count], [4, 6, 6]);
  assert.deepEqual(
    Object.keys(filed.answers).sort(),
    [1, 2, 3, 4, 6].map((n) => qid(sharedQuiz, n)),
    "An answer past the student's count was kept",
  );
  // The planner reads the point's frozen score: four of the six set, so 66.67.
  // Out of all eight, with the right answers to 7 and 8, it would be 75.
  assert.equal(pointScore(filed.point_scores), 66.67);

  // Changing level leaves a filed attempt as it was: the weekly lock replays
  // it with its own count, by id or from another tab, and files nothing.
  await db.query("update profiles set question_load = 'enhanced' where id = $1", [reduced]);
  for (const id of [r.attempt_id, uuid(900)]) {
    const replay = (await grade(reduced, sharedQuiz, answersTo(sharedQuiz, 8), id)) as Graded;
    assert.equal(replay.attempt_id, r.attempt_id);
    assert.deepEqual([replay.score, replay.total, replay.shown_count], [4, 6, 6]);
    assert.equal(replay.results.length, 5, "A replay gives the key to what was answered");
  }
  assert.equal(await attempts(), 1);
  await db.query("update profiles set question_load = 'reduced' where id = $1", [reduced]);
}
{
  // Normal is what everyone had: all eight of a quiz written before this.
  const r = (await grade(normal, sharedQuiz, answersTo(sharedQuiz, 8, [8]))) as Graded;
  assert.deepEqual([r.score, r.total, r.shown_count], [7, 8, 8]);
  assert.equal(pointScore((await attempt(r.attempt_id)).point_scores), 87.5);
  // Enhanced sees nothing extra on it, and all ten once ten are written.
  const old = (await grade(enhanced, sharedQuiz, answersTo(sharedQuiz, 8))) as Graded;
  assert.deepEqual([old.score, old.total, old.shown_count], [8, 8, 8]);
  const ten = (await grade(enhanced, longQuiz, answersTo(longQuiz, 10))) as Graded;
  assert.deepEqual([ten.score, ten.total, ten.shown_count], [10, 10, 10]);
  // Normal on that longer quiz is still eight, and question 9 is not marked.
  const eight = (await grade(normal, longQuiz, answersTo(longQuiz, 10))) as Graded;
  assert.deepEqual([eight.score, eight.total, eight.shown_count], [8, 8, 8]);
  // A quiz with six stored is six on every level.
  for (const who of [reduced, normal, enhanced]) {
    const six = (await grade(who, shortQuiz, answersTo(shortQuiz, 6))) as Graded;
    assert.deepEqual([six.score, six.total, six.shown_count], [6, 6, 6]);
  }
}
{
  // A tutor's own quiz is set whole, and files no count.
  const r = (await grade(reduced, tutorQuiz, answersTo(tutorQuiz, 8, [7, 8]))) as Graded;
  assert.deepEqual([r.score, r.total, r.shown_count], [6, 8, null]);
  assert.equal(r.results.length, 8);
  assert.equal((await attempt(r.attempt_id)).shown_count, null);
}
{
  // Position isn't unique: ties go by id, so the same six every time.
  const r = (await grade(reduced, tiedQuiz, answersTo(tiedQuiz, 8))) as Graded;
  assert.deepEqual(
    r.results.map((x) => x.question_id),
    [1, 2, 3, 4, 5, 6].map((n) => qid(tiedQuiz, n)),
  );
}
{
  // An answer naming a question the quiz doesn't have is still refused.
  await clearWork();
  assert.equal(await grade(reduced, sharedQuiz, { [uuid(999)]: 0 }), "quiz has changed");
  assert.equal(await attempts(), 0);
}
{
  // An attempt filed before the levels has no count. Its replay is unchanged:
  // the filed score, and the key to everything it answered.
  await db.query(
    "insert into mcq_attempts(id, set_id, user_id, score, total, answers) values($1, $2, $3, 7, 8, $4)",
    [uuid(901), sharedQuiz, reduced, JSON.stringify(answersTo(sharedQuiz, 8, [8]))],
  );
  const replay = (await grade(reduced, sharedQuiz, {}, uuid(901))) as Graded;
  assert.deepEqual([replay.score, replay.total, replay.shown_count], [7, 8, null]);
  assert.equal(replay.results.length, 8);
  await clearWork();
}

// ── Tasks ───────────────────────────────────────────────────────────────────
{
  // Reduced: set the first three. Answers sent for 4 and 5 are not kept, and
  // a question set but not sent gets a blank row, so it still counts.
  const sub = await handIn(reduced, sharedTask, [1, 3, 4, 5]);
  assert.equal((await submission(sub)).shown_count, 3, sub);
  assert.deepEqual(await answerRows(sub), [
    [1, "answer 1"],
    [2, null],
    [3, "answer 3"],
  ]);
  // Scored out of the three set (2 + 3 + 4 marks), not all five (20). A mark
  // staged for a question past the count is not counted either.
  assert.equal(await publish(sub, sharedTask, { 1: 2, 2: 0, 3: 4, 4: 5 }), 67);
}
{
  // Normal is all five of a task written before this; Enhanced the same.
  const sub = await handIn(normal, sharedTask, [1, 2, 3, 4, 5]);
  assert.equal((await submission(sub)).shown_count, 5);
  assert.equal((await answerRows(sub)).length, 5);
  assert.equal(await publish(sub, sharedTask, { 1: 2, 2: 3, 3: 4, 4: 5, 5: 0 }), 70);
  const more = await handIn(enhanced, sharedTask, [1, 2, 3, 4, 5]);
  assert.equal((await submission(more)).shown_count, 5);
  // A task with four stored is four on Normal and Enhanced, three on Reduced.
  assert.equal((await submission(await handIn(normal, shortTask, [1]))).shown_count, 4);
  assert.equal((await submission(await handIn(enhanced, shortTask, [1]))).shown_count, 4);
  assert.equal((await submission(await handIn(reduced, shortTask, [1]))).shown_count, 3);
}
{
  // A tutor's own task is handed in whole: no count, the rows as sent, and
  // scored by the rule from before (a question on the sheet at hand-in counts
  // even when no answer was sent for it).
  const sub = await handIn(reduced, tutorTask, [1, 2]);
  assert.equal((await submission(sub)).shown_count, null, sub);
  assert.deepEqual(await answerRows(sub), [
    [1, "answer 1"],
    [2, "answer 2"],
  ]);
  assert.equal(await publish(sub, tutorTask, { 1: 2, 2: 3 }), 25);
}
{
  // The checks from before still hold.
  await clearWork();
  await as(reduced);
  await assert.rejects(
    () =>
      db.query("select public.submit_homework_answers($1, $2::jsonb)", [
        sharedTask,
        JSON.stringify([{ question_id: uuid(999), answer_text: "x" }]),
      ]),
    /not on this task/,
  );
  await assert.rejects(
    () =>
      db.query("select public.submit_homework_answers($1, $2::jsonb)", [
        sharedTask,
        JSON.stringify([{ question_id: qid(sharedTask, 1), answer_text: "x".repeat(5001) }]),
      ]),
    /too long/,
  );
  assert.match(await handIn(reduced, sharedTask, [1]), /^[0-9a-f-]{36}$/);
  assert.match(await handIn(reduced, sharedTask, [1]), /already submitted/);
}
{
  // Work handed in before the levels has no count, and is scored as before:
  // out of the questions on the sheet at hand-in, not one added since.
  await clearWork();
  const { id } = (
    await db.query<{ id: string }>(
      "insert into homework_submissions(resource_id, student_id) values($1, $2) returning id",
      [sharedTask, normal],
    )
  ).rows[0];
  await db.query(
    "insert into homework_answers(submission_id, question_id, answer_text) values($1, $2, 'a')",
    [id, qid(sharedTask, 1)],
  );
  await db.query(
    "insert into homework_questions(id, resource_id, position, marks, created_at) values($1, $2, 99, 20, now() + interval '1 hour')",
    [uuid(998), sharedTask],
  );
  assert.equal(await publish(id, sharedTask, { 1: 2 }), 10);
  await db.query("delete from homework_questions where id = $1", [uuid(998)]);
}

// ── The rollback restores production's definitions and takes the columns ────
await clearWork();
await db.exec(rollback);
await isLive();
const left = (
  await db.query<{ n: number }>(
    `select count(*)::int n from information_schema.columns
      where table_schema = 'public' and column_name in ('question_load', 'shown_count')`,
  )
).rows[0].n;
assert.equal(Number(left), 0, "The rollback left a column behind");

console.log("question load: all checks passed");
