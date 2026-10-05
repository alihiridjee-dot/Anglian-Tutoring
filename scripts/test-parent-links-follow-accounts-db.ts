/** Isolated PostgreSQL checks for 20261005170000_parent_links_follow_accounts.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-parent-links-follow-accounts-db.ts
 *
 * The link triggers, the invite-code generator and the tutor-profile guard are
 * production's own definitions (5 Oct 2026). So deleting an account runs the
 * cascade it runs live: the profile goes, the links go, and each link removed
 * gives its student a new invite code. Both orders the cascade can take are run.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const file = (path: string) => readFile(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = await file("migrations/20261005170000_parent_links_follow_accounts.sql");
const rollback = await file("rollbacks/20261005170000_parent_links_follow_accounts.down.sql");

await db.exec(`
create schema auth; create schema private; create schema extensions;
create table auth.users(id uuid primary key);
create type app_role as enum ('student','tutor','admin');
create type profile_role as enum ('student','parent','tutor');
create table user_roles(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users on delete cascade, role app_role not null, unique (user_id, role));
create table profiles(id uuid primary key references auth.users on delete cascade, role profile_role not null default 'student', level text, enrolled_courses text[] not null default '{}', student_invite_code text unique);
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid not null, student_id uuid not null, created_at timestamptz not null default now(), unique (parent_id, student_id));
create index idx_parent_student_links_parent on parent_student_links(parent_id);
create index idx_parent_student_links_student on parent_student_links(student_id);

-- pgcrypto's, which PGlite doesn't load: up to 16 random bytes.
create function extensions.gen_random_bytes(int) returns bytea language sql
  as $$ select substring(decode(md5(random()::text), 'hex') from 1 for $1) $$;
-- Only reached when an account becomes a tutor, which nothing here does.
create function private.student_rows_held(uuid) returns text[] language sql
  as $$ select '{}'::text[] $$;
`);

// Production's definitions, verbatim.
await db.exec(`
CREATE OR REPLACE FUNCTION public.gen_student_invite_code()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Crockford base32 -- no I, L, O or U, so a code can't be misread down the
  -- phone (1/I, 0/O) or land on an unfortunate word.
  k_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code text;
  i int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := 'ANG-';
    for i in 1..8 loop
      -- 256 is a whole multiple of 32, so this modulo is unbiased.
      -- 8 chars x 5 bits = 40 bits (~1.1 trillion).
      v_code := v_code || substr(k_alphabet, 1 + (get_byte(v_bytes, i - 1) % 32), 1);
    end loop;
    -- SECURITY DEFINER is required, not incidental: under the caller's own RLS
    -- ("profiles self read") this uniqueness check can only see the caller's
    -- row, so it would wave through a code already held by someone else and
    -- leave the UNIQUE index to fail the write.
    exit when not exists (
      select 1 from public.profiles p where p.student_invite_code = v_code
    );
  end loop;
  return v_code;
end;
$function$;

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

CREATE OR REPLACE FUNCTION private.refuse_student_row_for_staff()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _row jsonb := to_jsonb(new);
  _col text;
  _id uuid;
begin
  foreach _col in array tg_argv loop
    -- A renamed column would otherwise read as null and wave every row through.
    if not (_row ? _col) then
      raise exception 'student_row_not_staff on % names a missing column %.', tg_table_name, _col;
    end if;
    _id := (_row ->> _col)::uuid;
    if _id is not null and private.is_staff(_id) then
      raise exception 'A tutor account can''t hold student data (%.%).', tg_table_name, _col
        using errcode = '23514',
              hint = 'Tutors and students are separate accounts. See docs/AUTHENTICATION.md.';
    end if;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.rotate_invite_code_on_unlink()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.profiles
     set student_invite_code = public.gen_student_invite_code()
   where id = old.student_id;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.keep_tutor_profile_clean()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _granted boolean := exists (
    select 1 from public.user_roles r
    where r.user_id = new.id and r.role in ('tutor', 'admin')
  );
  _becoming_tutor boolean;
  _held text[];
begin
  if new.role = 'tutor' and not _granted then
    raise exception 'Only an account with the tutor role can have a tutor profile.'
      using errcode = '23514',
            hint = 'Change the account''s user_roles row to tutor; the profile follows.';
  end if;
  if _granted and new.role is distinct from 'tutor' then
    raise exception 'This account has the tutor role, so its profile stays a tutor profile.'
      using errcode = '23514',
            hint = 'Delete the tutor row in user_roles first.';
  end if;

  if new.role = 'tutor' then
    if new.level is not null or cardinality(new.enrolled_courses) > 0 then
      raise exception 'A tutor''s profile can''t have an exam level or courses.'
        using errcode = '23514';
    end if;

    if tg_op = 'INSERT' then
      _becoming_tutor := true;
    else
      _becoming_tutor := old.role is distinct from 'tutor';
    end if;
    if _becoming_tutor then
      _held := private.student_rows_held(new.id);
      if cardinality(_held) > 0 then
        raise exception 'This account still has student data in: %.', array_to_string(_held, ', ')
          using errcode = '23514',
                hint = 'Remove it before making the account a tutor.';
      end if;
    end if;

    new.student_invite_code := null;
  end if;
  return new;
end;
$function$;

CREATE TRIGGER psl_rotate_invite_code AFTER DELETE ON public.parent_student_links FOR EACH ROW EXECUTE FUNCTION private.rotate_invite_code_on_unlink();
CREATE TRIGGER student_row_not_staff BEFORE INSERT OR UPDATE OF student_id ON public.parent_student_links FOR EACH ROW EXECUTE FUNCTION private.refuse_student_row_for_staff('student_id');
CREATE TRIGGER tutor_profile_not_student BEFORE INSERT OR UPDATE OF role, level, enrolled_courses, student_invite_code ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.keep_tutor_profile_clean();
`);

// ── Helpers ───────────────────────────────────────────────────────────────
let n = 0;
const nextId = (head: string) => `${head}-0000-0000-0000-${String(++n).padStart(12, "0")}`;
/** An account as sign-up leaves it: the login, the role grant and a profile. */
const account = async (role: "student" | "parent") => {
  const id = nextId("00000000");
  await db.query("insert into auth.users(id) values ($1)", [id]);
  await db.query("insert into user_roles(user_id, role) values ($1, 'student')", [id]);
  await db.query("insert into profiles(id, role, student_invite_code) values ($1, $2, $3)", [
    id,
    role,
    role === "student" ? `ANG-SEED${n}` : null,
  ]);
  return id;
};
/** An id with no account behind it: what a deleted account leaves in a link. */
const gone = () => nextId("ffffffff");
const deleteAccount = (id: string) => db.query("delete from auth.users where id = $1", [id]);
const link = (parent: string, student: string) =>
  db.query("insert into parent_student_links(parent_id, student_id) values ($1, $2)", [
    parent,
    student,
  ]);
