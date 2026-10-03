/** Isolated PostgreSQL checks for 20261003120000_plan_descriptions_one_session_a_week.sql
 * (S-9). No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-plan-descriptions-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const OLD: Record<string, string> = {
  weekly_1: "2 live sessions a week.",
  weekly_2: "4 live sessions a week.",
  weekly_3: "6 live sessions a week.",
  monthly_1: "8 live sessions a month.",
  monthly_2: "16 live sessions a month.",
  monthly_3: "24 live sessions a month.",
  termly_1: "24 live sessions a term.",
  termly_2: "48 live sessions a term.",
  termly_3: "72 live sessions a term.",
};

// public.packages as live on 3 Oct: the general ladder, the iGCSE copy, and
// the retired ks3 row.
await db.exec(`
create table public.packages(
  id uuid primary key default gen_random_uuid(),
  tier text not null, level text, name text not null, description text,
  price_pence int not null, stripe_price_id text, active boolean not null default true
);
`);
for (const level of [null, "igcse"]) {
  for (const [tier, description] of Object.entries(OLD)) {
    await db.query(
      "insert into public.packages(tier, level, name, description, price_pence, stripe_price_id) values ($1, $2, $3, $4, 1999, $5)",
      [tier, level, tier, description, `price_${level ?? "all"}_${tier}`],
    );
  }
}
await db.exec(
  "insert into public.packages(tier, level, name, description, price_pence, active) values ('ks3', 'ks3', 'KS3 Science', 'Weekly live lessons across all 3 sciences for KS3 students.', 2900, false)",
);

type Row = {
  tier: string;
  level: string | null;
  description: string;
  price_pence: number;
  stripe_price_id: string | null;
};
const read = async (): Promise<Row[]> =>
  (
    await db.query(
      "select tier, level, description, price_pence, stripe_price_id from public.packages order by level nulls first, tier",
    )
  ).rows as Row[];
const before = await read();

const path = (dir: string, suffix: string) =>
  new URL(
    `../supabase/${dir}/20261003120000_plan_descriptions_one_session_a_week${suffix}`,
    import.meta.url,
  );
const migration = await readFile(path("migrations", ".sql"), "utf8");
const rollback = await readFile(path("rollbacks", ".down.sql"), "utf8");

await db.exec(migration);
await db.exec(migration); // idempotent
const after = await read();

const byKey = (rows: Row[]) =>
  Object.fromEntries(rows.map((r) => [`${r.level ?? "all"}:${r.tier}`, r]));
const a = byKey(after);

// 1 live session per subject per week, on both price lists.
for (const level of ["all", "igcse"]) {
  assert.equal(a[`${level}:weekly_1`].description, "1 live session a week.");
  assert.equal(a[`${level}:weekly_3`].description, "3 live sessions a week.");
  assert.equal(a[`${level}:monthly_1`].description, "4 live sessions a month, 1 a week.");
  assert.equal(a[`${level}:monthly_2`].description, "8 live sessions a month, 2 a week.");
  assert.equal(a[`${level}:termly_1`].description, "12 live sessions a term, 1 a week.");
  assert.equal(a[`${level}:termly_3`].description, "36 live sessions a term, 3 a week.");
}
// Nothing else moves: prices, Stripe ids and the ks3 row.
const b = byKey(before);
for (const key of Object.keys(b)) {
  assert.equal(a[key].price_pence, b[key].price_pence, key);
  assert.equal(a[key].stripe_price_id, b[key].stripe_price_id, key);
}
assert.equal(a["ks3:ks3"].description, b["ks3:ks3"].description);

// The rollback restores exactly what was there.
await db.exec(rollback);
assert.deepEqual(await read(), before);

console.log("plan descriptions: all checks passed");
