/** L15: a signed-in student changes only board and grades on their own
 * enrolment rows. Before the migration a student can insert, delete and turn
 * one subject into another directly; after it they cannot, while the board
 * switch, the target grade, onboarding step 3, the tutor's record page and both
 * RPCs still work. The rollback puts back production's live state exactly. No
 * production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-enrolment-self-writes-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");

const name = "20261119234634_enrolment_self_writes_fenced";
const up = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const down = await readFile(
  new URL(`../supabase/rollbacks/${name}.down.sql`, import.meta.url),
  "utf8",
);

const db = new PGlite();
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const other = uuid(2);
const tutor = uuid(3);
const parent = uuid(4);

// The table, its policies, triggers and grants, and the functions that write
// it, as production defines them (pg_policy, pg_get_triggerdef,
// pg_get_functiondef, relacl, 19 Nov 2026). Helpers the triggers call are
// stubbed.
await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth; create schema private;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type public.app_role as enum ('student','tutor','admin');
create type public.subject as enum ('biology','chemistry','physics');
create type public.board as enum ('edexcel','aqa','ocr','cambridge','oxford_aqa');
create type public.level as enum ('gcse','alevel','gcse_trilogy','igcse');
create table public.user_roles(id uuid primary key default gen_random_uuid(), user_id uuid not null,
  role public.app_role not null, unique (user_id, role));
create table public.profiles(id uuid primary key references auth.users on delete cascade,
  level public.level, enrolled_courses text[]);
create table public.parent_student_links(id uuid primary key default gen_random_uuid(),
  parent_id uuid not null, student_id uuid not null, unique (parent_id, student_id));

create function private.has_role(_user_id uuid, _role public.app_role) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if _user_id = auth.uid() then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  elsif exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'tutor'::public.app_role) then
    return exists (select 1 from public.user_roles where user_id = _user_id and role = _role);
  else
    return false;
  end if;
end $$;
create function private.is_staff(_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = _id and role in ('tutor','admin')) $$;
-- Stub: every board has a curriculum except OxfordAQA.
create function private.has_curriculum(_level public.level, _board public.board, _subject public.subject)
returns boolean language sql stable security definer set search_path = '' as $$ select _board <> 'oxford_aqa' $$;
create function private.my_paid_subject_cap() returns integer language sql stable security definer set search_path = '' as $$ select null::integer $$;
create function private.sync_subject_pauses(_student uuid) returns void language plpgsql security definer set search_path = '' as $$ begin null; end $$;

create table public.student_enrolments(
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users(id) on delete cascade,
  subject public.subject not null,
  board public.board not null,
  created_at timestamptz not null default now(),
  previous_grade text, current_grade text, target_grade text,
  unique (student_id, subject));
alter table public.student_enrolments enable row level security;
create policy "enrolments self read" on public.student_enrolments for select to authenticated
  using (student_id = (select auth.uid()));
create policy "enrolments self insert" on public.student_enrolments for insert to authenticated
  with check (student_id = (select auth.uid()));
create policy "enrolments self update" on public.student_enrolments for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy "enrolments self delete" on public.student_enrolments for delete to authenticated
  using (student_id = (select auth.uid()));
create policy "enrolments parent reads linked" on public.student_enrolments for select to authenticated
  using (exists (select 1 from public.parent_student_links l
    where l.parent_id = (select auth.uid()) and l.student_id = student_enrolments.student_id));
create policy "enrolments tutor read" on public.student_enrolments for select to authenticated
  using (private.has_role((select auth.uid()), 'tutor'));
create policy "enrolments tutor update" on public.student_enrolments for update to authenticated
  using (private.has_role((select auth.uid()), 'tutor') or private.has_role((select auth.uid()), 'admin'))
  with check (private.has_role((select auth.uid()), 'tutor') or private.has_role((select auth.uid()), 'admin'));

CREATE OR REPLACE FUNCTION public.save_student_enrolments(_subjects jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _uid uuid := auth.uid();
  _keep text[];
  _cap int;
begin
  if _uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(coalesce(_subjects, '[]'::jsonb)) <> 'array' then
    raise exception 'subjects must be an array';
  end if;
  if jsonb_array_length(coalesce(_subjects, '[]'::jsonb)) > 20 then
    raise exception 'too many subjects';
  end if;

  select coalesce(array_agg(distinct e->>'subject'), '{}'::text[])
  into _keep
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e;

  -- A live plan caps how many subjects may be enrolled. Growing past it goes
  -- through the billing page (which charges the upgrade), never through here.
  _cap := private.my_paid_subject_cap();
  if _cap is not null and cardinality(_keep) > _cap then
    raise exception
      'Your plan covers % subject(s). Add subjects from the billing page to upgrade your plan.', _cap
      using errcode = 'check_violation';
  end if;

  -- Drop de-selected subjects: narrowing from three to one must actually
  -- remove access to the other two, which an upsert alone would not do.
  --
  -- SECURITY DEFINER bypasses RLS, so the \`= _uid\` on every statement below is
  -- now the only thing holding this to the caller's own rows. _uid comes from
  -- auth.uid(), never from an argument, so there is nothing to pass in.
  delete from student_enrolments
  where student_id = _uid
    and (_keep = '{}'::text[] or subject::text <> all (_keep));

  insert into student_enrolments (student_id, subject, board)
  select _uid, (e->>'subject')::subject, (e->>'board')::board
  from jsonb_array_elements(coalesce(_subjects, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  -- The denormalised list many reads (and the content RLS) still use. Moving in
  -- the same transaction as the rows above is the whole point of this function.
  update profiles set enrolled_courses = _keep where id = _uid;
end
$function$;

CREATE OR REPLACE FUNCTION public.apply_enrolment_change(_student_id uuid, _add jsonb, _remove text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _before text[];
  _after text[];
begin
  perform pg_advisory_xact_lock(hashtext('enrolments:' || _student_id::text));

  select coalesce(p.enrolled_courses, '{}'::text[]) into _before
    from public.profiles p where p.id = _student_id
    for update;
  if not found then
    raise exception 'No such student';
  end if;

  if coalesce(cardinality(_remove), 0) > 0 then
    delete from public.student_enrolments
     where student_id = _student_id
       and subject::text = any (_remove);
  end if;

  insert into public.student_enrolments (student_id, subject, board)
  select _student_id, (e ->> 'subject')::public.subject, (e ->> 'board')::public.board
    from jsonb_array_elements(coalesce(_add, '[]'::jsonb)) e
  on conflict (student_id, subject) do update set board = excluded.board;

  select coalesce(array_agg(s order by coalesce(array_position(_before, s), 1000), s), '{}'::text[])
    into _after
    from (select e.subject::text as s
            from public.student_enrolments e
           where e.student_id = _student_id) q;

  update public.profiles set enrolled_courses = _after where id = _student_id;
  return _after;
end;
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

CREATE OR REPLACE FUNCTION private.enrolment_board_needs_curriculum()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _level public.level;
begin
  -- The student's own onboarding, and server writes, are not checked.
  if auth.uid() is null or auth.uid() = new.student_id then
    return new;
  end if;

  select p.level into _level from public.profiles p where p.id = new.student_id;
  -- No level yet: nothing to check against.
  if _level is not null and not private.has_curriculum(_level, new.board, new.subject) then
    raise exception 'There''s no % curriculum for % at this student''s level.',
      case new.board when 'aqa' then 'AQA' when 'ocr' then 'OCR' when 'oxford_aqa' then 'OxfordAQA' else initcap(new.board::text) end, initcap(new.subject::text)
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sync_subject_pauses_after_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _new uuid;
  _old uuid;
begin
  _new := (to_jsonb(new) ->> tg_argv[0])::uuid;
  _old := (to_jsonb(old) ->> tg_argv[0])::uuid;
  begin
    perform private.sync_subject_pauses(_new);
    if _old is distinct from _new then
      perform private.sync_subject_pauses(_old);
    end if;
  exception when others then
    raise warning 'sync_subject_pauses failed for % on %: %', coalesce(_new, _old), tg_table_name, sqlerrm;
  end;
  return null;
end;
$function$;

CREATE TRIGGER enrolment_board_needs_curriculum BEFORE UPDATE OF board ON public.student_enrolments FOR EACH ROW WHEN ((new.board IS DISTINCT FROM old.board)) EXECUTE FUNCTION private.enrolment_board_needs_curriculum();
CREATE TRIGGER student_row_not_staff BEFORE INSERT OR UPDATE OF student_id ON public.student_enrolments FOR EACH ROW EXECUTE FUNCTION private.refuse_student_row_for_staff('student_id');
CREATE CONSTRAINT TRIGGER subject_pauses_follow_enrolment AFTER INSERT OR DELETE OR UPDATE ON public.student_enrolments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.sync_subject_pauses_after_change('student_id');

revoke all on function public.save_student_enrolments(jsonb) from public;
grant execute on function public.save_student_enrolments(jsonb) to authenticated, service_role;
revoke all on function public.apply_enrolment_change(uuid, jsonb, text[]) from public;
grant execute on function public.apply_enrolment_change(uuid, jsonb, text[]) to service_role;
grant usage on schema public, auth, private to anon, authenticated, service_role;
grant all on public.student_enrolments to anon, authenticated, service_role;
grant select on public.user_roles, public.profiles, public.parent_student_links to authenticated;
`);

// ── Production's live state (19 Nov 2026) ────────────────────────────────
const LIVE_MD5: Record<string, string> = {
  "save_student_enrolments(jsonb)": "6f4725171d982c4bd921f8da305dee87",
  "apply_enrolment_change(uuid,jsonb,text[])": "421b84fc3e524f7f263e1e035f9a211d",
  "private.refuse_student_row_for_staff()": "0de3f522f24c89a0f7ad74de9a747196",
  "private.enrolment_board_needs_curriculum()": "ad3279e13e9374082adf2ae39cde0c5c",
  "private.sync_subject_pauses_after_change()": "14674cbfba2613662924eb3bdb47c3ae",
};
const LIVE_ACL =
  "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const self = "(student_id = ( SELECT auth.uid() AS uid))";
const staff =
  "(private.has_role(( SELECT auth.uid() AS uid), 'tutor'::app_role) OR private.has_role(( SELECT auth.uid() AS uid), 'admin'::app_role))";
const LIVE_POLICIES = [
  "enrolments parent reads linked | r roles=authenticated using=(EXISTS ( SELECT 1\n   FROM parent_student_links l\n  WHERE ((l.parent_id = ( SELECT auth.uid() AS uid)) AND (l.student_id = student_enrolments.student_id)))) check= permissive=true",
  `enrolments self delete | d roles=authenticated using=${self} check= permissive=true`,
  `enrolments self insert | a roles=authenticated using= check=${self} permissive=true`,
  `enrolments self read | r roles=authenticated using=${self} check= permissive=true`,
  `enrolments self update | w roles=authenticated using=${self} check=${self} permissive=true`,
  "enrolments tutor read | r roles=authenticated using=private.has_role(( SELECT auth.uid() AS uid), 'tutor'::app_role) check= permissive=true",
  `enrolments tutor update | w roles=authenticated using=${staff} check=${staff} permissive=true`,
];
const ALL_COLUMNS = [
  "id",
  "student_id",
  "subject",
  "board",
  "created_at",
  "previous_grade",
  "current_grade",
  "target_grade",
];
const FENCED = ["board", "previous_grade", "current_grade", "target_grade"];

// ── Helpers ──────────────────────────────────────────────────────────────
/** Back to the owner, no one signed in. */
const asOwner = async () => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub','',false)");
};
/** A caller: a signed-in user (or none) under a database role. */
const as = async (id: string | null, role = "authenticated") => {
  await asOwner();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec(`set role ${role}`);
};

