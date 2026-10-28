/** Isolated PostgreSQL checks for 20261028110000_size_and_flood_limits.sql.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-size-and-flood-limits-db.ts
 *
 * The tables, policies and grants are shaped as production has them on 28 Oct
 * (pg_policies, information_schema.column_privileges, pg_get_functiondef).
 * Like production, the app's role has no USAGE on the private schema.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const parent = uuid(2);
const tutor = uuid(3);
const freeAccount = uuid(4);
const otherStudent = uuid(5);
const sheet = uuid(10); // chemistry, approved: open to the student
const lockedSheet = uuid(11); // biology: the student doesn't pay for it
const video = uuid(12); // not a task at all
const q1 = uuid(20);
const q2 = uuid(21);
const lockedQ = uuid(22);
const plan = uuid(30);

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');

create type public.app_role as enum ('student','tutor','admin');
create type public.profile_role as enum ('student','parent','tutor');
create type public.subject as enum ('biology','chemistry','physics');
create type public.resource_kind as enum ('homework','video','notes');

create table public.user_roles(user_id uuid, role public.app_role, unique (user_id, role));
create table public.profiles(id uuid primary key, display_name text, role public.profile_role not null default 'student',
  phone text, school text, student_invite_code text);
create table public.parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid, unique (parent_id, student_id));
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  link text, chat_thread_id uuid, created_at timestamptz default now());
create table public.ai_request_log(id bigserial primary key, user_id uuid not null, endpoint text not null, created_at timestamptz not null default now());

-- Who pays for what, standing in for the billing tables behind these helpers.
create table private.paid(student_id uuid, subject text);
create function private.has_role(_user_id uuid, _role public.app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor') then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create function private.student_paid_subjects(_uid uuid) returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(subject), '{}') from private.paid where student_id = _uid $$;
create function private.my_content_subjects() returns text[] language sql stable security definer set search_path = '' as $$
  select private.student_paid_subjects(auth.uid()) $$;
create function private.viewer_has_content_access(_uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.paid where student_id = _uid) $$;
revoke all on all functions in schema private from public;
grant execute on function private.has_role(uuid, public.app_role), private.my_content_subjects(),
  private.viewer_has_content_access(uuid) to authenticated;

create function public.tutor_directory() returns table(id uuid, display_name text) language sql stable security definer set search_path = public as $$
  select p.id, p.display_name from profiles p join user_roles r on r.user_id = p.id and r.role = 'tutor' $$;

-- Tasks.
create table public.resources(id uuid primary key, kind public.resource_kind not null, subject public.subject,
  review_status text not null default 'approved', publish_at timestamptz);
create table public.homework_questions(id uuid primary key, resource_id uuid references public.resources, position int);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid,
  notes text, submitted_at timestamptz, unique (resource_id, student_id));
create table public.homework_answers(id uuid primary key default gen_random_uuid(), submission_id uuid references public.homework_submissions,
  question_id uuid, answer_text text, unique (submission_id, question_id));
create table public.homework_drafts(student_id uuid not null, resource_id uuid not null references public.resources on delete cascade,
  answers jsonb not null default '{}'::jsonb, notes text, stamps jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), primary key (student_id, resource_id));
create function public.stamp_homework_draft() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger stamp_homework_draft before insert or update on public.homework_drafts for each row execute function public.stamp_homework_draft();

alter table public.resources enable row level security;
create policy "resources read scoped" on public.resources for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::public.app_role))
  or ((subject)::text in (select unnest(private.my_content_subjects()))
      and (review_status = 'approved'
           or (review_status = 'to_review' and (publish_at is null or publish_at <= now()))
           or exists (select 1 from public.homework_submissions s where s.resource_id = resources.id))));
alter table public.homework_questions enable row level security;
create policy "hq read via resource" on public.homework_questions for select to authenticated using (
  private.has_role((select auth.uid()), 'tutor'::public.app_role)
  or exists (select 1 from public.resources r where r.id = homework_questions.resource_id
             and private.viewer_has_content_access((select auth.uid()))));
alter table public.homework_submissions enable row level security;
create policy "hs read scoped" on public.homework_submissions for select to authenticated using (
  (select auth.uid()) = student_id or private.has_role((select auth.uid()), 'tutor'::public.app_role));
alter table public.homework_answers enable row level security;
create policy "ha read via submission" on public.homework_answers for select to authenticated using (
  exists (select 1 from public.homework_submissions s where s.id = homework_answers.submission_id and s.student_id = (select auth.uid())));
alter table public.homework_drafts enable row level security;
create policy "hd own" on public.homework_drafts for all
  using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);

-- Chat.
create table public.chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid references public.profiles(id) on delete set null,
  subject public.subject, spec_point_id uuid, resource_id uuid, mcq_set_id uuid,
  subject_line text not null, status text not null default 'open' check (status in ('open','answered','closed')),
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now(),
  context_label text, about_student_id uuid references public.profiles(id));
create table public.chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null constraint chat_messages_body_check check (length(btrim(body)) > 0),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now());
alter table public.chat_threads enable row level security;
create policy "chat_threads read own or tutor" on public.chat_threads for select using (
  private.has_role((select auth.uid()), 'tutor'::public.app_role)
  or ((student_id = (select auth.uid())) and ((about_student_id is null) or exists (select 1 from public.parent_student_links l
      where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))));
create policy "chat_threads member creates own" on public.chat_threads for insert to authenticated with check (
  (student_id = (select auth.uid()))
  and ((tutor_id is null) or (tutor_id in (select d.id from public.tutor_directory() d(id, display_name))))
  and case when exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'parent'::public.profile_role)
      then ((about_student_id is not null) and exists (select 1 from public.parent_student_links l
            where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))
      else (about_student_id is null) end);
create policy "chat_threads tutors update" on public.chat_threads for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::public.app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::public.app_role));
alter table public.chat_messages enable row level security;
create policy "chat_messages read participants" on public.chat_messages for select using (
  exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id
          and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::public.app_role))));
create policy "chat_messages send as self" on public.chat_messages for insert with check (
  (sender_id = (select auth.uid())) and exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id
   and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::public.app_role))));

-- The live fan-out: bumps the thread to the message's own time.
create function public.on_chat_message_insert() returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp' as $$
declare v_thread public.chat_threads%rowtype; v_from_student boolean;
begin
  select * into v_thread from public.chat_threads where id = new.thread_id;
  if not found then return new; end if;
  v_from_student := (new.sender_id = v_thread.student_id);
  update public.chat_threads
     set last_message_at = new.created_at,
         status = case when v_from_student then 'open' else 'answered' end,
         student_last_read_at = case when v_from_student then new.created_at else student_last_read_at end,
         tutor_last_read_at = case when v_from_student then tutor_last_read_at else new.created_at end
   where id = new.thread_id;
  return new;
end $$;
create trigger chat_message_fanout after insert on public.chat_messages for each row execute function public.on_chat_message_insert();

-- Weekly check-ins.
create table public.student_weekly_checkins(id uuid primary key default gen_random_uuid(), plan_id uuid unique,
  student_id uuid, reflection text, covered_ok boolean);
alter table public.student_weekly_checkins enable row level security;
create policy "wc own" on public.student_weekly_checkins for all to authenticated
  using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);

alter table public.profiles enable row level security;
create policy "profiles self read" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles tutor read" on public.profiles for select to authenticated using (private.has_role((select auth.uid()), 'tutor'::public.app_role));
create policy "profiles self update" on public.profiles for update to authenticated using ((select auth.uid()) = id);

-- Grants as production has them: everything in public to the API roles
-- (Supabase's defaults), except profiles, whose updates are column by column.
grant usage on schema public, auth to authenticated, anon;
grant all on all tables in schema public to authenticated, anon, service_role;
grant usage, select on all sequences in schema public to authenticated, anon;
revoke update on public.profiles from authenticated, anon;
grant update (display_name, phone, school) on public.profiles to authenticated;

insert into public.user_roles values ('${tutor}', 'tutor'), ('${student}', 'student'), ('${otherStudent}', 'student');
insert into public.profiles(id, display_name, role) values
  ('${student}', 'Bea', 'student'), ('${parent}', 'Mum', 'parent'), ('${tutor}', 'Ms T', 'tutor'),
  ('${freeAccount}', 'Free', 'student'), ('${otherStudent}', 'Al', 'student');
insert into public.parent_student_links(parent_id, student_id) values ('${parent}', '${student}');
insert into private.paid values ('${student}', 'chemistry'), ('${otherStudent}', 'chemistry');
insert into public.resources values ('${sheet}', 'homework', 'chemistry', 'approved', null),
  ('${lockedSheet}', 'homework', 'biology', 'approved', null), ('${video}', 'video', 'chemistry', 'approved', null);
insert into public.homework_questions values ('${q1}', '${sheet}', 1), ('${q2}', '${sheet}', 2), ('${lockedQ}', '${lockedSheet}', 1);
insert into public.student_weekly_checkins(plan_id, student_id) values ('${plan}', '${student}');
`);

// The draft sync as it is live (this migration leaves it alone).
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001202000_homework_draft_merge.sql", import.meta.url),
    "utf8",
  ),
);

const migration = await readFile(
  new URL("../supabase/migrations/20261028110000_size_and_flood_limits.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent
await db.exec(
  "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()",
);

// ── Helpers ────────────────────────────────────────────────────────────────
/** Runs one statement as a signed-in user, through the API role. */
async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("set role authenticated");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
async function refused(p: Promise<unknown>, pattern: RegExp, what: string) {
  await assert.rejects(p, pattern, what);
}
const x = (n: number) => "x".repeat(n);
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: number }>(sql, params)).rows[0].n);