const pair = (parent: string, student: string) => `${parent} → ${student}`;
const links = async () =>
  (
    await db.query<{ p: string }>(
      "select parent_id || ' → ' || student_id as p from parent_student_links",
    )
  ).rows
    .map((r) => r.p)
    .sort();
const code = async (id: string) =>
  (
    await db.query<{ code: string | null }>(
      "select student_invite_code as code from profiles where id = $1",
      [id],
    )
  ).rows[0]?.code;
const hasProfile = async (id: string) =>
  (await db.query("select 1 from profiles where id = $1", [id])).rows.length === 1;
const keys = async () =>
  (
    await db.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.parent_student_links'::regclass and contype = 'f'
        order by conname`,
    )
  ).rows;
/** Which runs first when an account is deleted: its profile's cascade or its links'. */
const firstCascade = async () =>
  (
    await db.query<{ conname: string }>(
      `select c.conname from pg_trigger t join pg_constraint c on c.oid = t.tgconstraint
        where t.tgrelid = 'auth.users'::regclass and (t.tgtype & 8) <> 0
          and c.conname in ('profiles_id_fkey', 'parent_student_links_student_id_fkey')
        order by t.tgname limit 1`,
    )
  ).rows[0].conname;
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
const KEYS = [
  {
    conname: "parent_student_links_parent_id_fkey",
    def: "FOREIGN KEY (parent_id) REFERENCES auth.users(id) ON DELETE CASCADE",
  },
  {
    conname: "parent_student_links_student_id_fkey",
    def: "FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE",
  },
];
const FRESH_CODE = /^ANG-[0-9A-HJKMNP-TV-Z]{8}$/;

// ── Before: production on 5 Oct, plus the shapes it happens not to have ───
const alex = await account("student");
const ali = await account("parent");
await link(ali, alex); // the one real link
for (let i = 0; i < 4; i++) await link(gone(), alex); // parents deleted in July and September
await link(gone(), gone()); // both accounts deleted
const pat = await account("parent");
await link(pat, gone()); // a deleted student, the parent still here
const sam = await account("student");
const bea = await account("student");
await link(pat, sam);
await link(pat, bea);
const dan = await account("parent");
const cal = await account("student");
await link(dan, cal);
const alexCode = await code(alex);

await db.exec(migration);

// ── Only links between two real accounts are left ─────────────────────────
assert.deepEqual(
  await links(),
  [pair(ali, alex), pair(pat, sam), pair(pat, bea), pair(dan, cal)].sort(),
  "The clean-up kept a dead link or lost a live one",
);
assert.notEqual(await code(alex), alexCode, "Alex's dead links went but their code stayed");
assert.match((await code(alex)) ?? "", FRESH_CODE);

// ── Both ids must name an account ─────────────────────────────────────────
assert.deepEqual(await keys(), KEYS);
await failsWith(
  () => link(gone(), sam),
  /violates foreign key constraint "parent_student_links_parent_id_fkey"/,
  "A link to a parent with no account",
);
await failsWith(
  () => link(pat, gone()),
  /violates foreign key constraint "parent_student_links_student_id_fkey"/,
  "A link to a student with no account",
);

// ── Deleting an account takes its links: the profile's cascade first ──────
assert.equal(await firstCascade(), "profiles_id_fkey");
const [samCode, beaCode] = [await code(sam), await code(bea)];
await deleteAccount(pat);
assert.deepEqual(
  await links(),
  [pair(ali, alex), pair(dan, cal)].sort(),
  "A deleted parent's links stayed",
);
assert(
  (await hasProfile(sam)) && (await hasProfile(bea)),
  "A deleted parent took a child with them",
);
assert.notEqual(await code(sam), samCode, "A child kept the code a deleted parent knew");
assert.notEqual(await code(bea), beaCode, "A child kept the code a deleted parent knew");
await deleteAccount(alex);
assert.deepEqual(await links(), [pair(dan, cal)], "A deleted student's links stayed");
assert(!(await hasProfile(alex)), "A deleted student's profile stayed");
assert(await hasProfile(ali), "A deleted student took their parent with them");

// ── And with the links' cascade first, so the code changes mid-delete ─────
await db.exec(`alter table profiles drop constraint profiles_id_fkey;
  alter table profiles add constraint profiles_id_fkey
    foreign key (id) references auth.users on delete cascade;`);
assert.equal(await firstCascade(), "parent_student_links_student_id_fkey");
await deleteAccount(cal);
assert.deepEqual(await links(), [], "A deleted student's links stayed");
assert(!(await hasProfile(cal)), "A deleted student's profile stayed");
assert(await hasProfile(dan), "A deleted student took their parent with them");

// ── The purge's order still works: its own link delete, then the account ──
const eve = await account("student");
const fay = await account("parent");
await link(fay, eve);
await db.query("delete from parent_student_links where student_id = $1", [eve]);
await deleteAccount(eve);
assert(!(await hasProfile(eve)) && (await hasProfile(fay)));

// ── Running it again changes nothing ──────────────────────────────────────
await link(ali, sam);
await db.exec(migration);
assert.deepEqual(await keys(), KEYS, "A second run changed the keys");
assert.deepEqual(await links(), [pair(ali, sam)], "A second run touched a live link");

// ── The rollback drops both keys, and the migration then runs clean ───────
await db.exec(rollback);
assert.deepEqual(await keys(), [], "The rollback left a key behind");
await link(gone(), sam); // a dead link is possible again, as before
await db.exec(rollback);
await db.exec(migration);
assert.deepEqual(await keys(), KEYS);
assert.deepEqual(await links(), [pair(ali, sam)], "The dead link made while rolled back stayed");

console.log("parent-links-follow-accounts: all checks passed");
