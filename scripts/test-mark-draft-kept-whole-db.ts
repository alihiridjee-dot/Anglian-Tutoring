/** Isolated PostgreSQL checks for 20261119224752: a tutor's saved marking draft
 * keeps the marker's hold reasons and is never written over by the marker.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-mark-draft-kept-whole-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);
const sheet = uuid(10);
const [q1, q2, q3] = [uuid(21), uuid(22), uuid(23)];

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create table public.user_roles(user_id uuid, role public.app_role);
create function private.has_role(_uid uuid, _role public.app_role) returns boolean language sql stable security definer as $$ select exists (select 1 from public.user_roles r where r.user_id = _uid and r.role = _role) $$;
grant usage on schema private, auth to authenticated;
create table public.homework_questions(id uuid primary key, resource_id uuid, marks int);
create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid,
  graded_at timestamptz, release_at timestamptz, tutor_reviewed_at timestamptz,
  ai_marked_at timestamptz, ai_marking_started_at timestamptz);
create table public.homework_ai_marks(submission_id uuid primary key, marks jsonb not null, summary text, model text, credited jsonb);
insert into public.user_roles values ('${tutor}','tutor'),('${student}','student');
insert into public.homework_questions values ('${q1}','${sheet}',3),('${q2}','${sheet}',2),('${q3}','${sheet}',4);
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261119224752_mark_draft_kept_whole.sql", import.meta.url),
    "utf8",
  ),
);

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
const submission = async (fields = "") =>
  (
    await db.query<{ id: string }>(
      `insert into public.homework_submissions(resource_id, student_id${fields ? ", " + fields.split("=")[0] : ""})
       values('${sheet}','${student}'${fields ? ", " + fields.split("=")[1] : ""}) returning id`,
    )
  ).rows[0].id;
const saveDraft = (who: string, id: string, marks: unknown, summary: string | null = null) =>
  as(who, "select public.save_homework_mark_draft($1,$2::jsonb,$3)", [
    id,
    JSON.stringify(marks),
    summary,
  ]);
const claim = async (id: string) => {
  await db.exec("set role service_role");
  try {
    return (await db.query<{ ok: boolean }>("select public.claim_homework_marking($1) ok", [id]))
      .rows[0].ok;
  } finally {
    await db.exec("reset role");
  }
};
type Staged = { question_id: string; marks: number; feedback: string; held?: string };
const staged = async (id: string) =>
  (
    await db.query<{ marks: Staged[]; summary: string | null; credited: unknown }>(
      "select marks, summary, credited from public.homework_ai_marks where submission_id = $1",
      [id],
    )
  ).rows[0];

// 1. A held paper, part-marked and saved: the hold reasons stay with their
//    questions, the tutor's marks and comments replace the marker's, and the
//    words behind each mark (`credited`) are untouched.
const held = await submission("ai_marked_at=now()");
await db.query(
  "insert into public.homework_ai_marks(submission_id, marks, summary, credited) values ($1,$2::jsonb,'AI summary','{\"k\":1}')",
  [
    held,
    JSON.stringify([
      { question_id: q1, marks: 1, feedback: "AI on 1" },
      { question_id: q2, marks: 2, feedback: "AI on 2", held: "Not sure of this mark." },
      { question_id: q3, marks: 4, feedback: "AI on 3", held: "Blanked by the tutor." },
    ]),
  ],
);
await saveDraft(
  tutor,
  held,
  [
    { question_id: q1, marks: 3, feedback: "Tutor on 1" },
    { question_id: q2, marks: 99, feedback: "" },
    // A mark left blank is not staged, as before.
    { question_id: q3, marks: null, feedback: "No mark yet" },
    { question_id: uuid(999), marks: 1, feedback: "not on this sheet" },
  ],
  "Tutor summary",
);
const kept = await staged(held);
const byId = new Map(kept.marks.map((m) => [m.question_id, m]));
assert.equal(kept.marks.length, 2);
assert.deepEqual(byId.get(q1), { question_id: q1, marks: 3, feedback: "Tutor on 1" });
assert.deepEqual(byId.get(q2), {
  question_id: q2,
  marks: 2,
  feedback: "",
  held: "Not sure of this mark.",
});
assert.equal(kept.summary, "Tutor summary");
assert.deepEqual(kept.credited, { k: 1 });
const [row] = (
  await db.query<{ tutor_reviewed_at: string | null; graded_at: string | null }>(
    "select tutor_reviewed_at, graded_at from public.homework_submissions where id = $1",
    [held],
  )
).rows;
assert.ok(row.tutor_reviewed_at && !row.graded_at, "A saved draft published, or left no trace");

// Saved again, the reason is still there.
await saveDraft(tutor, held, [{ question_id: q2, marks: 1, feedback: "Half" }]);
assert.equal((await staged(held)).marks[0].held, "Not sure of this mark.");

// 2. Only staff, and never onto published work.
await assert.rejects(saveDraft(student, held, []), /Only tutors/);
await db.query("update public.homework_submissions set graded_at = now() where id = $1", [held]);
await assert.rejects(saveDraft(tutor, held, []), /already published/);

// 3. A paper the marker never marked: once a tutor has saved marks on it, the
//    marker may not claim it and write over them.
const unmarked = await submission();
await saveDraft(tutor, unmarked, [{ question_id: q1, marks: 2, feedback: "By hand" }]);
assert.equal(await claim(unmarked), false, "The marker claimed a paper with a tutor's draft");
assert.deepEqual((await staged(unmarked)).marks, [
  { question_id: q1, marks: 2, feedback: "By hand" },
]);

// 4. While a marking run holds the claim, a draft is refused; once the run is
//    done, or its claim has gone stale, it saves.
const running = await submission();
assert.equal(await claim(running), true, "The first run couldn't claim fresh work");
assert.equal(await claim(running), false, "A second run claimed work already being marked");
await assert.rejects(
  saveDraft(tutor, running, [{ question_id: q1, marks: 1, feedback: "" }]),
  /being marked right now/,
);
await db.query(
  "update public.homework_submissions set ai_marking_started_at = now() - interval '11 minutes' where id = $1",
  [running],
);
await saveDraft(tutor, running, [{ question_id: q1, marks: 1, feedback: "" }]);
const finished = await submission("ai_marking_started_at=now()");
await db.query("update public.homework_submissions set ai_marked_at = now() where id = $1", [
  finished,
]);
await saveDraft(tutor, finished, [{ question_id: q1, marks: 1, feedback: "" }]);

// 5. The claim's older rules still hold.
assert.equal(await claim(await submission("ai_marked_at=now()")), false);
assert.equal(await claim(await submission("graded_at=now()")), false);
const other = await submission();
for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  let threw = false;
  try {
    await db.query("select public.claim_homework_marking($1)", [other]);
  } catch {
    threw = true;
  } finally {
    await db.exec("reset role");
  }
  assert(threw, `${role} could claim a submission`);
}

console.log("mark draft kept whole: all checks passed");