const policies = async () =>
  (
    await db.query<{ d: string }>(`
      select polname || ' | ' || polcmd::text
        || ' roles=' || array_to_string(array(select coalesce(rolname, 'public') from unnest(polroles) r
             left join pg_roles on pg_roles.oid = r), ',')
        || ' using=' || coalesce(pg_get_expr(polqual, polrelid), '')
        || ' check=' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        || ' permissive=' || polpermissive::text as d
        from pg_policy where polrelid = 'public.student_enrolments'::regclass`)
  ).rows
    .map((r) => r.d)
    .sort();
const acl = async () =>
  (
    await db.query<{ a: string }>(
      "select relacl::text as a from pg_class where oid = 'public.student_enrolments'::regclass",
    )
  ).rows[0].a;
/** The columns a role may update, in table order. */
const updatable = async (role: string) =>
  (
    await db.query<{ c: string }>(
      `select a.attname as c from pg_attribute a
        where a.attrelid = 'public.student_enrolments'::regclass and a.attnum > 0 and not a.attisdropped
          and has_column_privilege($1, a.attrelid, a.attnum, 'UPDATE') order by a.attnum`,
      [role],
    )
  ).rows.map((r) => r.c);
const tableUpdate = async (role: string) =>
  (
    await db.query<{ t: boolean }>(
      "select has_table_privilege($1, 'public.student_enrolments', 'UPDATE') as t",
      [role],
    )
  ).rows[0].t;

