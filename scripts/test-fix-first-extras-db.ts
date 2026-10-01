/** Isolated PostgreSQL regression checks for 20261001111430_fix_first_extras.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-fix-first-extras-db.ts
 *
 * Built as production stands after 20261001104228: the chat tables and
 * functions from the migrations that define them, 20260926083808 applied
 * whole, then the #1 and #2/#3 sections of 20261001104228 taken from its file.
 * Each gap is shown open on that state before this migration closes it. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const otherChild = uuid(2);
const tutor = uuid(3);
const parent = uuid(4);
const topic = uuid(50);
const [pointA, pointB] = [uuid(100), uuid(101)];

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");

/** One function definition, from its `create` line to the closing `$$;`. */
async function definition(path: string, marker: string) {
  const lines = (await file(path)).split("\n");
  const start = lines.findIndex((l) => l.includes(marker));
  assert.ok(start >= 0, `${marker} not found in ${path}`);
  const end = lines.findIndex((l, i) => i > start && /^\$\$;/.test(l));
  return lines.slice(start, end + 1).join("\n");
}

/** The part of a migration between two section headings. */
async function section(path: string, from: string, to: string) {
  const sql = await file(path);
  const start = sql.indexOf(from);
  const end = sql.indexOf(to);
  assert.ok(start >= 0 && end > start, `sections ${from} … ${to} not found in ${path}`);
  return sql.slice(start, end);
}

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema extensions;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function extensions.gen_random_bytes(int) returns bytea language sql volatile as $$
  select decode(md5(random()::text) || md5(random()::text), 'hex') $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.profile_role as enum ('student','parent','tutor');
create type public.subject as enum ('biology','chemistry','physics');
create type public.level as enum ('gcse');
create type public.board as enum ('aqa');
create type public.resource_origin as enum ('tutor','generated');
create table public.user_roles(user_id uuid, role public.app_role);
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
create table public.profiles(
  id uuid primary key, display_name text, role public.profile_role not null default 'student',
  student_invite_code text unique);
create table public.parent_student_links(
  id uuid primary key default gen_random_uuid(), parent_id uuid not null, student_id uuid not null,
  unique (parent_id, student_id));
alter table public.parent_student_links enable row level security;
create policy "psl parent reads own" on public.parent_student_links for select
  using (auth.uid() = parent_id or auth.uid() = student_id or private.has_role(auth.uid(), 'tutor'::public.app_role));
create table public.notifications(
  id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  link text, created_at timestamptz default now());

-- Library tables, as the July scaffold left resources.created_by.
create table public.topics(id uuid primary key, subject public.subject not null);
create table public.spec_points(
  id uuid primary key, topic_id uuid not null references public.topics, code text, title text);
create table public.resources(
  id uuid primary key default gen_random_uuid(), kind text not null, title text,
  subject public.subject, board public.board, level public.level,
  spec_point_id uuid references public.spec_points,
  created_by uuid not null references auth.users(id) on delete cascade,
  origin public.resource_origin not null default 'tutor',
  review_status text not null default 'approved', publish_at timestamptz);
create unique index on public.resources (spec_point_id)
  where kind = 'homework' and spec_point_id is not null;
create table public.resource_spec_points(
  resource_id uuid references public.resources on delete cascade, spec_point_id uuid,
  primary key (resource_id, spec_point_id));
create table public.homework_questions(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources on delete cascade,
  position int, prompt text, marks int, answer_type text, mark_scheme text, spec_point_id uuid,
  unique (resource_id, position));
create table public.mcq_sets(
  id uuid primary key default gen_random_uuid(), spec_point_id uuid, title text,
  description text, published boolean, subject public.subject,
  created_by uuid not null, origin public.resource_origin not null default 'tutor');
create unique index on public.mcq_sets (spec_point_id)
  where origin = 'generated' and spec_point_id is not null;
