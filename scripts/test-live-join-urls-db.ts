/** Isolated PostgreSQL regression checks for S-20: live-session join links go
 * only to tutors and to students on the session's course, and browsers can't
 * read resources.join_url once it is withheld. No production data is read or
 * written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-live-join-urls-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1); // GCSE, Biology with AQA and Chemistry with Edexcel, both paid
const alevel = uuid(2); // A-level Biology, paid
const parent = uuid(3); // linked to `student`
const tutor = uuid(4);
const unpaid = uuid(5); // GCSE Biology, no plan
const noLevel = uuid(6); // Biology, paid, never picked a level
const oneSubject = uuid(7); // GCSE Biology and Chemistry, plan pays for one

// The tables, grants, policies and functions S-20 touches, as production
// defines them (pg_policies / pg_get_functiondef, 1 Oct 2026).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
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
create table profiles(id uuid primary key, role profile_role not null default 'student',
  enrolled_courses text[] not null default '{}', level level);
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  subject subject not null, board board not null);
create table parent_student_links(parent_id uuid, student_id uuid);
create table subscriptions(student_id uuid, plan text, status text, current_period_end timestamptz);

create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
create function private.student_paid_subjects(p_student_id uuid) returns text[] language sql stable security definer set search_path = public, private as $$
  select coalesce((select case when x.cap is null then x.courses else x.courses[1:x.cap] end
    from (select coalesce(p.enrolled_courses, '{}'::text[]) as courses,
      (select max(case when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int else null end)
        from public.subscriptions s where s.student_id = p_student_id and s.status in ('active', 'trialing')
          and (s.current_period_end is null or s.current_period_end > now())) as cap
      from public.profiles p where p.id = p_student_id and private.student_has_access(p_student_id)) x), '{}'::text[]) $$;
create function private.my_content_subjects() returns text[] language sql stable security definer set search_path = public, private as $$
  select case when (select auth.uid()) is null then '{}'::text[] else coalesce((select array_agg(distinct s) from (
    select unnest(private.student_paid_subjects((select auth.uid()))) as s
    union
    select unnest(private.student_paid_subjects(l.student_id)) as s from public.parent_student_links l
    where l.parent_id = (select auth.uid())) q), '{}'::text[]) end $$;

-- Every production column, in order: the second step re-grants each by name.
create table resources(id uuid primary key default gen_random_uuid(), kind resource_kind not null, title text not null,
  description text, subject subject not null, board board, level level not null, video_url text, duration_seconds integer,
  file_path text, file_name text, file_mime text, file_size bigint, mark_scheme_path text, mark_scheme_name text,
  starts_at timestamptz, join_url text, due_at timestamptz, instructions text, created_by uuid,
  created_at timestamptz not null default now(), spec_point_id uuid, origin resource_origin not null default 'tutor',
  review_status text not null default 'approved', publish_at timestamptz, reviewed_by uuid, reviewed_at timestamptz);
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid);
alter table resources enable row level security;
create policy "resources read scoped" on resources for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or (((subject)::text in (select unnest(private.my_content_subjects())))
    and ((review_status = 'approved') or ((review_status = 'to_review') and ((publish_at is null) or (publish_at <= now())))
      or (exists (select 1 from homework_submissions s where s.resource_id = resources.id)))));
create policy "resources tutors insert" on resources for insert to authenticated with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "resources tutors update" on resources for update to authenticated using (private.has_role((select auth.uid()), 'tutor'::app_role));
create table resource_spec_points(resource_id uuid not null, spec_point_id uuid not null, created_at timestamptz not null default now());
alter table resource_spec_points enable row level security;
create policy "rsp read follows resource" on resource_spec_points for select using (exists (select 1 from resources r where r.id = resource_spec_points.resource_id));

grant usage on schema public, auth, private to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;
`);

const migration = (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
await db.exec(await migration("20261001121511_live_session_join_urls.sql"));

// ── Fixtures ──────────────────────────────────────────────────────────────
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
const profile = (id: string, role: string, courses: string[], level: string | null) =>
  db.query("insert into profiles values($1,$2,$3,$4)", [id, role, courses, level]);
const enrol = (id: string, subject: string, board: string) =>
  db.query("insert into student_enrolments(student_id, subject, board) values($1,$2,$3)", [
    id,
    subject,
    board,
  ]);
const plan = (id: string, name: string) =>
  db.query("insert into subscriptions values($1,$2,'active',now() + interval '20 days')", [
    id,
    name,
  ]);
await profile(student, "student", ["biology", "chemistry"], "gcse");
await enrol(student, "biology", "aqa");
await enrol(student, "chemistry", "edexcel");
await plan(student, "monthly_2");
await profile(alevel, "student", ["biology"], "alevel");
await enrol(alevel, "biology", "aqa");
await plan(alevel, "monthly_1");
await profile(parent, "parent", [], null);
await db.query("insert into parent_student_links values($1,$2)", [parent, student]);
await profile(tutor, "tutor", [], null);
await profile(unpaid, "student", ["biology"], "gcse");
await enrol(unpaid, "biology", "aqa");
await profile(noLevel, "student", ["biology"], null);
await enrol(noLevel, "biology", "aqa");
await plan(noLevel, "monthly_1");
await profile(oneSubject, "student", ["biology", "chemistry"], "gcse");
await enrol(oneSubject, "biology", "aqa");
await enrol(oneSubject, "chemistry", "edexcel");
await plan(oneSubject, "monthly_1"); // pays for the first listed subject only

const session = async (
  title: string,
  subject: string,
  level: string,
  board: string | null,
  review = "approved",
) =>
  (
    await db.query<{ id: string }>(
      `insert into resources(kind, title, subject, level, board, join_url, review_status)
       values('live_session',$1,$2,$3,$4,$5,$6) returning id`,
      [title, subject, level, board, `https://zoom.us/j/${title.length}?pwd=secret`, review],
    )
  ).rows[0].id;
const gcseBio = await session("GCSE Biology", "biology", "gcse", null);
const alevelBio = await session("A-level Biology", "biology", "alevel", null);
const gcseBioOcr = await session("GCSE Biology, OCR only", "biology", "gcse", "ocr");
const gcseBioAqa = await session("GCSE Biology, AQA only", "biology", "gcse", "aqa");
const gcseChem = await session("GCSE Chemistry", "chemistry", "gcse", null);
const held = await session("GCSE Biology held", "biology", "gcse", null, "held");
const all = [gcseBio, alevelBio, gcseBioOcr, gcseBioAqa, gcseChem, held];

await db.exec("set role authenticated");
const as = (id: string | null) =>
  db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
const asRole = async <T>(role: string, fn: () => Promise<T>) => {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("set role authenticated");
  }
};
const fails = async (q: () => Promise<unknown>, what: string) => {
  let threw = false;
  try {
    await q();
  } catch {
    threw = true;
  }
  assert(threw, what);
};
const links = async () =>
  new Set(
    (
      await db.query<{ id: string }>("select id from public.live_session_join_urls($1)", [all])
    ).rows.map((r) => r.id),
  );

// ── Who gets a link ───────────────────────────────────────────────────────
const checkLinks = async () => {
  await as(tutor);
  assert.equal((await links()).size, all.length, "A tutor lost a join link");

  await as(student);
  assert.deepEqual(
    await links(),
    new Set([gcseBio, gcseBioAqa, gcseChem]),
    "A GCSE student got the wrong links: another level's, another board's, or a held session's",
  );

  await as(alevel);
  assert.deepEqual(await links(), new Set([alevelBio]), "An A-level student got a GCSE link");

  for (const [who, id] of [
    ["A parent", parent],
    ["A student with no plan", unpaid],
    ["A student with no level", noLevel],
  ] as const) {
    await as(id);
    assert.equal((await links()).size, 0, `${who} got a join link`);
  }

  await as(oneSubject);
  assert.deepEqual(
    await links(),
    new Set([gcseBio, gcseBioAqa]),
    "A one-subject plan unlocked the unpaid subject's link",
  );

  await as(null);
  await asRole("anon", () =>
    fails(
      () => db.query("select * from public.live_session_join_urls($1)", [all]),
      "An anonymous caller could call live_session_join_urls",
    ),
  );
};
await checkLinks();

// Before the second step the column is still readable: this is the hole.
await as(parent);
assert.equal(
  (await db.query("select join_url from resources where join_url is not null")).rows.length,
  5,
  "Fixture check: a parent should still read every Biology and Chemistry link before step two",
);

// ── Second step: the column is withheld ───────────────────────────────────
await asRole("postgres", () =>
  migration("20261001121512_withhold_live_session_join_urls.sql").then((sql) => db.exec(sql)),
);

for (const id of [parent, student, tutor]) {
  await as(id);
  await fails(
    () => db.query("select join_url from resources"),
    "A signed-in user could still read resources.join_url",
  );
  await fails(
    () => db.query("select * from resources"),
    "select * still reads the withheld column",
  );
}
await as(null);
await asRole("anon", () =>
  fails(() => db.query("select join_url from resources"), "anon could still read join_url"),
);

// Every other column stays readable, by name and through an embed's subquery.
const columns = (
  await asRole("postgres", () =>
    db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'resources' and column_name <> 'join_url'",
    ),
  )
).rows.map((r) => r.column_name);
assert.equal(columns.length, 26, "Fixture check: resources should have 27 columns");
await as(student);
const visible = await db.query(`select ${columns.join(", ")} from resources`);
assert.equal(visible.rows.length, 5, "A student lost sight of the sessions RLS lets them read");
await asRole("postgres", () =>
  db.query("insert into resource_spec_points values($1, gen_random_uuid())", [gcseBio]),
);
assert.equal(
  (await db.query("select resource_id from resource_spec_points")).rows.length,
  1,
  "resource_spec_points' policy can no longer see its resource",
);

// Tutors still write the link, and the function still hands it out.
await as(tutor);
const added = await db.query<{ id: string }>(
  `insert into resources(kind, title, subject, level, join_url)
   values('live_session','New','biology','gcse','https://zoom.us/j/1') returning id`,
);
await db.query("update resources set join_url = 'https://zoom.us/j/2' where id = $1", [
  added.rows[0].id,
]);
assert.equal(
  (
    await db.query<{ join_url: string }>("select join_url from public.live_session_join_urls($1)", [
      [added.rows[0].id],
    ])
  ).rows[0]?.join_url,
  "https://zoom.us/j/2",
  "A tutor's edited link didn't come back through the function",
);
await checkLinks();

console.log("live join urls: all checks passed");
