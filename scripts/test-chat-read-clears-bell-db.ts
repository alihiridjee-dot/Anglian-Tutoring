/** Isolated PostgreSQL checks for 20261028111700_chat_read_clears_bell. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-read-clears-bell-db.ts
 *
 * The rollback file holds the live definition, so it runs first to show the
 * fault (a reply read in Messages stays unread in the bell), then the migration
 * to show it fixed: reading a thread clears the reader's own notifications for
 * that thread, and nothing else.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const sam = uuid(1); // a student
const tutor = uuid(2);
const mum = uuid(3); // a parent, linked to sam
const exMum = uuid(4); // a parent no longer linked to sam
const other = uuid(5); // another student
const samThread = uuid(10);
const samOther = uuid(11); // sam's second thread
const mumThread = uuid(12);
const exMumThread = uuid(13);

// The tables and helpers mark_chat_thread_read touches, as production defines
// them (pg_get_functiondef / information_schema, 28 Oct 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create table user_roles(user_id uuid, role app_role);
create table parent_student_links(parent_id uuid, student_id uuid);
create table chat_threads(id uuid primary key, student_id uuid not null, about_student_id uuid,
  tutor_id uuid, student_last_read_at timestamptz, tutor_last_read_at timestamptz);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null,
  type text not null, title text not null, body text, link text, submission_id uuid,
  read_at timestamptz, created_at timestamptz not null default now(), chat_thread_id uuid);

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
create function private.chat_member_can_see(_member uuid, _about uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select _member = (select auth.uid())
     and (_about is null or exists (select 1 from public.parent_student_links l
       where l.parent_id = _member and l.student_id = _about)) $$;

insert into user_roles values ('${sam}','student'), ('${tutor}','tutor'), ('${other}','student');
insert into parent_student_links values ('${mum}','${sam}');
insert into chat_threads(id, student_id, about_student_id) values
  ('${samThread}','${sam}',null), ('${samOther}','${sam}',null),
  ('${mumThread}','${mum}','${sam}'), ('${exMumThread}','${exMum}','${sam}');
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261028111700_chat_read_clears_bell.sql", import.meta.url),
  "utf8",
);
const before = await readFile(
  new URL("../supabase/rollbacks/20261028111700_chat_read_clears_bell.down.sql", import.meta.url),
  "utf8",
);

/** A fresh bell: one unread notification per (user, thread), plus a marked task. */
async function seed() {
  await db.exec(`
    delete from notifications;
    update chat_threads set student_last_read_at = null, tutor_last_read_at = null;
    insert into notifications(user_id, type, title, chat_thread_id) values
      ('${sam}','chat_message','Reply from Ali','${samThread}'),
      ('${sam}','chat_message','Reply from Ali','${samOther}'),
      ('${sam}','homework_marked','Your task was marked',null),
      ('${tutor}','chat_message','Sam sent you a question','${samThread}'),
      ('${mum}','chat_message','Reply from Ali','${mumThread}'),
      ('${exMum}','chat_message','Reply from Ali','${exMumThread}');
  `);
}

async function read(who: string, thread: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
  await db.exec("set role authenticated");
  try {
    await db.query("select public.mark_chat_thread_read($1)", [thread]);
  } finally {
    await db.exec("reset role");
  }
}

/** Unread notifications, as "user:thread" (thread "-" for a non-chat one). */
async function unread() {
  const { rows } = await db.query<{ k: string }>(
    `select user_id::text || ':' || coalesce(chat_thread_id::text, '-') as k
       from notifications where read_at is null order by 1`,
  );
  return rows.map((r) => r.k);
}
const all = [
  `${sam}:${samThread}`,
  `${sam}:${samOther}`,
  `${sam}:-`,
  `${tutor}:${samThread}`,
  `${mum}:${mumThread}`,
  `${exMum}:${exMumThread}`,
].sort();
const without = (...gone: string[]) => all.filter((k) => !gone.includes(k));

// ── Live, before: reading moves the watermark and leaves the bell lit. ──
await db.exec(before);
await seed();
await read(sam, samThread);
const live = await db.query<{ student_last_read_at: string | null }>(
  "select student_last_read_at from chat_threads where id = $1",
  [samThread],
);
assert.ok(live.rows[0].student_last_read_at, "The live function stopped moving the watermark");
assert.deepEqual(await unread(), all, "The live bell was expected to stay unread");

// ── After the migration. ──
await db.exec(migration);

// A student reading a reply clears that thread's notification, theirs only:
// not their other thread, not their marked task, not the tutor's copy.
await seed();
await read(sam, samThread);
assert.deepEqual(await unread(), without(`${sam}:${samThread}`));

// A tutor reading the question clears their own copy.
await seed();
await read(tutor, samThread);
assert.deepEqual(await unread(), without(`${tutor}:${samThread}`));
const t = await db.query<{ tutor_last_read_at: string | null }>(
  "select tutor_last_read_at from chat_threads where id = $1",
  [samThread],
);
assert.ok(t.rows[0].tutor_last_read_at, "The tutor's watermark no longer moves");

// A linked parent reading the tutor's reply clears theirs.
await seed();
await read(mum, mumThread);
assert.deepEqual(await unread(), without(`${mum}:${mumThread}`));

// A parent no longer linked can't see the thread: nothing moves.
await seed();
await read(exMum, exMumThread);
assert.deepEqual(await unread(), all, "An unlinked parent's read changed something");
const ex = await db.query<{ student_last_read_at: string | null }>(
  "select student_last_read_at from chat_threads where id = $1",
  [exMumThread],
);
assert.equal(ex.rows[0].student_last_read_at, null);

// Someone else's thread: nothing moves, nobody's bell changes.
await seed();
await read(other, samThread);
assert.deepEqual(await unread(), all, "A stranger's read changed someone's bell");

// A thread that no longer exists: a quiet no-op, as before.
await seed();
await read(sam, uuid(99));
assert.deepEqual(await unread(), all);

// Tutors share one read mark, so once one tutor has read a question to the
// whole team it no longer counts as unread for a second. The page still calls
// this when the second tutor opens it, and that clears their own copy.
const tutor2 = uuid(6);
await db.exec(`insert into user_roles values ('${tutor2}','tutor')`);
await seed();
await db.exec(`insert into notifications(user_id, type, title, chat_thread_id)
  values ('${tutor2}','chat_message','Sam sent you a question','${samThread}')`);
await read(tutor, samThread);
assert.deepEqual(
  (await unread()).filter((k) => k.startsWith(tutor2)),
  [`${tutor2}:${samThread}`],
  "One tutor's read cleared another tutor's bell",
);
await read(tutor2, samThread);
assert.deepEqual(await unread(), without(`${tutor}:${samThread}`));

console.log("chat read clears bell: all checks passed");