// What ChatDAL.startThread and ChatDAL.sendMessage send, column for column.
const startThread = (
  user: string,
  subjectLine = "Osmosis",
  about: string | null = null,
  label: string | null = null,
) =>
  as<{ id: string }>(
    user,
    `insert into public.chat_threads(student_id, tutor_id, subject_line, subject, spec_point_id, resource_id,
       mcq_set_id, context_label, about_student_id)
     values (auth.uid(), $1, $2, null, null, null, null, $3, $4) returning id`,
    [about ? tutor : null, subjectLine, label, about],
  ).then((r) => r[0].id);
const send = (user: string, thread: string, body: string, aiDrafted = false) =>
  as(
    user,
    "insert into public.chat_messages(thread_id, sender_id, body, ai_drafted) values ($1, auth.uid(), $2, $3)",
    [thread, body, aiDrafted],
  );

// ── 1. Task answers ──────────────────────────────────────────────────────────
// A refusal says why in a student's words, before anything is written.
await refused(
  as(student, "select public.submit_homework_answers($1, $2)", [
    sheet,
    JSON.stringify([{ question_id: q1, answer_text: x(5001) }]),
  ]),
  /One of your answers is too long\. Each answer can be up to 5,000 characters\./,
  "A 5,001-character answer was handed in",
);
assert.equal(
  await count("select count(*)::int n from public.homework_submissions"),
  0,
  "A refused hand-in left a row",
);