/** A PATCH as PostgREST sends it: only the body's keys are SET. Rows changed. */
const patch = async (body: Record<string, unknown>, studentId: string, subject: string) => {
  const cols = Object.keys(body).map((c) => `"${c}"`);
  const r = await db.query<{ n: number }>(
    `with pgrst_source as (
       update public.student_enrolments set ${cols.map((c) => `${c} = pgrst_body.${c}`).join(", ")}
         from (select $1::json as json_data) pgrst_payload,
         lateral (select ${cols.join(", ")}
                    from json_populate_record(null::public.student_enrolments, pgrst_payload.json_data) _) pgrst_body
        where public.student_enrolments.student_id = $2 and public.student_enrolments.subject = $3
       returning public.student_enrolments.*)
     select count(*)::int as n from pgrst_source`,
    [JSON.stringify(body), studentId, subject],
  );
  return r.rows[0].n;
};
const rejects = async (q: () => Promise<unknown>, message: RegExp, what: string) => {
  let error: unknown = null;
  try {
    await q();
  } catch (e) {
    error = e;
  }
  assert.ok(error, `${what}: it was allowed`);
  assert.match((error as Error).message, message, what);
};
const insertOwn = (subject: string) =>
  db.query(
    "insert into public.student_enrolments(student_id, subject, board) values ($1, $2, 'aqa')",
    [student, subject],
  );
