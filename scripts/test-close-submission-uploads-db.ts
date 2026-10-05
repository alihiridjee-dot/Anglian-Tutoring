/** Isolated PostgreSQL checks for 20261005180000_close_submission_uploads.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-close-submission-uploads-db.ts
 *
 * storage.objects carries all ten of production's rules (pg_policies, 5 Oct
 * 2026) verbatim, and private.has_role is production's own. Each write runs as
 * `authenticated` with the caller's id, as the Storage API runs it. Left out:
 * storage's own triggers, which guard SQL deletes and touch timestamps, not who
 * may write; and is_enrolled_in, which only the read rule calls and which is a
 * stand-in here.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = await file("migrations/20261005180000_close_submission_uploads.sql");
const rollback = await file("rollbacks/20261005180000_close_submission_uploads.down.sql");

await db.exec(`
create role authenticated;
create schema auth; create schema private; create schema storage;
create table auth.users(id uuid primary key);
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create table user_roles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, role app_role not null, unique (user_id, role));
create table profiles(id uuid primary key references auth.users on delete cascade, enrolled_courses text[] not null default '{}');
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid not null, student_id uuid not null);
create table resources(id uuid primary key default gen_random_uuid(), file_path text, subject subject);
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid not null,
  student_id uuid not null, acknowledged_at timestamptz);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb);
alter table storage.objects enable row level security;

-- As Supabase defines it.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
-- A stand-in: only the read rule calls it, and no read is under test.
create function is_enrolled_in(_user_id uuid, _subject subject) returns boolean language sql stable
  as $$ select false $$;

grant usage on schema auth, private, storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on profiles, parent_student_links, resources, homework_submissions to authenticated;
`);

// Production's definitions, verbatim.
await db.exec(`
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id = auth.uid() THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSIF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'tutor'::public.app_role) THEN
    RETURN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
  ELSE
    RETURN false;
  END IF;
END;
$function$;

create policy "avatars owner delete" on storage.objects for delete to authenticated
  using (((bucket_id = 'avatars'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));
create policy "avatars owner read" on storage.objects for select to authenticated
  using (((bucket_id = 'avatars'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));
create policy "avatars owner replace" on storage.objects for update to authenticated
  using (((bucket_id = 'avatars'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))))
  with check (((bucket_id = 'avatars'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));
create policy "avatars owner upload" on storage.objects for insert to authenticated
  with check (((bucket_id = 'avatars'::text) AND (name ~~ ((auth.uid())::text || '/%'::text))));
create policy "resources bucket read scoped" on storage.objects for select to authenticated
  using (((bucket_id = 'resources'::text) AND (private.has_role(auth.uid(), 'tutor'::app_role) OR ((name ~~ 'submissions/%'::text) AND ((name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text)) OR (EXISTS ( SELECT 1
   FROM parent_student_links l
  WHERE ((l.parent_id = auth.uid()) AND (objects.name ~~ (('submissions/'::text || (l.student_id)::text) || '/%'::text))))))) OR (EXISTS ( SELECT 1
   FROM resources r
  WHERE ((r.file_path = objects.name) AND (is_enrolled_in(auth.uid(), r.subject) OR (EXISTS ( SELECT 1
           FROM (parent_student_links l
             JOIN profiles p ON ((p.id = l.student_id)))
          WHERE ((l.parent_id = auth.uid()) AND (p.enrolled_courses @> ARRAY[(r.subject)::text])))))))))));
create policy "resources bucket student delete acknowledged" on storage.objects for delete to authenticated
  using (((bucket_id = 'resources'::text) AND (name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text)) AND (EXISTS ( SELECT 1
   FROM homework_submissions s
  WHERE ((s.student_id = auth.uid()) AND (s.acknowledged_at IS NOT NULL) AND (objects.name ~~ (((('submissions/'::text || (auth.uid())::text) || '/'::text) || (s.resource_id)::text) || '/%'::text)))))));
create policy "resources bucket student upload" on storage.objects for insert to authenticated
  with check (((bucket_id = 'resources'::text) AND (name ~~ (('submissions/'::text || (auth.uid())::text) || '/%'::text))));
create policy "resources bucket tutors delete" on storage.objects for delete to authenticated
  using (((bucket_id = 'resources'::text) AND private.has_role(auth.uid(), 'tutor'::app_role)));
create policy "resources bucket tutors update" on storage.objects for update to authenticated
  using (((bucket_id = 'resources'::text) AND private.has_role(auth.uid(), 'tutor'::app_role)));
create policy "resources bucket tutors write" on storage.objects for insert to authenticated
  with check (((bucket_id = 'resources'::text) AND private.has_role(auth.uid(), 'tutor'::app_role)));
`);

// ── Helpers ───────────────────────────────────────────────────────────────
let n = 0;
const nextId = () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`;
const account = async (role: "student" | "tutor") => {
  const id = nextId();
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into user_roles(user_id, role) values ($1, $2)", [id, role]);
  await db.query("insert into profiles(id) values ($1)", [id]);
  return id;
};
/** Runs a write as the Storage API does: as `authenticated`, with the caller's id. */
const as = async <T>(user: string, q: () => Promise<T>) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("set role authenticated");
  try {
    return await q();
  } finally {
    await db.exec("reset role");
  }
};
const upload = (user: string, bucket: string, name: string) =>
  as(user, () =>
    db.query("insert into storage.objects(bucket_id, name, owner) values ($1, $2, $3)", [
      bucket,
      name,
      user,
    ]),
  );
