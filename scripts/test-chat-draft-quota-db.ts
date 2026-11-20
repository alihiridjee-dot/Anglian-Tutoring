/** Isolated PostgreSQL checks for 20261120000144_chat_draft_quota.sql: the
 * tutor's reply drafts are budgeted per account and apart, every quota that
 * was there before is unchanged, and the rollback puts the old list back. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-chat-draft-quota-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const TUTOR = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.ai_request_log(id bigserial primary key, user_id uuid not null, endpoint text not null, created_at timestamptz not null default now());
grant usage on schema public, auth to authenticated, anon;
`);

const sql = (name: string) => readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");

// The definition live before this change.
await db.exec(await sql("migrations/20261028101700_stripe_invoices_quota.sql"));

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

// Before: a draft's claim is refused as unknown, so the app change must wait.
await assert.rejects(claim(TUTOR, "chat_draft", 60), /Unknown request type/);

const up = await sql("migrations/20261120000144_chat_draft_quota.sql");
await db.exec(up);
await db.exec(up); // idempotent

// Sixty drafts an hour, and a caller can't ask for more.
for (let i = 0; i < 60; i++) assert.equal(await claim(TUTOR, "chat_draft", 1000), true);
assert.equal(await claim(TUTOR, "chat_draft", 1000), false);

// Counted per account.
assert.equal(await claim(OTHER, "chat_draft", 60), true);

// Drafting replies doesn't spend the other tutor tools' budgets.
assert.equal(await claim(TUTOR, "session_blurb", 60), true);
assert.equal(await claim(TUTOR, "weekly_feedback", 60), true);
assert.equal(await claim(TUTOR, "homework_generation", 60), true);

// The quotas that were there before still are.
for (let i = 0; i < 10; i++) assert.equal(await claim(OTHER, "question_ideas", 1000), true);
assert.equal(await claim(OTHER, "question_ideas", 1000), false);
for (let i = 0; i < 60; i++) assert.equal(await claim(OTHER, "stripe_invoices", 1000), true);
assert.equal(await claim(OTHER, "stripe_invoices", 1000), false);
assert.equal(await claim(OTHER, "help_ask", 20), true);
await assert.rejects(claim(TUTOR, "anything_i_like", 1), /Unknown request type/);

// Signed out, it refuses.
await assert.rejects(claim(null, "chat_draft", 60));

// Grants as before: the API role and the server, never anon.
const { rows: grants } = await db.query<{ role: string; ok: boolean }>(
  `select r as role, has_function_privilege(r, 'public.claim_ai_request(text,integer,interval)', 'execute') as ok
     from unnest(array['authenticated', 'service_role', 'anon']) as r`,
);
assert.deepEqual(Object.fromEntries(grants.map((g) => [g.role, g.ok])), {
  authenticated: true,
  service_role: true,
  anon: false,
});

// Rolled back, drafts are unknown again and the rest is untouched.
await db.exec(await sql("rollbacks/20261120000144_chat_draft_quota.down.sql"));
await assert.rejects(claim(OTHER, "chat_draft", 60), /Unknown request type/);
assert.equal(await claim(OTHER, "stripe_invoices", 1000), false); // still spent from above
assert.equal(await claim(OTHER, "help_ask", 20), true);

console.log("chat draft quota: all checks passed");