const deleteOwn = async (subject: string) =>
  (
    await db.query(
      "delete from public.student_enrolments where student_id = $1 and subject = $2 returning id",
      [student, subject],
    )
  ).rows.length;
/** One student's rows, read as the owner. */
const rows = async (id: string) => {
  const role = (await db.query<{ r: string }>("select current_user as r")).rows[0].r;
  const sub = (
    await db.query<{ s: string }>("select current_setting('request.jwt.claim.sub', true) as s")
  ).rows[0].s;
  await asOwner();
  const r = (
    await db.query<Record<string, string | null>>(
      `select subject::text, board::text, previous_grade, current_grade, target_grade
         from public.student_enrolments where student_id = $1 order by subject`,
      [id],
    )
  ).rows;
  await as(sub || null, role);
  return r;
};

// ── The fixture is production's shape ───────────────────────────────────
for (const [sig, md5] of Object.entries(LIVE_MD5)) {
  const r = await db.query<{ m: string }>(
    `select md5(prosrc) as m from pg_proc where oid = '${sig}'::regprocedure`,
  );
  assert.equal(r.rows[0].m, md5, `${sig} is not production's live body`);
}
assert.equal(await acl(), LIVE_ACL, "the table grants are not production's");
assert.deepEqual(await policies(), LIVE_POLICIES, "the policies are not production's");

