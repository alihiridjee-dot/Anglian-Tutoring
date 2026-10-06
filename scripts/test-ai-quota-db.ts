/** Isolated PostgreSQL checks for 20261001171500_ai_quota_fixed_limits.sql
 * (M-14, M-16). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-ai-quota-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const STUDENT = "00000000-0000-0000-0000-000000000001";
const PARENT = "00000000-0000-0000-0000-000000000002";
const OTHER_PARENT = "00000000-0000-0000-0000-000000000003";

// The slice of production the migration touches, shaped as live on 1 Oct.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table auth.users(id uuid primary key, email text);
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command; select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n; select true $$;
create type public.profile_role as enum ('student','parent','tutor');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role);
create table public.ai_request_log(id bigserial primary key, user_id uuid not null, endpoint text not null, created_at timestamptz not null default now());
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.parent_link_invites(id uuid primary key default gen_random_uuid(), student_id uuid not null, parent_email text not null, status text not null default 'pending', created_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '14 days');
create unique index uq_parent_link_invites_pending on public.parent_link_invites(student_id, parent_email) where status = 'pending';
create table public.notifications(id bigserial, user_id uuid, type text, title text, body text, link text);
create function public.prune_ai_request_log() returns integer language sql as $$ select 0 $$;
grant usage on schema public, auth to authenticated, anon;
insert into auth.users values ('${STUDENT}', 'sam@example.com'), ('${PARENT}', 'mum@example.com'), ('${OTHER_PARENT}', 'dad@example.com');
insert into public.profiles values ('${STUDENT}', 'Sam', 'student'), ('${PARENT}', 'Mum', 'parent'), ('${OTHER_PARENT}', 'Dad', 'parent');
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261001171500_ai_quota_fixed_limits.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

/** Runs one statement as a signed-in user, through the API role. */
async function as<T>(user: string | null, sql: string, params: unknown[] = []): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  const email = user === STUDENT ? "sam@example.com" : user === PARENT ? "mum@example.com" : "";
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ email })]);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return (await db.query<{ r: T }>(`select ${sql} as r`, params)).rows[0].r;
  } finally {
    await db.exec("reset role");
  }
}
const claim = (endpoint: string, limit: number, window = "00:00:01") =>
  as<boolean>(STUDENT, "public.claim_ai_request($1, $2, $3::interval)", [endpoint, limit, window]);
const logRows = async (endpoint?: string) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.ai_request_log where $1::text is null or endpoint = $1",
        [endpoint ?? null],
      )
    ).rows[0].n,
  );

// ── M-16: the server decides the quota ──────────────────────────────────────
// A made-up endpoint is refused and writes nothing.
await assert.rejects(claim("anything_i_like", 1_000_000), /Unknown request type/);
assert.equal(await logRows(), 0);

// A huge limit and a one-second window from the caller don't widen the quota:
// link_child_by_code is ten an hour.
for (let i = 0; i < 10; i++) assert.equal(await claim("link_child_by_code", 1_000_000), true);
assert.equal(await claim("link_child_by_code", 1_000_000), false);
assert.equal(await logRows("link_child_by_code"), 10);

// A lower limit from the caller still applies.
assert.equal(await claim("homework_marking", 1), true);
assert.equal(await claim("homework_marking", 1), false);

// The count and insert run under a per-user, per-endpoint lock held to commit,
// so a parallel call waits for this one's row before it counts.
await db.exec("begin");
await db.query("select set_config('request.jwt.claim.sub', $1, true)", [STUDENT]);
await db.query("select public.claim_ai_request('weekly_summary', 60, '01:00:00')");
const held = await db.query<{ n: number }>(
  "select count(*)::int as n from pg_locks where locktype = 'advisory' and granted",
);
assert.equal(held.rows[0].n, 1);
await db.exec("commit");
const released = await db.query<{ n: number }>(
  "select count(*)::int as n from pg_locks where locktype = 'advisory'",
);
assert.equal(released.rows[0].n, 0);

// Anonymous callers can't use it.
await assert.rejects(as(null, "public.claim_ai_request('weekly_summary', 1, '01:00:00')"));

// The prune is scheduled.
const job = await db.query<{ command: string }>(
  "select command from cron.job where jobname = 'prune-ai-request-log'",
);
assert.match(job.rows[0].command, /prune_ai_request_log/);

// ── M-14: invite_parent_by_email ────────────────────────────────────────────
const invite = (user: string, email: string) =>
  as<{ status: string }>(user, "public.invite_parent_by_email($1)", [email]);
const notesFor = async (user: string) =>
  Number(
    (
      await db.query<{ n: number }>(
        "select count(*)::int as n from public.notifications where user_id = $1",
        [user],
      )
    ).rows[0].n,
  );

// Only a student can invite.
assert.equal((await invite(PARENT, "dad@example.com")).status, "not_a_student");
assert.equal(await notesFor(OTHER_PARENT), 0);

// The first invite notifies the parent; sending it again refreshes the invite
// but doesn't notify again.
assert.equal((await invite(STUDENT, "mum@example.com")).status, "invited");
assert.equal((await invite(STUDENT, "Mum@Example.com ")).status, "invited");
assert.equal(await notesFor(PARENT), 1);
const pending = await db.query("select 1 from public.parent_link_invites where status = 'pending'");
assert.equal(pending.rows.length, 1);

// Ten an hour, counted before the account lookup, so the "no account" and
// "not a parent" answers can't be used to check email after email.
for (let i = 0; i < 8; i++) await invite(STUDENT, `nobody${i}@example.com`);
assert.equal((await invite(STUDENT, "dad@example.com")).status, "rate_limited");
assert.equal(await notesFor(OTHER_PARENT), 0);

console.log("ai quota: all checks passed");
