/** Isolated PostgreSQL checks for 20261117120000_parent_join_links: the
 * one-time "My parent is paying" link. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-parent-join-links-db.ts
 *
 * The tables are cut down to the columns the functions read. The tutor guard
 * and is_staff are production's own definitions (17 Nov 2026).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
grant usage on schema public to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.profile_role as enum ('student','parent','tutor');
create type public.subject as enum ('biology','chemistry','physics');
create table public.user_roles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, role public.app_role not null);
create table public.profiles(id uuid primary key references auth.users on delete cascade, role public.profile_role not null default 'student', display_name text, level text);
create table public.student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid not null, subject public.subject not null, board text);
create table public.parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid not null references auth.users on delete cascade, student_id uuid not null references auth.users on delete cascade, created_at timestamptz not null default now(), unique (parent_id, student_id));
create table public.parent_link_invites(id uuid primary key default gen_random_uuid(), student_id uuid not null, parent_email text not null, status text not null default 'pending', responded_at timestamptz, responded_by uuid);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, title text not null, body text, link text);

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  select exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role in ('tutor', 'admin'))
      or exists (select 1 from public.profiles p where p.id = _user_id and p.role = 'tutor');
$function$;

CREATE OR REPLACE FUNCTION private.refuse_student_row_for_staff()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare
  _row jsonb := to_jsonb(new);
  _col text;
  _id uuid;
begin
  foreach _col in array tg_argv loop
    if not (_row ? _col) then
      raise exception 'student_row_not_staff on % names a missing column %.', tg_table_name, _col;
    end if;
    _id := (_row ->> _col)::uuid;
    if _id is not null and private.is_staff(_id) then
      raise exception 'A tutor account can''t hold student data (%.%).', tg_table_name, _col
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$function$;
`);

await db.exec(await file("migrations/20261117120000_parent_join_links.sql"));

const ALEX = "00000000-0000-0000-0000-00000000000a";
const MUM = "00000000-0000-0000-0000-00000000000b";
const DAD = "00000000-0000-0000-0000-00000000000c";
const TUTOR = "00000000-0000-0000-0000-00000000000d";
const SAM = "00000000-0000-0000-0000-00000000000e"; // another student

await db.exec(`
insert into auth.users(id, email) values
  ('${ALEX}', 'alex@x.test'), ('${MUM}', 'mum@x.test'), ('${DAD}', 'dad@x.test'),
  ('${TUTOR}', 'tutor@x.test'), ('${SAM}', 'sam@x.test');
insert into public.profiles(id, role, display_name, level) values
  ('${ALEX}', 'student', 'Alex Smith', 'gcse_triple'),
  ('${MUM}', 'parent', 'Jo Smith', null),
  ('${DAD}', 'parent', 'Pat Smith', null),
  ('${TUTOR}', 'tutor', 'Tutor', null),
  ('${SAM}', 'student', 'Sam', 'gcse_triple');
insert into public.student_enrolments(student_id, subject, board) values
  ('${ALEX}', 'physics', 'aqa'), ('${ALEX}', 'biology', null);
insert into public.parent_link_invites(student_id, parent_email) values ('${ALEX}', 'mum@x.test');
`);

/** One call through the API: anon, or signed in as `user`. */
async function as<T = Record<string, unknown>>(
  user: string | null,
  sql: string,
  params: unknown[] = [],
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  const email = user
    ? ((await db.query<{ email: string }>("select email from auth.users where id = $1", [user]))
        .rows[0]?.email ?? "")
    : "";
  await db.query("select set_config('request.jwt.claim.email', $1, false)", [email]);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  } finally {
    await db.exec("reset role");
  }
}
type Answer = { status: string; [k: string]: unknown };
const create = (user: string | null, cadence = "monthly") =>
  as<{ token: string; expires_at: string }>(user, "select public.create_parent_join_link($1) r", [
    cadence,
  ]);
const peek = (user: string | null, token: string) =>
  as<Answer>(user, "select public.peek_parent_join_link($1) r", [token]);
const redeem = (user: string | null, token: string) =>
  as<Answer>(user, "select public.redeem_parent_join_link($1) r", [token]);
