/** Isolated PostgreSQL checks for the SSO sign-up migration.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-sso-sign-up-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The slice of production the migration touches, with the live enum values.
await db.exec(`
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now());
create type public.profile_role as enum ('student','parent','tutor');
create type public.app_role as enum ('student','tutor','admin');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role, phone text, student_invite_code text, onboarding_completed_at timestamptz);
create table public.user_roles(user_id uuid, role public.app_role, unique (user_id, role));
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.student_enrolments(id serial, student_id uuid, subject text);
create table public.subscriptions(id serial, user_id uuid, student_id uuid);
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261001141329_sso_sign_up.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent
await db.exec(
  "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()",
);

type Meta = Record<string, string>;
const signUp = async (
  n: number,
  provider: string,
  meta: Meta,
  createdAgo = "0 minutes",
  email = `u${n}@example.com`,
) => {
  await db.query(
    `insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data, created_at)
     values ($1, $2, $3, $4, now() - $5::interval)`,
    [uuid(n), email, JSON.stringify(meta), JSON.stringify({ provider }), createdAgo],
  );
  return uuid(n);
};
const profile = async (id: string) =>
  (
    await db.query<{ display_name: string; role: string }>(
      "select display_name, role from public.profiles where id = $1",
      [id],
    )
  ).rows[0];
const claimAs = async (id: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  await db.exec("set role authenticated");
  try {
    const r = await db.query<{ r: { status: string } }>("select public.claim_parent_role() as r");
    return r.rows[0].r.status;
  } finally {
    await db.exec("reset role");
  }
};

// ── Display names ───────────────────────────────────────────────────────────
const formUser = await signUp(1, "email", { display_name: "Jamie Doe", role: "parent" });
assert.deepEqual(await profile(formUser), { display_name: "Jamie Doe", role: "parent" });

const google = await signUp(2, "google", { full_name: "Sam Smith", name: "Sam S" });
assert.deepEqual(await profile(google), { display_name: "Sam Smith", role: "student" });

const msName = await signUp(3, "azure", { name: "Alex Brown" });
assert.equal((await profile(msName)).display_name, "Alex Brown");

const bare = await signUp(4, "azure", { full_name: "  " }, "0 minutes", "kid12@school.org");
assert.equal((await profile(bare)).display_name, "kid12", "blank name falls back to the email");

// ── claim_parent_role ───────────────────────────────────────────────────────
assert.equal(await claimAs(google), "claimed");
assert.equal((await profile(google)).role, "parent");
assert.equal(await claimAs(google), "already_parent", "a second call is harmless");

assert.equal(await claimAs(formUser), "already_parent");
const formStudent = await signUp(5, "email", { display_name: "Pat" });
assert.equal(await claimAs(formStudent), "not_eligible", "email sign-ups choose on the form");

const old = await signUp(6, "google", { full_name: "Old" }, "31 minutes");
assert.equal(await claimAs(old), "not_eligible", "only a fresh account");

const onboarded = await signUp(7, "google", { full_name: "Onboarded" });
await db.query("update public.profiles set onboarding_completed_at = now() where id = $1", [
  onboarded,
]);
assert.equal(await claimAs(onboarded), "not_eligible");

const enrolled = await signUp(8, "google", { full_name: "Enrolled" });
await db.query("insert into public.student_enrolments(student_id, subject) values ($1, 'bio')", [
  enrolled,
]);
assert.equal(await claimAs(enrolled), "not_eligible");

const paying = await signUp(9, "google", { full_name: "Paying" });
await db.query("insert into public.subscriptions(user_id, student_id) values (null, $1)", [paying]);
assert.equal(await claimAs(paying), "not_eligible");

const linked = await signUp(10, "google", { full_name: "Linked" });
await db.query("insert into public.parent_student_links values ($1, $2)", [google, linked]);
assert.equal(await claimAs(linked), "not_eligible");

const staff = await signUp(11, "google", { full_name: "Staff" });
await db.query("insert into public.user_roles values ($1, 'tutor')", [staff]);
assert.equal(await claimAs(staff), "not_eligible");

const tutorProfile = await signUp(12, "google", { full_name: "Tutor" });
await db.query("update public.profiles set role = 'tutor' where id = $1", [tutorProfile]);
assert.equal(await claimAs(tutorProfile), "not_eligible", "never touches a tutor profile");
assert.equal((await profile(tutorProfile)).role, "tutor");

await assert.rejects(claimAs(null), /Not authenticated/);

// ── Grants ──────────────────────────────────────────────────────────────────
const grants = await db.query<{ anon: boolean; authed: boolean }>(`
  select has_function_privilege('anon', 'public.claim_parent_role()', 'execute') as anon,
         has_function_privilege('authenticated', 'public.claim_parent_role()', 'execute') as authed`);
assert.deepEqual(grants.rows[0], { anon: false, authed: true });

console.log("sso sign-up migration: all checks passed");
