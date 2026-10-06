/** Isolated PostgreSQL checks for 20261003115242_tutors_are_never_students.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-tutors-never-students-db.ts
 *
 * The sign-up trigger and the invite-code generator are production's own
 * definitions (3 Oct 2026), so sign-up — including the hard-coded tutor
 * account — is exercised through the new rules exactly as it runs live.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const migration = await readFile(
  new URL("../supabase/migrations/20261003115242_tutors_are_never_students.sql", import.meta.url),
  "utf8",
);

// Every table the migration guards, with the column(s) naming the student.
const GUARDED: Array<[string, string[]]> = [
  ["billing_change_leases", ["student_id"]],
  ["billing_feedback", ["student_id"]],
  ["chat_threads", ["student_id", "about_student_id"]],
  ["homework_drafts", ["student_id"]],
  ["homework_submissions", ["student_id"]],
  ["mcq_attempts", ["user_id"]],
  ["parent_link_invites", ["student_id"]],
  ["parent_student_links", ["student_id"]],
  ["session_attendees", ["user_id"]],
  ["student_enrolments", ["student_id"]],
  ["student_group_members", ["student_id"]],
  ["student_learning_profile", ["student_id"]],
  ["student_plan_overrides", ["student_id"]],
  ["student_program_plan", ["student_id"]],
  ["student_spec_point_confidence", ["student_id"]],
  ["student_spec_point_reviews", ["student_id"]],
  ["student_spec_point_schedule", ["student_id"]],
  ["student_term_plans", ["student_id"]],
  ["student_topic_confidence", ["student_id"]],
  ["student_tutor_notes", ["student_id"]],
  ["student_weekly_checkins", ["student_id"]],
  ["student_weekly_plans", ["student_id"]],
  ["student_weekly_tutor_notes", ["student_id"]],
  ["subscriptions", ["student_id"]],
  ["trial_codes", ["student_id"]],
];
const EXTRA: Record<string, string> = {
  chat_threads: ", tutor_id uuid",
  parent_student_links: ", parent_id uuid, unique (parent_id, student_id)",
};

await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create type level as enum ('gcse','alevel','igcse');
create table user_roles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, role app_role not null, unique (user_id, role));
create table profiles(id uuid primary key references auth.users, display_name text, role profile_role not null default 'student', enrolled_courses text[] not null default '{}', student_invite_code text, phone text, level level, school text, onboarding_completed_at timestamptz, created_at timestamptz default now());
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, link text);

create function public.gen_student_invite_code() returns text language sql as $$ select 'ANG-' || upper(substr(md5(random()::text), 1, 8)) $$;
CREATE OR REPLACE FUNCTION public.generate_invite_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.student_invite_code is null then
    new.student_invite_code := public.gen_student_invite_code();
  end if;
  return new;
end;
$function$;
create trigger t_profiles_invite_code before insert on public.profiles for each row execute function generate_invite_code();
`);
for (const [table, cols] of GUARDED) {
  await db.exec(
    `create table public.${table}(id uuid primary key default gen_random_uuid(), ${cols
      .map((c) => `${c} uuid`)
      .join(", ")}${EXTRA[table] ?? ""});`,
  );
}
// Production's sign-up trigger, verbatim.
await db.exec(`
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  meta_role text;
  final_role public.profile_role;
  v_code text := upper(btrim(coalesce(NEW.raw_user_meta_data->>'parent_invite_code', '')));
  v_student uuid;
  v_parent_name text;
begin
  meta_role := lower(coalesce(NEW.raw_user_meta_data->>'role', 'student'));

  final_role := case
    when meta_role in ('student', 'parent') then meta_role::public.profile_role
    else 'student'::public.profile_role
  end;

  insert into public.profiles (id, display_name, role, phone)
  values (
    NEW.id,
    coalesce(
      nullif(btrim(NEW.raw_user_meta_data->>'display_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(NEW.raw_user_meta_data->>'name'), ''),
      split_part(NEW.email, '@', 1)
    ),
    final_role,
    NEW.raw_user_meta_data->>'phone'
  );

  if lower(NEW.email) = 'asa180@live.co.uk' then
    insert into public.user_roles (user_id, role) values (NEW.id, 'tutor')
    on conflict do nothing;
    update public.profiles set role = 'tutor' where id = NEW.id;
  else
    insert into public.user_roles (user_id, role) values (NEW.id, 'student')
    on conflict do nothing;
  end if;

  if final_role = 'parent' and v_code <> '' then
    select p.id into v_student
    from public.profiles p
    where p.student_invite_code = v_code
      and p.role = 'student'::public.profile_role;

    if v_student is not null then
      insert into public.parent_student_links (parent_id, student_id)
      values (NEW.id, v_student)
      on conflict (parent_id, student_id) do nothing;

      select coalesce(nullif(btrim(p.display_name), ''), 'Your parent/guardian')
        into v_parent_name
      from public.profiles p where p.id = NEW.id;

      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_student, 'parent_invite', 'Parent linked to your account',
        v_parent_name || ' linked to your account using your invite code.', '/parents'
      );
    end if;
  end if;

  return NEW;
end;
$function$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
`);

await db.exec(migration);

// ── Helpers ───────────────────────────────────────────────────────────────
let n = 0;
const signUp = async (email: string, meta: Record<string, string> = {}) => {
  const id = `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
  await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify(meta),
  ]);
  return id;
};
const profile = async (id: string) =>
  (
    await db.query<{
      role: string;
      level: string | null;
      enrolled_courses: string[];
      student_invite_code: string | null;
    }>("select role, level, enrolled_courses, student_invite_code from profiles where id = $1", [
      id,
    ])
  ).rows[0];
const roles = async (id: string) =>
  (
    await db.query<{ role: string }>(
      "select role from user_roles where user_id = $1 order by role",
      [id],
    )
  ).rows.map((r) => r.role);
const failsWith = async (q: () => Promise<unknown>, pattern: RegExp, what: string) => {
  let message = "";
  try {
    await q();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message, `${what}: it was allowed`);
  assert.match(message, pattern, `${what}: failed for the wrong reason`);
  return message;
};
const insertNaming = (table: string, col: string, id: string) =>
  db.query(`insert into public.${table}(${col}) values ($1)`, [id]);

// ── Sign-up still works, and the hard-coded tutor comes out clean ─────────
const sam = await signUp("sam@example.com", { role: "student", display_name: "Sam" });
assert.equal((await profile(sam)).role, "student");
assert((await profile(sam)).student_invite_code, "A student was given no invite code");
assert.deepEqual(await roles(sam), ["student"]);

const pat = await signUp("pat@example.com", {
  role: "parent",
  parent_invite_code: (await profile(sam)).student_invite_code!,
});
assert.equal((await profile(pat)).role, "parent");
const link = await db.query(
  "select 1 from parent_student_links where parent_id = $1 and student_id = $2",
  [pat, sam],
);
assert.equal(link.rows.length, 1, "A parent signing up with the child's code was not linked");

const ali = await signUp("asa180@live.co.uk", { display_name: "Ali" });
assert.equal(
  (await profile(ali)).role,
  "tutor",
  "The hard-coded tutor's profile is not a tutor profile",
);
assert.equal(
  (await profile(ali)).student_invite_code,
  null,
  "The hard-coded tutor kept an invite code",
);
assert.deepEqual(await roles(ali), ["tutor"]);

// ── Rule 1: no student row may name a tutor ───────────────────────────────
for (const [table, cols] of GUARDED) {
  for (const col of cols) {
    await failsWith(
      () => insertNaming(table, col, ali),
      /A tutor account can't hold student data/,
      `${table}.${col} accepted a row naming a tutor`,
    );
    await insertNaming(table, col, sam);
  }
}
await failsWith(
  () => db.query("update student_enrolments set student_id = $1 where student_id = $2", [ali, sam]),
  /can't hold student data \(student_enrolments\.student_id\)/,
  "An enrolment was moved onto a tutor",
);
await db.query(
  "insert into chat_threads(student_id, tutor_id, about_student_id) values ($1, $2, null)",
  [pat, ali],
);

// A student acting as themselves, without access to the private schema (as
// in production), still gets the trigger's answer, not a permission error.
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert on public.student_enrolments to authenticated;`);
await db.exec("set role authenticated");
await db.query("insert into student_enrolments(student_id) values ($1)", [sam]);
await failsWith(
  () => db.query("insert into student_enrolments(student_id) values ($1)", [ali]),
  /A tutor account can't hold student data/,
  "A signed-in user's enrolment for a tutor",
);
await db.exec("reset role");

// ── Rule 2: a tutor's profile carries nothing of a student's ──────────────
await failsWith(
  () => db.query("update profiles set level = 'gcse' where id = $1", [ali]),
  /can't have an exam level or courses/,
  "A tutor was given an exam level",
);
await failsWith(
  () => db.query("update profiles set enrolled_courses = '{biology}' where id = $1", [ali]),
  /can't have an exam level or courses/,
  "A tutor was given courses",
);
await db.query("update profiles set student_invite_code = 'ANG-TUTOR1' where id = $1", [ali]);
assert.equal((await profile(ali)).student_invite_code, null, "A tutor's invite code stuck");
await db.query("update profiles set display_name = 'Ali H', phone = '07000' where id = $1", [ali]);

// ── Rule 3: a tutor profile and a tutor grant go together ─────────────────
await failsWith(
  () => db.query("update profiles set role = 'tutor' where id = $1", [sam]),
  /Only an account with the tutor role/,
  "A profile claimed 'tutor' without the grant",
);
await failsWith(
  () => db.query("update profiles set role = 'student' where id = $1", [ali]),
  /its profile stays a tutor profile/,
  "A tutor's profile left 'tutor' while the grant remained",
);
await failsWith(
  () => db.query("insert into user_roles(user_id, role) values ($1, 'student')", [ali]),
  /can't also have the student role/,
  "A tutor was given the student role too",
);
await failsWith(
  () => db.query("update user_roles set role = 'student' where user_id = $1", [ali]),
  /can't also have the student role/,
  "A tutor grant was flipped to student in place",
);

// ── Rule 4: no promotion over student data, and the list says where ───────
const bea = await signUp("bea@example.com", { role: "student", display_name: "Bea" });
await db.query(
  "update profiles set level = 'igcse', enrolled_courses = '{biology}' where id = $1",
  [bea],
);
await db.query("insert into student_enrolments(student_id) values ($1)", [bea]);
await db.query("insert into mcq_attempts(user_id) values ($1)", [bea]);
await db.query("insert into chat_threads(student_id, about_student_id) values ($1, $2)", [
  pat,
  bea,
]);
const refused = await failsWith(
  () => db.query("update user_roles set role = 'tutor' where user_id = $1", [bea]),
  /still has student data in: .*chat_threads\.about_student_id/,
  "A student with data was promoted",
);
for (const where of [
  "mcq_attempts.user_id",
  "student_enrolments.student_id",
  "profiles.level/enrolled_courses",
]) {
  assert(refused.includes(where), `The refusal didn't name ${where}: ${refused}`);
}
await failsWith(
  () => db.query("insert into user_roles(user_id, role) values ($1, 'admin')", [bea]),
  /still has student data/,
  "A student with data was made an admin",
);
assert.deepEqual(await roles(bea), ["student"], "A refused promotion left a grant behind");
assert.equal((await profile(bea)).role, "student");

// Cleared out, the same promotion goes through and the profile follows.
await db.query("delete from student_enrolments where student_id = $1", [bea]);
await db.query("delete from mcq_attempts where user_id = $1", [bea]);
await db.query("delete from chat_threads where about_student_id = $1", [bea]);
await failsWith(
  () => db.query("update user_roles set role = 'tutor' where user_id = $1", [bea]),
  /profiles\.level\/enrolled_courses/,
  "Promoted with a level and courses still on the profile",
);
await db.query("update profiles set level = null, enrolled_courses = '{}' where id = $1", [bea]);
await db.query("update user_roles set role = 'tutor' where user_id = $1", [bea]);
assert.deepEqual(await roles(bea), ["tutor"]);
assert.equal((await profile(bea)).role, "tutor", "The profile did not follow the grant");
assert.equal(
  (await profile(bea)).student_invite_code,
  null,
  "A promoted tutor kept the invite code",
);

// Promoting by adding a grant rather than changing one drops the student grant.
const cal = await signUp("cal@example.com", { role: "student" });
await db.query("insert into user_roles(user_id, role) values ($1, 'tutor')", [cal]);
assert.deepEqual(await roles(cal), ["tutor"], "A student grant survived alongside the tutor grant");
assert.equal((await profile(cal)).role, "tutor");

// ── Taking tutor access away, in the documented order ─────────────────────
await db.query("delete from user_roles where user_id = $1", [cal]);
await db.query("update profiles set role = 'student' where id = $1", [cal]);
await db.query("insert into user_roles(user_id, role) values ($1, 'student')", [cal]);
await db.query("insert into student_enrolments(student_id) values ($1)", [cal]);

// ── student_rows_held reads every guarded column, multi-column ones too ───
const dee = await signUp("dee@example.com", { role: "student" });
for (const [table, cols] of GUARDED) for (const col of cols) await insertNaming(table, col, dee);
const held = await db.query<{ held: string[] }>("select private.student_rows_held($1) as held", [
  dee,
]);
assert.deepEqual(
  [...held.rows[0].held].sort(),
  GUARDED.flatMap(([table, cols]) => cols.map((c) => `${table}.${c}`)).sort(),
  "student_rows_held missed or invented a table",
);

// ── Re-running is a no-op; a staff account holding data stops it ──────────
await db.exec(migration);
await db.exec("alter table student_enrolments disable trigger student_row_not_staff");
await db.query("insert into student_enrolments(student_id) values ($1)", [ali]);
await db.exec("alter table student_enrolments enable trigger student_row_not_staff");
await failsWith(
  () => db.exec(migration),
  /still has student data in: student_enrolments\.student_id/,
  "The migration finished over a tutor holding an enrolment",
);
await db.query("delete from student_enrolments where student_id = $1", [ali]);
await db.exec(migration);

console.log("tutors-never-students: all checks passed");
