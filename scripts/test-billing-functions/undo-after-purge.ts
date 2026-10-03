/** Undoing an account deletion: allowed while nothing has been deleted, refused
 * once a purge has tried (and maybe half-done) the job, or once the date has
 * passed and a purge may start at any moment (M-15). Runs the real
 * delete-account code against the in-memory Supabase. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.deletions.json \
 *     --allow-env --allow-read scripts/test-billing-functions/undo-after-purge.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { BANS, DB, resetDb, table } from "./mock-supabase-deletions.ts";

const fn = await loadHandler("../../supabase/functions/delete-account/index.ts");

const TUTOR = "tutor-T";
const STUDENT = "student-S";
const DAY = 86_400_000;

/** A booking for STUDENT, then a tutor pressing Undo. */
async function undo(booking: { attempts: number; purgeInDays: number }) {
  resetDb();
  for (const k of Object.keys(BANS)) delete BANS[k];
  DB.users["tutor-token"] = { id: TUTOR, email: "tutor@example.com" };
  table("user_roles").push({ user_id: TUTOR, role: "tutor" });
  table("account_deletions").push({
    id: "del-1",
    student_id: STUDENT,
    status: "scheduled",
    purge_after: new Date(Date.now() + booking.purgeInDays * DAY).toISOString(),
    notify: [],
    student_name: "Sam",
    paused_subscription_id: null,
    attempts: booking.attempts,
    claimed_at: null,
    last_error: booking.attempts ? "avatars: storage timeout" : null,
  });
  const res = await fn(
    post({ action: "undo", student_id: STUDENT }, { Authorization: "Bearer tutor-token" }),
  );
  return { status: res.status, body: await res.json(), row: table("account_deletions")[0] };
}

// 1. Booked yesterday, nothing deleted yet: Undo works and the login is unlocked.
{
  const { status, row } = await undo({ attempts: 0, purgeInDays: 6 });
  assert.equal(status, 200);
  assert.equal(row.status, "cancelled");
  assert.equal(BANS[STUDENT], "none");
}

// 2. A purge ran, cancelled the plan and deleted the parent links, then failed
//    on the files: Undo is refused, the booking stays, and the login stays locked.
{
  const { status, body, row } = await undo({ attempts: 1, purgeInDays: -0.1 });
  assert.equal(status, 409);
  assert.match(body.error, /already started/);
  assert.equal(row.status, "scheduled");
  assert.equal(BANS[STUDENT], undefined);
}

// 3. The date has passed and the hourly purge hasn't reached it yet: refused too,
//    since the purge could claim it while the undo is half-way through.
{
  const { status, row } = await undo({ attempts: 0, purgeInDays: -0.01 });
  assert.equal(status, 409);
  assert.equal(row.status, "scheduled");
}

console.log("undo-after-purge: 3 cases pass");