await db.query("insert into auth.users values ($1), ($2), ($3), ($4)", [
  student,
  other,
  tutor,
  parent,
]);
await db.query("insert into public.user_roles(user_id, role) values ($1, 'tutor')", [tutor]);
await db.query(
  "insert into public.profiles(id, level, enrolled_courses) values ($1, 'gcse', '{biology,chemistry}'), ($2, 'gcse', '{biology}')",
  [student, other],
);
await db.query("insert into public.parent_student_links(parent_id, student_id) values ($1, $2)", [
  parent,
  student,
]);
await db.query(
  `insert into public.student_enrolments(student_id, subject, board)
   values ($1, 'biology', 'aqa'), ($1, 'chemistry', 'aqa'), ($2, 'biology', 'ocr')`,
  [student, other],
);

// ── Before: the hole ─────────────────────────────────────────────────────
await as(student);
assert.equal(
  await patch({ subject: "physics" }, student, "chemistry"),
  1,
  "before: subject swap allowed",
);
assert.equal(await patch({ subject: "chemistry" }, student, "physics"), 1, "before: swap back");
await insertOwn("physics");
assert.equal(await deleteOwn("physics"), 1, "before: a student deletes their own row");
assert.deepEqual(await updatable("authenticated"), ALL_COLUMNS);

