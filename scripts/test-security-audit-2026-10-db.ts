/** Proves the confirmed findings in docs/SECURITY_AUDIT_2026-10.md against the
 * live definitions (policies, grants and function bodies read from production
 * on 1 Oct 2026). Each check asserts the behaviour as it stands today, so this
 * script passes while the finding is open and fails once it is fixed: update
 * the assertion in the PR that fixes it. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-security-audit-2026-10-db.ts
 */
import assert from "node:assert/strict";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1); // pays monthly_1 for Biology only
const tutor = uuid(2);
const bioSet = uuid(10);
const chemSet = uuid(11);
const chemQ = uuid(21);

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type subject as enum ('biology','chemistry','physics');
create type resource_origin as enum ('tutor','generated');
create table public.user_roles(user_id uuid, role app_role, unique (user_id, role));
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
create table public.profiles(id uuid primary key, display_name text, role profile_role not null default 'student',
  enrolled_courses text[] not null default '{}', phone text);
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.subscriptions(student_id uuid, plan text, status text, current_period_end timestamptz);
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text,
  title text, body text, link text, created_at timestamptz default now());

create function private.student_has_access(p_student_id uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from public.subscriptions s where s.student_id = p_student_id
    and s.status in ('active', 'trialing') and (s.current_period_end is null or s.current_period_end > now())) $$;
create function private.viewer_has_content_access(p_uid uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select case
    when p_uid is null then false
    when p_uid <> (select auth.uid()) and not private.has_role((select auth.uid()), 'tutor'::app_role) then false
    when private.has_role(p_uid, 'tutor'::app_role) then true
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'student') then private.student_has_access(p_uid)
    when exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'parent')
      then exists (select 1 from public.parent_student_links l where l.parent_id = p_uid and private.student_has_access(l.student_id))
    else false end $$;

-- Quizzes: the live policies and column grants.
create table public.mcq_sets(id uuid primary key, subject subject not null, published boolean not null default true,
  spec_point_id uuid, origin resource_origin not null default 'generated');
alter table public.mcq_sets enable row level security;
create policy "mcq_sets read" on public.mcq_sets for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or (published and (select private.viewer_has_content_access((select auth.uid())))));
create table public.mcq_questions(id uuid primary key, set_id uuid not null, position int not null, question text,
  options jsonb, correct_index int, explanation text, created_at timestamptz default now(), spec_point_id uuid);
alter table public.mcq_questions enable row level security;
create policy "mcq_questions read via set" on public.mcq_questions for select to authenticated using (
  (select private.has_role((select auth.uid()), 'tutor'::app_role))
  or ((select private.viewer_has_content_access((select auth.uid())))
      and exists (select 1 from public.mcq_sets s where s.id = mcq_questions.set_id and s.published)));
create table public.mcq_attempts(id uuid primary key default gen_random_uuid(), set_id uuid, user_id uuid,
  score int, total int, answers jsonb, point_scores jsonb, created_at timestamptz default now());