/** How many files the caller changed; row-level security hides the rest. */
const replace = async (user: string, bucket: string, name: string) =>
  (
    await as(user, () =>
      db.query("update storage.objects set metadata = '{}' where bucket_id = $1 and name = $2", [
        bucket,
        name,
      ]),
    )
  ).affectedRows;
const remove = async (user: string, bucket: string, name: string) =>
  (
    await as(user, () =>
      db.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, name]),
    )
  ).affectedRows;
/** A file put there with the service role, which no rule limits. */
const put = (bucket: string, name: string) =>
  db.query("insert into storage.objects(bucket_id, name) values ($1, $2)", [bucket, name]);
const policies = async () =>
  (
    await db.query<{
      policyname: string;
      cmd: string;
      roles: string;
      qual: string | null;
      with_check: string | null;
    }>(
      `select policyname, cmd, roles::text as roles, qual, with_check from pg_policies
        where schemaname = 'storage' and tablename = 'objects' order by policyname`,
    )
  ).rows;
const failsWith = async (q: () => Promise<unknown>, pattern: RegExp, what: string) => {
  let message = "";
  try {
    await q();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(message, `${what}: it was allowed`);
  assert.match(message, pattern, `${what}: failed for the wrong reason`);
};
const REFUSED = /new row violates row-level security policy for table "objects"/;
const CLOSED = ["resources bucket student delete acknowledged", "resources bucket student upload"];

// ── Before: production on 5 Oct ───────────────────────────────────────────
const sam = await account("student");
const pat = await account("student"); // a parent: sign-up grants them the student role
const tia = await account("tutor");
await db.query("insert into parent_student_links(parent_id, student_id) values ($1, $2)", [
  pat,
  sam,
]);
const task = nextId();
await db.query(
  "insert into homework_submissions(resource_id, student_id, acknowledged_at) values ($1, $2, now())",
  [task, sam],
);
const photo = `submissions/${sam}/${task}/photo.jpg`;

const live = await policies();
assert.equal(live.length, 10);
// The photo-era path is open: a student uploads into their own folder, and
// deletes the file once they have acknowledged their mark.
await upload(sam, "resources", photo);
assert.equal(await remove(sam, "resources", photo), 1);

await db.exec(migration);

// ── Only the two student rules are gone ───────────────────────────────────
const closed = live.filter((p) => !CLOSED.includes(p.policyname));
assert.deepEqual(await policies(), closed, "The migration changed a rule it should have kept");

// ── Nobody but a tutor writes to the resources bucket ─────────────────────
await failsWith(() => upload(sam, "resources", photo), REFUSED, "A student uploading a task photo");
await failsWith(
  () => upload(sam, "resources", `submissions/${sam}/notes.pdf`),
  REFUSED,
  "A student uploading anything else into their folder",
);
await failsWith(
  () => upload(sam, "resources", "elsewhere.pdf"),
  REFUSED,
  "A student uploading elsewhere in the bucket",
);
await failsWith(
  () => upload(pat, "resources", `submissions/${pat}/photo.jpg`),
  REFUSED,
  "A parent uploading into their own folder",
);
// A file put there earlier stays put for the student: only a tutor (or the
// service role) can remove it now.
await put("resources", photo);
assert.equal(await remove(sam, "resources", photo), 0, "A student still deletes their uploads");
assert.equal(await replace(sam, "resources", photo), 0, "A student overwrote an upload");
assert.equal(await remove(tia, "resources", photo), 1, "A tutor can't clear an old upload");

// ── Tutors keep task attachments; profile photos are untouched ────────────
const brief = `tasks/${task}/brief.pdf`;
await upload(tia, "resources", brief);
assert.equal(await replace(tia, "resources", brief), 1);
assert.equal(await remove(tia, "resources", brief), 1);
const avatar = `${sam}/avatar.jpg`;
await upload(sam, "avatars", avatar);
assert.equal(await replace(sam, "avatars", avatar), 1);
assert.equal(await remove(sam, "avatars", avatar), 1);
await failsWith(
  () => upload(pat, "avatars", avatar),
  REFUSED,
  "A parent uploading the child's photo",
);

// ── Running it again changes nothing ──────────────────────────────────────
await db.exec(migration);
assert.deepEqual(await policies(), closed, "A second run changed the rules");

// ── The rollback puts both rules back exactly; the migration then runs clean
await db.exec(rollback);
assert.deepEqual(await policies(), live, "The rollback didn't restore the live rules exactly");
await upload(sam, "resources", photo); // open again, as before
await db.exec(rollback);
assert.deepEqual(await policies(), live, "A second rollback changed the rules");
await db.exec(migration);
assert.deepEqual(await policies(), closed);

console.log("close-submission-uploads: all checks passed");
