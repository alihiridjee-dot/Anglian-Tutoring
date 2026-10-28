/** Isolated PostgreSQL checks for 20261028101600_renewal_grace.sql: a paying
 * student keeps access while the renewal webhook is late, and nobody else
 * gains any. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-renewal-grace-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The slice of production the migration touches, as live on 28 Oct.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.profiles(id uuid primary key, enrolled_courses text[]);
create table public.subscriptions(student_id uuid primary key, plan text, status text, current_period_end timestamptz);
create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261028101600_renewal_grace.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

// One student per case: status, and how far the period end is from now.
const cases: [string, string, string | null, boolean][] = [
  ["active, period running", "active", "+ interval '3 days'", true],
  ["active, renewal webhook an hour late", "active", "- interval '1 hour'", true],
  ["trialing, webhook 20 hours late", "trialing", "- interval '20 hours'", true],
  ["active, no webhook for two days", "active", "- interval '2 days'", false],
  ["active, no period end recorded", "active", null, true],
  ["cancelled", "canceled", "+ interval '3 days'", false],
  ["cancelled an hour ago", "canceled", "- interval '1 hour'", false],
  ["payment failed", "past_due", "- interval '1 hour'", false],
  ["paused", "paused", "+ interval '3 days'", false],
];
for (const [i, [, status, offset]] of cases.entries()) {
  const id = uuid(i + 1);
  await db.query("insert into public.profiles values ($1, '{biology,chemistry,physics}')", [id]);
  await db.query(
    `insert into public.subscriptions values ($1, 'weekly_2', $2, ${offset ? `now() ${offset}` : "null"})`,
    [id, status],
  );
}

for (const [i, [label, , , access]] of cases.entries()) {
  const id = uuid(i + 1);
  const { rows } = await db.query<{ access: boolean; paid: string[] }>(
    "select private.student_has_access($1) as access, private.student_paid_subjects($1) as paid",
    [id],
  );
  assert.equal(rows[0].access, access, `${label}: access`);
  assert.deepEqual(rows[0].paid, access ? ["biology", "chemistry"] : [], `${label}: subjects`);

  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  const cap = await db.query<{ cap: number | null }>("select private.my_paid_subject_cap() as cap");
  assert.equal(cap.rows[0].cap, access ? 2 : null, `${label}: subject cap`);
}

console.log("renewal grace: all checks passed");
