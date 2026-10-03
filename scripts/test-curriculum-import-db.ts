/** Isolated PostgreSQL regression checks for M-40: the curriculum text importer
 * writes a topic and its spec points together or not at all, reports how many
 * it wrote, keeps the pasted order, refuses a repeated code, and only a tutor
 * can import. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-curriculum-import-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);

// The tables, constraints, triggers' effect and policies these writes touch, as
// production defines them (information_schema and pg_policies, 3 Oct 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type level as enum ('gcse','alevel','gcse_trilogy','igcse');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from user_roles where user_id = auth.uid() and role = 'tutor') then
    return exists (select 1 from user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create table topics(id uuid primary key default gen_random_uuid(), subject subject not null, board board not null,
  level level not null, code text, title text not null, description text, sort_order integer not null default 0,
  created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  specification_version text, exam_tier text);
create table spec_points(id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics on delete cascade, code text not null, title text not null,
  description text, sort_order integer not null default 0, created_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  weight numeric not null default 1 check (weight > 0), assessment_context text);
alter table topics enable row level security;
alter table spec_points enable row level security;
create policy "topics tutors write" on topics for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "topics read scoped" on topics for select to authenticated using (true);
create policy "spec_points tutors write" on spec_points for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "spec_points read scoped" on spec_points for select to authenticated using (true);
grant usage on schema public, auth, private to authenticated, anon;
grant all on topics, spec_points to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261003130000_import_curriculum_topic.sql", import.meta.url),
    "utf8",
  ),
);
await db.query("insert into user_roles values($1,'tutor'),($2,'student')", [tutor, student]);

// A point that fails to write half-way through, the way a single failed
// insert used to be skipped while the rest went in.
await db.exec(`
create function fail_on_boom() returns trigger language plpgsql as $$
begin
  if new.code = 'BOOM' then raise exception 'write failed'; end if;
  return new;
end $$;
create trigger t_fail_on_boom before insert on spec_points for each row execute function fail_on_boom();
`);

await db.exec("set role authenticated");
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const fails = async (q: () => Promise<unknown>, what: string, code?: string) => {
  let err: unknown;
  try {
    await q();
  } catch (e) {
    err = e;
  }
  assert(err, what);
  if (code) assert.equal((err as { code?: string }).code, code, what);
};
const count = async (table: string) =>
  Number((await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n);

type P = { code: string; title: string; description?: string | null };
const importTopic = (points: P[], title = "Cell biology") =>
  db.query<{ r: { topic_id: string; points: number } }>(
    `select public.import_curriculum_topic(
       _subject => 'biology', _board => 'aqa', _level => 'gcse',
       _topic_code => 'Topic 4.1', _topic_title => $1,
       _topic_description => 'Manual/PDF Uploaded Curriculum Module', _points => $2::jsonb) as r`,
    [title, JSON.stringify(points)],
  );

// A tutor's import lands whole, in the pasted order, and says how many.
await as(tutor);
const made = (
  await importTopic([
    { code: "4.1.1.2", title: " Animal and plant cells ", description: "  " },
    { code: "4.1.1.1", title: "Eukaryotes and prokaryotes", description: "Both have DNA" },
    { code: "4.1.1.3", title: "Cell specialisation" },
  ])
).rows[0].r;
assert.equal(made.points, 3, "The count isn't the number of points written");
const topic = (
  await db.query<{ code: string; title: string; sort_order: number; created_by: string }>(
    "select code, title, sort_order, created_by from topics where id = $1",
    [made.topic_id],
  )
).rows[0];
assert.deepEqual(topic, {
  code: "Topic 4.1",
  title: "Cell biology",
  sort_order: 100,
  created_by: tutor,
});
const points = (
  await db.query<{ code: string; title: string; description: string | null; sort_order: number }>(
    "select code, title, description, sort_order from spec_points where topic_id = $1 order by sort_order",
    [made.topic_id],
  )
).rows;
assert.deepEqual(points, [
  { code: "4.1.1.2", title: "Animal and plant cells", description: null, sort_order: 0 },
  {
    code: "4.1.1.1",
    title: "Eukaryotes and prokaryotes",
    description: "Both have DNA",
    sort_order: 1,
  },
  { code: "4.1.1.3", title: "Cell specialisation", description: null, sort_order: 2 },
]);

// Anything wrong writes nothing at all: no topic is left without its points.
const before = [await count("topics"), await count("spec_points")];
await fails(
  () =>
    importTopic([
      { code: "1.1", title: "Fine" },
      { code: "BOOM", title: "Fails to write" },
      { code: "1.3", title: "Never reached" },
    ]),
  "A failed point write was skipped",
);
await fails(
  () =>
    importTopic([
      { code: "1.1", title: "Once" },
      { code: "1.1", title: "Twice" },
    ]),
  "A repeated code was imported",
);
await fails(
  () => importTopic([{ code: "1.1", title: "  " }]),
  "A point with no title was imported",
);
await fails(() => importTopic([]), "An empty topic was created");
await fails(
  () => importTopic([{ code: "1.1", title: "Fine" }], " "),
  "A topic with no title was created",
);
assert.deepEqual(
  [await count("topics"), await count("spec_points")],
  before,
  "A refused import left rows behind",
);

// Only a tutor can import; a signed-out caller can't call it at all.
await as(student);
await fails(
  () => importTopic([{ code: "1.1", title: "Cells" }]),
  "A student imported curriculum",
  "42501",
);
await db.exec("reset role");
await db.exec("set role anon");
await fails(
  () => importTopic([{ code: "1.1", title: "Cells" }]),
  "anon can call the import",
  "42501",
);
await db.exec("reset role");
assert.deepEqual(
  [await count("topics"), await count("spec_points")],
  before,
  "A refused caller left rows behind",
);

console.log("curriculum import: all checks passed");