-- grade_mcq_attempt, as live (point scores trimmed: they don't bear on access).
create function public.grade_mcq_attempt(_set_id uuid, _answers jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  _uid uuid := auth.uid(); _is_tutor boolean; _visible boolean; _total int; _score int; _attempt_id uuid; _results jsonb;
begin
  if _uid is null then raise exception 'not signed in'; end if;
  _is_tutor := private.has_role(_uid, 'tutor'::app_role);
  select (_is_tutor or (s.published and private.viewer_has_content_access(_uid))) into _visible
  from mcq_sets s where s.id = _set_id;
  if _visible is null then raise exception 'quiz not found'; end if;
  if not _visible then raise exception 'quiz not available'; end if;
  select count(*) into _total from mcq_questions q where q.set_id = _set_id;
  select count(*) filter (where (_answers ->> q.id::text)::int = q.correct_index),
    jsonb_agg(jsonb_build_object('question_id', q.id, 'correct_index', q.correct_index, 'explanation', q.explanation))
  into _score, _results from mcq_questions q where q.set_id = _set_id;
  insert into mcq_attempts (set_id, user_id, score, total, answers) values (_set_id, _uid, _score, _total, _answers)
  returning id into _attempt_id;
  return jsonb_build_object('attempt_id', _attempt_id, 'score', _score, 'total', _total, 'results', _results);
end $$;

-- Chat: the live policies and delete_chat_thread.
create table public.chat_threads(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  tutor_id uuid, about_student_id uuid);
create table public.chat_messages(id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads on delete cascade, sender_id uuid not null,
  body text not null, created_at timestamptz not null default now());
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
create policy "chat_threads read own or tutor" on public.chat_threads for select using (
  private.has_role((select auth.uid()), 'tutor'::app_role) or ((student_id = (select auth.uid())) and ((about_student_id is null)
  or exists (select 1 from parent_student_links l where l.parent_id = (select auth.uid()) and l.student_id = chat_threads.about_student_id))));
create policy "chat_messages read participants" on public.chat_messages for select using (exists (select 1 from chat_threads t
  where t.id = chat_messages.thread_id and ((t.student_id = (select auth.uid())) or private.has_role((select auth.uid()), 'tutor'::app_role))));
create function private.chat_member_can_see(_member uuid, _about uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select _member = (select auth.uid()) and (_about is null or exists (select 1 from public.parent_student_links l
    where l.parent_id = _member and l.student_id = _about)) $$;
create function public.delete_chat_thread(p_thread_id uuid) returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_thread public.chat_threads%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to delete a conversation.'; end if;
  select * into v_thread from public.chat_threads where id = p_thread_id for update;
  if not found then return; end if;
  if not private.chat_member_can_see(v_thread.student_id, v_thread.about_student_id)
     and not private.has_role(auth.uid(), 'tutor'::public.app_role) then
    raise exception 'You can only delete your own conversations.';
  end if;
  delete from public.chat_threads where id = p_thread_id;
end $$;

-- The sign-up trigger, as live (the parent-code arm is S-34's, omitted).
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare meta_role text; final_role public.profile_role;
begin
  final_role := 'student';
  insert into public.profiles (id, display_name, role) values (NEW.id, split_part(NEW.email, '@', 1), final_role);
  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor') on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student') on conflict do nothing;
  end if;
  return NEW;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

grant usage on schema public, auth, private to authenticated, anon;
grant all on all tables in schema public to authenticated, anon;
revoke select on public.mcq_questions from authenticated, anon;
grant select (id, set_id, position, question, options, created_at, spec_point_id) on public.mcq_questions to authenticated;
grant execute on all functions in schema private to authenticated;
`);

await db.query("insert into auth.users values ($1, 'kid@example.com'), ($2, 'tutor@example.com')", [
  student,
  tutor,
]);
await db.query("insert into user_roles values ($1, 'tutor') on conflict do nothing", [tutor]);
await db.query("update profiles set enrolled_courses = '{biology}' where id = $1", [student]);
await db.query(
  "insert into subscriptions values ($1, 'monthly_1', 'active', now() + interval '20 days')",
  [student],
);
await db.query("insert into mcq_sets(id, subject) values ($1, 'biology'), ($2, 'chemistry')", [
  bioSet,
  chemSet,
]);
await db.query(
  `insert into mcq_questions(id, set_id, position, question, options, correct_index, explanation)
   values ($1, $2, 0, 'Moles in 18 g of water?', '["0.5","1","2"]', 1, 'M = 18')`,
  [chemQ, chemSet],
);

await db.exec("set role authenticated");
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

// ── Finding 1: quizzes aren't scoped to the subjects paid for ───────────────
await as(student);
const sets = await db.query<{ subject: string }>("select subject::text from mcq_sets order by 1");
assert.deepEqual(
  sets.rows.map((r) => r.subject),
  ["biology", "chemistry"],
  "Finding 1 fixed? A Biology-only student no longer sees the Chemistry set",
);
const questions = await db.query<{ question: string }>("select question from mcq_questions");
assert.equal(
  questions.rows.length,
  1,
  "Finding 1 fixed? Chemistry questions are no longer readable",
);
await assert.rejects(
  () => db.query("select correct_index from mcq_questions"),
  "The answer key itself is still withheld at column level",
);
const graded = await db.query<{ r: { results: { correct_index: number }[] } }>(
  "select public.grade_mcq_attempt($1, '{}'::jsonb) r",
  [chemSet],
);
assert.equal(
  graded.rows[0].r.results[0].correct_index,
  1,
  "Finding 1 fixed? Grading an unpaid subject's quiz no longer returns its answers",
);

// ── Finding 2: a student can delete a whole conversation, the tutor's replies too ─
await db.exec("reset role");
const thread = (
  await db.query<{ id: string }>(
    "insert into chat_threads(student_id, tutor_id) values ($1, $2) returning id",
    [student, tutor],
  )
).rows[0].id;
await db.query(
  "insert into chat_messages(thread_id, sender_id, body) values ($1, $2, 'Help with moles'), ($1, $3, 'Divide mass by Mr')",
  [thread, student, tutor],
);
await db.exec("set role authenticated");
await as(student);
await db.query("select public.delete_chat_thread($1)", [thread]);
await db.exec("reset role");
const left = await db.query("select 1 from chat_messages where thread_id = $1", [thread]);
assert.equal(
  left.rows.length,
  0,
  "Finding 2 fixed? The tutor's reply survives the student's delete",
);

// ── Finding 3: sign-up grants tutor to one hard-coded address ───────────────
const newcomer = uuid(3);
await db.query("insert into auth.users values ($1, 'ASA180@live.co.uk')", [newcomer]);
const roles = await db.query<{ role: string }>(
  "select role::text from user_roles where user_id = $1",
  [newcomer],
);
assert.deepEqual(
  roles.rows.map((r) => r.role),
  ["tutor"],
  "Finding 3 fixed? Creating an account with that address no longer makes it a tutor",
);

console.log("security audit 2026-10: findings 1–3 reproduce against the live definitions");
