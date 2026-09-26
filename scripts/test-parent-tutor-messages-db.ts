/** Isolated PostgreSQL regression checks for the parent ↔ tutor messaging migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-parent-tutor-messages-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const otherChild = uuid(2);
const tutor = uuid(3);
const parent = uuid(4);

// The chat tables, policies and fan-out trigger as production defines them
// before this migration (from pg_policies and pg_get_functiondef).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create table user_roles(user_id uuid, role app_role);
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
create table profiles(id uuid primary key, display_name text, role profile_role not null default 'student');
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, link text, created_at timestamptz default now());

create table chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  tutor_id uuid references profiles(id) on delete set null,
  subject subject, spec_point_id uuid, resource_id uuid, mcq_set_id uuid,
  subject_line text not null, status text not null default 'open',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now(),
  context_label text);
create table chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) > 0),
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now());

alter table chat_threads enable row level security;
create policy "chat_threads read own or tutor" on chat_threads for select to authenticated
  using ((student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "chat_threads student creates own" on chat_threads for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy "chat_threads participants update" on chat_threads for update to authenticated
  using ((student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))
  with check ((student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role));
alter table chat_messages enable row level security;
create policy "chat_messages read participants" on chat_messages for select to authenticated
  using (exists (select 1 from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));
create policy "chat_messages send as self" on chat_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and exists (select 1 from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));

create function public.on_chat_message_insert() returns trigger language plpgsql security definer
set search_path to 'public', 'private', 'pg_temp' as $$ begin return new; end $$;
create trigger chat_message_fanout after insert on chat_messages for each row execute function on_chat_message_insert();
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260926083808_parent_tutor_messages.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into profiles values($1,'Bea','student')", [child]);
await db.query("insert into profiles values($1,'Al','student')", [otherChild]);
await db.query("insert into profiles values($1,'Ms T','tutor')", [tutor]);
await db.query("insert into profiles values($1,'Mum','parent')", [parent]);
await db.query("insert into parent_student_links(parent_id,student_id) values($1,$2)", [
  parent,
  child,
]);

await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant all on all tables in schema public to authenticated;
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const fails = async (q: () => Promise<unknown>, what: string) => {
  let threw = false;
  try {
    await q();
  } catch {
    threw = true;
  }
  assert(threw, what);
};
const open = (about: string | null) =>
  db.query<{ id: string }>(
    "insert into chat_threads(student_id,tutor_id,subject_line,about_student_id) values(auth.uid(),$1,'Hi',$2) returning id",
    [tutor, about],
  );
const send = (thread: string, body: string) =>
  db.query("insert into chat_messages(thread_id,sender_id,body) values($1,auth.uid(),$2)", [
    thread,
    body,
  ]);
const lastNotification = async (user: string) => {
  await db.exec("reset role");
  const r = await db.query<{ title: string; link: string }>(
    "select title, link from notifications where user_id=$1 order by created_at desc, id desc limit 1",
    [user],
  );
  await db.exec("set role authenticated");
  return r.rows[0];
};

// ── Who may open a thread ─────────────────────────────────────────────────
await as(child);
const studentThread = (await open(null)).rows[0].id;
await fails(() => open(otherChild), "A student opened a thread about another student");

await as(parent);
const parentThread = (await open(child)).rows[0].id;
await fails(() => open(otherChild), "A parent opened a thread about a child they aren't linked to");
await fails(() => open(null), "A parent opened a thread without naming a child");

// ── Who may read it ───────────────────────────────────────────────────────
await as(parent);
let seen = await db.query<{ id: string }>("select id from chat_threads");
assert.deepEqual(
  seen.rows.map((r) => r.id),
  [parentThread],
  "A parent saw more than their own thread",
);
await as(child);
seen = await db.query<{ id: string }>("select id from chat_threads");
assert.deepEqual(
  seen.rows.map((r) => r.id),
  [studentThread],
  "A child saw their parent's thread",
);
await as(tutor);
seen = await db.query<{ id: string }>("select id from chat_threads");
assert.equal(seen.rows.length, 2, "A tutor could not see both threads");

// ── Who may repoint it ────────────────────────────────────────────────────
await as(parent);
// Control: the same statement shape succeeds when it keeps the linked child,
// so the refusals below are the policy and not a broken query.
const kept = await db.query("update chat_threads set about_student_id=$1 where id=$2", [
  child,
  parentThread,
]);
assert.equal(kept.affectedRows, 1, "A parent could not update their own thread at all");
await fails(
  () =>
    db.query("update chat_threads set about_student_id=$1 where id=$2", [otherChild, parentThread]),
  "A parent repointed their thread at a child who isn't theirs",
);
await as(child);
await fails(
  () =>
    db.query("update chat_threads set about_student_id=$1 where id=$2", [
      otherChild,
      studentThread,
    ]),
  "A student attached a child to their own thread",
);

// ── Notifications ─────────────────────────────────────────────────────────
await as(parent);
await send(parentThread, "How is Bea getting on?");
let n = await lastNotification(tutor);
assert.equal(n.title, "Mum sent you a message", "Parent message was titled as a question");
assert.equal(n.link, "/messages", "Tutor's notification should open their inbox");

await as(tutor);
await send(parentThread, "Really well.");
n = await lastNotification(parent);
assert.equal(n.title, "Reply from Ms T");
assert.equal(n.link, "/parent-dashboard", "A parent's reply notification pointed at /messages");

await as(child);
await send(studentThread, "What is osmosis?");
n = await lastNotification(tutor);
assert.equal(n.title, "Bea sent you a question", "Student notification copy changed");
await as(tutor);
await send(studentThread, "Water moving across a membrane.");
n = await lastNotification(child);
assert.equal(n.link, "/messages", "A student's reply notification changed destination");

// ── Deleting the child takes the parent's threads about them ─────────────
await db.exec("reset role");
await db.query("delete from profiles where id=$1", [child]);
const left = await db.query("select 1 from chat_threads where id=$1", [parentThread]);
assert.equal(left.rows.length, 0, "A thread about a deleted child survived");

console.log("parent ↔ tutor messaging: all checks passed");