// ── After ────────────────────────────────────────────────────────────────
const checkFenced = async (when: string) => {
  await asOwner();
  assert.deepEqual(
    await policies(),
    LIVE_POLICIES.filter((p) => !/self (insert|delete)/.test(p)),
    `${when}: policies`,
  );
  assert.equal(await tableUpdate("authenticated"), false, `${when}: no table-wide update`);
  assert.deepEqual(await updatable("authenticated"), FENCED, `${when}: the four columns`);
  // Nothing else moves: anon and the service role keep their grants, and
  // signed-in users keep every other privilege.
  assert.deepEqual(await updatable("anon"), ALL_COLUMNS, `${when}: anon untouched`);
  assert.deepEqual(await updatable("service_role"), ALL_COLUMNS, `${when}: service role untouched`);
  for (const p of ["SELECT", "INSERT", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
    const r = await db.query<{ t: boolean }>(
      "select has_table_privilege('authenticated', 'public.student_enrolments', $1) as t",
      [p],
    );
    assert.equal(r.rows[0].t, true, `${when}: authenticated keeps ${p}`);
  }
};

await asOwner();
await db.exec(up);
await checkFenced("after");

// The student's three screens still save.
await as(student);
assert.equal(await patch({ board: "ocr" }, student, "biology"), 1, "board switch");
assert.equal(await patch({ target_grade: "7" }, student, "biology"), 1, "predicted-grade card");
assert.equal(
  await patch({ previous_grade: "5", current_grade: "6", target_grade: "8" }, student, "chemistry"),
  1,
  "onboarding step 3",
);
for (const col of ["previous_grade", "current_grade"]) {
  assert.equal(await patch({ [col]: "4" }, student, "biology"), 1, `${col} alone`);
}
assert.deepEqual(await rows(student), [
  { subject: "biology", board: "ocr", previous_grade: "4", current_grade: "4", target_grade: "7" },
  {
    subject: "chemistry",
    board: "aqa",
    previous_grade: "5",
    current_grade: "6",
    target_grade: "8",
  },
]);

// Every other column is refused, alone or riding along with an allowed one.
const denied = /permission denied for table student_enrolments/;
for (const body of [
  { subject: "physics" },
  { created_at: "2020-01-01T00:00:00Z" },
  { id: uuid(99) },
  { student_id: other },
  { target_grade: "9", subject: "physics" },
]) {
  await rejects(() => patch(body, student, "biology"), denied, `student sets ${Object.keys(body)}`);
}
// No insert, no delete.
await rejects(() => insertOwn("physics"), /row-level security/, "student inserts a row");
assert.equal(await deleteOwn("biology"), 0, "student deletes a row");
// Another student's row is still out of reach.
assert.equal(await patch({ target_grade: "9" }, other, "biology"), 0, "another student's row");
assert.deepEqual(await rows(student), [
  { subject: "biology", board: "ocr", previous_grade: "4", current_grade: "4", target_grade: "7" },
  {
    subject: "chemistry",
    board: "aqa",
    previous_grade: "5",
    current_grade: "6",
    target_grade: "8",
  },
]);

// Subjects still change through save_student_enrolments, as the student.
await db.query("select public.save_student_enrolments($1::jsonb)", [
  JSON.stringify([
    { subject: "biology", board: "aqa" },
    { subject: "physics", board: "edexcel" },
  ]),
]);
assert.deepEqual(await rows(student), [
  { subject: "biology", board: "aqa", previous_grade: "4", current_grade: "4", target_grade: "7" },
  {
    subject: "physics",
    board: "edexcel",
    previous_grade: null,
    current_grade: null,
    target_grade: null,
  },
]);
await asOwner();
assert.deepEqual(
  (
    await db.query<{ e: string[] }>(
      "select enrolled_courses as e from public.profiles where id = $1",
      [student],
    )
  ).rows[0].e,
  ["biology", "physics"],
);

// apply_enrolment_change: still the service role's only.
await as(student);
await rejects(
  () => db.query("select public.apply_enrolment_change($1, '[]'::jsonb, '{}')", [student]),
  /permission denied for function apply_enrolment_change/,
  "student calls apply_enrolment_change",
);
await as(null, "service_role");
assert.deepEqual(
  (
    await db.query<{ a: string[] }>(
      `select public.apply_enrolment_change($1, '[{"subject":"chemistry","board":"ocr"}]'::jsonb, '{physics}') as a`,
      [student],
    )
  ).rows[0].a,
  ["biology", "chemistry"],
);
// The service role still writes any column directly.
assert.equal(
  await patch({ subject: "physics" }, student, "chemistry"),
  1,
  "service role swaps a subject",
);
assert.equal(
  await patch({ subject: "chemistry" }, student, "physics"),
  1,
  "service role swaps back",
);

// The tutor's record page: board and grades, through "enrolments tutor update".
await as(tutor);
assert.equal(
  await patch({ target_grade: "9", current_grade: "8" }, student, "biology"),
  1,
  "tutor grades",
);
assert.equal(await patch({ board: "edexcel" }, student, "biology"), 1, "tutor board");
// The board trigger still fires for a tutor's change under the column grant.
await rejects(
  () => patch({ board: "oxford_aqa" }, student, "biology"),
  /no OxfordAQA curriculum for Biology/,
  "tutor picks a board with no curriculum",
);
await rejects(
  () => patch({ subject: "physics" }, student, "biology"),
  denied,
  "tutor sets subject",
);
assert.deepEqual((await rows(student))[0], {
  subject: "biology",
  board: "edexcel",
  previous_grade: "4",
  current_grade: "8",
  target_grade: "9",
});

// A linked parent, a signed-in nobody and anon still change nothing.
await as(parent);
assert.equal(await patch({ target_grade: "1" }, student, "biology"), 0, "parent");
await as(null);
assert.equal(await patch({ target_grade: "1" }, student, "biology"), 0, "signed in as no one");
await as(null, "anon");
assert.equal(await patch({ target_grade: "1" }, student, "biology"), 0, "anon");

// ── Twice is the same as once ────────────────────────────────────────────
await asOwner();
await db.exec(up);
await checkFenced("second run");

// ── The rollback is production's live state ──────────────────────────────
await db.exec(down);
assert.deepEqual(await policies(), LIVE_POLICIES, "rollback: policies");
assert.equal(await acl(), LIVE_ACL, "rollback: grants");
assert.deepEqual(await updatable("authenticated"), ALL_COLUMNS, "rollback: every column");
await as(student);
await insertOwn("physics");
assert.equal(await deleteOwn("physics"), 1, "rollback: self delete is back");
assert.equal(
  await patch({ subject: "physics" }, student, "chemistry"),
  1,
  "rollback: swap allowed again",
);

// And forward again from the rolled-back state.
await asOwner();
await db.exec(up);
await checkFenced("re-applied");

await db.close();
console.log("enrolment self writes: all checks passed");
