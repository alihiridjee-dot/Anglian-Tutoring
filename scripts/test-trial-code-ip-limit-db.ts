/** Isolated PostgreSQL regression checks for S-1's per-IP limit on free-trial
 * code requests. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-trial-code-ip-limit-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

await db.exec("create role authenticated; create role anon; create role service_role;");
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001125659_trial_code_ip_limit.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec("grant usage on schema public to service_role, authenticated, anon;");

const claim = async (ip: string, limit = 5) =>
  (
    await db.query<{ ok: boolean }>("select public.claim_trial_code_request($1, $2) ok", [
      ip,
      limit,
    ])
  ).rows[0].ok;

await db.exec("set role service_role");
for (let i = 0; i < 5; i++) assert.equal(await claim("ip-a"), true, `request ${i + 1} was refused`);
assert.equal(await claim("ip-a"), false, "A sixth request in the hour got through");
assert.equal(await claim("ip-b"), true, "One address's limit blocked another");

// An hour later the address is free again, and the old rows are gone.
await db.exec("reset role");
await db.query("update trial_code_requests set created_at = now() - interval '61 minutes'");
await db.exec("set role service_role");
assert.equal(await claim("ip-a"), true, "Requests over an hour old still counted");
await db.exec("reset role");
const kept = await db.query<{ n: number }>("select count(*)::int n from trial_code_requests");
assert.equal(kept.rows[0].n, 1, "Rows older than an hour were kept");

// Nobody but the function may claim or read.
for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => claim("ip-c"), `${role} could claim`);
  await assert.rejects(() => db.query("select * from trial_code_requests"), `${role} could read`);
  await db.exec("reset role");
}

console.log("trial code IP limit: all checks passed");
