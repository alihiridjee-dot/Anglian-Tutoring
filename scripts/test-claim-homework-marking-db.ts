/** Isolated PostgreSQL regression checks for M-3: only one mark-homework run
 * claims a submission at a time. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-claim-homework-marking-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

await db.exec(`
create role authenticated; create role anon; create role service_role;
create table homework_submissions(id uuid primary key default gen_random_uuid(), student_id uuid,
  graded_at timestamptz, ai_marked_at timestamptz);
grant usage on schema public to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, anon, service_role;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001123331_claim_homework_marking.sql", import.meta.url),
    "utf8",
  ),
);

const sub = async (fields = "") =>
  (
    await db.query<{ id: string }>(
      `insert into homework_submissions(student_id${fields ? ", " + fields.split("=")[0] : ""})
       values(gen_random_uuid()${fields ? ", " + fields.split("=")[1] : ""}) returning id`,
    )
  ).rows[0].id;
const claim = async (id: string) =>
  (await db.query<{ ok: boolean }>("select public.claim_homework_marking($1) ok", [id])).rows[0].ok;

await db.exec("set role service_role");
const fresh = await sub();
assert.equal(await claim(fresh), true, "The first run couldn't claim fresh work");
assert.equal(await claim(fresh), false, "A second run claimed work already being marked");

// A run that crashed without releasing: after ten minutes the work is free again.
await db.query(
  "update homework_submissions set ai_marking_started_at = now() - interval '11 minutes' where id = $1",
  [fresh],
);
assert.equal(await claim(fresh), true, "A stale claim blocked marking for good");

// Marked or published work is never claimed again.
assert.equal(await claim(await sub("ai_marked_at=now()")), false, "Marked work was re-claimed");
assert.equal(await claim(await sub("graded_at=now()")), false, "Published work was re-claimed");

// Only the edge function (service role) may claim.
const other = await sub();
for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  let threw = false;
  try {
    await claim(other);
  } catch {
    threw = true;
  }
  assert(threw, `${role} could claim a submission`);
}

console.log("claim homework marking: all checks passed");
