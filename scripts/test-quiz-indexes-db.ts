/** M10: the quiz-index migration records production's three dashboard-made
 * indexes, drops the duplicate (user_id, set_id) index on mcq_attempts, and
 * changes nothing on a second run or on a production-shaped schema. The
 * rollback brings the duplicate back and leaves the recorded three. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-quiz-indexes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const name = "20261118183244_quiz_indexes_record_and_dedupe";
const up = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const down = await readFile(
  new URL(`../supabase/rollbacks/${name}.down.sql`, import.meta.url),
  "utf8",
);

// pg_get_indexdef in production, read 18 Nov 2026.
const live = {
  idx_mcq_attempts_set_id:
    "CREATE INDEX idx_mcq_attempts_set_id ON public.mcq_attempts USING btree (set_id)",
  idx_mcq_attempts_user:
    "CREATE INDEX idx_mcq_attempts_user ON public.mcq_attempts USING btree (user_id, set_id)",
  mcq_attempts_user_set_idx:
    "CREATE INDEX mcq_attempts_user_set_idx ON public.mcq_attempts USING btree (user_id, set_id)",
  idx_mcq_questions_set_id:
    "CREATE INDEX idx_mcq_questions_set_id ON public.mcq_questions USING btree (set_id)",
  idx_mcq_questions_spec_point_id:
    "CREATE INDEX idx_mcq_questions_spec_point_id ON public.mcq_questions USING btree (spec_point_id)",
};

const tables = `
create table public.mcq_questions(id uuid primary key, set_id uuid, spec_point_id uuid, position int);
create table public.mcq_attempts(id uuid primary key, user_id uuid, set_id uuid);
`;
// What the repo builds today: both (user_id, set_id) indexes, none of the three.
const repoShaped = `${tables}
create index if not exists idx_mcq_attempts_user on public.mcq_attempts(user_id, set_id);
create index if not exists mcq_attempts_user_set_idx on public.mcq_attempts (user_id, set_id);
`;

const indexes = async (db: InstanceType<typeof PGlite>) =>
  Object.fromEntries(
    (
      await db.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and indexname not like '%_pkey' order by indexname`,
      )
    ).rows.map((r) => [r.indexname, r.indexdef]),
  );

const { idx_mcq_attempts_user: duplicate, ...afterUp } = live;

// A database built from the repo gets production's indexes, minus the duplicate.
const fresh = new PGlite();
await fresh.exec(repoShaped);
await fresh.exec(up);
assert.deepEqual(await indexes(fresh), afterUp, "Up on a repo-built schema");

// A second run changes nothing.
await fresh.exec(up);
assert.deepEqual(await indexes(fresh), afterUp, "A second run changed the indexes");

// The rollback brings the duplicate back as production had it and keeps the three.
await fresh.exec(down);
assert.deepEqual(await indexes(fresh), live, "Rollback");
assert.equal((await indexes(fresh)).idx_mcq_attempts_user, duplicate);

// Production-shaped: the three already exist, so only the duplicate goes.
const prod = new PGlite();
await prod.exec(tables);
for (const def of Object.values(live)) await prod.exec(def);
assert.deepEqual(await indexes(prod), live, "Production fixture");
await prod.exec(up);
assert.deepEqual(await indexes(prod), afterUp, "Up on a production-shaped schema");

console.log("quiz indexes: all checks passed");
