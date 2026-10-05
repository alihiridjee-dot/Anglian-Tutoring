/** Isolated PostgreSQL regression checks for student_engagement (S-24).
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-student-engagement-db.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const child = uuid(1);
const parent = uuid(2);
const stranger = uuid(3);
const tutor = uuid(4);

await db.exec(`
create role authenticated; create role anon;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create type app_role as enum ('student','tutor','admin');
create type subject as enum ('biology','chemistry','physics');
create type board as enum ('edexcel','aqa','ocr');
create type level as enum ('gcse','alevel','igcse');
create type resource_kind as enum ('homework','live_session','video');
create type resource_origin as enum ('tutor','generated');
create table user_roles(user_id uuid, role app_role);
create function private.has_role(_user_id uuid, _role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = _user_id and role = _role) $$;
create table profiles(id uuid primary key, level level, created_at timestamptz default now());
create table student_enrolments(id uuid primary key default gen_random_uuid(), student_id uuid, subject subject, board board, created_at timestamptz default now());
create table parent_student_links(id uuid primary key default gen_random_uuid(), parent_id uuid, student_id uuid);
create table resources(id uuid primary key default gen_random_uuid(), kind resource_kind, title text, subject subject, board board, level level,
  starts_at timestamptz, due_at timestamptz, origin resource_origin default 'tutor', review_status text default 'approved', publish_at timestamptz);
create table session_attendees(id uuid primary key default gen_random_uuid(), resource_id uuid, user_id uuid, joined_at timestamptz default now());
create table homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid);
`);
const migration = await readFile(
  new URL("../supabase/migrations/20261003111000_student_engagement.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

// ── Fixtures ──────────────────────────────────────────────────────────────
// A GCSE child who took up Biology (AQA) 30 days ago and Physics (Edexcel) 10
// days ago. Everything below is a reason the old count was wrong, plus the
// work that genuinely was theirs.
await db.query("insert into user_roles values($1,'tutor')", [tutor]);
await db.query(
  "insert into profiles(id,level,created_at) values($1,'gcse',now() - interval '60 days')",
  [child],
);
await db.query(
  "insert into student_enrolments(student_id,subject,board,created_at) values($1,'biology','aqa',now() - interval '30 days'),($1,'physics','edexcel',now() - interval '10 days')",
  [child],
);
await db.query("insert into parent_student_links(parent_id,student_id) values($1,$2)", [
  parent,
  child,
]);

const hw = async (title: string, cols: Record<string, string>) => {
  const keys = ["kind", "title", ...Object.keys(cols)];
  const vals = ["'homework'", `'${title}'`, ...Object.values(cols)];
  const r = await db.query<{ id: string }>(
    `insert into resources(${keys.join(",")}) values(${vals.join(",")}) returning id`,
  );
  return r.rows[0].id;
};
const day = (n: number) => `now() + interval '${n} days'`;

// Counted: set for them and due since they joined.
const bioMine = await hw("Bio, mine", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(-5),
});
const bioAnyBoard = await hw("Bio, any board", {
  subject: "'biology'",
  level: "'gcse'",
  due_at: day(-3),
});
const physMine = await hw("Phys, mine", {
  subject: "'physics'",
  board: "'edexcel'",
  level: "'gcse'",
  due_at: day(-2),
});
// Not counted.
await hw("Bio, before joining", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(-40),
});
await hw("Phys, before taking physics up", {
  subject: "'physics'",
  board: "'edexcel'",
  level: "'gcse'",
  due_at: day(-20),
});
await hw("Bio, other board", {
  subject: "'biology'",
  board: "'ocr'",
  level: "'gcse'",
  due_at: day(-5),
});
await hw("Bio, not yet due", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(3),
});
await hw("Bio, no due date", { subject: "'biology'", board: "'aqa'", level: "'gcse'" });
await hw("Bio, A-level", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'alevel'",
  due_at: day(-5),
});
await hw("Bio, generated", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(-5),
  origin: "'generated'",
});
await hw("Bio, held for review", {
  subject: "'biology'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(-5),
  review_status: "'to_review'",
  publish_at: day(1),
});
await hw("Chem, not their subject", {
  subject: "'chemistry'",
  board: "'aqa'",
  level: "'gcse'",
  due_at: day(-5),
});

const session = async (cols: string) =>
  (
    await db.query<{ id: string }>(
      `insert into resources(kind,title,subject,board,level,starts_at) values('live_session','s',${cols}) returning id`,
    )
  ).rows[0].id;
const s1 = await session(`'biology','aqa','gcse',${day(-7)}`);
const s2 = await session(`'biology',null,'gcse',${day(-6)}`);
await session(`'biology','ocr','gcse',${day(-6)}`); // other board
await session(`'biology','aqa','gcse',${day(-45)}`); // before joining
await session(`'biology','aqa','gcse',${day(2)}`); // not held yet
await session(`'biology','aqa','alevel',${day(-6)}`); // other level

// Handed in two of the three briefs, plus one that isn't counted; joined s1 twice.
await db.query("insert into homework_submissions(resource_id,student_id) values($1,$3),($2,$3)", [
  bioMine,
  physMine,
  child,
]);
const notCounted = await db.query<{ id: string }>(
  "select id from resources where title = 'Bio, before joining'",
);
await db.query("insert into homework_submissions(resource_id,student_id) values($1,$2)", [
  notCounted.rows[0].id,
  child,
]);
await db.query("insert into session_attendees(resource_id,user_id) values($1,$2),($1,$2)", [
  s1,
  child,
]);
void bioAnyBoard;
void s2;

await db.exec(`grant usage on schema public,auth,private to authenticated, anon;
 grant select on all tables in schema public to authenticated;
 set role authenticated;`);
const as = (id: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
const counts = async () =>
  (await db.query("select * from student_engagement($1)", [child])).rows as Array<
    Record<string, number>
  >;

const expected = [
  { sessions_held: 2, sessions_attended: 1, homework_set: 3, homework_submitted: 2 },
];
await as(parent);
assert.deepEqual(await counts(), expected, "A linked parent sees the child's own counts");
await as(child);
assert.deepEqual(await counts(), expected, "The child sees the same counts");
await as(tutor);
assert.deepEqual(await counts(), expected, "A tutor sees the same counts");
await as(stranger);
assert.deepEqual(await counts(), [], "An unlinked caller gets no row");

// A student with no level yet isn't filtered by one, as on their own pages.
await db.exec("reset role");
await db.query("update profiles set level = null where id = $1", [child]);
await db.exec("set role authenticated");
await as(parent);
const unlevelled = await counts();
assert.equal(unlevelled[0].homework_set, 4, "No level: the A-level brief counts too");
assert.equal(unlevelled[0].sessions_held, 3, "No level: the A-level session counts too");

await db.exec("reset role; set role anon;");
let threw = false;
try {
  await db.query("select * from student_engagement($1)", [child]);
} catch {
  threw = true;
}
assert(threw, "anon could call student_engagement");

// ── Breaks (20261005142000): what fell in a break counts neither way ─────
{
  await db.exec("reset role");
  await db.query("update profiles set level = 'gcse' where id = $1", [child]);
  // The real table, exactly as the migration that makes it writes it.
  const breaksSql = await readFile(
    new URL("../supabase/migrations/20261004114000_student_breaks.sql", import.meta.url),
    "utf8",
  );
  const from = breaksSql.indexOf("create table public.student_breaks (");
  await db.exec(
    `create table auth.users(id uuid primary key); insert into auth.users values ('${child}');` +
      breaksSql.slice(from, breaksSql.indexOf(");\n", from) + 3),
  );
  const pickup = await readFile(
    new URL("../supabase/migrations/20261005142000_breaks_not_held_against.sql", import.meta.url),
    "utf8",
  );
  await db.exec(pickup);
  await db.exec(pickup); // idempotent

  // A week three weeks back, well after they took Biology up.
  const monday = (
    await db.query<{ m: string }>(
      "select to_char(date_trunc('week', (now() - interval '21 days') at time zone 'Europe/London'), 'YYYY-MM-DD') as m",
    )
  ).rows[0].m;
  const at = (days: number, hour: number) =>
    `(('${monday}'::date + ${days})::timestamp + interval '${hour} hours') at time zone 'Europe/London'`;
  const dueInBreak = await hw("Bio, due in the break", {
    subject: "'biology'",
    board: "'aqa'",
    level: "'gcse'",
    due_at: at(2, 17),
  });
  await hw("Bio, due the Monday after", {
    subject: "'biology'",
    board: "'aqa'",
    level: "'gcse'",
    due_at: at(7, 9),
  });
  await session(`'biology','aqa','gcse',${at(1, 16)}`);
  await db.query("insert into homework_submissions(resource_id,student_id) values($1,$2)", [
    dueInBreak,
    child,
  ]);
  const away = (
    await db.query<{ id: string }>(
      "insert into public.student_breaks (student_id, starts_on, ends_on, reason) values ($1, $2, $2::date + 6, 'holiday') returning id",
      [child, monday],
    )
  ).rows[0].id;

  const countsAs = async (who: string) => {
    await db.exec("set role authenticated");
    await as(who);
    try {
      return (await counts())[0];
    } finally {
      await db.exec("reset role");
    }
  };
  assert.deepEqual(
    await countsAs(parent),
    { sessions_held: 2, sessions_attended: 1, homework_set: 4, homework_submitted: 2 },
    "The task due and the session held in the break count neither way; the Monday after counts",
  );

  await db.query("update public.student_breaks set cancelled_at = now() where id = $1", [away]);
  const calledOff = {
    sessions_held: 3,
    sessions_attended: 1,
    homework_set: 5,
    homework_submitted: 3,
  };
  assert.deepEqual(await countsAs(parent), calledOff, "A called-off break never counts");

  await db.query("update public.student_breaks set cancelled_at = null where id = $1", [away]);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/rollbacks/20261005142000_breaks_not_held_against.down.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(await countsAs(parent), calledOff, "The rollback counts break weeks again");
}

console.log("student_engagement: all checks passed");
