/** Isolated PostgreSQL regression checks for the fix-first access migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-fix-first-access-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1); // on monthly_1, enrolled in three subjects
const sibling = uuid(2); // no plan
const tutor = uuid(3);
const parent = uuid(4); // linked to child and sibling
const author = uuid(5); // the student whose week first needed a shared sheet
const classmate = uuid(6); // submitted on that sheet

// The tables, grants, policies and functions this migration touches, as
// production defines them before it (pg_policies / pg_get_functiondef).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private; create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
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
create table profiles(id uuid primary key references auth.users on delete cascade, display_name text,
  role profile_role not null default 'student', enrolled_courses text[], student_invite_code text unique);
create function public.gen_student_invite_code() returns text language sql volatile as $$ select 'ANG-' || upper(substr(md5(random()::text), 1, 8)) $$;
create table parent_student_links(id uuid primary key default gen_random_uuid(),
  parent_id uuid references profiles on delete cascade, student_id uuid references profiles on delete cascade);
create table subscriptions(student_id uuid, user_id uuid, plan text, status text, current_period_end timestamptz);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, link text, created_at timestamptz default now());

create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select case
    when p_uid is null then false
    when p_uid <> (select auth.uid()) and not private.has_role((select auth.uid()), 'tutor'::app_role) then false
    when private.has_role(p_uid, 'tutor'::app_role) then true
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'student') then private.student_has_access(p_uid)
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'parent')
      then exists (select 1 from public.parent_student_links l where l.parent_id = p_uid and private.student_has_access(l.student_id))
    else false end $$;
create function private.my_content_subjects() returns text[] language sql stable security definer set search_path = public, private as $$
  select case when not private.viewer_has_content_access((select auth.uid())) then '{}'::text[]
  else coalesce((select array_agg(distinct s) from (
    select unnest(coalesce(p.enrolled_courses, '{}'::text[])) as s from public.profiles p where p.id = (select auth.uid())
    union
    select unnest(coalesce(cp.enrolled_courses, '{}'::text[])) as s from public.parent_student_links l
      join public.profiles cp on cp.id = l.student_id where l.parent_id = (select auth.uid())) q), '{}'::text[]) end $$;
create function public.is_enrolled_in(_user_id uuid, _subject subject) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() or private.has_role(auth.uid(), 'tutor'::public.app_role) then
    return exists (select 1 from public.profiles p where p.id = _user_id and p.enrolled_courses @> array[_subject::text]);
  else return false; end if;
end $$;
create function public.tutor_directory() returns table(id uuid, display_name text) language sql stable security definer set search_path = public, private, pg_temp as $$
  select p.id, coalesce(nullif(btrim(p.display_name), ''), 'Tutor') from public.profiles p
  join public.user_roles r on r.user_id = p.id and r.role = 'tutor'::public.app_role
  where (select auth.uid()) is not null order by 2 $$;

create table topics(id uuid primary key default gen_random_uuid(), subject subject);
alter table topics enable row level security;
create policy "topics read scoped" on topics for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role)) or ((subject)::text in (select unnest(private.my_content_subjects()))));

create table resources(id uuid primary key default gen_random_uuid(), created_by uuid not null, subject subject,
  file_path text, mark_scheme_path text, review_status text default 'approved', publish_at timestamptz);
alter table resources add constraint resources_created_by_fkey foreign key (created_by) references auth.users(id) on delete cascade;
alter table resources enable row level security;
create policy "resources read scoped" on resources for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role)) or ((subject)::text in (select unnest(private.my_content_subjects()))));

create table homework_questions(id uuid primary key default gen_random_uuid(), resource_id uuid references resources on delete cascade,
  position int, prompt text, marks int, answer_type text, mark_scheme text, image_path text, image_name text,
  spec_point_id uuid, created_at timestamptz default now());
alter table homework_questions enable row level security;
create policy "hq read via resource" on homework_questions for select to authenticated using (
  private.has_role((select auth.uid()), 'tutor'::app_role) or exists (select 1 from resources r
  where r.id = homework_questions.resource_id and private.viewer_has_content_access((select auth.uid()))));
create policy "hq tutors write" on homework_questions for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid references resources on delete cascade,
  student_id uuid, graded_at timestamptz);

create table student_program_plan(student_id uuid, subject subject, exam_date date not null, primary key(student_id, subject));

create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create policy "resources bucket read scoped" on storage.objects for select to authenticated using (
  (bucket_id = 'resources') and (private.has_role(auth.uid(), 'tutor'::app_role) or ((name ~~ 'submissions/%')
  and ((name ~~ (('submissions/' || (auth.uid())::text) || '/%')) or (exists (select 1 from parent_student_links l
  where ((l.parent_id = auth.uid()) and (objects.name ~~ (('submissions/' || (l.student_id)::text) || '/%'))))))) or (exists (select 1
  from resources r where (((r.file_path = objects.name) or (r.mark_scheme_path = objects.name)) and (is_enrolled_in(auth.uid(), r.subject)
  or (exists (select 1 from (parent_student_links l join profiles p on ((p.id = l.student_id))) where ((l.parent_id = auth.uid())
  and (p.enrolled_courses @> array[(r.subject)::text]))))))))));

create table chat_threads(id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade, tutor_id uuid references profiles(id) on delete set null,
  subject_line text not null default 'Hi', status text not null default 'open',
  student_last_read_at timestamptz, tutor_last_read_at timestamptz,
  last_message_at timestamptz not null default now(), about_student_id uuid references profiles(id) on delete cascade);
create table chat_messages(id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade, sender_id uuid not null references profiles(id) on delete cascade,
  body text not null, created_at timestamptz not null default now());
alter table chat_threads enable row level security;
create policy "chat_threads read own or tutor" on chat_threads for select using (
  (student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "chat_threads member creates own" on chat_threads for insert to authenticated with check (
  (student_id = (select auth.uid())) and case when exists (select 1 from profiles p where p.id = (select auth.uid()) and p.role = 'parent')
  then (about_student_id is not null and exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))
  else about_student_id is null end);
create policy "chat_threads participants update" on chat_threads for update to authenticated
  using ((student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))
  with check (private.has_role((select auth.uid()), 'tutor'::app_role) or ((student_id = (select auth.uid()))
  and ((about_student_id is null) or exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))));
alter table chat_messages enable row level security;
create policy "chat_messages read participants" on chat_messages for select using (exists (select 1 from chat_threads t
  where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));
create policy "chat_messages send as self" on chat_messages for insert with check ((sender_id = (select auth.uid())) and exists (select 1
  from chat_threads t where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));
create function public.on_chat_message_insert() returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$ begin return new; end $$;
create trigger chat_message_fanout after insert on chat_messages for each row execute function on_chat_message_insert();

grant usage on schema public, auth, private, storage to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
grant select on storage.objects to authenticated;
grant execute on all functions in schema public, private to authenticated;
`);

// Production grants SELECT column by column as well as table-wide; mirror it
// so the revoke is tested against the same shape.
await db.exec(`grant select (id, resource_id, position, prompt, marks, answer_type, mark_scheme, image_path, image_name, spec_point_id, created_at)
  on homework_questions to authenticated, anon;`);

await db.exec(
  await readFile(
    new URL("../supabase/migrations/20260928090000_fix_first_access_rules.sql", import.meta.url),
    "utf8",
  ),
);

// ── Fixtures ──────────────────────────────────────────────────────────────
for (const id of [child, sibling, tutor, parent, author, classmate])
  await db.query("insert into auth.users values($1)", [id]);
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
const profile = (id: string, name: string, role: string, courses: string[] | null, code: string) =>
  db.query("insert into profiles values($1,$2,$3,$4,$5)", [id, name, role, courses, code]);
await profile(child, "Bea", "student", ["biology", "chemistry", "physics"], "ANG-CHILD");
await profile(sibling, "Al", "student", ["physics"], "ANG-SIB");
await profile(tutor, "Ms T", "tutor", null, "ANG-TUTOR");
await profile(parent, "Mum", "parent", null, "ANG-PARENT");
await profile(author, "Ann", "student", ["biology"], "ANG-AUTHOR");
await profile(classmate, "Cal", "student", ["biology"], "ANG-CLASS");
for (const s of [child, sibling])
  await db.query("insert into parent_student_links(parent_id, student_id) values($1,$2)", [
    parent,
    s,
  ]);
await db.query(
  "insert into subscriptions values($1,$2,'monthly_1','active',now() + interval '20 days')",
  [child, parent],
);
for (const s of ["biology", "chemistry", "physics"])
  await db.query("insert into topics(subject) values($1)", [s]);

await db.exec("set role authenticated");
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const asAdmin = async <T>(fn: () => Promise<T>) => {
  await db.exec("reset role");
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
const subjects = async () =>
  (await db.query<{ subject: string }>("select subject::text from topics order by 1")).rows.map(
    (r) => r.subject,
  );

// ── #7 Content covers the subjects paid for ───────────────────────────────
await as(child);
assert.deepEqual(await subjects(), ["biology"], "A 1-subject plan unlocked more than one subject");
await as(sibling);
assert.deepEqual(await subjects(), [], "A student with no plan read content");
await as(parent);
assert.deepEqual(
  await subjects(),
  ["biology"],
  "A parent read an unpaid child's subjects through another child's plan",
);
await asAdmin(() =>
  db.query("update subscriptions set plan='monthly_3' where student_id=$1", [child]),
);
await as(child);
assert.deepEqual(await subjects(), ["biology", "chemistry", "physics"], "A 3-subject plan was cut");
await asAdmin(() =>
  db.query("update subscriptions set plan='legacy' where student_id=$1", [child]),
);
assert.equal((await subjects()).length, 3, "A plan name without a count locked subjects away");
await asAdmin(() =>
  db.query("update subscriptions set status='paused' where student_id=$1", [child]),
);
assert.deepEqual(await subjects(), [], "A paused plan still read content");
await asAdmin(() =>
  db.query("update subscriptions set plan='monthly_1', status='active' where student_id=$1", [
    child,
  ]),
);
await as(tutor);
assert.equal((await subjects()).length, 3, "A tutor lost content access");

// ── #1 A purged author leaves the shared sheet behind ─────────────────────
const sheet = await asAdmin(async () => {
  const r = await db.query<{ id: string }>(
    "insert into resources(created_by, subject, file_path, mark_scheme_path) values($1,'biology','hw/sheet.pdf','hw/scheme.pdf') returning id",
    [author],
  );
  const id = r.rows[0].id;
  await db.query(
    "insert into homework_questions(resource_id, position, prompt, marks, answer_type, mark_scheme) values($1,1,'Define osmosis',2,'text','Water (1) across a membrane (1)')",
    [id],
  );
  await db.query("insert into homework_submissions(resource_id, student_id) values($1,$2)", [
    id,
    classmate,
  ]);
  await db.query(
    "insert into storage.objects(bucket_id, name) values('resources','hw/sheet.pdf'),('resources','hw/scheme.pdf')",
  );
  return id;
});
await asAdmin(() => db.query("delete from auth.users where id=$1", [author]));
const survived = await asAdmin(() =>
  db.query<{ created_by: string | null; subs: number }>(
    "select r.created_by, (select count(*)::int from homework_submissions s where s.resource_id = r.id) as subs from resources r where r.id=$1",
    [sheet],
  ),
);
assert.equal(survived.rows.length, 1, "Purging the author deleted the shared sheet");
assert.equal(survived.rows[0].created_by, null, "The sheet still points at a deleted user");
assert.equal(survived.rows[0].subs, 1, "Another student's submission went with the author");

// ── #10 Mark schemes after marking ────────────────────────────────────────
// Between the two migrations both apps must work: the one still live selects
// the column directly, and the new one calls the function.
await as(child);
assert.equal(
  (await db.query("select mark_scheme from homework_questions")).rows.length,
  1,
  "The first migration broke the app that still reads the column",
);
await db.query("select * from homework_mark_schemes($1)", [[sheet]]);

await asAdmin(async () =>
  db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260928090100_withhold_homework_mark_schemes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);
await fails(
  () => db.query("select mark_scheme from homework_questions"),
  "A student read the mark_scheme column directly",
);
const visible = await db.query("select id, prompt from homework_questions");
assert.equal(visible.rows.length, 1, "A student lost the questions themselves");
const schemes = () =>
  db.query<{ mark_scheme: string }>("select * from homework_mark_schemes($1)", [[sheet]]);
assert.equal((await schemes()).rows.length, 0, "The scheme was handed out before any submission");
await asAdmin(() =>
  db.query("insert into homework_submissions(resource_id, student_id) values($1,$2)", [
    sheet,
    child,
  ]),
);
assert.equal((await schemes()).rows.length, 0, "The scheme was handed out before marking");
await asAdmin(() =>
  db.query("update homework_submissions set graded_at = now() where student_id=$1", [child]),
);
assert.equal((await schemes()).rows.length, 1, "The student couldn't see the scheme once marked");
await as(parent);
assert.equal((await schemes()).rows.length, 1, "A linked parent couldn't see a marked scheme");
await as(classmate);
assert.equal((await schemes()).rows.length, 0, "Another student's marking unlocked the scheme");
await as(tutor);
assert.equal((await schemes()).rows.length, 1, "A tutor couldn't read the scheme");
await as(child);
const files = await db.query<{ name: string }>("select name from storage.objects order by name");
assert.deepEqual(
  files.rows.map((f) => f.name),
  ["hw/sheet.pdf"],
  "A student could download the mark-scheme PDF",
);
await as(tutor);
assert.equal(
  (await db.query("select name from storage.objects")).rows.length,
  2,
  "A tutor lost the mark-scheme PDF",
);

// ── #9 A plausible exam date ──────────────────────────────────────────────
await fails(
  () =>
    asAdmin(() =>
      db.query("insert into student_program_plan values($1,'biology','0002-06-01')", [child]),
    ),
  "A year-2 exam date was stored",
);
await asAdmin(() =>
  db.query("insert into student_program_plan values($1,'biology','2027-06-07')", [child]),
);

// ── #2 A thread can only name a real tutor ────────────────────────────────
const open = (tutorId: string, about: string | null) =>
  db.query<{ id: string }>(
    "insert into chat_threads(student_id, tutor_id, about_student_id) values(auth.uid(),$1,$2) returning id",
    [tutorId, about],
  );
const send = (thread: string, body: string) =>
  db.query("insert into chat_messages(thread_id, sender_id, body) values($1, auth.uid(), $2)", [
    thread,
    body,
  ]);
const bell = (user: string) =>
  asAdmin(() =>
    db.query<{ title: string }>("select title from notifications where user_id=$1", [user]),
  );

await as(sibling);
await fails(() => open(child, null), "A student opened a thread naming another student as tutor");
const ownThread = (await open(tutor, null)).rows[0].id;
await fails(
  () => db.query("update chat_threads set tutor_id=$1 where id=$2", [child, ownThread]),
  "A student repointed their thread at another student",
);
// A bad thread that predates the fix must still not reach a bell.
const legacy = await asAdmin(async () => {
  const r = await db.query<{ id: string }>(
    "insert into chat_threads(student_id, tutor_id) values($1,$2) returning id",
    [sibling, child],
  );
  return r.rows[0].id;
});
await send(legacy, "boo");
assert.equal((await bell(child)).rows.length, 0, "A message reached a non-tutor's bell");
await send(ownThread, "What is osmosis?");
assert.equal((await bell(tutor)).rows.length, 1, "A real tutor stopped being notified");

// ── #3 An unlinked parent loses the chat and the code changes ────────────
await as(parent);
const parentThread = (await open(tutor, child)).rows[0].id;
await send(parentThread, "How is Bea getting on?");
await as(tutor);
await send(parentThread, "Really well.");
assert.equal((await bell(parent)).rows.length, 1, "A linked parent missed a tutor reply");

const codeBefore = await asAdmin(
  async () =>
    (
      await db.query<{ code: string }>(
        "select student_invite_code as code from profiles where id=$1",
        [child],
      )
    ).rows[0].code,
);
await asAdmin(() =>
  db.query("delete from parent_student_links where parent_id=$1 and student_id=$2", [
    parent,
    child,
  ]),
);
const codeAfter = await asAdmin(
  async () =>
    (
      await db.query<{ code: string }>(
        "select student_invite_code as code from profiles where id=$1",
        [child],
      )
    ).rows[0].code,
);
assert.notEqual(codeAfter, codeBefore, "The child's invite code survived the unlink");

await as(parent);
assert.equal(
  (await db.query("select id from chat_threads where id=$1", [parentThread])).rows.length,
  0,
  "An unlinked parent could still read the thread about the child",
);
assert.equal(
  (await db.query("select id from chat_messages where thread_id=$1", [parentThread])).rows.length,
  0,
  "An unlinked parent could still read the messages",
);
await fails(() => send(parentThread, "Still here"), "An unlinked parent could still post");
await as(tutor);
await send(parentThread, "Following up.");
assert.equal((await bell(parent)).rows.length, 1, "An unlinked parent was notified of a reply");
assert.equal(
  (await db.query("select id from chat_threads where id=$1", [parentThread])).rows.length,
  1,
  "The tutor lost the thread's history",
);

// Relinking brings the history back.
await asAdmin(() =>
  db.query("insert into parent_student_links(parent_id, student_id) values($1,$2)", [
    parent,
    child,
  ]),
);
await as(parent);
assert.equal(
  (await db.query("select id from chat_messages where thread_id=$1", [parentThread])).rows.length,
  3,
  "A relinked parent didn't get the history back",
);

// ── Both rollbacks run, newest first ──────────────────────────────────────
// Restoring NOT NULL needs every sheet to have an author again, which is the
// rollback's stated precondition.
await asAdmin(async () => {
  await db.query("delete from resources where created_by is null");
  for (const f of [
    "20260928090100_withhold_homework_mark_schemes",
    "20260928090000_fix_first_access_rules",
  ])
    await db.exec(
      await readFile(new URL(`../supabase/rollbacks/${f}.down.sql`, import.meta.url), "utf8"),
    );
});
await as(sibling);
await open(child, null); // the #2 hole is back: proof the rollback restored the old rule

console.log("fix-first access migration: all checks passed");
