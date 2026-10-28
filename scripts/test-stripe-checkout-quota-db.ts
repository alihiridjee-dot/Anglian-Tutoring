/** Isolated PostgreSQL checks for 20261028101500_stripe_checkout_quota.sql:
 * opening Stripe Checkout or the billing portal is budgeted per account, and
 * every quota that was there before is unchanged. No production data is read
 * or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-stripe-checkout-quota-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const PARENT = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.ai_request_log(id bigserial primary key, user_id uuid not null, endpoint text not null, created_at timestamptz not null default now());
grant usage on schema public, auth to authenticated, anon;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261028101500_stripe_checkout_quota.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

/** One claim, as a signed-in user through the API role. */
async function claim(user: string | null, endpoint: string, limit: number) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${user ? "authenticated" : "anon"}`);
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      "select public.claim_ai_request($1, $2, '01:00:00'::interval) as ok",
      [endpoint, limit],
    );
    return rows[0].ok;
  } finally {
    await db.exec("reset role");
  }
}

// Twenty openings an hour, and a caller can't ask for more.
for (let i = 0; i < 20; i++) assert.equal(await claim(PARENT, "stripe_checkout", 1000), true);
assert.equal(await claim(PARENT, "stripe_checkout", 1000), false);

// Counted per account.
assert.equal(await claim(OTHER, "stripe_checkout", 20), true);

// The quotas that were there before still are.
for (let i = 0; i < 10; i++) assert.equal(await claim(PARENT, "question_ideas", 1000), true);
assert.equal(await claim(PARENT, "question_ideas", 1000), false);
assert.equal(await claim(PARENT, "help_ask", 20), true);
await assert.rejects(claim(PARENT, "anything_i_like", 1), /Unknown request type/);

// Signed out, it refuses.
await assert.rejects(claim(null, "stripe_checkout", 20));

console.log("stripe checkout quota: all checks passed");
