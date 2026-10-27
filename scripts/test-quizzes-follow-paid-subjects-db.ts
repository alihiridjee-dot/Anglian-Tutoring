/** Isolated PostgreSQL regression checks for 20261027131300_quizzes_follow_paid_subjects.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-quizzes-follow-paid-subjects-db.ts
 *
 * The rollback file holds the live definitions from before the migration, so it
 * runs first to show the leak (a one-subject student reading every subject's
 * quizzes, a parent marked and handed the answer key), then the migration to
 * show it closed, with tutors reading exactly as before.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const one = uuid(1); // enrolled in chemistry + biology, pays for one: chemistry
const two = uuid(2); // enrolled in three, pays for two: chemistry + biology
const parent = uuid(3); // linked to `one`
const tutor = uuid(4);
const lapsed = uuid(5); // enrolled in chemistry, subscription cancelled

const chemQuiz = uuid(10);
const bioQuiz = uuid(11);
const physQuiz = uuid(12);
const pointQuiz = uuid(13); // no subject of its own; its spec point is biology
const orphanQuiz = uuid(14); // no subject and no spec point
const chemDraft = uuid(15); // unpublished
const bioTopic = uuid(30);
const bioPoint = uuid(31);
const allSets = [chemQuiz, bioQuiz, physQuiz, pointQuiz, orphanQuiz, chemDraft];

// The tables, grants and functions these policies and grade_mcq_attempt touch,
// as production defines them (pg_policies / pg_get_functiondef, 27 Oct 2026).
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create table user_roles(user_id uuid, role app_role);
create table profiles(id uuid primary key, role profile_role not null default 'student', enrolled_courses text[]);
create table parent_student_links(parent_id uuid, student_id uuid);
create table subscriptions(student_id uuid, plan text, status text, current_period_end timestamptz);

create function private.has_role(_user_id uuid, _role app_role) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'tutor'::public.app_role) then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create function private.is_staff(_user_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = _user_id and r.role in ('tutor', 'admin'))
      or exists (select 1 from public.profiles p where p.id = _user_id and p.role = 'tutor') $$;
create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
create function private.student_paid_subjects(p_student_id uuid) returns text[] language sql stable security definer set search_path = public, private as $$
  select coalesce((
    select case when x.cap is null then x.courses else x.courses[1:x.cap] end
    from (
      select coalesce(p.enrolled_courses, '{}'::text[]) as courses,
        (select max(case when split_part(s.plan, '_', 2) ~ '^[0-9]+$' then split_part(s.plan, '_', 2)::int else null end)
         from public.subscriptions s
         where s.student_id = p_student_id and s.status in ('active', 'trialing')
           and (s.current_period_end is null or s.current_period_end > now())) as cap
      from public.profiles p
      where p.id = p_student_id and private.student_has_access(p_student_id)
    ) x), '{}'::text[]) $$;
create function private.my_content_subjects() returns text[] language sql stable security definer set search_path = public, private as $$
  select case
    when (select auth.uid()) is null then '{}'::text[]
    else coalesce((
      select array_agg(distinct s) from (
        select unnest(private.student_paid_subjects((select auth.uid()))) as s
        union
        select unnest(private.student_paid_subjects(l.student_id)) as s
        from public.parent_student_links l where l.parent_id = (select auth.uid())
      ) q), '{}'::text[])
  end $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select case
    when p_uid is null then false
    when p_uid <> (select auth.uid()) and not private.has_role((select auth.uid()), 'tutor'::app_role) then false
    when private.has_role(p_uid, 'tutor'::app_role) then true
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'student') then private.student_has_access(p_uid)
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'parent')
      then exists (select 1 from public.parent_student_links l where l.parent_id = p_uid and private.student_has_access(l.student_id))
    else false end $$;

create table topics(id uuid primary key, subject subject);
create table spec_points(id uuid primary key, topic_id uuid references topics);
-- Spec points are read per board; here nobody but a tutor reads them, so the
-- subject fallback has to work without the caller seeing the point.
alter table spec_points enable row level security;
create policy "spec_points tutors only" on spec_points for select to authenticated
  using ((select private.has_role((select auth.uid()), 'tutor'::app_role)));

create table mcq_sets(id uuid primary key, published boolean not null, spec_point_id uuid references spec_points, subject subject);
create table mcq_questions(id uuid primary key default gen_random_uuid(), set_id uuid references mcq_sets on delete cascade,
  position int, question text, options jsonb, correct_index int, explanation text, spec_point_id uuid);
create table mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid not null references mcq_sets on delete cascade,
  user_id uuid not null, score int not null, total int not null, answers jsonb not null, created_at timestamptz default now(), point_scores jsonb);

-- student_row_not_staff, as it guards mcq_attempts.
create function private.refuse_student_row_for_staff() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_staff(new.user_id) then
    raise exception 'A tutor account can''t hold student data (%.user_id).', tg_table_name using errcode = '23514';
  end if;
  return new;
end $$;
create trigger student_row_not_staff before insert or update on mcq_attempts
  for each row execute function private.refuse_student_row_for_staff();

alter table mcq_sets enable row level security;
alter table mcq_questions enable row level security;
-- Placeholders: the rollback sets them to the live definitions.
create policy "mcq_sets read" on mcq_sets for select to authenticated using (false);
create policy "mcq_sets tutors write" on mcq_sets for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));
create policy "mcq_questions read via set" on mcq_questions for select to authenticated using (false);
create policy "mcq_questions tutors write" on mcq_questions for all to authenticated
  using (private.has_role((select auth.uid()), 'tutor'::app_role)) with check (private.has_role((select auth.uid()), 'tutor'::app_role));

-- Production's grants: no USAGE on private, EXECUTE only where the policies need it.
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid() to authenticated;
revoke execute on all functions in schema private from public;
grant execute on function private.has_role(uuid, app_role), private.viewer_has_content_access(uuid),
  private.my_content_subjects() to authenticated;
grant select on mcq_sets, spec_points, topics to authenticated;
-- The answer key (correct_index, explanation) is withheld from signed-in users.
grant select (id, set_id, position, question, options, spec_point_id) on mcq_questions to authenticated;

insert into user_roles values ('${tutor}', 'tutor');
insert into profiles values
  ('${one}', 'student', '{chemistry,biology}'),
  ('${two}', 'student', '{chemistry,biology,physics}'),
  ('${parent}', 'parent', null),
  ('${tutor}', 'tutor', null),
  ('${lapsed}', 'student', '{chemistry}');
insert into parent_student_links values ('${parent}', '${one}');
insert into subscriptions values
  ('${one}', 'monthly_1', 'active', now() + interval '20 days'),
  ('${two}', 'monthly_2', 'trialing', null),
  ('${lapsed}', 'monthly_1', 'canceled', now() - interval '1 day');
insert into topics values ('${bioTopic}', 'biology');
insert into spec_points values ('${bioPoint}', '${bioTopic}');
insert into mcq_sets values
  ('${chemQuiz}', true, null, 'chemistry'),
  ('${bioQuiz}', true, null, 'biology'),
  ('${physQuiz}', true, null, 'physics'),
  ('${pointQuiz}', true, '${bioPoint}', null),
  ('${orphanQuiz}', true, null, null),
  ('${chemDraft}', false, null, 'chemistry');
insert into mcq_questions (id, set_id, position, question, options, correct_index, explanation) values
  ('${uuid(20)}', '${chemQuiz}', 1, 'c1', '["a","b"]', 0, 'chem one'),
  ('${uuid(21)}', '${chemQuiz}', 2, 'c2', '["a","b"]', 1, 'chem two'),
  ('${uuid(22)}', '${bioQuiz}', 1, 'b1', '["a","b"]', 1, 'bio'),
  ('${uuid(23)}', '${physQuiz}', 1, 'p1', '["a","b"]', 0, 'phys'),
  ('${uuid(24)}', '${pointQuiz}', 1, 'pt1', '["a","b"]', 1, 'point'),
  ('${uuid(25)}', '${orphanQuiz}', 1, 'o1', '["a","b"]', 0, 'orphan'),
  ('${uuid(26)}', '${chemDraft}', 1, 'd1', '["a","b"]', 0, 'draft');
`);

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261027131300_quizzes_follow_paid_subjects.sql",
    import.meta.url,
  ),
  "utf8",
);
const before = await readFile(
  new URL(
    "../supabase/rollbacks/20261027131300_quizzes_follow_paid_subjects.down.sql",
    import.meta.url,
  ),
  "utf8",
);

const as = (who: string) =>
  db.query("select set_config('request.jwt.claim.sub', $1, false)", [who]);

/** The quiz ids `who` can read, and the quiz ids of the questions they can read. */
async function reads(who: string) {
  await as(who);
  await db.exec("set role authenticated");
  try {
    const sets = await db.query<{ id: string }>("select id from mcq_sets order by id");
    const qs = await db.query<{ set_id: string }>(
      "select distinct set_id from mcq_questions order by set_id",
    );
    return { sets: sets.rows.map((r) => r.id), questions: qs.rows.map((r) => r.set_id) };
  } finally {
    await db.exec("reset role");
  }
}

