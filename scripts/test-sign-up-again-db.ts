/** Isolated PostgreSQL checks for settle_sign_up_role (20261028101000).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-sign-up-again-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The slice of production the function reads, with the live enum values and
// the live unlink trigger (a removed link gives the child a new invite code).
await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}', email_confirmed_at timestamptz);
create type public.profile_role as enum ('student','parent','tutor');
create type public.app_role as enum ('student','tutor','admin');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role, student_invite_code text, onboarding_completed_at timestamptz);
create table public.user_roles(user_id uuid, role public.app_role, unique (user_id, role));
create table public.parent_student_links(id serial, parent_id uuid, student_id uuid, unique (parent_id, student_id));
create table public.student_enrolments(id serial, student_id uuid, subject text);
create table public.subscriptions(id serial, user_id uuid, student_id uuid);
create function private.rotate_invite_code_on_unlink() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  update public.profiles set student_invite_code = 'NEW-' || left(old.student_id::text, 4) where id = old.student_id;
  return null;
end $$;
create trigger psl_rotate_invite_code after delete on public.parent_student_links for each row execute function private.rotate_invite_code_on_unlink();
grant usage on schema public to authenticated, anon;
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261028101000_sign_up_again_settles_role.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

/** An account as GoTrue + handle_new_user leave it after the first attempt. */
const account = async (
  n: number,
  role: "student" | "parent" | "tutor",
  { provider = "email", confirmedAgo = "1 minute" as string | null, code = `KID-${n}` } = {},
) => {
  await db.query(
    `insert into auth.users(id, email, raw_app_meta_data, email_confirmed_at)
     values ($1, $2, $3, case when $4::text is null then null else now() - $4::interval end)`,
    [uuid(n), `u${n}@example.com`, JSON.stringify({ provider }), confirmedAgo],
  );
  await db.query(
    "insert into public.profiles(id, display_name, role, student_invite_code) values ($1, $2, $3, $4)",
    [uuid(n), `User ${n}`, role, code],
  );
  return uuid(n);
};
const roleOf = async (id: string) =>
  (await db.query<{ role: string }>("select role from public.profiles where id = $1", [id])).rows[0]
    .role;
const codeOf = async (id: string) =>
  (
    await db.query<{ c: string }>(
      "select student_invite_code c from public.profiles where id = $1",
      [id],
    )
  ).rows[0].c;
const links = async (parent: string) =>
  (
    await db.query<{ s: string }>(
      "select student_id s from public.parent_student_links where parent_id = $1 order by 1",
      [parent],
    )
  ).rows.map((r) => r.s);
const link = (parent: string, student: string) =>
  db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
    parent,
    student,
  ]);

const settleAs = async (id: string | null, role: string, code: string | null = null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ""]);
  await db.exec("set role authenticated");
  try {
    const r = await db.query<{ r: { status: string } }>(
      "select public.settle_sign_up_role($1, $2) as r",
      [role, code],
    );
    return r.rows[0].r.status;
  } finally {
    await db.exec("reset role");
  }
};

// Two children whose codes a parent might use.
const kidA = await account(100, "student", { confirmedAgo: "30 days", code: "ANG-AAAA" });
const kidB = await account(101, "student", { confirmedAgo: "30 days", code: "ANG-BBBB" });

// ── First attempt as a parent, then signed up again as a student ────────────
const p2s = await account(1, "parent");
await link(p2s, kidA);
assert.equal(await settleAs(p2s, "student"), "settled");
assert.equal(await roleOf(p2s), "student");
assert.deepEqual(await links(p2s), [], "a student keeps no parent links");
assert.equal(await codeOf(kidA), "NEW-0000", "the child's code rotates on unlink");
await db.query("update public.profiles set student_invite_code = 'ANG-AAAA' where id = $1", [kidA]);

// ── First attempt as a student, then signed up again as a parent ────────────
const s2p = await account(2, "student");
assert.equal(await settleAs(s2p, "parent", "ang-aaaa"), "settled");
assert.equal(await roleOf(s2p), "parent");
assert.deepEqual(await links(s2p), [], "linking is left to link_child_by_code");

