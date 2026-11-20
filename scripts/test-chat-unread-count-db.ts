/** M7: the unread badge looks at the caller's threads only. The new
 * chat_unread_count gives the same number as the live one for every caller (a
 * student, a linked parent, a parent whose link was removed, two tutors, a
 * stranger, nobody), on a hand-checked set of threads and on random ones. A
 * student's call reads only their own threads, and the tutor half is skipped
 * for anyone who is not a tutor. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-unread-count-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const name = "20261119232034_chat_unread_count_own_threads";
const up = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const down = await readFile(
  new URL(`../supabase/rollbacks/${name}.down.sql`, import.meta.url),
  "utf8",
);
/** md5 of the live body (prosrc), read 19 Nov 2026. */
const LIVE_MD5 = "ac474aca4d46caf41cc0a33ec8b1e0b3";

/** The text between the $function$ markers: what prosrc holds. */
const body = (sql: string) => {
  const a = sql.indexOf("$function$") + "$function$".length;
  return sql.slice(a, sql.indexOf("$function$", a));
};

const db = new PGlite();
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The tables, indexes and helpers the badge reads, as production defines them
// (pg_get_functiondef / pg_get_indexdef / information_schema, 19 Nov 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create table public.user_roles(id uuid primary key default gen_random_uuid(), user_id uuid not null,
  role public.app_role not null, unique (user_id, role));
create index idx_user_roles_user on public.user_roles(user_id);
create table public.parent_student_links(id uuid primary key default gen_random_uuid(),
  parent_id uuid not null, student_id uuid not null, unique (parent_id, student_id));
create index idx_parent_student_links_parent on public.parent_student_links(parent_id);
create index idx_parent_student_links_student on public.parent_student_links(student_id);
create table public.chat_threads(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  tutor_id uuid, about_student_id uuid, student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now());
create index chat_threads_student_idx on public.chat_threads(student_id, last_message_at desc);
create index chat_threads_tutor_idx on public.chat_threads(tutor_id, last_message_at desc);
create index chat_threads_about_student_id_idx on public.chat_threads(about_student_id) where about_student_id is not null;
create table public.chat_messages(id uuid primary key default gen_random_uuid(), thread_id uuid not null,
  sender_id uuid, body text not null default 'x', created_at timestamptz not null default now());
create index chat_messages_thread_idx on public.chat_messages(thread_id, created_at);
create index chat_messages_sender_id_idx on public.chat_messages(sender_id);

