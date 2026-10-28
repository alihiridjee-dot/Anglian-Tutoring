/** Proves the open findings in docs/SECURITY_AUDIT_2026-10.md against the live
 * definitions (policies, grants and function bodies read from production on
 * 1 Oct 2026). Each check asserts the behaviour as it stands today. The bodies
 * are frozen here, not read from the migrations, so a fix never turns this
 * red: the PR that fixes a finding removes its check, as the one for finding 1
 * did (fixed live 27 Oct by 20261027131300, now covered by
 * scripts/test-quizzes-follow-paid-subjects-db.ts). No production data is read
 * or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-security-audit-2026-10-db.ts
 */
import assert from "node:assert/strict";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const tutor = uuid(2);

await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
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
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text,
  title text, body text, link text, created_at timestamptz default now());

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
grant execute on all functions in schema private to authenticated;
`);

await db.query("insert into auth.users values ($1, 'kid@example.com'), ($2, 'tutor@example.com')", [
  student,
  tutor,
]);
await db.query("insert into user_roles values ($1, 'tutor') on conflict do nothing", [tutor]);

const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);

// ── Finding 2: a student can delete a whole conversation, the tutor's replies too ─
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

console.log("security audit 2026-10: findings 2 and 3 reproduce against the live definitions");
