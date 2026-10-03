/** Isolated PostgreSQL checks for S-38's two migrations:
 * 20261001180000_leads_limits_and_retention.sql and
 * 20261001180100_leads_server_only.sql. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-leads-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const TUTOR = "00000000-0000-0000-0000-000000000001";
const STUDENT = "00000000-0000-0000-0000-000000000002";

// public.leads as live on 1 Oct: Supabase's default grants, and its policies.
await db.exec(`
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema private;
create type public.app_role as enum ('student','tutor','admin');
create function private.has_role(u uuid, r public.app_role) returns boolean language sql stable as $$ select u = '${TUTOR}'::uuid and r = 'tutor' $$;
grant usage on schema private, auth, public to anon, authenticated;
create schema cron;
create table cron.job(jobname text primary key, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job values (n, s, c) on conflict (jobname) do update set command = excluded.command; select 1::bigint $$;
create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n; select true $$;
create table public.leads(id uuid primary key default gen_random_uuid(), name text not null, email text not null, phone text, message text not null, handled boolean not null default false, created_at timestamptz not null default now());
alter table public.leads enable row level security;
grant all on public.leads to anon, authenticated;
create policy "leads public insert" on public.leads for insert to anon, authenticated
  with check (char_length(email) >= 3 and char_length(email) <= 320 and char_length(name) >= 1 and char_length(name) <= 200 and char_length(message) >= 1 and char_length(message) <= 4000 and email ~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$');
create policy "leads tutor read" on public.leads for select to authenticated using (private.has_role((select auth.uid()), 'tutor'));
create policy "leads tutor update" on public.leads for update to authenticated using (private.has_role((select auth.uid()), 'tutor')) with check (private.has_role((select auth.uid()), 'tutor'));
insert into public.leads(name, email, phone, message, created_at) values ('Old', 'old@example.com', null, 'From long ago', now() - interval '13 months'), ('Recent', 'new@example.com', '07700900000', 'Hello', now() - interval '11 months');
`);

const file = (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

/** One statement as a caller through the API: anon, or signed in as `user`. */
async function as(user: string | null, sql: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}
const insertLead = (who: string | null) =>
  as(
    who,
    "insert into public.leads(name, email, message) values ('Bot', 'bot@example.com', 'spam')",
  );

// Before: anyone with the public key writes straight to the table.
await insertLead(null);
await db.exec("delete from public.leads where name = 'Bot'");

// ── Step 1 ──────────────────────────────────────────────────────────────────
const step1 = await file("20261001180000_leads_limits_and_retention.sql");
await db.exec(step1);
await db.exec(step1); // idempotent

// The limits hold for any writer, here the owner (as the service role is).
await assert.rejects(
  db.exec(
    "insert into public.leads(name, email, phone, message) values ('A', 'a@example.com', repeat('7', 41), 'Hi')",
  ),
  /leads_phone_length/,
);
await assert.rejects(
  db.exec("insert into public.leads(name, email, message) values ('A', 'not-an-email', 'Hi')"),
  /leads_email_valid/,
);
await assert.rejects(
  db.exec("insert into public.leads(name, email, message) values ('', 'a@example.com', 'Hi')"),
  /leads_name_length/,
);
await db.exec(
  "insert into public.leads(name, email, phone, message) values ('Ok', 'ok@example.com', '+44 7700 900000', 'Hi')",
);

// The daily purge removes leads older than 12 months, and only those.
const job = await db.query<{ command: string }>(
  "select command from cron.job where jobname = 'purge-old-leads'",
);
await db.exec(job.rows[0].command);
const names = await db.query<{ name: string }>("select name from public.leads order by name");
assert.deepEqual(
  names.rows.map((r) => r.name),
  ["Ok", "Recent"],
);

// The public insert still works until step 2 (the old app relies on it).
await insertLead(null);
await db.exec("delete from public.leads where name = 'Bot'");

// ── Step 2 ──────────────────────────────────────────────────────────────────
const step2 = await file("20261001180100_leads_server_only.sql");
await db.exec(step2);
await db.exec(step2); // idempotent

await assert.rejects(insertLead(null), /permission denied/);
await assert.rejects(insertLead(STUDENT), /permission denied/);
await assert.rejects(as(STUDENT, "truncate public.leads"), /permission denied/);
await assert.rejects(as(null, "select * from public.leads"), /permission denied/);

// Tutors still read and mark leads handled.
const read = await as(TUTOR, "select name from public.leads");
assert.equal(read.rows.length, 2);
await as(TUTOR, "update public.leads set handled = true where name = 'Recent'");
// A student still sees none.
assert.equal((await as(STUDENT, "select name from public.leads")).rows.length, 0);

// The server (the owner here, the service role in production) still writes.
await db.exec(
  "insert into public.leads(name, email, message) values ('Via server', 's@example.com', 'Hi')",
);

console.log("leads: all checks passed");
