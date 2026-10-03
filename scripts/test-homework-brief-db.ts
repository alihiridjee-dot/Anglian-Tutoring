/** Isolated PostgreSQL regression checks for S-11 and M-20: a homework brief,
 * its questions and its spec-point links are saved together or not at all,
 * questions can be reordered, and only a tutor can save. No production data
 * is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-homework-brief-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const tutor = uuid(1);
const student = uuid(2);
const pointA = uuid(10);
const pointB = uuid(11);
const missingPoint = uuid(99);

// The tables, constraints, policies and grants these writes touch, as
// production defines them (information_schema and pg_policies, 1 Oct 2026).
// Browsers can't select homework_questions.mark_scheme since #88.
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type level as enum ('gcse','alevel','gcse_trilogy','igcse');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type resource_kind as enum ('video','download','live_session','homework');
create type resource_origin as enum ('tutor','generated');
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
create table spec_points(id uuid primary key);
create table resources(id uuid primary key default gen_random_uuid(), kind resource_kind not null, title text not null,
  description text, subject subject not null, board board, level level not null, due_at timestamptz, instructions text,
  created_by uuid, created_at timestamptz not null default now(), origin resource_origin not null default 'tutor',
  review_status text not null default 'approved');
alter table resources enable row level security;
create policy "resources read scoped" on resources for select to authenticated using (true);
create policy "resources tutors insert" on resources for insert to authenticated with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "resources tutors update" on resources for update to authenticated using (private.has_role((select auth.uid()), 'tutor'::app_role));
create table homework_questions(id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references resources on delete cascade, position integer not null, prompt text not null,
  marks integer not null default 1 check (marks >= 1 and marks <= 30),
  answer_type text not null default 'short' check (answer_type in ('short','long','numeric')),
  image_path text, image_name text, mark_scheme text, spec_point_id uuid references spec_points on delete set null,
  created_at timestamptz not null default now(), unique (resource_id, position));
alter table homework_questions enable row level security;
create policy "hq read via resource" on homework_questions for select to authenticated using (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "hq tutors write" on homework_questions for all to authenticated using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create table homework_answers(id uuid primary key default gen_random_uuid(),
  question_id uuid not null references homework_questions on delete cascade, answer text);
create table resource_spec_points(resource_id uuid not null references resources on delete cascade,
  spec_point_id uuid not null references spec_points on delete cascade, created_at timestamptz not null default now(),
  primary key (resource_id, spec_point_id));
alter table resource_spec_points enable row level security;
create policy "rsp read follows resource" on resource_spec_points for select using (exists (select 1 from resources r where r.id = resource_spec_points.resource_id));
create policy "rsp tutors write" on resource_spec_points for all using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
grant usage on schema public, auth, private to authenticated, anon;
grant all on resources, resource_spec_points, spec_points to authenticated, anon;
grant insert, update, delete on homework_questions to authenticated, anon;
grant select (id, resource_id, position, prompt, marks, answer_type, image_path, image_name, spec_point_id, created_at)
  on homework_questions to authenticated;
grant execute on all functions in schema private to authenticated, anon;
`);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001190000_save_homework_brief.sql", import.meta.url),
    "utf8",
  ),
);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query("insert into spec_points values($1),($2)", [pointA, pointB]);

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

type Q = { id?: string | null; prompt: string; marks?: number; mark_scheme?: string | null };
const save = (id: string | null, questions: Q[], points: string[] = [pointA], title = "Cells") =>
  db.query<{ id: string }>(
    `select public.save_homework_brief(
       _id => $1::uuid, _title => $2, _instructions => 'Answer every question',
       _due_at => now() + interval '7 days', _subject => 'biology', _board => 'aqa',
       _level => 'gcse', _spec_point_ids => $3::uuid[], _questions => $4::jsonb) as id`,
    [
      id,
      title,
      points,
      JSON.stringify(
        questions.map((q) => ({
          id: q.id ?? null,
          prompt: q.prompt,
          marks: q.marks ?? 1,
          answer_type: "short",
          mark_scheme: q.mark_scheme ?? null,
          spec_point_id: null,
        })),
      ),
    ],
  );
const sheet = async (id: string) =>
  (
    await db.query<{ id: string; prompt: string; position: number }>(
      "select id, prompt, position from homework_questions where resource_id = $1 order by position",
      [id],
    )
  ).rows;

// A new brief arrives with its questions, its links and its author.
await as(tutor);
const hw = (
  await save(
    null,
    [{ prompt: "Q1" }, { prompt: "Q2", mark_scheme: "M2" }, { prompt: "Q3" }],
    [pointA, pointB, pointA],
  )
).rows[0].id;
let rows = await sheet(hw);
assert.deepEqual(
  rows.map((r) => [r.prompt, r.position]),
  [
    ["Q1", 0],
    ["Q2", 1],
    ["Q3", 2],
  ],
);
assert.equal(await count("resource_spec_points"), 2, "Links were lost or duplicated");
const made = (
  await db.query<{ created_by: string; origin: string; kind: string }>(
    "select created_by, origin, kind from resources where id = $1",
    [hw],
  )
).rows[0];
assert.deepEqual(made, { created_by: tutor, origin: "tutor", kind: "homework" });
const [q1, q2, q3] = rows.map((r) => r.id);
await db.exec("reset role");
await db.query(
  "insert into homework_answers(question_id, answer) values ($1,'a1'),($2,'a2'),($3,'a3')",
  [q1, q2, q3],
);
await db.exec("set role authenticated");

// S-11, the old way: one request per question's position collides at once.
await fails(
  () => db.query("update homework_questions set position = 1 where id = $1", [q1]),
  "The per-question update no longer collides, so this test no longer shows the bug",
  "23505",
);

// Swapping two questions keeps both rows, so the answers stay with them.
await save(hw, [
  { id: q2, prompt: "Q2", mark_scheme: "M2" },
  { id: q1, prompt: "Q1" },
  { id: q3, prompt: "Q3" },
]);
rows = await sheet(hw);
assert.deepEqual(
  rows.map((r) => r.id),
  [q2, q1, q3],
  "Swapping two questions didn't save",
);

// Deleting a middle question and adding one at the end: one save, and only the
// removed question's answer goes with it.
await save(
  hw,
  [{ id: q2, prompt: "Q2 edited", mark_scheme: "M2" }, { id: q3, prompt: "Q3" }, { prompt: "Q4" }],
  [pointB],
);
rows = await sheet(hw);
assert.deepEqual(
  rows.map((r) => [r.prompt, r.position]),
  [
    ["Q2 edited", 0],
    ["Q3", 1],
    ["Q4", 2],
  ],
);
assert.equal(rows[0].id, q2, "An edited question lost its identity");
await db.exec("reset role");
assert.deepEqual(
  (
    await db.query<{ answer: string }>("select answer from homework_answers order by answer")
  ).rows.map((r) => r.answer),
  ["a2", "a3"],
  "Answers to kept questions were lost, or the removed one's survived",
);
assert.equal(
  (
    await db.query<{ m: string }>("select mark_scheme m from homework_questions where id = $1", [
      q2,
    ])
  ).rows[0].m,
  "M2",
  "The mark scheme wasn't written back",
);
await db.exec("set role authenticated");
assert.deepEqual(
  (
    await db.query<{ p: string }>(
      "select spec_point_id p from resource_spec_points where resource_id = $1",
      [hw],
    )
  ).rows.map((r) => r.p),
  [pointB],
  "Links weren't replaced",
);

// A failure part-way leaves nothing half-saved: here the last question is
// invalid, after the title, the delete and the reorder have run.
const before = JSON.stringify(await sheet(hw));
await fails(
  () =>
    save(
      hw,
      [
        { id: q3, prompt: "Q3" },
        { prompt: "Bad", marks: 99 },
      ],
      [pointA],
      "Renamed",
    ),
  "An out-of-range mark was accepted",
);
assert.equal(JSON.stringify(await sheet(hw)), before, "A failed save left questions half-changed");
assert.equal(
  (await db.query<{ title: string }>("select title from resources where id = $1", [hw])).rows[0]
    .title,
  "Cells",
  "A failed save kept the new title",
);

// M-20: a new brief whose questions fail leaves no empty brief behind.
const briefs = await count("resources");
await fails(() => save(null, [{ prompt: "" }]), "A blank prompt was accepted");
await fails(
  () => save(null, [{ prompt: "Q" }], [missingPoint]),
  "A missing spec point was accepted",
);
assert.equal(await count("resources"), briefs, "A failed new brief left an empty one behind");

// A question that isn't on this sheet, or appears twice, is refused.
const other = (await save(null, [{ prompt: "Other" }])).rows[0].id;
const otherQ = (await sheet(other))[0].id;
await fails(
  () => save(hw, [{ id: otherQ, prompt: "Stolen" }]),
  "Another sheet's question was moved",
  "P0002",
);
await fails(
  () =>
    save(hw, [
      { id: q3, prompt: "Q3" },
      { id: q3, prompt: "Q3 again" },
    ]),
  "A duplicated question was accepted",
);
assert.equal((await sheet(other))[0].prompt, "Other");

// Only homework is saved this way.
await db.exec("reset role");
const video = (
  await db.query<{ id: string }>(
    "insert into resources(kind, title, subject, level) values ('video','V','biology','gcse') returning id",
  )
).rows[0].id;
await db.exec("set role authenticated");
await fails(() => save(video, [{ prompt: "Q" }]), "A video was saved as a brief", "P0002");

// Row-level security still decides who writes: a student is refused, and nothing changes.
await as(student);
const total = await count("resources");
await fails(() => save(null, [{ prompt: "Q" }]), "A student created a brief");
await fails(() => save(hw, [{ prompt: "Q" }]), "A student rewrote a brief");
await as(tutor);
assert.equal(await count("resources"), total, "A refused write left a row");
assert.equal((await sheet(hw)).length, 3, "A student's save changed the sheet");

// Anonymous callers can't call it at all.
await db.exec("set role anon");
await fails(() => save(null, [{ prompt: "Q" }]), "anon could call save_homework_brief");

console.log("homework brief saves: all checks passed");
