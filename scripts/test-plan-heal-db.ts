/** Isolated PostgreSQL checks for the nightly plan check (20261007130000): the
 * schedule, the knock on the route's door, the run record and who may write
 * or read it, and the rollback. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-heal-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

// Supabase's roles and default privileges in public, with pg_cron, pg_net and
// Vault stubbed down to what the migration calls. The pg_net stub records
// each request instead of sending it.
await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema private; create schema cron; create schema net; create schema vault;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema private to anon, authenticated, service_role;

create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) returning jobid::bigint $$;
create function cron.unschedule(job_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = job_name returning 1) select exists (select 1 from d) $$;
create table net.requests(
  id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer);
create function net.http_post(
  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint language sql as $$
  insert into net.requests(url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds) returning id $$;
create table vault.decrypted_secrets(name text, decrypted_secret text);
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261007130000_plan_heal.sql", import.meta.url),
  "utf8",
);
const rollback = await readFile(
  new URL("../supabase/rollbacks/20261007130000_plan_heal.down.sql", import.meta.url),
  "utf8",
);
assert.ok(!/\bdrop\b/i.test(migration), "the migration must apply through MCP, which refuses DROP");

await db.exec(migration);
// Idempotent: a second apply leaves one job and one table.
await db.exec(migration);

const jobs = (await db.query("select jobname, schedule, command from cron.job")).rows;
assert.deepEqual(jobs, [
  { jobname: "plan-heal", schedule: "30 2 * * *", command: " select private.kick_plan_heal(); " },
]);

type Request = {
  url: string;
  body: unknown;
  headers: Record<string, string>;
  timeout_milliseconds: number;
};
const requests = async () =>
  (
    await db.query<Request>(
      "select url, body, headers, timeout_milliseconds from net.requests order by id",
    )
  ).rows;
const kick = async (dryRun?: boolean) =>
  (
    await db.query<{ id: number | null }>(
      dryRun === undefined
        ? "select private.kick_plan_heal() as id"
        : `select private.kick_plan_heal(${dryRun}) as id`,
    )
  ).rows[0].id;

// Without the practice worker's address and secret in Vault, nothing is sent.
assert.equal(await kick(), null);
await db.exec(
  "insert into vault.decrypted_secrets values ('practice_worker_secret', '  s3cret  ')",
);
assert.equal(await kick(), null);
await db.exec(
  "insert into vault.decrypted_secrets values ('practice_worker_url', 'https://example.test/api/practice-worker')",
);

// The route next to the practice worker, the trimmed secret, and the run's kind.
assert.ok((await kick()) !== null);
assert.ok((await kick(true)) !== null);
assert.deepEqual(await requests(), [
  {
    url: "https://example.test/api/plan-heal",
    body: { dryRun: false },
    headers: { "Content-Type": "application/json", Authorization: "Bearer s3cret" },
    timeout_milliseconds: 300000,
  },
  {
    url: "https://example.test/api/plan-heal",
    body: { dryRun: true },
    headers: { "Content-Type": "application/json", Authorization: "Bearer s3cret" },
    timeout_milliseconds: 300000,
  },
]);

// An address of any other shape sends nothing rather than guessing.
await db.exec("delete from net.requests");
for (const odd of [
  "https://example.test/api/practice-worker/extra",
  "https://example.test/",
  "   ",
]) {
  await db.query(
    "update vault.decrypted_secrets set decrypted_secret = $1 where name = 'practice_worker_url'",
    [odd],
  );
  assert.equal(await kick(), null, odd);
}
assert.deepEqual(await requests(), []);
await db.exec(
  "update vault.decrypted_secrets set decrypted_secret = 'https://example.test/api/practice-worker/' where name = 'practice_worker_url'",
);
assert.ok((await kick()) !== null, "a trailing slash is the same address");

// Nobody but the service role may knock or record; nobody else may read the record.
for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query("select private.kick_plan_heal()"), /permission denied/, role);
  await assert.rejects(
    db.query("select public.record_plan_heal_run('2026-10-05', false, '{}'::jsonb)"),
    /permission denied/,
    role,
  );
  await assert.rejects(db.query("select * from private.plan_heal_runs"), /permission denied/, role);
  await db.exec("reset role");
}

// A run's record counts what it checked and what it put right.
const report = {
  week: "2026-10-05",
  dryRun: false,
  courses: [
    { studentId: "s1", subject: "biology", outcome: "healed", missing: 0, stale: 4 },
    { studentId: "s1", subject: "physics", outcome: "plan-applied" },
    { studentId: "s2", subject: "biology", outcome: "in-step" },
    { studentId: "s2", subject: "chemistry", outcome: "left", reason: "break week" },
    { studentId: "s3", subject: "biology", outcome: "would-heal" },
  ],
  unreached: 0,
};
await db.exec("set role service_role");
await db.query("select public.record_plan_heal_run($1, $2, $3)", [
  "2026-10-05",
  false,
  JSON.stringify(report),
]);
await db.query("select public.record_plan_heal_run($1, $2, $3)", [
  "2026-10-05",
  true,
  JSON.stringify({ courses: [] }),
]);
await db.exec("reset role");
const runs = (
  await db.query<{
    week_start: string;
    dry_run: boolean;
    checked: number;
    healed: number;
    report: unknown;
  }>(
    "select week_start::text, dry_run, checked, healed, report from private.plan_heal_runs order by id",
  )
).rows;
assert.deepEqual(
  runs.map(({ report: _, ...r }) => r),
  [
    { week_start: "2026-10-05", dry_run: false, checked: 5, healed: 2 },
    { week_start: "2026-10-05", dry_run: true, checked: 0, healed: 0 },
  ],
);
assert.deepEqual(runs[0].report, report);

// Records older than 90 days go when the next run is recorded.
await db.exec(
  "update private.plan_heal_runs set ran_at = now() - interval '91 days' where dry_run",
);
await db.exec("set role service_role");
await db.query(
  "select public.record_plan_heal_run('2026-10-12', false, '{\"courses\": []}'::jsonb)",
);
await db.exec("reset role");
assert.deepEqual(
  (await db.query("select week_start::text, dry_run from private.plan_heal_runs order by id")).rows,
  [
    { week_start: "2026-10-05", dry_run: false },
    { week_start: "2026-10-12", dry_run: false },
  ],
);

// The rollback takes it all away again, and applies twice.
await db.exec(rollback);
await db.exec(rollback);
assert.equal((await db.query("select count(*)::int as n from cron.job")).rows[0].n, 0);
assert.equal(
  (await db.query("select to_regclass('private.plan_heal_runs') is null as gone")).rows[0].gone,
  true,
);
assert.equal(
  (
    await db.query(
      "select count(*)::int as n from pg_proc where proname in ('kick_plan_heal', 'record_plan_heal_run')",
    )
  ).rows[0].n,
  0,
);

console.log("plan heal: all checks passed");