// ── Parent both times, a different child's code the second time ─────────────
const p2p = await account(3, "parent");
await link(p2p, kidA);
assert.equal(await settleAs(p2p, "Parent", " ANG-BBBB "), "settled");
assert.equal(await roleOf(p2p), "parent");
assert.deepEqual(await links(p2p), [], "the first attempt's child is unlinked");
await db.query("update public.profiles set student_invite_code = 'ANG-AAAA' where id = $1", [kidA]);

// ── Parent both times, the same child: the link stays ───────────────────────
const same = await account(4, "parent");
await link(same, kidA);
assert.equal(await settleAs(same, "parent", " ang-aaaa"), "settled");
assert.deepEqual(await links(same), [kidA]);
assert.equal(await codeOf(kidA), "ANG-AAAA", "nothing unlinked, nothing rotated");

// A parent with no code on the form keeps no link.
const noCode = await account(5, "parent");
await link(noCode, kidB);
assert.equal(await settleAs(noCode, "parent", ""), "settled");
assert.deepEqual(await links(noCode), []);

// Calling it twice is harmless.
assert.equal(await settleAs(s2p, "parent", "ANG-AAAA"), "settled");
assert.equal(await roleOf(s2p), "parent");

// ── Who it refuses ──────────────────────────────────────────────────────────
const stale = await account(10, "student", { confirmedAgo: "16 minutes" });
assert.equal(await settleAs(stale, "parent"), "not_eligible", "only just after confirming");
assert.equal(await roleOf(stale), "student");

const unconfirmed = await account(11, "student", { confirmedAgo: null });
assert.equal(await settleAs(unconfirmed, "parent"), "not_eligible");

const google = await account(12, "student", { provider: "google" });
assert.equal(await settleAs(google, "parent"), "not_eligible", "SSO has claim_parent_role");

const onboarded = await account(13, "student");
await db.query("update public.profiles set onboarding_completed_at = now() where id = $1", [
  onboarded,
]);
assert.equal(await settleAs(onboarded, "parent"), "not_eligible");

const enrolled = await account(14, "student");
await db.query("insert into public.student_enrolments(student_id, subject) values ($1, 'bio')", [
  enrolled,
]);
assert.equal(await settleAs(enrolled, "parent"), "not_eligible");

const paying = await account(15, "student");
await db.query("insert into public.subscriptions(user_id, student_id) values (null, $1)", [paying]);
assert.equal(await settleAs(paying, "parent"), "not_eligible");

const hasParent = await account(16, "student");
await link(same, hasParent);
assert.equal(await settleAs(hasParent, "parent"), "not_eligible", "a child with a parent stays");
assert.equal(await roleOf(hasParent), "student");

const staff = await account(17, "student");
await db.query("insert into public.user_roles values ($1, 'tutor')", [staff]);
assert.equal(await settleAs(staff, "parent"), "not_eligible");

const tutor = await account(18, "tutor");
assert.equal(await settleAs(tutor, "student"), "not_eligible", "never touches a tutor profile");
assert.equal(await roleOf(tutor), "tutor");

await assert.rejects(settleAs(s2p, "tutor"), /student or parent/, "never grants tutor");
await assert.rejects(settleAs(s2p, "admin"), /student or parent/);
await assert.rejects(settleAs(null, "student"), /Not authenticated/);

// ── Grants ──────────────────────────────────────────────────────────────────
const grants = await db.query<{ anon: boolean; authed: boolean; pub: boolean }>(`
  select has_function_privilege('anon', 'public.settle_sign_up_role(text, text)', 'execute') as anon,
         has_function_privilege('authenticated', 'public.settle_sign_up_role(text, text)', 'execute') as authed,
         exists (
           select 1 from pg_proc p, aclexplode(p.proacl) a
           where p.proname = 'settle_sign_up_role' and a.grantee = 0
         ) as pub`);
assert.deepEqual(grants.rows[0], { anon: false, authed: true, pub: false });

console.log("sign-up again: all checks passed");
