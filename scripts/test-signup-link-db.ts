/** Isolated PostgreSQL checks for 20261001173000_signup_link_rules.sql (S-34):
 * a parent signing up with an invite code is linked by link_child_by_code's
 * rules. No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-signup-link-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The slice of production handle_new_user touches, as live on 1 Oct.
await db.exec(`
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create type public.profile_role as enum ('student','parent','tutor');
create type public.app_role as enum ('student','tutor','admin');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role, phone text, student_invite_code text unique);
create table public.user_roles(user_id uuid, role public.app_role, unique (user_id, role));
create table public.parent_student_links(id bigserial primary key, parent_id uuid, student_id uuid, unique (parent_id, student_id));
create table public.notifications(id bigserial, user_id uuid, type text, title text, body text, link text);
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261001173000_signup_link_rules.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent
await db.exec(
  "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()",
);

const signUp = async (n: number, meta: Record<string, string>) => {
  await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
    uuid(n),
    `u${n}@example.com`,
    JSON.stringify(meta),
  ]);
  return uuid(n);
};
const links = async (parent: string) =>
  (
    await db.query<{ student_id: string }>(
      "select student_id from public.parent_student_links where parent_id = $1",
      [parent],
    )
  ).rows.map((r) => r.student_id);
const notes = async (user: string) =>
  (
    await db.query<{ title: string; body: string }>(
      "select title, body from public.notifications where user_id = $1",
      [user],
    )
  ).rows;

// A student with a code, and a parent and a tutor who (wrongly) hold codes too.
const child = await signUp(1, { display_name: "Sam", role: "student" });
await db.query("update public.profiles set student_invite_code = 'ANG-CHILD001' where id = $1", [
  child,
]);
const otherParent = await signUp(2, { display_name: "Pat", role: "parent" });
await db.query("update public.profiles set student_invite_code = 'ANG-PARENT01' where id = $1", [
  otherParent,
]);

// 1. A pasted code with spaces and lower case still links, and the child is told.
const mum = await signUp(3, {
  display_name: "Alex Morgan",
  role: "parent",
  parent_invite_code: "  ang-child001 ",
});
assert.deepEqual(await links(mum), [child]);
assert.deepEqual(await notes(child), [
  {
    title: "Parent linked to your account",
    body: "Alex Morgan linked to your account using your invite code.",
  },
]);

// 2. Another parent's code links to nobody, and nobody is notified.
const stranger = await signUp(4, { role: "parent", parent_invite_code: "ANG-PARENT01" });
assert.deepEqual(await links(stranger), []);
assert.deepEqual(await notes(otherParent), []);

// 3. A blank or unknown code makes an unlinked account, not an error.
const blank = await signUp(5, { role: "parent", parent_invite_code: "   " });
const unknown = await signUp(6, { role: "parent", parent_invite_code: "ANG-NOPE0000" });
assert.deepEqual(await links(blank), []);
assert.deepEqual(await links(unknown), []);

// 4. A student signing up with a code is never linked as a parent.
const sneaky = await signUp(7, { role: "student", parent_invite_code: "ANG-CHILD001" });
assert.deepEqual(await links(sneaky), []);

// 5. A parent with no display name is named generically to the child.
await db.query("update public.profiles set display_name = null where id = $1", [child]);
await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
  uuid(8),
  "@",
  JSON.stringify({ role: "parent", parent_invite_code: "ANG-CHILD001" }),
]);
assert.equal((await notes(child)).length, 2);
assert.equal(
  (await notes(child))[1].body,
  "Your parent/guardian linked to your account using your invite code.",
);

// Sign-up itself is unchanged: the profile and the student role still land.
const p = await db.query<{ role: string; display_name: string }>(
  "select role, display_name from public.profiles where id = $1",
  [mum],
);
assert.deepEqual(p.rows[0], { role: "parent", display_name: "Alex Morgan" });

console.log("sign-up link rules: all checks passed");