// Spaces round an answer don't count towards it, and 5,000 is allowed.
const [{ submit_homework_answers: submissionId }] = await as<{ submit_homework_answers: string }>(
  student,
  "select public.submit_homework_answers($1, $2)",
  [
    sheet,
    JSON.stringify([
      { question_id: q1, answer_text: `  ${x(5000)}  ` },
      // Only zero-width spaces, a BOM and a direction mark: nothing to read (T-11).
      { question_id: q2, answer_text: "\u200b\u200b\ufeff\u200f \n\u00a0\u3000" },
    ]),
  ],
);
const stored = await db.query<{ question_id: string; answer_text: string | null }>(
  "select question_id, answer_text from public.homework_answers where submission_id = $1",
  [submissionId],
);
const byQuestion = new Map(stored.rows.map((r) => [r.question_id, r.answer_text]));
assert.equal(byQuestion.get(q1)?.length, 5000, "A 5,000-character answer wasn't stored whole");
assert.equal(byQuestion.get(q2), null, "An answer of invisible characters wasn't stored as blank");

// A word with a zero-width space inside it is still an answer.
await db.exec(`delete from public.homework_answers; delete from public.homework_submissions;`);
await as(student, "select public.submit_homework_answers($1, $2)", [
  sheet,
  JSON.stringify([{ question_id: q1, answer_text: "H\u200bO" }]),
]);
assert.equal(
  await count("select count(*)::int n from public.homework_answers where answer_text = $1", [
    "H\u200bO",
  ]),
  1,
  "A real answer containing an invisible character was blanked",
);

// The table refuses an over-long answer and note on its own, whoever writes them.
await refused(
  db.query(
    "insert into public.homework_answers(submission_id, question_id, answer_text) select id, $1, $2 from public.homework_submissions",
    [q2, x(5001)],
  ),
  /homework_answers_answer_text_length/,
  "homework_answers took a 5,001-character answer",
);
await refused(
  db.query("update public.homework_submissions set notes = $1", [x(2001)]),
  /homework_submissions_notes_length/,
  "homework_submissions took a 2,001-character note",
);
await db.exec(`delete from public.homework_answers; delete from public.homework_submissions;`);

