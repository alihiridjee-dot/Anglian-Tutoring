/** Isolated PostgreSQL checks for 20261120173521_signup_grants_no_tutor.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-signup-grants-no-tutor-db.ts
 *
 * Sign-up used to give the tutor role to one address written into
 * handle_new_user. After this migration every new account gets the student
 * role row, and nothing else in the function changes. The address is read
 * from the old definition, so this file never spells it out.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The `create or replace function public.handle_new_user()` statement of a file. */
const statementOf = (sql: string) => {
  const start = sql.indexOf("create or replace function public.handle_new_user()");
  assert.ok(start >= 0, "handle_new_user is in the file");
  const open = sql.indexOf("$function$", start) + "$function$".length;
  const close = sql.indexOf("$function$", open);
  return {
    statement: sql.slice(start, close + "$function$;".length),
    body: sql.slice(open, close),
  };
};

const before = statementOf(
  await read("supabase/migrations/20261028110000_size_and_flood_limits.sql"),
);
const migration = await read("supabase/migrations/20261120173521_signup_grants_no_tutor.sql");
const after = statementOf(migration);
const rollback = statementOf(
  await read("supabase/rollbacks/20261120173521_signup_grants_no_tutor.down.sql"),
);

const address = /lower\(NEW\.email\) = '([^']+)'/.exec(before.body)?.[1];
assert.ok(address, "the old body names one address");

// ── The new body is the old one with only that branch taken out ─────────────
const oldBranch = before.body.slice(
  before.body.indexOf("  if lower(NEW.email) = "),
  before.body.indexOf("  end if;\n", before.body.indexOf("  if lower(NEW.email) = ")) +
    "  end if;\n".length,
);
assert.equal(oldBranch.split("\n").length, 9, "the branch is the eight lines expected");
assert.equal(
  after.body,
  before.body.replace(
    oldBranch,
    "  insert into public.user_roles (user_id, role) values (NEW.id, 'student')\n" +
      "  on conflict do nothing;\n",
  ),
  "nothing but the branch changes",
);
assert.equal(md5(before.body), "514345c3e643c0f7f69584bbc109f04e", "old body as live on 20 Nov");
assert.equal(md5(after.body), "053421e319b66fb13ac889330f095803", "new body");
assert.equal(rollback.statement, before.statement, "the rollback restores the old definition");
assert.ok(!migration.includes(address), "the migration never names the address");
assert.ok(
  !/values \(NEW\.id, 'tutor'\)|set role = 'tutor'/.test(after.body),
  "the new body grants no tutor role",
);
assert.ok(/values \(NEW\.id, 'tutor'\)/.test(before.body), "the old body did");

// ── The slice of production the function touches ──────────────────────────
await db.exec(`
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create type public.profile_role as enum ('student','parent','tutor');
create type public.app_role as enum ('student','tutor','admin');
create table public.profiles(id uuid primary key, display_name text, role public.profile_role, phone text, student_invite_code text);
create table public.user_roles(user_id uuid, role public.app_role, unique (user_id, role));
create table public.parent_student_links(parent_id uuid, student_id uuid, unique (parent_id, student_id));
create table public.notifications(id serial, user_id uuid, type text, title text, body text, link text);
`);

let next = 1;
const signUp = async (email: string, meta: Record<string, string> = {}) => {
  const id = uuid(next++);
  await db.query("insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    email,
    JSON.stringify(meta),
  ]);
  return id;
};
const rolesOf = async (id: string) =>
  (
    await db.query<{ role: string }>(
      "select role::text from public.user_roles where user_id = $1 order by role",
      [id],
    )
  ).rows.map((r) => r.role);
const profileOf = async (id: string) =>
  (
    await db.query<{ display_name: string; role: string }>(
      "select display_name, role::text from public.profiles where id = $1",
      [id],
    )
  ).rows[0];

// ── Before: that address became a tutor at sign-up ─────────────────────────
await db.exec(before.statement);
await db.exec(
  "create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()",
);
const oldTutor = await signUp(address, { display_name: "Old tutor" });
assert.deepEqual(await rolesOf(oldTutor), ["tutor"], "before: the address is made a tutor");
assert.equal((await profileOf(oldTutor)).role, "tutor");

// ── After ─────────────────────────────────────────────────────────────────
await db.exec(migration);
await db.exec(migration); // idempotent
const live = (
  await db.query<{ prosrc: string; prosecdef: boolean; proconfig: string[] }>(
    "select prosrc, prosecdef, proconfig from pg_proc where proname = 'handle_new_user'",
  )
).rows;
assert.equal(live.length, 1, "one function");
assert.equal(
  md5(live[0].prosrc),
  "053421e319b66fb13ac889330f095803",
  "the file's body is what runs",
);
assert.equal(live[0].prosecdef, true, "still security definer");
assert.deepEqual(live[0].proconfig, ["search_path=public"], "same search_path");

// An existing tutor keeps the role: no row is touched.
assert.deepEqual(await rolesOf(oldTutor), ["tutor"], "an existing tutor keeps the role");

// A sign-up with that address is a student, whatever the case or the metadata.
const again = await signUp(address, { display_name: "Again" });
assert.deepEqual(await rolesOf(again), ["student"], "the address now gets only the student role");
assert.equal((await profileOf(again)).role, "student");

const upper = await signUp(address.toUpperCase(), { role: "tutor" });
assert.deepEqual(await rolesOf(upper), ["student"], "upper case and a tutor claim change nothing");
assert.equal((await profileOf(upper)).role, "student");

// Everything else behaves as before.
const pupil = await signUp("pupil@example.com", { display_name: "  Bea  " });
assert.deepEqual(await rolesOf(pupil), ["student"]);
assert.deepEqual(await profileOf(pupil), { display_name: "Bea", role: "student" });
await db.query("update public.profiles set student_invite_code = 'ABC123' where id = $1", [pupil]);

const longName = await signUp("long@example.com", { full_name: "x".repeat(200) });
assert.equal((await profileOf(longName)).display_name.length, 80, "a long name is clipped to 80");

const fromEmail = await signUp("kid12@school.org");
assert.equal((await profileOf(fromEmail)).display_name, "kid12", "no name falls back to the email");

const parent = await signUp("mum@example.com", {
  display_name: "Mum",
  role: "parent",
  parent_invite_code: " abc123 ",
});
assert.deepEqual(await profileOf(parent), { display_name: "Mum", role: "parent" });
assert.deepEqual(await rolesOf(parent), ["student"], "a parent's role row is as before");
const links = await db.query(
  "select 1 from public.parent_student_links where parent_id = $1 and student_id = $2",
  [parent, pupil],
);
assert.equal(links.rows.length, 1, "a parent's invite code still links the child");
const told = await db.query<{ body: string }>(
  "select body from public.notifications where user_id = $1",
  [pupil],
);
assert.deepEqual(
  told.rows.map((r) => r.body),
  ["Mum linked to your account using your invite code."],
  "the child is still told",
);

// ── Rollback puts the old body back ─────────────────────────────────────────
await db.exec(rollback.statement);
const rolledBack = (
  await db.query<{ prosrc: string }>("select prosrc from pg_proc where proname = 'handle_new_user'")
).rows[0];
assert.equal(md5(rolledBack.prosrc), "514345c3e643c0f7f69584bbc109f04e", "rollback = old body");

console.log("signup-grants-no-tutor: all checks passed");