create table public.mcq_questions(
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.mcq_sets on delete cascade,
  position int, question text, options jsonb, correct_index int, explanation text,
  spec_point_id uuid);

-- Chat, with the policies of 20260803231626.
create table public.chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  tutor_id uuid references public.profiles(id) on delete set null,
  subject public.subject, spec_point_id uuid, resource_id uuid, mcq_set_id uuid,
  subject_line text not null, status text not null default 'open',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now(),
  context_label text);
create table public.chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now());
alter table public.chat_threads enable row level security;
create policy "chat_threads read own or tutor" on public.chat_threads for select
  using (student_id = (select auth.uid()) or private.has_role((select auth.uid()), 'tutor'::public.app_role));
create policy "chat_threads student creates own" on public.chat_threads for insert
  with check (student_id = (select auth.uid()));
create policy "chat_threads participants update" on public.chat_threads for update
  using (student_id = (select auth.uid()) or private.has_role((select auth.uid()), 'tutor'::public.app_role))
  with check (student_id = (select auth.uid()) or private.has_role((select auth.uid()), 'tutor'::public.app_role));
alter table public.chat_messages enable row level security;
create policy "chat_messages read participants" on public.chat_messages for select
  using (exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id
    and (t.student_id = (select auth.uid()) or private.has_role((select auth.uid()), 'tutor'::public.app_role))));
create policy "chat_messages send as self" on public.chat_messages for insert
  with check (sender_id = (select auth.uid()) and exists (select 1 from public.chat_threads t
    where t.id = chat_messages.thread_id
      and (t.student_id = (select auth.uid()) or private.has_role((select auth.uid()), 'tutor'::public.app_role))));
create function public.on_chat_message_insert() returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp' as $$ begin return new; end $$;
create trigger chat_message_fanout after insert on public.chat_messages
  for each row execute function public.on_chat_message_insert();
`);

for (const [path, marker] of [
  [
    "migrations/20260716000000_parent_linking_and_profile_settings.sql",
    "create or replace function public.gen_student_invite_code(",
  ],
  [
    "migrations/20260716000000_parent_linking_and_profile_settings.sql",
    "create or replace function public.unlink_parent(",
  ],
  [
    "migrations/20260803231700_chat_directory_and_read_state.sql",
    "create or replace function public.tutor_directory(",
  ],
  [
    "migrations/20260803231700_chat_directory_and_read_state.sql",
    "create or replace function public.mark_chat_thread_read(",
  ],
  [
    "migrations/20260803231700_chat_directory_and_read_state.sql",
    "create or replace function public.chat_unread_count(",
  ],
  [
    "migrations/20260916120000_delete_chat_thread.sql",
    "create or replace function public.delete_chat_thread(",
  ],
  [
    "migrations/20260921221948_homework_review_gate.sql",
    "create function public.ensure_generated_homework(",
  ],
  [
    "migrations/20260916140000_shared_mcq_sets.sql",
    "create or replace function public.ensure_generated_mcq_set(",
  ],
]) {
  await db.exec(await definition(path, marker));
}
await db.exec(`
revoke all on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) from public, anon, authenticated;
grant execute on function public.ensure_generated_homework(
  uuid, text, public.subject, public.level, jsonb, uuid, public.board, timestamptz
) to service_role;
revoke all on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.ensure_generated_mcq_set(uuid, jsonb, uuid) to service_role;
`);
await db.exec(await file("migrations/20260926083808_parent_tutor_messages.sql"));
const accessRules = "migrations/20261001104228_fix_first_access_rules.sql";
await db.exec(await section(accessRules, "-- ── #1 ", "-- ── #7 "));

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.exec(`
insert into auth.users values ('${child}'), ('${otherChild}'), ('${tutor}'), ('${parent}');
insert into public.user_roles values ('${tutor}', 'tutor');
insert into public.profiles values
  ('${child}', 'Bea', 'student', 'ANG-OLDCODE1'), ('${otherChild}', 'Al', 'student', 'ANG-OLDCODE2'),
  ('${tutor}', 'Ms T', 'tutor', null), ('${parent}', 'Mum', 'parent', null);