// ── 2. Drafts ────────────────────────────────────────────────────────────────
const sync = (user: string, resource: string, answers: Record<string, string>, notes?: string) => {
  const stamps: Record<string, number> = Object.fromEntries(
    Object.keys(answers).map((k) => [k, Date.now()]),
  );
  if (notes !== undefined) stamps.notes = Date.now();
  return as<{ r: { answers: Record<string, string> } | null }>(
    user,
    "select public.sync_homework_draft($1, $2, $3, $4, $5) as r",
    [resource, JSON.stringify(answers), notes ?? null, JSON.stringify(stamps), Date.now()],
  ).then((rows) => rows[0].r);
};

// A real draft saves, a full-length answer whole.
const draft = await sync(student, sheet, { [q1]: x(5000), [q2]: "Water" });
assert.deepEqual(Object.keys(draft!.answers).sort(), [q1, q2].sort());
assert.equal(draft!.answers[q1].length, 5000);

// Over the limit is refused.
await refused(
  sync(student, sheet, { [q1]: x(5001) }),
  /homework_drafts_answers_fit/,
  "A 5,001-character draft answer was kept",
);
await refused(
  sync(student, sheet, {}, x(2001)),
  /homework_drafts_notes_length/,
  "A 2,001-character draft note was kept",
);

// A task the student can't open gets no draft: through the call (which the
// page treats as "no server copy" and carries on)...
await refused(
  sync(student, lockedSheet, { [lockedQ]: "hi" }),
  /row-level security/,
  "A draft was saved on an unpaid task",
);
await refused(
  sync(freeAccount, sheet, { [q1]: "hi" }),
  /row-level security/,
  "A free account saved a draft",
);
assert.equal(
  await count("select count(*)::int n from public.homework_drafts"),
  1,
  "Only the real draft should exist",
);

// ...or written straight into the table.
const writeDraft = (user: string, resource: string, answers: Record<string, unknown>) =>
  as(
    user,
    "insert into public.homework_drafts(student_id, resource_id, answers) values (auth.uid(), $1, $2)",
    [resource, JSON.stringify(answers)],
  );
await refused(
  writeDraft(student, lockedSheet, {}),
  /row-level security/,
  "A draft row was written for an unpaid task",
);
await refused(
  writeDraft(student, video, {}),
  /row-level security/,
  "A draft row was written for a video",
);
await refused(
  writeDraft(freeAccount, sheet, {}),
  /row-level security/,
  "A free account wrote a draft row",
);
await refused(writeDraft(parent, sheet, {}), /row-level security/, "A parent wrote a draft row");
// A draft left from before (the subject since stopped) can't be grown either.
await db.query("insert into public.homework_drafts(student_id, resource_id) values ($1, $2)", [
  student,
  lockedSheet,
]);
const grown = await as(
  student,
  "update public.homework_drafts set notes = 'more' where resource_id = $1 returning 1",
  [lockedSheet],
);
assert.equal(grown.length, 0, "A draft on a task the student can't open was changed");
await db.query("delete from public.homework_drafts where resource_id = $1", [lockedSheet]);
// Straight in for an open task, the size rules still hold.
await refused(
  as(student, "update public.homework_drafts set answers = $1 where resource_id = $2", [
    JSON.stringify(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, "a"]))),
    sheet,
  ]),
  /homework_drafts_answers_fit/,
  "A draft held 51 answers",
);
await refused(
  as(student, "update public.homework_drafts set answers = $1 where resource_id = $2", [
    JSON.stringify({ [q1]: 42 }),
    sheet,
  ]),
  /homework_drafts_answers_fit/,
  "A draft held an answer that isn't text",
);
await refused(
  as(student, "update public.homework_drafts set stamps = $1 where resource_id = $2", [
    JSON.stringify({ junk: x(10001) }),
    sheet,
  ]),
  /homework_drafts_stamps_size/,
  "A draft held 10 kB of edit times",
);
const fifty = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, x(10)]));
await as(
  student,
  "update public.homework_drafts set answers = $1, stamps = $2 where resource_id = $3",
  [
    JSON.stringify(fifty),
    JSON.stringify(Object.fromEntries(Object.keys(fifty).map((k) => [k, Date.now()]))),
    sheet,
  ],
);

