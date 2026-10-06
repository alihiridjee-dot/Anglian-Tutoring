/** Isolated PostgreSQL checks for chat_thread_summaries (M-25).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-thread-summaries-db.ts
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
const otherTutor = uuid(5);

// The chat tables and their row-level security as production has them on
// 3 October 2026 (pg_policies), with the insert rules left out: fixtures are
// written as the table owner.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table profiles(id uuid primary key, display_name text);
create table parent_student_links(parent_id uuid, student_id uuid);
create table chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  about_student_id uuid references profiles(id) on delete cascade,
  tutor_id uuid references profiles(id) on delete set null,
  subject_line text not null default 'Hi',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now());
create table chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now());

alter table chat_threads enable row level security;
create policy "chat_threads read own or tutor" on chat_threads for select
  using (private.has_role((select auth.uid()), 'tutor'::app_role) or ((student_id = (select auth.uid())) and ((about_student_id is null) or exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))));
alter table chat_messages enable row level security;
create policy "chat_messages read participants" on chat_messages for select to authenticated
  using (exists (select 1 from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));

grant usage on schema public, auth, private to authenticated, anon;
grant select on all tables in schema public to authenticated, anon;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261003090000_chat_thread_summaries.sql", import.meta.url),
    "utf8",
  ),
);
// Idempotent: a second run must not fail.
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261003090000_chat_thread_summaries.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures ──────────────────────────────────────────────────────────────
for (const [id, name] of [
  [child, "Bea"],
  [otherChild, "Al"],
  [tutor, "Ms T"],
  [parent, "Mum"],
  [otherTutor, "Mr U"],
])
  await db.query("insert into profiles values($1,$2)", [id, name]);
await db.query("insert into user_roles values($1,'tutor'),($2,'tutor')", [tutor, otherTutor]);
await db.query("insert into parent_student_links values($1,$2)", [parent, child]);

const thread = async (
  member: string,
  about: string | null,
  studentRead: string | null,
  tutorRead: string | null,
) =>
  (
    await db.query<{ id: string }>(
      "insert into chat_threads(student_id,about_student_id,tutor_id,student_last_read_at,tutor_last_read_at) values($1,$2,$3,$4,$5) returning id",
      [member, about, tutor, studentRead, tutorRead],
    )
  ).rows[0].id;
const say = (t: string, from: string | null, body: string, at: string) =>
  db.query("insert into chat_messages(thread_id,sender_id,body,created_at) values($1,$2,$3,$4)", [
    t,
    from,
    body,
    at,
  ]);

// A busy thread: 1,200 messages, more than PostgREST will ever return in one
// read. The student has read up to message 600; the tutor read everything up
// to the student's last question, then a different tutor replied twice.
const busy = await thread(child, null, "2026-01-01T10:00:00Z", "2026-01-01T19:59:00Z");
await db.exec("begin");
for (let i = 0; i < 1200; i++) {
  const at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(); // one a minute
  await say(busy, i % 2 === 0 ? child : tutor, `message ${i}`, at);
}
await db.exec("commit");
await say(busy, otherTutor, "Another tutor here", "2026-01-02T09:00:00Z");
await say(busy, otherTutor, "the newest line", "2026-01-02T09:01:00Z");

const parentThread = await thread(parent, child, null, null);
await say(parentThread, parent, "How is Bea doing?", "2026-01-03T09:00:00Z");
await say(parentThread, tutor, "Very well", "2026-01-03T10:00:00Z");

const otherThread = await thread(otherChild, null, null, null);
await say(otherThread, otherChild, "Al's question", "2026-01-04T09:00:00Z");

const all = [busy, parentThread, otherThread];
const summaries = async (who: string | null) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ?? ""]);
  await db.exec(who ? "set role authenticated" : "set role anon");
  try {
    const r = await db.query<{ thread_id: string; unread: number; last_message: string | null }>(
      "select * from public.chat_thread_summaries($1::uuid[])",
      [all],
    );
    return new Map(r.rows.map((row) => [row.thread_id, row]));
  } finally {
    await db.exec("reset role");
  }
};
// What the old client-side count would have said, for comparison.
const expectedUnread = async (t: string, viewer: string, watermark: string | null) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from chat_messages where thread_id=$1 and sender_id is distinct from $2 and ($3::timestamptz is null or created_at > $3)",
        [t, viewer, watermark],
      )
    ).rows[0].n,
  );

// ── The student ───────────────────────────────────────────────────────────
let s = await summaries(child);
assert.deepEqual([...s.keys()], [busy], "A student saw a thread that isn't theirs");
assert.equal(
  s.get(busy)!.unread,
  await expectedUnread(busy, child, "2026-01-01T10:00:00Z"),
  "The student's unread count is wrong",
);
assert(s.get(busy)!.unread > 300, "Unread messages past the first 1,000 were missed");
assert.equal(
  s.get(busy)!.last_message,
  "the newest line",
  "The last line is not the newest message",
);

// ── A tutor: every thread, counted on the tutors' side ────────────────────
s = await summaries(tutor);
assert.equal(s.size, 3, "A tutor didn't get every thread");
assert.equal(
  s.get(busy)!.unread,
  await expectedUnread(busy, tutor, "2026-01-01T19:59:00Z"),
  "The tutor's unread count is wrong",
);
assert.equal(s.get(otherThread)!.unread, 1, "An unanswered question wasn't counted for the tutor");
assert.equal(s.get(parentThread)!.unread, 1, "A parent's message wasn't counted for the tutor");

// ── A linked parent sees their own thread, on the member's side ───────────
s = await summaries(parent);
assert.deepEqual([...s.keys()], [parentThread], "A parent saw more than their own thread");
assert.equal(s.get(parentThread)!.unread, 1, "The tutor's reply wasn't unread for the parent");
assert.equal(s.get(parentThread)!.last_message, "Very well");

// ── An unlinked parent loses the thread; anonymous callers get nothing ────
await db.query("delete from parent_student_links");
s = await summaries(parent);
assert.equal(s.size, 0, "An unlinked parent still saw the thread");
await assert.rejects(() => summaries(null), "anon could call chat_thread_summaries");

// ── A reply from a deleted account still counts ───────────────────────────
await db.query("insert into parent_student_links values($1,$2)", [parent, child]);
await db.query("delete from profiles where id=$1", [otherTutor]);
s = await summaries(child);
assert.equal(s.get(busy)!.last_message, "the newest line", "A deleted sender's reply vanished");
assert.equal(
  s.get(busy)!.unread,
  await expectedUnread(busy, child, "2026-01-01T10:00:00Z"),
  "A deleted sender's reply stopped counting as unread",
);

console.log("chat_thread_summaries: all checks passed");
