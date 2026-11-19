/** L27: the marking queue's two sorts each get a partial index. On a
 * production-shaped table the migration adds exactly those two, a second run
 * changes nothing, the planner can read each page straight off its index with
 * no sort, and the rollback takes back only what it added. No production data
 * is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-marking-queue-indexes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const name = "20261119223041_marking_queue_sort_indexes";
const up = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const down = await readFile(
  new URL(`../supabase/rollbacks/${name}.down.sql`, import.meta.url),
  "utf8",
);

// pg_get_indexdef in production, read 19 Nov 2026 (the primary key aside).
const live = {
  homework_submissions_pending_release_idx:
    "CREATE INDEX homework_submissions_pending_release_idx ON public.homework_submissions USING btree (release_at) WHERE ((graded_at IS NULL) AND (release_at IS NOT NULL))",
  homework_submissions_resource_id_student_id_key:
    "CREATE UNIQUE INDEX homework_submissions_resource_id_student_id_key ON public.homework_submissions USING btree (resource_id, student_id)",
  homework_submissions_student_resource_idx:
    "CREATE INDEX homework_submissions_student_resource_idx ON public.homework_submissions USING btree (student_id, resource_id)",
  idx_homework_submissions_resource:
    "CREATE INDEX idx_homework_submissions_resource ON public.homework_submissions USING btree (resource_id)",
  idx_homework_submissions_student:
    "CREATE INDEX idx_homework_submissions_student ON public.homework_submissions USING btree (student_id)",
};
const added = {
  homework_submissions_graded_idx:
    "CREATE INDEX homework_submissions_graded_idx ON public.homework_submissions USING btree (graded_at DESC) WHERE (graded_at IS NOT NULL)",
  homework_submissions_pending_idx:
    "CREATE INDEX homework_submissions_pending_idx ON public.homework_submissions USING btree (submitted_at DESC) WHERE (graded_at IS NULL)",
};

const indexes = async (db: InstanceType<typeof PGlite>) =>
  Object.fromEntries(
    (
      await db.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'homework_submissions'
            and indexname <> 'homework_submissions_pkey' order by indexname`,
      )
    ).rows.map((r) => [r.indexname, r.indexdef]),
  );

const db = new PGlite();
await db.exec(`
create table public.homework_submissions(
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null,
  student_id uuid not null,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  release_at timestamptz,
  constraint homework_submissions_resource_id_student_id_key unique (resource_id, student_id)
);
`);
for (const [key, def] of Object.entries(live)) if (!key.endsWith("_key")) await db.exec(def);
assert.deepEqual(await indexes(db), live, "Production fixture");

// Up adds exactly the two marking-queue indexes.
await db.exec(up);
const afterUp = { ...live, ...added };
assert.deepEqual(await indexes(db), afterUp, "Up on a production-shaped table");

// A second run changes nothing.
await db.exec(up);
assert.deepEqual(await indexes(db), afterUp, "A second run changed the indexes");

// Each page comes straight off its own index, already in order: no sort step.
// (Seq scans and sorts are switched off only so the tiny fixture can't win by
// reading everything; the point is that the index can serve the page at all.)
const plan = async (sql: string) =>
  (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows
    .map((r) => r["QUERY PLAN"])
    .join("\n");
await db.exec("set enable_seqscan = off; set enable_sort = off;");
const pending = await plan(
  "select * from public.homework_submissions where graded_at is null order by submitted_at desc limit 50 offset 50",
);
assert.match(pending, /Index Scan using homework_submissions_pending_idx/, pending);
assert.doesNotMatch(pending, /Sort/, pending);
const graded = await plan(
  "select * from public.homework_submissions where graded_at is not null order by graded_at desc limit 50",
);
assert.match(graded, /Index Scan using homework_submissions_graded_idx/, graded);
assert.doesNotMatch(graded, /Sort/, graded);
await db.exec("reset enable_seqscan; reset enable_sort;");

// The rollback takes back only the two it added; a second run is harmless.
await db.exec(down);
assert.deepEqual(await indexes(db), live, "Rollback");
await db.exec(down);
assert.deepEqual(await indexes(db), live, "A second rollback changed the indexes");

console.log("marking queue indexes: all checks passed");