// Handing in still clears the draft.
await as(student, "select public.submit_homework_answers($1, $2)", [
  sheet,
  JSON.stringify([{ question_id: q1, answer_text: "Done" }]),
]);
assert.equal(
  await count("select count(*)::int n from public.homework_drafts"),
  0,
  "Hand-in left the draft behind",
);

// ── 3. Chat: who writes which columns ────────────────────────────────────────
// The app's own insert works for a student and a parent.
const studentThread = await startThread(student, "Osmosis", null, "AQA 4.1.3.2 Osmosis");
const parentThread = await startThread(parent, "How is Bea getting on?", student);
await send(student, studentThread, "What is osmosis?");
await send(parent, parentThread, "Hello");

// The server's own columns can't be written by the app.
for (const col of [
  "created_at",
  "last_message_at",
  "status",
  "student_last_read_at",
  "tutor_last_read_at",
  "id",
]) {
  const value = col === "status" ? "'closed'" : col === "id" ? "gen_random_uuid()" : "'2099-01-01'";
  await refused(
    as(
      student,
      `insert into public.chat_threads(student_id, subject_line, ${col}) values (auth.uid(), 'Hi', ${value})`,
    ),
    /permission denied/,
    `A student set chat_threads.${col}`,
  );
}
for (const col of ["created_at", "id"]) {
  const value = col === "id" ? "gen_random_uuid()" : "'2099-01-01'";
  await refused(
    as(
      student,
      `insert into public.chat_messages(thread_id, sender_id, body, ${col}) values ($1, auth.uid(), 'Hi', ${value})`,
      [studentThread],
    ),
    /permission denied/,
    `A student set chat_messages.${col}`,
  );
}

// So the thread's times are the server's.
const t = await db.query<{ ok: boolean; status: string }>(
  `select (t.last_message_at = m.created_at and m.created_at <= now() and t.created_at <= now()) as ok, t.status
     from public.chat_threads t join public.chat_messages m on m.thread_id = t.id where t.id = $1`,
  [studentThread],
);
assert.equal(t.rows[0].ok, true, "A thread's times weren't the server's");
assert.equal(t.rows[0].status, "open");

// Only a tutor's message keeps the AI-drafted mark.
await send(student, studentThread, "Is it diffusion?", true);
await send(tutor, studentThread, "Water across a membrane.", true);
const marks = await db.query<{ sender_id: string; ai_drafted: boolean }>(
  "select sender_id, ai_drafted from public.chat_messages where thread_id = $1 and body <> 'What is osmosis?'",
  [studentThread],
);
assert.deepEqual(
  Object.fromEntries(marks.rows.map((r) => [r.sender_id, r.ai_drafted])),
  { [student]: false, [tutor]: true },
  "The AI-drafted mark followed the wrong sender",
);

// ── 4. Chat: lengths ─────────────────────────────────────────────────────────
await refused(
  send(student, studentThread, x(4001)),
  /chat_messages_body_length/,
  "A 4,001-character message was sent",
);
await send(student, studentThread, x(4000));
await refused(
  startThread(student, x(201)),
  /chat_threads_subject_line_length/,
  "A 201-character subject was kept",
);
await refused(
  startThread(student, "Hi", null, x(301)),
  /chat_threads_context_label_length/,
  "A 301-character label was kept",
);

// ── 5. Chat: flood limits ────────────────────────────────────────────────────
// 30 messages an hour. The student has sent 3 that counted (the refused one
// rolled back with its claim), so 27 more go through and the next is refused.
assert.equal(
  await count(
    "select count(*)::int n from public.ai_request_log where user_id = $1 and endpoint = 'chat_message'",
    [student],
  ),
  3,
  "A refused message still used up the allowance",
);
for (let i = 0; i < 27; i++) await send(student, studentThread, `Message ${i}`);
await refused(
  send(student, studentThread, "One more"),
  /You've sent a lot of messages in the last hour\. Wait a little, then send this one again\./,
  "A 31st message in an hour went through",
);
// Someone else's allowance is their own, and tutors have none.
await send(parent, parentThread, "Another");
for (let i = 0; i < 35; i++) await send(tutor, studentThread, `Reply ${i}`);

// 10 new conversations a day. The student has started 1 that counted; the
// refused ones above rolled back.
for (let i = 0; i < 9; i++) await startThread(student, `Question ${i}`);
const before = await count(
  "select count(*)::int n from public.chat_threads where student_id = $1",
  [student],
);
await refused(
  startThread(student, "Question 11"),
  /You've started a lot of conversations today\. Add to one you already have, or start a new one tomorrow\./,
  "An 11th conversation in a day was started",
);
assert.equal(
  await count("select count(*)::int n from public.chat_threads where student_id = $1", [student]),
  before,
  "A refused conversation was kept",
);