type Graded = { attempt_id: string; score: number; results: { correct_index: number }[] };

/** Calls grade_mcq_attempt as `who`; resolves to its reply or the error's message. */
async function grade(who: string, setId: string, answers: object = {}) {
  await as(who);
  await db.exec("set role authenticated");
  try {
    return (
      await db.query<{ r: Graded }>("select public.grade_mcq_attempt($1, $2::jsonb) r", [
        setId,
        JSON.stringify(answers),
      ])
    ).rows[0].r;
  } catch (err) {
    return (err as Error).message;
  } finally {
    await db.exec("reset role");
  }
}
const attempts = async () =>
  Number((await db.query<{ n: number }>("select count(*)::int n from mcq_attempts")).rows[0].n);

// Before: the live definitions.
await db.exec(before);

const leak = await reads(one);
assert.ok(
  leak.sets.includes(bioQuiz),
  "Expected the old policy to show a one-subject student biology",
);
assert.ok(leak.questions.includes(physQuiz), "Expected the old policy to show physics questions");
const parentMarked = (await grade(parent, chemQuiz)) as Graded;
assert.equal(
  parentMarked.results?.[0]?.correct_index,
  0,
  "Expected the old function to mark a parent and hand back the answer key",
);
const tutorBefore = await reads(tutor);
assert.deepEqual(tutorBefore.sets, allSets, "A tutor should read every quiz, drafts too");
assert.match(String(await grade(tutor, chemQuiz)), /tutor account can't hold student data/);
await db.exec("delete from mcq_attempts");

// After, applied twice to show it is idempotent.
await db.exec(migration);
await db.exec(migration);

// A one-subject student: their paid subject only.
assert.deepEqual(await reads(one), { sets: [chemQuiz], questions: [chemQuiz] });
const chem = (await grade(one, chemQuiz, { [uuid(20)]: 0, [uuid(21)]: 0 })) as Graded;
assert.equal(chem.score, 1, `A paid subject's quiz should mark: ${chem as unknown as string}`);
assert.equal(await grade(one, bioQuiz), "quiz not available");
assert.equal(await grade(one, pointQuiz), "quiz not available");
assert.equal(await grade(one, chemDraft), "quiz not available");
assert.equal(await grade(one, uuid(99)), "quiz not found");

// The retake lock still holds: a second go inside the week files nothing.
const retake = (await grade(one, chemQuiz, { [uuid(20)]: 0, [uuid(21)]: 1 })) as Graded;
assert.equal(retake.attempt_id, chem.attempt_id, "The weekly retake lock no longer holds");
assert.equal(retake.score, 1);
assert.equal(await attempts(), 1);

// A two-subject student: both, and a quiz with no subject goes by its spec
// point's, though they can't read the point itself.
assert.deepEqual(await reads(two), {
  sets: [chemQuiz, bioQuiz, pointQuiz],
  questions: [chemQuiz, bioQuiz, pointQuiz],
});
assert.equal(((await grade(two, pointQuiz, { [uuid(24)]: 1 })) as Graded).score, 1);
assert.equal(((await grade(two, bioQuiz, { [uuid(22)]: 0 })) as Graded).score, 0);
assert.equal(await grade(two, physQuiz), "quiz not available");
assert.equal(await grade(two, orphanQuiz), "quiz not available");
assert.equal(await attempts(), 3);

// A parent: their child's paid subjects, and never marked.
assert.deepEqual(await reads(parent), { sets: [chemQuiz], questions: [chemQuiz] });
assert.equal(await grade(parent, chemQuiz), "only students can submit quizzes");

// A lapsed student: nothing, as before.
assert.deepEqual(await reads(lapsed), { sets: [], questions: [] });
assert.equal(await grade(lapsed, chemQuiz), "quiz not available");

// A tutor reads exactly what they did; marking stops them sooner, with no row.
assert.deepEqual(await reads(tutor), tutorBefore, "A tutor's reads changed");
assert.equal(await grade(tutor, chemQuiz), "only students can submit quizzes");
assert.equal(await attempts(), 3);

// The answer key is still withheld from a direct read.
await as(one);
await db.exec("set role authenticated");
await assert.rejects(db.query("select correct_index from mcq_questions"), /permission denied/);
await db.exec("reset role");

// The rollback restores the old reads.
await db.exec(before);
assert.ok((await reads(one)).sets.includes(bioQuiz), "The rollback didn't restore the old policy");

console.log("quizzes follow paid subjects: all checks passed");
