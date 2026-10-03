/** Isolated PostgreSQL regression checks for S-12 and S-15: a submission is
 * scored out of the questions it was set, and a tutor's "Confirm & publish" is
 * one write the timer can't half-overwrite. No production data is read or
 * written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-homework-publish-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);

// The tables, trigger and functions publishing touches, as production defines
// them (pg_get_functiondef / information_schema, 1 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create type app_role as enum ('student','tutor','admin');
create table public.user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor') then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create table public.resources(id uuid primary key default gen_random_uuid(), title text);
create table public.homework_questions(id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources on delete cascade, position int not null,
  prompt text not null default 'Q', marks int not null default 1, created_at timestamptz not null default now());
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid not null,
  student_id uuid not null, submitted_at timestamptz not null default now(), grade text, score_pct numeric,
  feedback text, graded_by uuid, graded_at timestamptz, ai_marked_at timestamptz, release_at timestamptz,
  tutor_reviewed_at timestamptz);
create table public.homework_answers(id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.homework_submissions on delete cascade,
  question_id uuid not null references public.homework_questions on delete cascade,
  answer_text text, awarded_marks numeric, feedback text, unique (submission_id, question_id));
create table public.homework_ai_marks(submission_id uuid primary key references public.homework_submissions on delete cascade,
  marks jsonb not null, summary text, model text);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text,
  title text, body text, link text, submission_id uuid);

create function public.enforce_grading_privileges() returns trigger language plpgsql security definer set search_path to '' as $$
declare v_privileged boolean;
begin
  v_privileged := coalesce(current_setting('app.publishing_marks', true), '') = 'on'
    or coalesce(auth.role(), '') = 'service_role'
    or private.has_role(auth.uid(), 'tutor'::public.app_role)
    or private.has_role(auth.uid(), 'admin'::public.app_role);
  if v_privileged then return new; end if;
  if tg_op = 'INSERT' then
    if new.grade is not null or new.score_pct is not null or new.feedback is not null or new.graded_by is not null
       or new.graded_at is not null or new.ai_marked_at is not null or new.release_at is not null
       or new.tutor_reviewed_at is not null then
      raise exception 'Only tutors or admins may set grading fields' using errcode = '42501';
    end if;
  else
    if new.grade is distinct from old.grade or new.score_pct is distinct from old.score_pct
       or new.feedback is distinct from old.feedback or new.graded_by is distinct from old.graded_by
       or new.graded_at is distinct from old.graded_at or new.ai_marked_at is distinct from old.ai_marked_at
       or new.release_at is distinct from old.release_at or new.tutor_reviewed_at is distinct from old.tutor_reviewed_at then
      raise exception 'Only tutors or admins may set grading fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_enforce_grading_privileges before insert or update on public.homework_submissions
  for each row execute function public.enforce_grading_privileges();

grant usage on schema public, auth, private to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;
`);
await db.query("insert into user_roles values($1,'tutor'),($2,'student')", [tutor, student]);

const sql = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const as = (id: string | null) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);

/** A sheet with these question marks, handed in an hour ago with these answers. */
async function handedIn(marks: number[], answered: (string | null)[]) {
  const hw = (
    await db.query<{ id: string }>("insert into resources(title) values('Cells') returning id")
  ).rows[0].id;
  const qs: string[] = [];
  for (const [i, m] of marks.entries()) {
    qs.push(
      (
        await db.query<{ id: string }>(
          `insert into homework_questions(resource_id, position, marks, created_at)
           values($1,$2,$3, now() - interval '2 hours') returning id`,
          [hw, i, m],
        )
      ).rows[0].id,
    );
  }
  const sub = (
    await db.query<{ id: string }>(
      `insert into homework_submissions(resource_id, student_id, submitted_at)
       values($1,$2, now() - interval '1 hour') returning id`,
      [hw, student],
    )
  ).rows[0].id;
  for (const [i, text] of answered.entries()) {
    if (text === undefined) continue;
    await db.query(
      "insert into homework_answers(submission_id, question_id, answer_text) values($1,$2,$3)",
      [sub, qs[i], text],
    );
  }
  return { hw, qs, sub };
}
const stage = (sub: string, marks: { question_id: string; marks: number }[]) =>
  db.query(
    "insert into homework_ai_marks(submission_id, marks, summary) values($1,$2,'Good work')",
    [sub, JSON.stringify(marks.map((m) => ({ ...m, feedback: "AI says" })))],
  );
const publish = async (sub: string) =>
  (await db.query<{ ok: boolean }>("select public.publish_homework_marks($1) ok", [sub])).rows[0]
    .ok;
const pct = async (sub: string) =>
  Number(
    (
      await db.query<{ p: string }>("select score_pct p from homework_submissions where id = $1", [
        sub,
      ])
    ).rows[0].p,
  );
const addQuestionNow = (hw: string, marks: number) =>
  db.query("insert into homework_questions(resource_id, position, marks) values($1, 99, $2)", [
    hw,
    marks,
  ]);

// ── S-12 on the live publisher: the bug, as it stands ──────────────────────
await as(null);
await db.exec(await sql("rollbacks/20261001123732_fair_totals_and_confirm_marks.down.sql"));
{
  const { hw, qs, sub } = await handedIn([2], ["Water across a membrane"]);
  await stage(sub, [{ question_id: qs[0], marks: 2 }]);
  await addQuestionNow(hw, 6);
  await publish(sub);
  assert.equal(await pct(sub), 25, "Fixture check: the live publisher should show the bug");
}

