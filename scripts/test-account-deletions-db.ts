/** Isolated PostgreSQL regression checks for the account-deletions migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-account-deletions-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const tutor = uuid(2);
const parent = uuid(3);

// The shape of production the migration touches: the role helper as production
// defines it, and pg_cron / pg_net stubbed down to what the migration calls.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private; create schema cron; create schema net;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
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
create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(_name text, _schedule text, _command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (_name, _schedule, _command) returning jobid::bigint $$;
create function cron.unschedule(_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = _name returning 1) select exists (select 1 from d) $$;
create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as $$ select 1::bigint $$;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20260923114330_account_deletions.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
// Idempotent: a second run must neither fail nor schedule the cron twice.
await db.exec(migration);

const jobs = await db.query<{ jobname: string; schedule: string; command: string }>(
  "select jobname, schedule, command from cron.job",
);
assert.equal(jobs.rows.length, 1, "exactly one purge job");
assert.equal(jobs.rows[0].schedule, "15 * * * *");
assert.match(jobs.rows[0].command, /net\.http_post/);
assert.match(jobs.rows[0].command, /functions\/v1\/delete-account/);
assert.match(jobs.rows[0].command, /"action": "purge"/);
assert.doesNotMatch(jobs.rows[0].command, /Bearer|apikey/i, "no key stored in the cron command");

// ── Fixtures (as the owner, i.e. the service role) ────────────────────────
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into user_roles values($1,'student')", [student]);
await db.query(
  "insert into account_deletions(student_id, requested_by, purge_after, notify) values($1,$2,now() + interval '7 days', '[{\"email\":\"s@example.com\"}]')",
  [student, tutor],
);

// One open request per student…
await assert.rejects(
  db.query("insert into account_deletions(student_id, purge_after) values($1, now())", [student]),
  /account_deletions_one_open/,
);
// …but a cancelled or completed one does not block the next.
await db.query("update account_deletions set status = 'cancelled' where student_id = $1", [
  student,
]);
await db.query("insert into account_deletions(student_id, purge_after) values($1, now())", [
  student,
]);
await assert.rejects(
  db.query(
    "insert into account_deletions(student_id, purge_after, status) values($1, now(), 'gone')",
    [uuid(9)],
  ),
  /account_deletions_status_check/,
);

// ── RLS ───────────────────────────────────────────────────────────────────
await db.exec(`grant usage on schema public,auth,private to authenticated;
 grant all on all tables in schema public to authenticated;`);
// The migration's revoke ran before this blanket grant; restate it the way
// production holds it (Supabase grants table privileges before migrations run).
await db.exec(`revoke all on public.account_deletions from authenticated;
 grant select on public.account_deletions to authenticated;
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

await as(tutor);
const seen = await db.query("select id from account_deletions");
assert.equal(seen.rows.length, 2, "a tutor reads every request");

for (const who of [student, parent]) {
  await as(who);
  const rows = await db.query("select id from account_deletions");
  assert.equal(rows.rows.length, 0, "students and parents see nothing");
}

// Nobody writes from the browser — not even a tutor.
await as(tutor);
await assert.rejects(
  db.query("insert into account_deletions(student_id, purge_after) values($1, now())", [uuid(8)]),
  /permission denied/,
);
await assert.rejects(
  db.query("update account_deletions set status = 'cancelled'"),
  /permission denied/,
);
await assert.rejects(db.query("delete from account_deletions"), /permission denied/);

console.log("account_deletions migration: all checks passed");