const status = (user: string | null, token: string) =>
  as<Answer>(user, "select public.parent_join_link_status($1) r", [token]);
const linked = async (parent: string, student: string) =>
  (
    await db.query(
      "select 1 from public.parent_student_links where parent_id = $1 and student_id = $2",
      [parent, student],
    )
  ).rows.length === 1;

// ── Making a link ────────────────────────────────────────────────────────────
const first = await create(ALEX);
assert.match(first.token, /^[0-9a-f]{32}$/, "The token isn't 32 hex characters");
const stored = await db.query<{ token_hash: string; cadence: string; hours: number }>(
  "select token_hash, cadence, extract(epoch from expires_at - created_at) / 3600 as hours from public.parent_join_links",
);
assert.equal(stored.rows.length, 1);
assert.notEqual(stored.rows[0].token_hash, first.token, "The token itself was stored");
assert.equal(stored.rows[0].cadence, "monthly");
assert.equal(Math.round(Number(stored.rows[0].hours)), 24, "A link doesn't last 24 hours");

await assert.rejects(() => create(null), /permission denied/, "Anon made a link");
await assert.rejects(() => create(MUM), /Only a student/, "A parent made a link");
await assert.rejects(() => create(TUTOR), /Only a student/, "A tutor made a link");
await assert.rejects(() => create(ALEX, "daily"), /weekly, monthly or termly/, "A made-up cadence");

// ── Nobody reads the table ──────────────────────────────────────────────────
for (const user of [null, ALEX, MUM]) {
  await assert.rejects(
    () => as(user, "select count(*) r from public.parent_join_links"),
    /permission denied/,
    `${user ?? "anon"} read the table`,
  );
}
await assert.rejects(
  () => as(ALEX, "select private.parent_join_plan($1, 'monthly') r", [ALEX]),
  /permission denied/,
  "A student called the private plan helper",
);

// ── A newer link kills the old one ──────────────────────────────────────────
const second = await create(ALEX, "termly");
assert.equal((await peek(null, first.token)).status, "expired", "The old link still worked");
assert.equal((await status(ALEX, first.token)).status, "expired");

// ── Peeking, signed out ─────────────────────────────────────────────────────
const shown = await peek(null, second.token);
assert.equal(shown.status, "ok");
assert.equal(shown.joined, false);
assert.equal(shown.student_name, "Alex", "Not just the first name");
assert.deepEqual(shown.subjects, [
  { subject: "biology", board: null },
  { subject: "physics", board: "aqa" },
]);
assert.equal(shown.level, "gcse_triple");
assert.equal(shown.cadence, "termly");
assert.equal(shown.student_id, undefined, "Peek gave away the child's id");
assert.equal((await peek(null, "nope")).status, "not_found");
assert.equal((await peek(null, "")).status, "not_found");

// ── Only the student sees their own link's status ───────────────────────────
assert.equal((await status(ALEX, second.token)).status, "waiting");
assert.equal((await status(SAM, second.token)).status, "not_found", "Another student saw it");
await assert.rejects(() => status(null, second.token), /permission denied/, "Anon read a status");

// ── Redeeming ────────────────────────────────────────────────────────────────
await assert.rejects(() => redeem(null, second.token), /permission denied/, "Anon redeemed");
assert.equal((await redeem(SAM, second.token)).status, "not_a_parent", "A student redeemed");
assert.equal((await redeem(TUTOR, second.token)).status, "not_a_parent", "A tutor redeemed");
assert.equal((await redeem(MUM, "nope")).status, "not_found");
assert.equal((await redeem(MUM, first.token)).status, "expired", "The killed link redeemed");
assert.equal(await linked(MUM, ALEX), false);

const used = await redeem(MUM, second.token);
assert.equal(used.status, "linked");
assert.equal(used.student_id, ALEX);
assert.equal(used.student_name, "Alex");
assert.equal(used.cadence, "termly");
assert.equal(await linked(MUM, ALEX), true, "No link was made");

