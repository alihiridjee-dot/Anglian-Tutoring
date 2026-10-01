/** Isolated PostgreSQL regression checks for
 * 20261001130000_chat_reaches_only_tutors_and_linked_parents. No production data
 * is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-reach-db.ts
 *
 * The chat schema is built as production has it today: the original tables and
 * policies, the read-state, delete and invite-code functions taken from the
 * migrations that define them, then 20260926083808 applied whole. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const otherChild = uuid(2);
const tutor = uuid(3);
const parent = uuid(4);

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");

/** One function definition, from its `create` line to the closing `$$;`. */
async function definition(path: string, marker: string) {
  const lines = (await file(path)).split("\n");
  const start = lines.findIndex((l) => l.includes(marker));
  assert.ok(start >= 0, `${marker} not found in ${path}`);
  const end = lines.findIndex((l, i) => i > start && /^\$\$;/.test(l));
  return lines.slice(start, end + 1).join("\n");
}

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
-- pgcrypto's gen_random_bytes, as far as the invite-code generator needs it.
create function extensions.gen_random_bytes(int) returns bytea language sql volatile as $$
  select decode(md5(random()::text) || md5(random()::text), 'hex') $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.profile_role as enum ('student','parent','tutor');
create type public.subject as enum ('biology','chemistry','physics');
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
create table public.notifications(
  id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text,
  link text, created_at timestamptz default now());

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

-- The original policies, from 20260803231626.
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
alter table public.parent_student_links enable row level security;
create policy "psl parent reads own" on public.parent_student_links for select
  using (auth.uid() = parent_id or auth.uid() = student_id or private.has_role(auth.uid(), 'tutor'::public.app_role));
create policy "psl tutor writes" on public.parent_student_links for all
  using (private.has_role(auth.uid(), 'tutor'::public.app_role))
  with check (private.has_role(auth.uid(), 'tutor'::public.app_role));

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
]) {
  await db.exec(await definition(path, marker));
}
await db.exec(await file("migrations/20260926083808_parent_tutor_messages.sql"));

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.exec(`
insert into public.user_roles values ('${tutor}', 'tutor');
insert into public.profiles values
  ('${child}', 'Bea', 'student', 'ANG-OLDCODE1'),
  ('${otherChild}', 'Al', 'student', 'ANG-OLDCODE2'),
  ('${tutor}', 'Ms T', 'tutor', null),
  ('${parent}', 'Mum', 'parent', null);
insert into public.parent_student_links(parent_id, student_id) values ('${parent}', '${child}');
grant usage on schema public, auth, private to authenticated;
grant all on all tables in schema public to authenticated;
`);

/** Run one statement as a signed-in user, the way PostgREST would. */
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
const bell = async (user: string) =>
  (
    await db.query<{ title: string; body: string }>(
      "select title, body from public.notifications where user_id = $1 order by created_at, title",
      [user],
    )
  ).rows;
const openThread = (member: string, to: string, about: string | null = null) =>
  as<{ id: string }>(
    member,
    "insert into public.chat_threads(student_id, tutor_id, subject_line, about_student_id) values (auth.uid(), $1, 'Hi', $2) returning id",
    [to, about],
  ).then((rows) => rows[0].id);
const send = (sender: string, thread: string, body: string) =>
  as(
    sender,
    "insert into public.chat_messages(thread_id, sender_id, body) values ($1, auth.uid(), $2)",
    [thread, body],
  );

// A thread opened before the fix, "to" another child: what the hole allowed.
const smuggled = await openThread(child, otherChild);

// ── The migration, twice: it must be safe to re-run ───────────────────────
const up = await file("migrations/20261001130000_chat_reaches_only_tutors_and_linked_parents.sql");
await db.exec(up);
await db.exec(up);

// 1. A thread can only be addressed to a tutor.
await assert.rejects(openThread(child, otherChild), /row-level security/);
await assert.rejects(openThread(child, parent), /row-level security/);
const question = await openThread(child, tutor);

// 2. A member can't rewrite their thread: no repointing, pinning or self-marking.
await as(
  child,
  "update public.chat_threads set tutor_id = $1, last_message_at = '2099-01-01', tutor_last_read_at = '2099-01-01' where id = $2",
  [otherChild, question],
);
const untouched = (
  await db.query<{ tutor_id: string; pinned: boolean }>(
    "select tutor_id, last_message_at > now() + interval '1 year' as pinned from public.chat_threads where id = $1",
    [question],
  )
).rows[0];
assert.deepEqual(untouched, { tutor_id: tutor, pinned: false });
// A tutor still can.
await as(tutor, "update public.chat_threads set status = 'closed' where id = $1", [question]);
assert.equal(
  (
    await db.query<{ status: string }>("select status from public.chat_threads where id = $1", [
      question,
    ])
  ).rows[0].status,
  "closed",
);