create function private.has_role(_user_id uuid, _role public.app_role) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'tutor'::public.app_role) then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create function private.chat_member_can_see(_member uuid, _about uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select _member = (select auth.uid())
     and (
       _about is null
       or exists (
         select 1 from public.parent_student_links l
         where l.parent_id = _member and l.student_id = _about
       )
     )
$$;
`);

// The rollback is the live definition. Keep a copy of it under another name,
// so the old and the new badge can be asked the same question side by side.
await db.exec(down);
const md5 = async () =>
  (
    await db.query<{ m: string }>(
      "select md5(prosrc) as m from pg_proc where oid = 'public.chat_unread_count()'::regprocedure",
    )
  ).rows[0].m;
assert.equal(await md5(), LIVE_MD5, "The rollback is not production's live body");
await db.exec(down.replaceAll("public.chat_unread_count()", "public.chat_unread_count_live()"));

await db.exec(up);
assert.equal(
  await md5(),
  new Bun.CryptoHasher("md5").update(body(up)).digest("hex"),
  "The new body is not the migration's",
);
const newMd5 = await md5();

// Same signature, language, volatility, security, search_path and grants.
const shape = await db.query<Record<string, unknown>>(`
  select p.prorettype::regtype::text as returns, l.lanname as language, p.provolatile as volatile,
         p.prosecdef as definer, p.proconfig as config,
         has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
         has_function_privilege('anon', p.oid, 'execute') as anon
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'public.chat_unread_count()'::regprocedure`);
assert.deepEqual(shape.rows[0], {
  returns: "integer",
  language: "sql",
  volatile: "s",
  definer: true,
  config: ["search_path=public, private, pg_temp"],
  authenticated: true,
  anon: false,
});

/** The badge for one caller (null: no one signed in), old and new. */
async function badge(who: string | null) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who ?? ""]);
  if (who) await db.exec("set role authenticated");
  try {
    const { rows } = await db.query<{ old: number; new: number }>(
      "select public.chat_unread_count_live() as old, public.chat_unread_count() as new",
    );
    return rows[0];
  } finally {
    if (who) await db.exec("reset role");
  }
}

// ── A hand-checked inbox. ──────────────────────────────────────────────────
const sam = uuid(1); // a student
const ben = uuid(2); // another student
const mum = uuid(3); // a parent, linked to sam
const exMum = uuid(4); // a parent whose link to sam was removed
const tutorA = uuid(5);
const tutorB = uuid(6);
const stranger = uuid(7); // signed in, no role, no threads
const at = (h: number) => `2026-11-19T${String(h).padStart(2, "0")}:00:00Z`;

await db.exec(`
insert into public.user_roles(user_id, role) values
  ('${sam}','student'), ('${ben}','student'), ('${tutorA}','tutor'), ('${tutorB}','tutor');
insert into public.parent_student_links(parent_id, student_id) values ('${mum}','${sam}');
insert into public.chat_threads(id, student_id, about_student_id, student_last_read_at, tutor_last_read_at) values
  ('${uuid(11)}','${sam}',null,'${at(10)}','${at(9)}'),
  ('${uuid(12)}','${sam}',null,'${at(23)}','${at(23)}'),
  ('${uuid(13)}','${mum}','${sam}',null,null),
  ('${uuid(14)}','${exMum}','${sam}',null,null),
  ('${uuid(15)}','${ben}',null,null,null),
  ('${uuid(16)}','${tutorA}',null,null,null);
insert into public.chat_messages(thread_id, sender_id, created_at) values
  -- sam's open thread: read by sam at 10, by the tutors at 9; a deleted tutor's reply at 12
  ('${uuid(11)}','${sam}','${at(8)}'), ('${uuid(11)}','${tutorA}','${at(9)}'),
  ('${uuid(11)}','${tutorA}','${at(10)}'), ('${uuid(11)}','${sam}','${at(11)}'),
  ('${uuid(11)}',null,'${at(12)}'),
  -- sam's thread everyone has read
  ('${uuid(12)}','${sam}','${at(13)}'), ('${uuid(12)}','${tutorA}','${at(14)}'),
  -- mum's thread about sam, and exMum's
  ('${uuid(13)}','${mum}','${at(8)}'), ('${uuid(13)}','${tutorA}','${at(9)}'),
  ('${uuid(14)}','${exMum}','${at(8)}'), ('${uuid(14)}','${tutorA}','${at(9)}'),
  -- ben's thread, answered by tutorB
  ('${uuid(15)}','${ben}','${at(9)}'), ('${uuid(15)}','${tutorB}','${at(10)}'),
  -- a thread whose member is a tutor
  ('${uuid(16)}','${tutorA}','${at(9)}'), ('${uuid(16)}','${tutorB}','${at(10)}');
`);
// A message counts only if it is after the read mark, so tutorA's reply at
// 10:00 is read by sam's mark at 10:00.
const expected: [string, string | null, number][] = [
  ["student", sam, 1], // the deleted tutor's reply at 12; not mum's thread
  ["other student", ben, 1],
  ["linked parent", mum, 1],
  ["parent whose link was removed", exMum, 0],
  ["tutor A", tutorA, 7], // 2 + 0 + 1 + 1 + 2 in others' threads, + 1 in their own
  ["tutor B", tutorB, 9], // 3 + 0 + 2 + 2 + 1 + 1
  ["stranger", stranger, 0],
  ["no one signed in", null, 0],
];
for (const [label, who, n] of expected) {
  assert.deepEqual(await badge(who), { old: n, new: n }, label);
}

// The link is removed while the parent's thread stays: both now count nothing.
await db.exec(`delete from public.parent_student_links where parent_id = '${mum}'`);
assert.deepEqual(await badge(mum), { old: 0, new: 0 }, "Parent after their link was removed");
await db.exec(
  `insert into public.parent_student_links(parent_id, student_id) values ('${mum}','${sam}')`,
);

// ── Random inboxes: old and new agree for every caller. ────────────────────
let seed = 20261119;
const rand = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const students = [uuid(101), uuid(102), uuid(103), uuid(104)];
const parents = [uuid(201), uuid(202), uuid(203)];
const tutors = [uuid(301), uuid(302)];
const people = [...students, ...parents, ...tutors, uuid(401)];
const sqlTime = () => (rand() < 0.25 ? "null" : `'${at(Math.floor(rand() * 24))}'`);
let compared = 0;
let nonZero = 0;
for (let round = 0; round < 30; round++) {
  const rows: string[] = [];
  await db.exec(
    "delete from public.chat_messages; delete from public.chat_threads; delete from public.parent_student_links; delete from public.user_roles;",
  );
  for (const s of students)
    rows.push(`insert into public.user_roles(user_id, role) values ('${s}','student');`);
  for (const t of tutors)
    rows.push(`insert into public.user_roles(user_id, role) values ('${t}','tutor');`);
  for (const p of parents)
    for (const s of students)
      if (rand() < 0.4)
        rows.push(
          `insert into public.parent_student_links(parent_id, student_id) values ('${p}','${s}');`,
        );
  for (let i = 0; i < 12; i++) {
    const r = rand();
    const member = r < 0.5 ? pick(students) : r < 0.9 ? pick(parents) : pick(tutors);
    const about = parents.includes(member) && rand() < 0.85 ? `'${pick(students)}'` : "null";
    const id = uuid(1000 + round * 100 + i);
    rows.push(
      `insert into public.chat_threads(id, student_id, about_student_id, student_last_read_at, tutor_last_read_at)
       values ('${id}','${member}',${about},${sqlTime()},${sqlTime()});`,
    );
    const messages = Math.floor(rand() * 7);
    for (let k = 0; k < messages; k++) {
      const q = rand();
      const sender =
        q < 0.4
          ? `'${member}'`
          : q < 0.8
            ? `'${pick(tutors)}'`
            : q < 0.9
              ? "null"
              : `'${pick(people)}'`;
      rows.push(
        `insert into public.chat_messages(thread_id, sender_id, created_at) values ('${id}',${sender},'${at(Math.floor(rand() * 24))}');`,
      );
    }
  }
  await db.exec(rows.join("\n"));
  for (const who of [...people, null]) {
    const b = await badge(who);
    assert.equal(b.new, b.old, `Round ${round}, caller ${who ?? "none"}`);
    compared++;
    if (b.old > 0) nonZero++;
  }
}
assert.ok(
  nonZero > compared / 3,
  `Too few non-zero badges to prove anything (${nonZero}/${compared})`,
);

// ── The plan: a student reads only their own threads. ──────────────────────
// 400 students, 3,000 threads, 30,000 messages.
await db.exec(`
delete from public.chat_messages; delete from public.chat_threads; delete from public.parent_student_links; delete from public.user_roles;
insert into public.user_roles(user_id, role)
  select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'student' from generate_series(1, 400) g;
insert into public.user_roles(user_id, role) values ('${tutorA}','tutor');
insert into public.chat_threads(id, student_id, student_last_read_at, tutor_last_read_at)
  select gen_random_uuid(), ('00000000-0000-0000-0000-' || lpad(((g % 400) + 1)::text, 12, '0'))::uuid,
         now() - (g % 7) * interval '1 day', now() - (g % 3) * interval '1 day'
    from generate_series(1, 3000) g;
insert into public.chat_messages(thread_id, sender_id, created_at)
  select t.id, case when k % 2 = 0 then t.student_id else '${tutorA}'::uuid end, now() - k * interval '13 hours'
    from public.chat_threads t, generate_series(1, 10) k;
analyze;
`);
const busy = uuid(7);
for (const who of [busy, tutorA]) {
  const b = await badge(who);
  assert.equal(b.new, b.old, `Large inbox, caller ${who}`);
  assert.ok(b.old > 0, "The large inbox gave an empty badge");
}

async function plan(who: string, sql: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);
  const { rows } = await db.query<Record<string, string>>(
    `explain (analyze, costs off, timing off, summary off) ${sql}`,
  );
  return rows.map((r) => Object.values(r)[0]);
}
const ranSeqScanOnMessages = (lines: string[]) =>
  lines.some((l) => l.includes("Seq Scan on chat_messages") && !l.includes("never executed"));

const studentNew = await plan(busy, body(up));
assert.ok(
  studentNew.some((l) => l.includes("chat_threads_student_idx")),
  `A student's badge no longer finds their threads by index:\n${studentNew.join("\n")}`,
);
assert.ok(
  !ranSeqScanOnMessages(studentNew),
  `A student's badge read every message:\n${studentNew.join("\n")}`,
);
assert.ok(
  studentNew.some((l) => l.includes("One-Time Filter")),
  `The tutor half is not gated by a one-time role check:\n${studentNew.join("\n")}`,
);
// The live body reads every message for the same student: what this fixes.
assert.ok(
  ranSeqScanOnMessages(await plan(busy, body(down))),
  "The live body was expected to read every message",
);

// ── Idempotent, and the rollback restores the live body. ──────────────────
await db.exec(up);
assert.equal(await md5(), newMd5, "A second run changed the function");
await db.exec(down);
assert.equal(await md5(), LIVE_MD5, "The rollback did not restore the live body");
const restored = await badge(busy);
assert.equal(restored.new, restored.old, "After the rollback the badge changed");

console.log(
  `chat unread count: all checks passed (${compared} random comparisons; new body md5 ${newMd5})`,
);
