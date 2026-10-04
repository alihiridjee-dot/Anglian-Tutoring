/** Isolated PostgreSQL regression checks for student_scored_work (S-23).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-student-scored-work-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const parent = uuid(2);
const stranger = uuid(3);
const otherChild = uuid(4);
const tutor = uuid(5);
const quizSet = uuid(10);
const sheet = uuid(11);

// Production's shape, cut down to what the function and the paywall touch.
// The paywall is stood in for by a `paid` flag: content is readable to tutors,
// or to anyone whose own (or linked child's) plan is live, as
// private.my_content_subjects() decides in production.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table paid(student_id uuid primary key);
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid);
create function private.has_content() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from paid where student_id = auth.uid())
      or exists (select 1 from paid p join parent_student_links l on l.student_id = p.student_id where l.parent_id = auth.uid()) $$;
create table mcq_sets(id uuid primary key, subject subject, title text, published boolean default true);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid references mcq_sets, user_id uuid, score int, total int, answers jsonb, created_at timestamptz default now());
create table resources(id uuid primary key, subject subject, title text, body text);
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid references resources, student_id uuid, score_pct numeric, feedback text, submitted_at timestamptz default now(), graded_at timestamptz);

alter table mcq_sets enable row level security;
create policy "mcq_sets read" on mcq_sets for select to authenticated using (private.has_role(auth.uid(),'tutor') or private.has_content());
alter table resources enable row level security;
create policy "resources read" on resources for select to authenticated using (private.has_role(auth.uid(),'tutor') or private.has_content());
alter table mcq_attempts enable row level security;
create policy "attempts read" on mcq_attempts for select to authenticated using (auth.uid() = user_id or private.has_role(auth.uid(),'tutor') or exists (select 1 from parent_student_links l where l.parent_id = auth.uid() and l.student_id = user_id));
alter table homework_submissions enable row level security;
create policy "hs read" on homework_submissions for select to authenticated using (auth.uid() = student_id or private.has_role(auth.uid(),'tutor') or exists (select 1 from parent_student_links l where l.parent_id = auth.uid() and l.student_id = homework_submissions.student_id));
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261003110000_student_scored_work.sql", import.meta.url),
    "utf8",
  ),
);
// Run it twice: the migration must be idempotent.
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261003110000_student_scored_work.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures: a child whose plan has lapsed (no `paid` row) ────────────────
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into parent_student_links(parent_id,student_id) values($1,$2)", [
  parent,
  child,
]);
await db.query("insert into mcq_sets values($1,'biology','Cells quiz')", [quizSet]);
await db.query("insert into resources values($1,'chemistry','Moles homework','secret content')", [
  sheet,
]);
await db.query(
  "insert into mcq_attempts(set_id,user_id,score,total,answers,created_at) values($1,$2,3,4,'{\"q\":1}',now() - interval '2 days')",
  [quizSet, child],
);
await db.query(
  "insert into mcq_attempts(set_id,user_id,score,total,created_at) values($1,$2,1,2,now() - interval '60 days')",
  [quizSet, child],
);
await db.query("insert into mcq_attempts(set_id,user_id,score,total) values($1,$2,4,4)", [
  quizSet,
  otherChild,
]);
await db.query(
  "insert into homework_submissions(resource_id,student_id,score_pct,feedback,graded_at) values($1,$2,80,'Good',now())",
  [sheet, child],
);
// Handed in but not yet marked: not scored work.
await db.query("insert into homework_submissions(resource_id,student_id) values($1,$2)", [
  sheet,
  child,
]);

await db.exec(`grant usage on schema public,auth,private to authenticated, anon;
 grant select on all tables in schema public to authenticated;
 set role authenticated;`);
const as = (id: string | null) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
type Row = { kind: string; subject: string; pct: string; title: string | null };
const work = async (since: string | null = null) =>
  (
    await db.query<Row>(
      "select kind, subject::text, round(pct)::text as pct, title from student_scored_work($1,$2) order by kind, pct",
      [child, since],
    )
  ).rows;

// ── The bug: past the paywall, the embeds come back empty ─────────────────
await as(parent);
const embed = await db.query<{ subject: string | null }>(
  "select s.subject::text from mcq_attempts a left join mcq_sets s on s.id = a.set_id where a.user_id = $1",
  [child],
);
assert(embed.rows.length > 0, "The parent can read the attempts themselves");
assert(
  embed.rows.every((r) => r.subject === null),
  "Fixture check: a lapsed child's quiz subjects are hidden by the paywall",
);

// ── The fix: the read model answers past the paywall ──────────────────────
const parentRows = await work();
assert.deepEqual(
  parentRows,
  [
    { kind: "homework", subject: "chemistry", pct: "80", title: "Moles homework" },
    { kind: "quiz", subject: "biology", pct: "50", title: null },
    { kind: "quiz", subject: "biology", pct: "75", title: null },
  ],
  "A linked parent of a lapsed child sees every scored piece, with its subject",
);
assert.deepEqual(
  (await work(new Date(Date.now() - 7 * 86400_000).toISOString())).map((r) => r.pct),
  ["80", "75"],
  "_since narrows to the window",
);

await as(child);
assert.equal((await work()).length, 3, "The child sees their own history");
await as(tutor);
assert.equal((await work()).length, 3, "A tutor sees it");

await as(stranger);
assert.equal((await work()).length, 0, "An unlinked parent gets nothing");
await as(otherChild);
assert.equal((await work()).length, 0, "Another student gets nothing");

// Only the agreed columns: no answers, questions, feedback or content.
const cols = await db.query<{ name: string }>(
  "select unnest(proargnames) as name from pg_proc where proname = 'student_scored_work'",
);
assert.deepEqual(
  cols.rows.map((r) => r.name),
  ["_student_id", "_since", "kind", "item_id", "subject", "pct", "scored_at", "title"],
  "The function returns only subject, score, date and title",
);

// Signed-out callers can't run it at all.
await db.exec("reset role; set role anon;");
let threw = false;
try {
  await db.query("select * from student_scored_work($1)", [child]);
} catch {
  threw = true;
}
assert(threw, "anon could call student_scored_work");

console.log("student_scored_work: all checks passed");