// 3. A member's message notifies a tutor, and nobody else — even on an old thread.
await send(child, question, "How do enzymes work?");
assert.deepEqual(await bell(tutor), [
  { title: "Bea sent you a question", body: "How do enzymes work?" },
]);
await send(child, smuggled, "Text pushed at another child");
assert.deepEqual(await bell(otherChild), [], "a non-tutor was notified");

// 4. Read state still works for the member, through the RPC.
await send(tutor, question, "They lower activation energy.");
assert.equal((await as<{ n: number }>(child, "select public.chat_unread_count() as n"))[0].n, 1);
await as(child, "select public.mark_chat_thread_read($1)", [question]);
assert.equal((await as<{ n: number }>(child, "select public.chat_unread_count() as n"))[0].n, 0);

// 5. A linked parent: opens a thread about the child, and hears every reply.
const parentThread = await openThread(parent, tutor, child);
await send(parent, parentThread, "How is Bea doing?");
await send(tutor, parentThread, "Bea is doing well.");
assert.deepEqual((await bell(parent)).at(-1), {
  title: "Reply from Ms T",
  body: "Bea is doing well.",
});
assert.equal((await as(parent, "select id from public.chat_threads")).length, 1);
assert.equal(
  (await as(child, "select id from public.chat_threads where about_student_id is not null")).length,
  0,
);

// 6. The child removes the parent: the thread disappears for the parent alone.
const linkId = (
  await db.query<{ id: string }>(
    "select id from public.parent_student_links where parent_id = $1",
    [parent],
  )
).rows[0].id;
await as(child, "select public.unlink_parent($1)", [linkId]);

assert.deepEqual(await as(parent, "select id from public.chat_threads"), []);
assert.deepEqual(await as(parent, "select id from public.chat_messages"), []);
await assert.rejects(send(parent, parentThread, "Still here"), /row-level security/);
await assert.rejects(
  as(parent, "select public.delete_chat_thread($1)", [parentThread]),
  /only delete your own/,
);

// Tutors keep the whole history, and replies no longer reach the parent.
const before = (await bell(parent)).length;
await send(tutor, parentThread, "Bea scored 42% on her mock.");
assert.equal((await bell(parent)).length, before, "an unlinked parent was notified");
assert.equal((await as(parent, "select public.chat_unread_count() as n"))[0].n, 0);
assert.equal(
  (await as(tutor, "select id from public.chat_messages where thread_id = $1", [parentThread]))
    .length,
  3,
);

// 7. The child's invite code changed, so the old one links nobody.
const code = async () =>
  (
    await db.query<{ student_invite_code: string }>(
      "select student_invite_code from public.profiles where id = $1",
      [child],
    )
  ).rows[0].student_invite_code;
const rotated = await code();
assert.notEqual(rotated, "ANG-OLDCODE1");
assert.match(rotated, /^ANG-[0-9A-HJKMNP-TV-Z]{8}$/);
// However the link goes: a tutor removing one rotates it too.
await db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
  parent,
  otherChild,
]);
await as(tutor, "delete from public.parent_student_links where student_id = $1", [otherChild]);
assert.notEqual(
  (
    await db.query<{ c: string }>(
      "select student_invite_code as c from public.profiles where id = $1",
      [otherChild],
    )
  ).rows[0].c,
  "ANG-OLDCODE2",
);

// 8. Linked again, the parent gets their conversation back, history and all.
await db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
  parent,
  child,
]);
assert.equal((await as(parent, "select id from public.chat_messages")).length, 3);
await send(parent, parentThread, "Thanks for keeping me posted.");

// 9. The rollback runs and restores the old rules.
await db.exec(
  await file("rollbacks/20261001130000_chat_reaches_only_tutors_and_linked_parents.down.sql"),
);
const policies = (
  await db.query<{ policyname: string }>(
    "select policyname from pg_policies where tablename = 'chat_threads' order by 1",
  )
).rows.map((r) => r.policyname);
assert.deepEqual(policies, [
  "chat_threads member creates own",
  "chat_threads participants update",
  "chat_threads read own or tutor",
]);
assert.equal(
  (await db.query("select 1 from pg_trigger where tgname = 'rotate_invite_code_on_unlink'")).rows
    .length,
  0,
);
await openThread(child, otherChild); // the old hole, back as documented

console.log("chat_reaches_only_tutors_and_linked_parents migration: all checks passed");