// ── The fix ───────────────────────────────────────────────────────────────
await db.exec(await sql("migrations/20261001123732_fair_totals_and_confirm_marks.sql"));
{
  const { hw, qs, sub } = await handedIn([2], ["Water across a membrane"]);
  await stage(sub, [{ question_id: qs[0], marks: 2 }]);
  await addQuestionNow(hw, 6);
  assert.equal(await publish(sub), true);
  assert.equal(await pct(sub), 100, "A question added after hand-in lowered the score");
}
{
  // A blank answer still counts against the student…
  const { qs, sub } = await handedIn([2, 2], ["Osmosis", null]);
  await stage(sub, [
    { question_id: qs[0], marks: 2 },
    { question_id: qs[1], marks: 0 },
  ]);
  await publish(sub);
  assert.equal(await pct(sub), 50, "A blank answer stopped counting");
}
{
  // …and so does a question that was on the sheet but left out of the request.
  const { qs, sub } = await handedIn([2, 2], ["Osmosis"]);
  await stage(sub, [{ question_id: qs[0], marks: 2 }]);
  await publish(sub);
  assert.equal(await pct(sub), 50, "Leaving a question out of the hand-in inflated the score");
}

// ── S-15: Confirm & publish is one write ──────────────────────────────────
const confirm = (sub: string, marks: unknown, score: number | null, feedback: string | null) =>
  db.query("select public.confirm_homework_marks($1, $2, $3, $4)", [
    sub,
    JSON.stringify(marks),
    score,
    feedback,
  ]);
const answers = async (sub: string) =>
  (
    await db.query<{ question_id: string; awarded_marks: string | null; feedback: string | null }>(
      "select question_id, awarded_marks, feedback from homework_answers where submission_id = $1 order by question_id",
      [sub],
    )
  ).rows.map((r) => ({
    ...r,
    awarded_marks: r.awarded_marks == null ? null : Number(r.awarded_marks),
  }));
const graded = async (sub: string) =>
  (
    await db.query<{
      graded_at: string | null;
      graded_by: string | null;
      tutor_reviewed_at: string | null;
      grade: string | null;
      feedback: string | null;
    }>(
      "select graded_at, graded_by, tutor_reviewed_at, grade, feedback from homework_submissions where id = $1",
      [sub],
    )
  ).rows[0];

await db.exec("set role authenticated");
{
  const { qs, sub } = await handedIn([2, 3], ["Osmosis", "Nucleus"]);
  await db.exec("reset role");
  await stage(sub, [
    { question_id: qs[0], marks: 0 },
    { question_id: qs[1], marks: 0 },
  ]);
  await db.exec("set role authenticated");

  // A student can't publish their own marks.
  await as(student);
  await assert.rejects(
    () => confirm(sub, [{ question_id: qs[0], marks: 2, feedback: "" }], 100, "Great"),
    /Only tutors/,
  );
  assert.equal((await graded(sub)).graded_at, null);

  // A payload that fails part-way leaves nothing written: no answer marks
  // without a grade for the timer to overwrite.
  await as(tutor);
  await assert.rejects(() =>
    confirm(
      sub,
      [
        { question_id: qs[0], marks: 2, feedback: "Good" },
        { question_id: qs[1], marks: "lots", feedback: "" },
      ],
      80,
      "Well done",
    ),
  );
  assert.deepEqual(
    (await answers(sub)).map((a) => a.awarded_marks),
    [null, null],
    "A failed confirm left marks behind",
  );
  assert.equal((await graded(sub)).graded_at, null, "A failed confirm left a grade behind");

  // The real thing: marks clamped, a cleared comment kept as cleared, and the
  // submission graded and credited in the same write.
  await confirm(
    sub,
    [
      { question_id: qs[0], marks: 99, feedback: "Spot on" },
      { question_id: qs[1], marks: 1, feedback: "" },
    ],
    60,
    "Well done",
  );
  const after = await answers(sub);
  assert.deepEqual(
    after.map((a) => [a.question_id === qs[0] ? "q1" : "q2", a.awarded_marks, a.feedback]).sort(),
    [
      ["q1", 2, "Spot on"],
      ["q2", 1, ""],
    ],
  );
  const g = await graded(sub);
  assert.ok(g.graded_at && g.tutor_reviewed_at, "The submission wasn't graded with its marks");
  assert.equal(g.graded_by, tutor);
  assert.equal(g.grade, "6");

  // The timer comes round afterwards: it finds the work graded, and the
  // tutor's marks stand.
  await db.exec("reset role");
  await as(null);
  assert.equal(await publish(sub), false);
  assert.deepEqual(await answers(sub), after, "The timer overwrote a tutor's marks");
  await db.exec("set role authenticated");

  // Scores outside 0–100 are refused.
  await as(tutor);
  await assert.rejects(() => confirm(sub, [], 120, null), /between 0 and 100/);
}
{
  // "Update mark" after the timer published: the tutor's marks win.
  await db.exec("reset role");
  await as(null);
  const { qs, sub } = await handedIn([2], ["Osmosis"]);
  await stage(sub, [{ question_id: qs[0], marks: 0 }]);
  await publish(sub);
  await db.exec("set role authenticated");
  await as(tutor);
  await confirm(sub, [{ question_id: qs[0], marks: 2, feedback: "Regraded" }], 100, null);
  assert.equal(
    (await answers(sub))[0].awarded_marks,
    2,
    "A tutor couldn't correct a published mark",
  );
}

console.log("homework publish: all checks passed");