const note = await db.query<{ user_id: string; body: string }>(
  "select user_id, body from public.notifications",
);
assert.equal(note.rows.length, 1, "The child wasn't told, or was told twice");
assert.equal(note.rows[0].user_id, ALEX);
assert.match(note.rows[0].body, /^Jo Smith linked/);
const invite = await db.query<{ status: string }>("select status from public.parent_link_invites");
assert.equal(invite.rows[0].status, "accepted", "Mum's pending email invite stayed pending");

const joined = await status(ALEX, second.token);
assert.equal(joined.status, "joined");
assert.equal(joined.parent_name, "Jo Smith");

// The same parent again (a reload, back from Stripe): same answer, nothing new.
const again = await redeem(MUM, second.token);
assert.equal(again.status, "already_linked");
assert.equal(again.student_id, ALEX);
assert.equal((await peek(MUM, second.token)).joined, true);
assert.equal((await db.query("select 1 from public.notifications")).rows.length, 1);

// Once used, nobody else can: not another parent, not signed out.
assert.equal((await redeem(DAD, second.token)).status, "used", "A second parent used the link");
assert.equal((await peek(null, second.token)).status, "used");
assert.equal((await peek(DAD, second.token)).status, "used");
assert.equal(await linked(DAD, ALEX), false);

// A child who unlinks the parent isn't re-linked by the old link.
await db.query("delete from public.parent_student_links where parent_id = $1", [MUM]);
assert.equal((await redeem(MUM, second.token)).status, "used", "The old link re-linked Mum");
assert.equal((await peek(MUM, second.token)).status, "used");
assert.equal(await linked(MUM, ALEX), false);

// ── An already-linked parent uses a fresh link: no second link, no note ─────
await db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
  DAD,
  ALEX,
]);
const third = await create(ALEX);
assert.equal((await redeem(DAD, third.token)).status, "already_linked");
assert.equal((await db.query("select 1 from public.notifications")).rows.length, 1);
assert.equal((await status(ALEX, third.token)).status, "joined", "The used link still waits");

// ── 24 hours on, a link is dead ─────────────────────────────────────────────
const fourth = await create(ALEX);
await db.query(
  "update public.parent_join_links set expires_at = now() - interval '1 second' where used_at is null",
);
assert.equal((await peek(null, fourth.token)).status, "expired");
assert.equal((await redeem(MUM, fourth.token)).status, "expired", "An expired link redeemed");
assert.equal((await status(ALEX, fourth.token)).status, "expired");

// ── A student who became a tutor can't be linked to ─────────────────────────
const fifth = await create(SAM);
await db.query("update public.profiles set role = 'tutor' where id = $1", [SAM]);
assert.equal((await redeem(MUM, fifth.token)).status, "not_found", "Linked a parent to a tutor");
assert.equal(await linked(MUM, SAM), false);
await db.query("update public.profiles set role = 'student' where id = $1", [SAM]);

// ── Twenty links an hour ────────────────────────────────────────────────────
await db.query("delete from public.parent_join_links where student_id = $1", [SAM]);
for (let i = 0; i < 20; i++) await create(SAM);
await assert.rejects(() => create(SAM), /Too many links/, "A 21st link in the hour");
await db.query(
  "update public.parent_join_links set created_at = now() - interval '61 minutes' where student_id = $1",
  [SAM],
);
await create(SAM);
const live = await db.query<{ n: number }>(
  "select count(*)::int n from public.parent_join_links where student_id = $1 and used_at is null and expires_at > now()",
  [SAM],
);
assert.equal(live.rows[0].n, 1, "More than one link works at a time");

// ── An account deleted takes its links with it ──────────────────────────────
await db.query("delete from auth.users where id = $1", [SAM]);
assert.equal(
  (await db.query("select 1 from public.parent_join_links where student_id = $1", [SAM])).rows
    .length,
  0,
);

// ── The rollback leaves nothing behind ──────────────────────────────────────
await db.exec(await file("rollbacks/20261117120000_parent_join_links.down.sql"));
const left = await db.query(
  "select 1 from pg_proc where proname like '%parent_join%' union all select 1 from pg_class where relname = 'parent_join_links'",
);
assert.equal(left.rows.length, 0, "The rollback left something behind");

console.log("parent join links: all checks passed");
