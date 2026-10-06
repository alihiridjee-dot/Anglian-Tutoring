/** Isolated PostgreSQL regression checks for workstream 03's billing rules: the
 * per-student lease (M-5), enrolments and access written together (M-5), and
 * the billing_feedback policy mirroring who may manage a plan (S-2). No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-billing-change-rules-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const parent = uuid(2);
const legacy = uuid(3); // a student whose plan has no payer recorded
const selfPayer = uuid(4);

// The tables and policy these rules touch, as production defines them.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table public.profiles(id uuid primary key, enrolled_courses text[] not null default '{}');
create table public.student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid not null,
  subject subject not null, board board not null, unique (student_id, subject));
create table public.parent_student_links(parent_id uuid, student_id uuid);
create table public.subscriptions(student_id uuid primary key, user_id uuid);
create table public.billing_feedback(id uuid primary key default gen_random_uuid(), user_id uuid, student_id uuid,
  action text, reason_category text, reason text, created_at timestamptz default now());
alter table public.billing_feedback enable row level security;
create policy "billing feedback insert manager" on public.billing_feedback for insert to authenticated with check (
  (auth.uid() = user_id) and ((exists (select 1 from subscriptions s where s.student_id = billing_feedback.student_id and s.user_id = auth.uid()))
  or (exists (select 1 from parent_student_links l where l.parent_id = auth.uid() and l.student_id = billing_feedback.student_id))
  or ((auth.uid() = student_id) and not exists (select 1 from parent_student_links l where l.student_id = billing_feedback.student_id))
  or private.has_role(auth.uid(), 'tutor'::app_role) or private.has_role(auth.uid(), 'admin'::app_role)));
grant usage on schema public, auth, private to authenticated, anon, service_role;
grant all on all tables in schema public to authenticated, anon, service_role;
grant execute on all functions in schema private to authenticated;
`);
await db.query("insert into profiles(id) values($1),($2),($3),($4)", [
  child,
  parent,
  legacy,
  selfPayer,
]);
await db.query("insert into subscriptions values($1,$2),($3,null),($4,$4)", [
  child,
  parent,
  legacy,
  selfPayer,
]);

const feedback = async (who: string, student: string) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]);
  await db.exec("set role authenticated");
  try {
    await db.query(
      "insert into billing_feedback(user_id, student_id, action) values($1,$2,'pause')",
      [who, student],
    );
    return true;
  } catch {
    return false;
  } finally {
    await db.exec("reset role");
  }
};

// The hole, on the live policy: a child who unlinked their paying parent.
assert.equal(
  await feedback(child, child),
  true,
  "Fixture check: the live policy should show the hole",
);

await db.exec(
  await readFile(
    new URL("../supabase/migrations/20261001130214_billing_change_rules.sql", import.meta.url),
    "utf8",
  ),
);

// ── S-2: the policy matches the server ────────────────────────────────────
assert.equal(await feedback(child, child), false, "A child recorded feedback on the parent's plan");
assert.equal(await feedback(parent, child), true, "The unlinked payer lost their say");
assert.equal(await feedback(legacy, legacy), true, "A legacy plan's student lost control");
assert.equal(await feedback(selfPayer, selfPayer), true, "A self-paying student lost control");
await db.query("insert into parent_student_links values($1,$2)", [parent, child]);
assert.equal(
  await feedback(child, child),
  false,
  "A linked child recorded feedback on the parent's plan",
);

// ── M-5: the lease ────────────────────────────────────────────────────────
await db.exec("set role service_role");
const take = async (id: string) =>
  (await db.query<{ ok: boolean }>("select public.take_billing_lease($1) ok", [id])).rows[0].ok;
assert.equal(await take(child), true);
assert.equal(await take(child), false, "A second change took the lease");
assert.equal(await take(parent), true, "One student's lease blocked another's");
await db.query("select public.release_billing_lease($1)", [child]);
assert.equal(await take(child), true, "A released lease couldn't be taken again");
await db.exec("reset role");
await db.query(
  "update billing_change_leases set taken_at = now() - interval '3 minutes' where student_id = $1",
  [child],
);
await db.exec("set role service_role");
assert.equal(await take(child), true, "A lease from a run that died never lapsed");

// ── M-5: enrolments and access, together ──────────────────────────────────
const apply = async (add: object[], remove: string[]) =>
  (
    await db.query<{ list: string[] }>("select public.apply_enrolment_change($1, $2, $3) list", [
      selfPayer,
      JSON.stringify(add),
      remove,
    ])
  ).rows[0].list;
const courses = async () =>
  (
    await db.query<{ c: string[] }>("select enrolled_courses c from profiles where id = $1", [
      selfPayer,
    ])
  ).rows[0].c;

assert.deepEqual(await apply([{ subject: "physics", board: "aqa" }], []), ["physics"]);
// A subject already granted keeps its place; new ones go on the end (the plan
// grants the first N, so order is access).
assert.deepEqual(
  await apply(
    [
      { subject: "biology", board: "ocr" },
      { subject: "chemistry", board: "aqa" },
    ],
    [],
  ),
  ["physics", "biology", "chemistry"],
);
assert.deepEqual(await apply([], ["biology"]), ["physics", "chemistry"]);
assert.deepEqual(await courses(), ["physics", "chemistry"], "The grant drifted from the rows");
// Re-boarding a subject changes no access.
assert.deepEqual(await apply([{ subject: "physics", board: "cambridge" }], []), [
  "physics",
  "chemistry",
]);

// Only the edge function may call any of it.
for (const role of ["authenticated", "anon"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(() => take(legacy), `${role} could take a lease`);
  await assert.rejects(() => apply([], []), `${role} could change enrolments`);
}

console.log("billing change rules: all checks passed");
