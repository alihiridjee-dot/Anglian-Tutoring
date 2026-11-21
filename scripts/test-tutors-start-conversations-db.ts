/** Isolated PostgreSQL checks for 20261121160000_tutors_start_conversations.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-tutors-start-conversations-db.ts
 *
 * The rollback file holds the live definitions, so it runs first to show the
 * gap (a tutor cannot open a conversation), then the migration to show it
 * closed: a tutor opens one with a student or a linked parent and nobody else,
 * the first message rings as "Message from", the member's reply rings every
 * tutor, and a student's or parent's own thread works exactly as before.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sam = uuid(1); // a student
const kim = uuid(2); // another student
const ali = uuid(3); // a tutor
const nadia = uuid(4); // a tutor
const mum = uuid(5); // a parent, linked to sam
const exDad = uuid(6); // a parent, not linked to sam

// The chat tables, policies and triggers as production defines them
// (pg_policy, pg_get_functiondef, 21 Nov 2026). The fan-out comes from the
// rollback file, which is the live definition byte for byte.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'tutor'::public.app_role) then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create table profiles(id uuid primary key, display_name text, role profile_role not null default 'student');
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null,
  type text not null, title text not null, body text, link text,
  read_at timestamptz, created_at timestamptz not null default now(), chat_thread_id uuid);
create function public.tutor_directory() returns table(id uuid, display_name text) language sql stable security definer set search_path = public as $$
  select p.id, p.display_name from profiles p join user_roles r on r.user_id = p.id and r.role = 'tutor' $$;

create table chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  about_student_id uuid references profiles(id) on delete cascade,
  tutor_id uuid references profiles(id) on delete set null,
  subject_line text not null, status text not null default 'open',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now());
create table chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  body text not null, ai_drafted boolean not null default false,
  created_at timestamptz not null default clock_timestamp());

-- refuse_student_row_for_staff (20261003115242), reduced to what it refuses here.
create function private.refuse_staff() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from user_roles r where r.role = 'tutor' and r.user_id in (new.student_id, new.about_student_id)) then
    raise exception 'A tutor holds no student data.';
  end if;
  return new;
end $$;
create trigger student_row_not_staff before insert on chat_threads for each row execute function private.refuse_staff();

alter table chat_threads enable row level security;
create policy "chat_threads read own or tutor" on chat_threads for select
  using (private.has_role((select auth.uid()), 'tutor'::app_role) or ((student_id = (select auth.uid())) and ((about_student_id is null) or (exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id)))));
create policy "chat_threads member creates own" on chat_threads for insert to authenticated
  with check ((student_id = (select auth.uid())) and ((tutor_id is null) or (tutor_id in (select d.id from tutor_directory() d(id, display_name)))) and
    case when (exists (select 1 from profiles p where p.id = (select auth.uid()) and p.role = 'parent'::profile_role))
      then ((about_student_id is not null) and (exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id)))
      else (about_student_id is null) end);
create policy "chat_threads tutors update" on chat_threads for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
alter table chat_messages enable row level security;
create policy "chat_messages read participants" on chat_messages for select
  using (exists (select 1 from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));
create policy "chat_messages send as self" on chat_messages for insert
  with check ((sender_id = (select auth.uid())) and (exists (select 1 from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role)))));

alter table profiles enable row level security;
create policy "profiles read" on profiles for select using (true);
alter table parent_student_links enable row level security;
create policy "links read" on parent_student_links for select using (true);
grant usage on schema private, auth to authenticated;
grant select, insert, update on chat_threads, chat_messages to authenticated;
grant select on profiles, parent_student_links, user_roles to authenticated;

insert into profiles values
  ('${sam}','Sam','student'), ('${kim}','Kim','student'),
  ('${ali}','Ali','tutor'), ('${nadia}','Nadia','tutor'),
  ('${mum}','Mum','parent'), ('${exDad}','Dad','parent');
insert into user_roles values
  ('${sam}','student'), ('${kim}','student'), ('${ali}','tutor'), ('${nadia}','tutor'),
  ('${mum}','student'), ('${exDad}','student');
insert into parent_student_links(parent_id, student_id) values ('${mum}','${sam}');
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261121160000_tutors_start_conversations.sql", import.meta.url),
  "utf8",
);
const rollback = await readFile(
  new URL(
    "../supabase/rollbacks/20261121160000_tutors_start_conversations.down.sql",
    import.meta.url,
  ),
  "utf8",
);
// The rollback file creates the live fan-out; the trigger needs it first.
await db.exec(rollback);
await db.exec(
  "create trigger chat_message_fanout after insert on chat_messages for each row execute function on_chat_message_insert();",
);

/** Runs `fn` as the signed-in user `who`, under RLS. */
async function as<T>(who: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** Opens a thread as `who`; the new id, or the error's message. */
async function open(
  who: string,
  row: { member: string; about?: string | null; tutor?: string | null },
): Promise<{ id?: string; error?: string }> {
  return as(who, async () => {
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into chat_threads(student_id, about_student_id, tutor_id, subject_line)
         values ($1, $2, $3, 'Hello') returning id`,
        [row.member, row.about ?? null, row.tutor ?? null],
      );
      return { id: rows[0].id };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
}

async function say(who: string, thread: string, body: string) {
  await as(who, () =>
    db.query("insert into chat_messages(thread_id, sender_id, body) values ($1, $2, $3)", [
      thread,
      who,
      body,
    ]),
  );
}

/** Notifications for a thread, as "user|title|link", in the order they were made. */
async function bells(thread: string): Promise<string[]> {
  const { rows } = await db.query<{ k: string }>(
    `select user_id::text || '|' || title || '|' || link as k
       from notifications where chat_thread_id = $1 order by created_at, user_id`,
    [thread],
  );
  return rows.map((r) => r.k);
}

const refused = (r: { id?: string; error?: string }, why: RegExp) => {
  assert.equal(r.id, undefined, "should have been refused");
  assert.match(r.error ?? "", why);
};
const RLS = /row-level security/;

// ── Live, before: a tutor cannot open a conversation at all. ──
refused(await open(ali, { member: sam }), RLS);
refused(await open(ali, { member: mum, about: sam }), RLS);
// A student still can.
assert.ok((await open(sam, { member: sam })).id);

// ── The migration. ──
await db.exec(migration);

// A tutor opens a conversation with a student. The first message rings the
// student as "Message from Ali"; the student's reply rings every tutor; Ali's
// next message is a reply.
const withSam = await open(ali, { member: sam });
assert.ok(withSam.id, withSam.error);
await say(ali, withSam.id!, "How did the osmosis practical go?");
assert.deepEqual(await bells(withSam.id!), [`${sam}|Message from Ali|/messages`]);
{
  const { rows } = await db.query<{ status: string; tutor_last_read_at: string | null }>(
    "select status, tutor_last_read_at from chat_threads where id = $1",
    [withSam.id],
  );
  assert.equal(rows[0].status, "answered");
  assert.ok(rows[0].tutor_last_read_at, "the tutor's own message counts as read");
}
await say(sam, withSam.id!, "Good thanks");
assert.deepEqual((await bells(withSam.id!)).slice(1).sort(), [
  `${ali}|Sam sent you a question|/messages`,
  `${nadia}|Sam sent you a question|/messages`,
]);
await say(ali, withSam.id!, "Great");
assert.equal((await bells(withSam.id!)).at(-1), `${sam}|Reply from Ali|/messages`);
// Any tutor may reply, as on every thread.
await say(nadia, withSam.id!, "Well done");
assert.equal((await bells(withSam.id!)).at(-1), `${sam}|Reply from Nadia|/messages`);
// The student sees it in their own list.
{
  const { rows } = await as(sam, () =>
    db.query<{ id: string }>("select id from chat_threads where id = $1", [withSam.id]),
  );
  assert.equal(rows.length, 1);
}

// A tutor opens a conversation with a parent about their linked child. It
// rings the parent on the Parent Portal; the parent's reply rings every tutor.
const withMum = await open(nadia, { member: mum, about: sam });
assert.ok(withMum.id, withMum.error);
await say(nadia, withMum.id!, "Sam is doing well");
assert.deepEqual(await bells(withMum.id!), [`${mum}|Message from Nadia|/parent-dashboard`]);
await say(mum, withMum.id!, "Thank you");
assert.deepEqual((await bells(withMum.id!)).slice(1).sort(), [
  `${ali}|Mum sent you a message|/messages`,
  `${nadia}|Mum sent you a message|/messages`,
]);
{
  const { rows } = await as(mum, () =>
    db.query<{ id: string }>("select id from chat_threads where id = $1", [withMum.id]),
  );
  assert.equal(rows.length, 1, "the parent can read it");
}

// Refused: a thread naming a tutor (replies go to the team), a parent with no
// child named, a student named as if a parent, a parent about a child they
// are not linked to, and another tutor as the member.
refused(await open(ali, { member: sam, tutor: ali }), RLS);
refused(await open(ali, { member: mum }), RLS);
refused(await open(ali, { member: kim, about: sam }), RLS);
refused(await open(ali, { member: exDad, about: sam }), RLS);
refused(await open(ali, { member: mum, about: kim }), RLS);
refused(await open(ali, { member: nadia }), /row-level security|tutor holds no student data/);

// A student cannot open a thread for someone else, or on a parent's behalf.
refused(await open(sam, { member: kim }), RLS);
refused(await open(kim, { member: mum, about: sam }), RLS);

// A student's own question is unchanged: it rings every tutor, and the
// tutor's first message on it is a reply, not a new message.
const samAsks = await open(sam, { member: sam });
assert.ok(samAsks.id, samAsks.error);
await say(sam, samAsks.id!, "What is osmosis?");
await say(ali, samAsks.id!, "Water moving across a membrane");
assert.deepEqual(await bells(samAsks.id!), [
  `${ali}|Sam sent you a question|/messages`,
  `${nadia}|Sam sent you a question|/messages`,
  `${sam}|Reply from Ali|/messages`,
]);

// A parent's own thread to a named tutor is unchanged.
const mumAsks = await open(mum, { member: mum, about: sam, tutor: ali });
assert.ok(mumAsks.id, mumAsks.error);
await say(mum, mumAsks.id!, "How is Sam?");
await say(ali, mumAsks.id!, "Very well");
assert.deepEqual(await bells(mumAsks.id!), [
  `${ali}|Mum sent you a message|/messages`,
  `${mum}|Reply from Ali|/parent-dashboard`,
]);

// Once the parent is unlinked, a tutor can no longer open one with them, and
// a message on the old thread no longer rings them.
await db.exec(`delete from parent_student_links where parent_id = '${mum}'`);
refused(await open(ali, { member: mum, about: sam }), RLS);
await say(ali, withMum.id!, "Are you still there?");
assert.equal((await bells(withMum.id!)).length, 3);

// ── The rollback puts the live definitions back. ──
await db.exec(rollback);
refused(await open(ali, { member: sam }), RLS);
{
  const { rows } = await db.query<{ md5: string }>(
    "select md5(prosrc) from pg_proc where proname = 'on_chat_message_insert'",
  );
  assert.equal(rows[0].md5, "6c6a0d3ea67ac583f8a3218a1341467f", "live fan-out restored");
}

console.log("tutors-start-conversations: all checks passed");