insert into public.parent_student_links(parent_id, student_id) values ('${parent}', '${child}');
insert into public.topics values ('${topic}', 'biology');
insert into public.spec_points values
  ('${pointA}', '${topic}', '1.1', 'Cells'), ('${pointB}', '${topic}', '1.2', 'Microscopy');
grant usage on schema public, auth, private to authenticated;
grant all on all tables in schema public to authenticated;
`);

async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`,
  );
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
async function asServer<T>(sql: string, params: unknown[]) {
  await db.exec("set role service_role");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const sheet = JSON.stringify([
  { prompt: "Name it", marks: 1, answer_type: "short", mark_scheme: "Nucleus" },
]);
const quiz = JSON.stringify([
  { question: "Which?", options: ["a", "b", "c", "d"], correct_index: 0, explanation: "Because" },
]);
const writeSheet = (point: string, by: string | null) =>
  asServer<{ id: string }>(
    "select public.ensure_generated_homework($1, 'Sheet', 'biology', 'gcse', $2::jsonb, $3, 'aqa') as id",
    [point, sheet, by],
  ).then((r) => r[0].id);
const writeQuiz = (point: string, by: string | null) =>
  asServer<{ id: string }>("select public.ensure_generated_mcq_set($1, $2::jsonb, $3) as id", [
    point,
    quiz,
    by,
  ]).then((r) => r[0].id);
const ownerOf = async (table: "resources" | "mcq_sets", id: string) =>
  (
    await db.query<{ created_by: string | null }>(
      `select created_by from public.${table} where id = $1`,
      [id],
    )
  ).rows[0].created_by;
const openThread = (member: string, about: string | null) =>
  as<{ id: string }>(
    member,
    "insert into public.chat_threads(student_id, tutor_id, subject_line, about_student_id) values (auth.uid(), $1, 'Hi', $2) returning id",
    [tutor, about],
  ).then((r) => r[0].id);
const send = (sender: string, thread: string, body: string) =>
  as(
    sender,
    "insert into public.chat_messages(thread_id, sender_id, body) values ($1, auth.uid(), $2)",
    [thread, body],
  );
const unread = async (user: string) =>
  (await as<{ n: number }>(user, "select public.chat_unread_count() as n"))[0].n;
const pinned = async (thread: string) =>
  (
    await db.query<{ p: boolean }>(
      "select last_message_at > now() + interval '1 year' as p from public.chat_threads where id = $1",
      [thread],
    )
  ).rows[0].p;

// ── The state 20261001104228 leaves ───────────────────────────────────────
const oldSheet = await writeSheet(pointA, child);
const oldQuiz = await writeQuiz(pointA, child);
assert.equal(await ownerOf("resources", oldSheet), child, "library rows record the student");

const question = await openThread(child, null);
await as(child, "update public.chat_threads set last_message_at = '2099-01-01' where id = $1", [
  question,
]);
assert.equal(await pinned(question), true, "a member can pin their own thread");

const parentThread = await openThread(parent, child);
await send(parent, parentThread, "How is Bea doing?");
await send(tutor, parentThread, "Bea is doing well.");
const linkId = (
  await db.query<{ id: string }>(
    "select id from public.parent_student_links where parent_id = $1",
    [parent],
  )
).rows[0].id;
await as(child, "select public.unlink_parent($1)", [linkId]);
await send(tutor, parentThread, "Bea scored 42% on her mock.");
assert.deepEqual(
  await as(parent, "select id from public.chat_threads"),
  [],
  "hidden from the parent",
);
assert.equal(await unread(parent), 2, "yet counted in their unread badge");
await db.exec("begin");
await as(parent, "select public.delete_chat_thread($1)", [parentThread]);
assert.equal(
  (await db.query("select id from public.chat_threads where id = $1", [parentThread])).rows.length,
  0,
  "and deletable by them, history and all",
);
await db.exec("rollback");

// ── This migration, twice ─────────────────────────────────────────────────
const up = await file("migrations/20261001111430_fix_first_extras.sql");
await db.exec(up);
await db.exec(up);

// Library rows belong to nobody; a tutor's own rows keep their author.
assert.equal(await ownerOf("resources", oldSheet), null);
assert.equal(await ownerOf("mcq_sets", oldQuiz), null);
assert.equal(await ownerOf("resources", await writeSheet(pointB, child)), null);
assert.equal(await ownerOf("mcq_sets", await writeQuiz(pointB, null)), null);
const tutorBrief = (
  await db.query<{ id: string }>(
    "insert into public.resources(kind, title, subject, created_by) values ('homework', 'Brief', 'biology', $1) returning id",
    [tutor],
  )
).rows[0].id;
assert.equal(await ownerOf("resources", tutorBrief), tutor);
await assert.rejects(
  as(child, "select public.ensure_generated_homework($1, 'x', 'biology', 'gcse', $2::jsonb)", [
    pointB,
    sheet,
  ]),
  /permission denied/,
);

// Only tutors update a thread; members still mark read through the RPC.
await db.query("update public.chat_threads set last_message_at = now() where id = $1", [question]);
await as(
  child,
  "update public.chat_threads set last_message_at = '2099-01-01', tutor_last_read_at = '2099-01-01' where id = $1",
  [question],
);
assert.equal(await pinned(question), false, "a member still pinned their thread");
await as(tutor, "update public.chat_threads set status = 'closed' where id = $1", [question]);
await send(tutor, question, "Answer.");
assert.equal(await unread(child), 1);
await as(child, "select public.mark_chat_thread_read($1)", [question]);
assert.equal(await unread(child), 0);

// The unlinked parent: no badge, no delete, no marking read; tutors keep the thread.
assert.equal(await unread(parent), 0);
await assert.rejects(
  as(parent, "select public.delete_chat_thread($1)", [parentThread]),
  /only delete your own/,
);
await as(parent, "select public.mark_chat_thread_read($1)", [parentThread]);
const watermark = await db.query<{ t: string | null }>(
  "select student_last_read_at as t from public.chat_threads where id = $1",
  [parentThread],
);
assert.equal(
  (await as(tutor, "select id from public.chat_messages where thread_id = $1", [parentThread]))
    .length,
  3,
);

// Linked again: the count, the delete and the thread itself come back.
await db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
  parent,
  child,
]);
assert.ok((await unread(parent)) > 0);
await as(parent, "select public.mark_chat_thread_read($1)", [parentThread]);
const after = await db.query<{ t: string | null }>(
  "select student_last_read_at as t from public.chat_threads where id = $1",
  [parentThread],
);
assert.notDeepEqual(after.rows, watermark.rows, "a linked parent's read was not recorded");
await as(parent, "select public.delete_chat_thread($1)", [parentThread]);
assert.equal(
  (await db.query("select id from public.chat_threads where id = $1", [parentThread])).rows.length,
  0,
);

// ── The rollback ──────────────────────────────────────────────────────────
await db.exec(await file("rollbacks/20261001111430_fix_first_extras.down.sql"));
const policies = (
  await db.query<{ policyname: string }>(
    "select policyname from pg_policies where tablename = 'chat_threads' and cmd = 'UPDATE'",
  )
).rows.map((r) => r.policyname);
assert.deepEqual(policies, ["chat_threads participants update"]);
await assert.rejects(writeSheet(uuid(102), null), /needs the user it was made for/);
await assert.rejects(writeQuiz(uuid(102), null), /needs the user it was made for/);

console.log("fix_first_extras migration: all checks passed");