// A day later the allowance is back.
await db.exec("update public.ai_request_log set created_at = created_at - interval '25 hours'");
await startThread(student, "Next day");
await send(student, studentThread, "Back again");

// ── 6. Profiles and check-ins ────────────────────────────────────────────────
const update = (col: string, value: string) =>
  as(student, `update public.profiles set ${col} = $1 where id = auth.uid()`, [value]);
await update("display_name", x(80));
await update("phone", "+44 (0) 7700 900 123 456 78");
await update("school", x(120));
await refused(
  update("display_name", x(81)),
  /profiles_display_name_length/,
  "An 81-character name was kept",
);
await refused(update("phone", x(33)), /profiles_phone_length/, "A 33-character phone was kept");
await refused(
  update("school", x(121)),
  /profiles_school_length/,
  "A 121-character school was kept",
);

await as(student, "update public.student_weekly_checkins set reflection = $1 where plan_id = $2", [
  x(2000),
  plan,
]);
await refused(
  as(student, "update public.student_weekly_checkins set reflection = $1 where plan_id = $2", [
    x(2001),
    plan,
  ]),
  /student_weekly_checkins_reflection_length/,
  "A 2,001-character check-in note was kept",
);

// A sign-up whose name is too long is clipped, never refused.
const longName = "Bartholomew ".repeat(20).trim();
await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
  uuid(40),
  "long@example.com",
  JSON.stringify({ full_name: longName, phone: x(50) }),
]);
const made = await db.query<{ display_name: string; phone: string }>(
  "select display_name, phone from public.profiles where id = $1",
  [uuid(40)],
);
assert.equal(
  made.rows[0].display_name,
  longName.slice(0, 80),
  "A long sign-up name wasn't clipped to 80",
);
assert.equal(made.rows[0].phone, x(32), "A long sign-up phone wasn't clipped to 32");
await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
  uuid(41),
  "jamie@example.com",
  JSON.stringify({ display_name: "Jamie Doe" }),
]);
assert.equal(
  (
    await db.query<{ display_name: string }>(
      "select display_name from public.profiles where id = $1",
      [uuid(41)],
    )
  ).rows[0].display_name,
  "Jamie Doe",
);

// ── 7. Grants ────────────────────────────────────────────────────────────────
const can = async (fn: string, role: string) =>
  (
    await db.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'EXECUTE') as ok", [
      role,
      fn,
    ])
  ).rows[0].ok;
assert.equal(await can("private.homework_draft_answers_fit(jsonb)", "authenticated"), true);
assert.equal(await can("private.homework_draft_answers_fit(jsonb)", "anon"), false);
assert.equal(await can("private.chat_message_flood_guard()", "authenticated"), false);
assert.equal(await can("private.chat_thread_flood_guard()", "authenticated"), false);

// ── 8. The rollback undoes it ────────────────────────────────────────────────
await db.exec(
  await readFile(
    new URL("../supabase/rollbacks/20261028110000_size_and_flood_limits.down.sql", import.meta.url),
    "utf8",
  ),
);
const leftover = await db.query<{ conname: string }>(
  "select conname from pg_constraint where conname like any (array['%\\_length', 'homework_drafts_answers_fit', 'homework_drafts_stamps_size'])",
);
assert.deepEqual(leftover.rows, [], "The rollback left a check behind");
const leftoverFns = await db.query<{ proname: string }>(
  "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname in ('claim_chat_send', 'chat_thread_flood_guard', 'chat_message_flood_guard', 'homework_draft_answers_fit')",
);
assert.deepEqual(leftoverFns.rows, [], "The rollback left a function behind");
await as(student, "update public.profiles set display_name = $1 where id = auth.uid()", [x(81)]);
// Every chat column is the app's to write again, and nothing counts sends.
await as(
  student,
  "insert into public.chat_threads(student_id, subject_line, created_at) values (auth.uid(), 'Hi', now())",
);
const logged = await count("select count(*)::int n from public.ai_request_log");
await send(student, studentThread, "After the rollback");
assert.equal(await count("select count(*)::int n from public.ai_request_log"), logged);

console.log("size and flood limits: all checks passed");
