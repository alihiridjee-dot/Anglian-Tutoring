/** Isolated PostgreSQL checks for the chat retention fixes (M-26).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-retention-db.ts
 *
 * Pass --before to run the same checks against production's definitions
 * without the migration: every fix's check should then fail.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();
const before = process.argv.includes("--before");

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const tutor = uuid(2);
const otherTutor = uuid(3);
const leaver = uuid(4);

// The tables and the three functions as production has them on 3 October 2026
// (pg_get_functiondef, constraints from pg_constraint): the rollback restores
// exactly those bodies, so it doubles as the "before" fixture.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema cron;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table profiles(id uuid primary key, display_name text);
create table parent_student_links(parent_id uuid, student_id uuid);
create function private.chat_member_can_see(_member uuid, _about uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select _member = (select auth.uid()) and (_about is null or exists (select 1 from public.parent_student_links l where l.parent_id = _member and l.student_id = _about)) $$;
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, title text not null, body text, link text, submission_id uuid, read_at timestamptz, created_at timestamptz not null default now());
create table chat_threads(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  about_student_id uuid references profiles(id) on delete cascade,
  tutor_id uuid references profiles(id) on delete set null,
  subject_line text not null default 'Hi', status text not null default 'open',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), created_at timestamptz not null default now());
create table chat_messages(
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  sender_id uuid not null,
  body text not null,
  ai_drafted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chat_messages_sender_id_fkey foreign key (sender_id) references profiles(id) on delete cascade);
create function public.on_chat_message_insert() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger chat_message_fanout after insert on chat_messages for each row execute function on_chat_message_insert();
`);
const sql = (name: string) => readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");
// The rollback's bodies are production's live ones; its column steps are
// harmless on the fixture.
await db.exec(
  (await sql("rollbacks/20261003100000_chat_retention_gaps.down.sql")).replace(
    /drop index[\s\S]*$/,
    "",
  ),
);
if (!before) {
  await db.exec(await sql("migrations/20261003100000_chat_retention_gaps.sql"));
  await db.exec(await sql("migrations/20261003100000_chat_retention_gaps.sql")); // idempotent
}

for (const [id, name] of [
  [student, "Bea"],
  [tutor, "Ms T"],
  [otherTutor, "Mr U"],
  [leaver, "Mx L"],
])
  await db.query("insert into profiles values($1,$2)", [id, name]);
await db.query("insert into user_roles values($1,'tutor'),($2,'tutor'),($3,'tutor')", [
  tutor,
  otherTutor,
  leaver,
]);

const thread = async () =>
  (
    await db.query<{ id: string }>(
      "insert into chat_threads(student_id,tutor_id) values($1,$2) returning id",
      [student, tutor],
    )
  ).rows[0].id;
const say = (t: string, from: string, body: string, daysAgo: number) =>
  db.query(
    "insert into chat_messages(thread_id,sender_id,body,created_at) values($1,$2,$3,now() - make_interval(days => $4))",
    [t, from, body, daysAgo],
  );
const age = (t: string, daysAgo: number) =>
  db.query(
    "update chat_threads set last_message_at = now() - make_interval(days => $2) where id=$1",
    [t, daysAgo],
  );
const exists = async (t: string) =>
  (await db.query("select 1 from chat_threads where id=$1", [t])).rows.length === 1;
// `keeps` marks a check of behaviour that was already right and must stay so.
const results: [string, () => Promise<void>, boolean][] = [];
const check = (name: string, fn: () => Promise<void>, keeps = false) =>
  results.push([name, fn, keeps]);

check("a thread answered by a different tutor expires after 30 quiet days", async () => {
  const t = await thread();
  await say(t, student, "Why does water move?", 40);
  await say(t, otherTutor, "Osmosis!", 39);
  await age(t, 39);
  await db.query("select public.expire_stale_chat_threads()");
  assert(!(await exists(t)), "A thread answered by another tutor was never swept");
});

check(
  "an unanswered question is still never swept",
  async () => {
    const t = await thread();
    await say(t, student, "Anyone?", 60);
    await age(t, 60);
    await db.query("select public.expire_stale_chat_threads()");
    assert(await exists(t), "An unanswered question was swept");
  },
  true,
);

check("a chat notification goes with its thread", async () => {
  // The live trigger (restored above) writes the notification; the fixture's
  // stub is replaced by it.
  const t = await thread();
  await say(t, student, "Question", 40);
  await say(t, tutor, "Answer", 39);
  await age(t, 39);
  const n = await db.query("select 1 from notifications where type='chat_message'");
  assert(n.rows.length >= 2, "The fan-out trigger wrote no notifications");
  await db.query("select public.expire_stale_chat_threads()");
  const left = await db.query(
    "select 1 from notifications where type='chat_message' and body in ('Question','Answer')",
  );
  assert.equal(left.rows.length, 0, "Chat notifications outlived the swept thread");
});

check("deleting a tutor's account keeps their replies, still unread", async () => {
  const t = await thread();
  await say(t, student, "Help with 4.1?", 1);
  await db.query(
    "update chat_threads set student_last_read_at = now() - interval '1 day' where id=$1",
    [t],
  );
  await say(t, leaver, "Here's how it works", 0);
  await db.query("delete from profiles where id=$1", [leaver]);
  const r = await db.query<{ body: string; sender_id: string | null }>(
    "select body, sender_id from chat_messages where thread_id=$1 order by created_at",
    [t],
  );
  assert.deepEqual(
    r.rows.map((m) => m.body),
    ["Help with 4.1?", "Here's how it works"],
    "A deleted tutor's reply was deleted",
  );
  assert.equal(r.rows[1].sender_id, null);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [student]);
  const unread = await db.query<{ n: number }>("select public.chat_unread_count() n");
  assert(unread.rows[0].n >= 1, "A deleted tutor's unread reply dropped off the badge");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
});

let failed = 0;
const fixes = results.filter(([, , keeps]) => !keeps).length;
for (const [name, fn] of results) {
  try {
    await db.exec("begin");
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await db.exec("rollback");
  }
}
if (before) {
  assert.equal(failed, fixes, "A fix's check passed without the migration");
  console.log(
    "chat retention (--before): every fix's check fails without the migration, as expected",
  );
} else {
  assert.equal(failed, 0, `${failed} check(s) failed`);
  console.log("chat retention: all checks passed");
}
