/** Isolated PostgreSQL regression checks for 20261001202000_homework_draft_merge.
 * No production data is read or written.
 *
 *   PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js bun scripts/test-homework-draft-merge-db.ts
 *
 * Two devices, as the student has them: a phone with a correct clock, and a
 * laptop whose clock runs an hour slow.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const db = new PGlite();

const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const student = uuid(1);
const classmate = uuid(2);
const sheet = uuid(10);
const handedIn = uuid(11);

// Only what the migration touches, shaped as production has it.
await db.exec(`
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.resources(id uuid primary key);
create table public.homework_submissions(id uuid primary key default gen_random_uuid(), resource_id uuid, student_id uuid);
create table public.homework_drafts(student_id uuid not null, resource_id uuid not null references public.resources on delete cascade,
  answers jsonb not null default '{}'::jsonb, notes text, updated_at timestamptz not null default now(),
  primary key (student_id, resource_id));
alter table public.homework_drafts enable row level security;
alter table public.homework_submissions enable row level security;
create policy "hd own" on public.homework_drafts for all
  using ((select auth.uid()) = student_id) with check ((select auth.uid()) = student_id);
create policy "hs read scoped" on public.homework_submissions for select to authenticated using ((select auth.uid()) = student_id);
grant all on public.homework_drafts to authenticated;
grant select on public.homework_submissions to authenticated;
grant usage on schema auth to authenticated;
insert into public.resources values ('${sheet}'), ('${handedIn}');
insert into public.homework_submissions(resource_id, student_id) values ('${handedIn}', '${student}');
`);

const migration = await readFile(
  new URL("../supabase/migrations/20261001202000_homework_draft_merge.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);
await db.exec(migration); // idempotent

type Draft = { answers: Record<string, string>; notes: string; stamps: Record<string, number> };

/** A device: its clock, and a sync call made from it as a signed-in student. */
function device(who: string, skewMs: number) {
  const clock = () => Date.now() + skewMs;
  return {
    clock,
    async sync(
      resource: string,
      answers: Record<string, string> = {},
      stamps: Record<string, number> = {},
      notes?: string,
    ): Promise<Draft | null> {
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [who]);
        await db.exec("set local role authenticated");
        const { rows } = await db.query<{ r: Draft | null }>(
          "select public.sync_homework_draft($1, $2::jsonb, $3, $4::jsonb, $5) r",
          [resource, JSON.stringify(answers), notes ?? null, JSON.stringify(stamps), clock()],
        );
        await db.exec("commit");
        return rows[0].r;
      } catch (err) {
        await db.exec("rollback");
        throw err;
      }
    },
  };
}
const HOUR = 60 * 60 * 1000;
const phone = device(student, 0);
const laptop = device(student, -HOUR);
const stored = async () =>
  (
    await db.query<{ answers: Record<string, string>; notes: string | null }>(
      "select answers, notes from homework_drafts where student_id = $1 and resource_id = $2",
      [student, sheet],
    )
  ).rows[0];

// 1. An old tab: the laptop loaded the sheet yesterday and touches only Q2.
//    It also still holds a blank Q1 from yesterday. The phone's Q1 survives.
const yesterday = laptop.clock() - 24 * HOUR;
await phone.sync(sheet, { q1: "typed on the phone" }, { q1: phone.clock() - 60_000 });
await laptop.sync(
  sheet,
  { q1: "", q2: "typed on the laptop" },
  { q1: yesterday, q2: laptop.clock() - 1_000 },
);
assert.deepEqual((await stored()).answers, {
  q1: "typed on the phone",
  q2: "typed on the laptop",
});

// 2. An offline laptop with a slow clock. Its Q3 edit is older in real time
//    than the phone's, though by its own clock it looks an hour older still:
//    the phone's wins. Then a genuinely newer laptop edit wins despite the clock.
await phone.sync(sheet, { q3: "phone, 10s ago" }, { q3: phone.clock() - 10_000 });
await laptop.sync(sheet, { q3: "laptop, 20s ago" }, { q3: laptop.clock() - 20_000 });
assert.equal((await stored()).answers.q3, "phone, 10s ago", "An older offline edit won");
await laptop.sync(sheet, { q3: "laptop, 5s ago" }, { q3: laptop.clock() - 5_000 });
assert.equal((await stored()).answers.q3, "laptop, 5s ago", "A newer edit lost to a slow clock");

// 3. What comes back is on the caller's own clock, so each device can compare
//    it with its local copy directly.
const fromPhone = (await phone.sync(sheet))!;
const fromLaptop = (await laptop.sync(sheet))!;
assert.ok(
  Math.abs(fromPhone.stamps.q3 - fromLaptop.stamps.q3 - HOUR) < 2_000,
  "Stamps not converted",
);
assert.ok(Math.abs(fromLaptop.stamps.q3 - (laptop.clock() - 5_000)) < 2_000);

// 4. The note merges the same way, and a read sends nothing and writes nothing.
await phone.sync(sheet, {}, { notes: phone.clock() }, "unsure on q3");
assert.equal((await stored()).notes, "unsure on q3");
const before = await stored();
assert.equal((await phone.sync(sheet))!.notes, "unsure on q3");
assert.deepEqual(await stored(), before);

// 5. A field in `stamps` that wasn't actually sent is ignored, not blanked.
await phone.sync(sheet, {}, { q1: phone.clock() });
assert.equal((await stored()).answers.q1, "typed on the phone");

// 6. Handed in: nothing comes back and nothing is written.
assert.equal(await phone.sync(handedIn, { q1: "late" }, { q1: phone.clock() }), null);
assert.equal(
  Number(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from homework_drafts where resource_id = $1",
        [handedIn],
      )
    ).rows[0].n,
  ),
  0,
);

// 7. Another student sees none of it and creates nothing of the student's.
const other = device(classmate, 0);
assert.equal(await other.sync(sheet), null);
await other.sync(sheet, { q1: "mine" }, { q1: other.clock() });
assert.equal((await stored()).answers.q1, "typed on the phone");

// 8. A draft written the old way (no stamps) counts as written at updated_at,
//    which the server sets whatever the writer sends.
await db.exec(`insert into homework_drafts(student_id, resource_id, answers, updated_at)
  values ('${classmate}', '${handedIn}', '{"q1":"old way"}', '2001-01-01')`);
const legacy = (
  await db.query<{ updated_at: string }>(
    `select updated_at::text from homework_drafts where student_id = '${classmate}' and resource_id = '${handedIn}'`,
  )
).rows[0];
assert.ok(!legacy.updated_at.startsWith("2001"), "updated_at came from the writer, not the server");
const older = (await other.sync(handedIn, { q1: "older" }, { q1: other.clock() - HOUR }))!;
assert.equal(older.answers.q1, "old way", "An edit older than the legacy row won");
const newer = (await other.sync(handedIn, { q1: "newer" }, { q1: other.clock() + 1_000 }))!;
assert.equal(newer.answers.q1, "newer");

console.log("sync_homework_draft: all checks passed");
