/** Isolated PostgreSQL checks for 20261003121119_user_roles_no_client_writes.sql:
 * a signed-in caller still reads their own roles, no client can write any (even
 * past a write policy added by mistake), and sign-up, grants by hand and the
 * service role still write through the table's triggers. No production data is
 * read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-user-roles-no-client-writes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TUTOR = uuid(1);
const STUDENT = uuid(2);
const NEWCOMER = uuid(3);

const file = (name: string) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

// public.user_roles as live on 3 Oct 2026: Supabase's default grants, its one
// policy, and the two triggers from 20261003115242_tutors_are_never_students
// (functions from pg_get_functiondef; bodies md5-identical to production's).
// The superuser owns everything here, as postgres does in production.
await db.exec(String.raw`
create role anon; create role authenticated; create role service_role bypassrls;
create role supabase_auth_admin;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;
create type public.app_role as enum ('student', 'tutor', 'admin');
create type public.profile_role as enum ('student', 'parent', 'tutor');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role not null default 'student', phone text, enrolled_courses text[] not null default '{}', level text, student_invite_code text);
create table public.user_roles(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, role public.app_role not null, unique (user_id, role));
alter table public.user_roles enable row level security;
grant usage on schema public to anon, authenticated, service_role;
grant all on public.user_roles to anon, authenticated, service_role;
create policy "roles self read" on public.user_roles for select to authenticated using ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION private.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
           select 1 from public.user_roles r
           where r.user_id = _user_id and r.role in ('tutor', 'admin')
         )
      or exists (
           select 1 from public.profiles p
           where p.id = _user_id and p.role = 'tutor'
         );
$function$;

CREATE OR REPLACE FUNCTION private.student_rows_held(_user_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _t record;
  _found boolean;
  _held text[] := '{}';
begin
  for _t in
    select t.tgrelid::regclass as tbl, c.relname, a.col
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    cross join lateral unnest(string_to_array(encode(t.tgargs, 'escape'), E'\\000')) as a(col)
    where t.tgname = 'student_row_not_staff' and a.col <> ''
    order by c.relname, a.col
  loop
    execute format('select exists (select 1 from %s where %I = $1)', _t.tbl, _t.col)
      into _found
      using _user_id;
    if _found then
      _held := _held || (_t.relname || '.' || _t.col);
    end if;
  end loop;
  return _held;
end;
$function$;

CREATE OR REPLACE FUNCTION private.check_staff_grant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _held text[];
begin
  if new.role in ('tutor', 'admin') then
    _held := private.student_rows_held(new.user_id);
    if exists (
      select 1 from public.profiles p
      where p.id = new.user_id
        and (p.level is not null or cardinality(p.enrolled_courses) > 0)
    ) then
      _held := _held || 'profiles.level/enrolled_courses'::text;
    end if;
    if cardinality(_held) > 0 then
      raise exception 'This account still has student data in: %.', array_to_string(_held, ', ')
        using errcode = '23514',
              hint = 'Remove it before making the account a tutor.';
    end if;
  elsif new.role = 'student' and private.is_staff(new.user_id) then
    raise exception 'A tutor account can''t also have the student role.'
      using errcode = '23514',
            hint = 'To take tutor access away, delete the tutor row in user_roles, then change profiles.role.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_staff_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.profiles
     set role = 'tutor', student_invite_code = null
   where id = new.user_id
     and (role is distinct from 'tutor' or student_invite_code is not null);
  delete from public.user_roles
   where user_id = new.user_id and role = 'student';
  return null;
end;
$function$;

CREATE TRIGGER staff_grant_not_student BEFORE INSERT OR UPDATE OF role, user_id ON public.user_roles FOR EACH ROW EXECUTE FUNCTION private.check_staff_grant();
CREATE TRIGGER staff_grant_syncs_profile AFTER INSERT OR UPDATE OF role, user_id ON public.user_roles FOR EACH ROW WHEN ((new.role = ANY (ARRAY['tutor'::app_role, 'admin'::app_role]))) EXECUTE FUNCTION private.sync_staff_profile();
`);

// Sign-up grants roles through production's handle_new_user (SECURITY
// DEFINER), from the migration whose body is md5-identical to the live one.
await db.exec(await file("20261001173000_signup_link_rules.sql"));
await db.exec(
  "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()",
);

/** One statement as a database role, signed in as `user` where that matters. */
async function asRole(
  role: string,
  sql: string,
  params: unknown[] = [],
  user: string | null = null,
) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await db.query<{ role: string }>(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
/** One statement as a caller through the API: anon, or signed in as `user`. */
const as = (user: string | null, sql: string, params: unknown[] = []) =>
  asRole(user ? "authenticated" : "anon", sql, params, user);
/** Supabase Auth creating an account, which fires handle_new_user. */
const signUp = (id: string, email: string) =>
  asRole("supabase_auth_admin", "insert into auth.users(id, email) values ($1, $2)", [id, email]);

const roles = async (id: string) =>
  (
    await db.query<{ role: string }>(
      "select role from public.user_roles where user_id = $1 order by role",
      [id],
    )
  ).rows.map((r) => r.role);
const profileRole = async (id: string) =>
  (await db.query<{ role: string }>("select role from public.profiles where id = $1", [id])).rows[0]
    ?.role;
const privileges = async (role: string) =>
  (
    await db.query(
      `select has_table_privilege($1, 'public.user_roles', 'select') as "select",
              has_table_privilege($1, 'public.user_roles', 'insert') as "insert",
              has_table_privilege($1, 'public.user_roles', 'update') as "update",
              has_table_privilege($1, 'public.user_roles', 'delete') as "delete",
              has_table_privilege($1, 'public.user_roles', 'truncate') as "truncate"`,
      [role],
    )
  ).rows[0];
const ALL = { select: true, insert: true, update: true, delete: true, truncate: true };
const READ_ONLY = { select: true, insert: false, update: false, delete: false, truncate: false };

// What a client could send. useRoles and guardState.ts send the first.
const ownRoles = (user: string) =>
  as(user, "select role from public.user_roles where user_id = $1", [user]);
const grantTutor = (user: string | null, to: string) =>
  as(user, "insert into public.user_roles(user_id, role) values ($1, 'tutor')", [to]);
const promoteSelf = (user: string) =>
  as(user, "update public.user_roles set role = 'tutor' where user_id = $1 returning role", [user]);
const MISTAKE = `create policy "a mistake" on public.user_roles for all to authenticated using (true) with check (true)`;
const DENIED = /permission denied for table user_roles/;

// A student signs up; a tutor is made by hand in SQL, as in production.
await signUp(STUDENT, "student@example.com");
await signUp(TUTOR, "tutor@example.com");
await db.query("update public.user_roles set role = 'tutor' where user_id = $1", [TUTOR]);
assert.deepEqual(await roles(STUDENT), ["student"]);
assert.deepEqual(await roles(TUTOR), ["tutor"]);

// ── Before: only row-level security stops a client write ────────────────────
assert.deepEqual(await privileges("authenticated"), ALL);
assert.deepEqual(await privileges("anon"), ALL);
await assert.rejects(grantTutor(STUDENT, STUDENT), /row-level security/);
assert.equal((await promoteSelf(STUDENT)).rows.length, 0, "an update finds no row it may change");

// One permissive write policy added by mistake, and a student makes themselves
// a tutor, profile and all. (Rolled back.)
await db.exec("begin");
await db.exec(MISTAKE);
await promoteSelf(STUDENT);
assert.deepEqual(await roles(STUDENT), ["tutor"]);
assert.equal(await profileRole(STUDENT), "tutor");
await db.exec("rollback");
assert.deepEqual(await roles(STUDENT), ["student"]);

// ── The migration, with that mistaken policy in place ───────────────────────
await db.exec(MISTAKE);
const migration = await file("20261003121119_user_roles_no_client_writes.sql");
await db.exec(migration);
await db.exec(migration); // idempotent

assert.deepEqual(await privileges("authenticated"), READ_ONLY);
assert.deepEqual(await privileges("anon"), READ_ONLY);
assert.deepEqual(await privileges("service_role"), ALL);

// No client writes, whatever the policies say.
await assert.rejects(grantTutor(STUDENT, STUDENT), DENIED);
await assert.rejects(promoteSelf(STUDENT), DENIED);
await assert.rejects(
  as(STUDENT, "delete from public.user_roles where user_id = $1", [TUTOR]),
  DENIED,
);
await assert.rejects(as(STUDENT, "truncate public.user_roles"), DENIED);
await assert.rejects(grantTutor(null, STUDENT), DENIED);
assert.deepEqual(await roles(STUDENT), ["student"]);
assert.deepEqual(await roles(TUTOR), ["tutor"]);
await db.exec(`drop policy "a mistake" on public.user_roles`);

// Reads are unchanged: each caller sees their own roles and no one else's.
assert.deepEqual((await ownRoles(STUDENT)).rows, [{ role: "student" }]);
assert.deepEqual((await ownRoles(TUTOR)).rows, [{ role: "tutor" }]);
assert.equal(
  (await as(STUDENT, "select role from public.user_roles where user_id = $1", [TUTOR])).rows.length,
  0,
);
assert.equal((await as(null, "select role from public.user_roles")).rows.length, 0);

// ── Server-side writes still work, and the triggers still fire ──────────────
// Sign-up grants the student role through handle_new_user.
await signUp(NEWCOMER, "newcomer@example.com");
assert.deepEqual(await roles(NEWCOMER), ["student"]);

// A grant by hand in SQL: staff_grant_syncs_profile moves the profile along,
await db.query("update public.user_roles set role = 'tutor' where user_id = $1", [NEWCOMER]);
assert.deepEqual(await roles(NEWCOMER), ["tutor"]);
assert.equal(await profileRole(NEWCOMER), "tutor");
// and staff_grant_not_student refuses a student grant for a tutor.
await assert.rejects(
  db.query("insert into public.user_roles(user_id, role) values ($1, 'student')", [NEWCOMER]),
  /can't also have the student role/,
);

// The service role keeps writing, and the same triggers judge its writes.
await assert.rejects(
  asRole("service_role", "insert into public.user_roles(user_id, role) values ($1, 'student')", [
    TUTOR,
  ]),
  /can't also have the student role/,
);
await asRole("service_role", "delete from public.user_roles where user_id = $1", [NEWCOMER]);
assert.deepEqual(await roles(NEWCOMER), []);

console.log("user_roles no client writes: all checks passed");
