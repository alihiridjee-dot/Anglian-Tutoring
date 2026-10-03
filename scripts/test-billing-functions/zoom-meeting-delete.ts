/** S-37, from the zoom-meeting function's side: deleting a live session
 * cancels its Zoom meeting only when the app created that meeting and no other
 * session still uses it. Runs the real function code against the in-memory
 * Supabase in this folder, with Zoom's API stubbed. No network.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/zoom-meeting-delete.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";

for (const k of ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"]) Deno.env.set(k, "x");

// Zoom: a token for anyone, and every meeting the function asks to delete.
const cancelled: string[] = [];
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("zoom.us/oauth/token")) {
    return Promise.resolve(Response.json({ access_token: "t", expires_in: 3600 }));
  }
  const m = url.match(/\/v2\/meetings\/(\d+)$/);
  if (m && init?.method === "DELETE") {
    cancelled.push(m[1]);
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.reject(new Error(`unexpected fetch ${url}`));
};

const zoom = await loadHandler("../../supabase/functions/zoom-meeting/index.ts");

const TUTOR = "tutor-token";
const STUDENT = "student-token";
function world(sessions: Record<string, unknown>[]) {
  resetDb();
  cancelled.length = 0;
  DB.users[TUTOR] = { id: "tutor-1", email: "t@test" };
  DB.users[STUDENT] = { id: "student-1", email: "s@test" };
  table("user_roles").push({ user_id: "tutor-1", role: "tutor" });
  for (const s of sessions) table("resources").push({ kind: "live_session", ...s });
}
const del = async (resourceId: string, token = TUTOR) => {
  const res = await zoom(
    post({ action: "delete", resource_id: resourceId }, { Authorization: `Bearer ${token}` }),
  );
  return { status: res.status, body: await res.json() };
};
const made = (id: string, meeting: string) => ({
  id,
  join_url: `https://us05web.zoom.us/j/${meeting}?pwd=abc`,
  zoom_meeting_id: meeting,
});

// 1. A meeting the app made, used by this session alone, is cancelled.
world([made("s1", "111")]);
let r = await del("s1");
assert.equal(r.status, 200);
assert.deepEqual(r.body, { deleted: true, id: "111" });
assert.deepEqual(cancelled, ["111"]);

// 2. A pasted link — often one recurring meeting reused every week — is never cancelled.
world([{ id: "s1", join_url: "https://zoom.us/j/222", zoom_meeting_id: null }]);
r = await del("s1");
assert.equal(r.body.reason, "not_created_here");
assert.deepEqual(cancelled, [], "A pasted link's meeting was cancelled");

// 3. An app-made meeting whose link was pasted into another session stays.
world([made("s1", "333"), { id: "s2", join_url: "https://zoom.us/j/333", zoom_meeting_id: null }]);
r = await del("s1");
assert.equal(r.body.reason, "shared");
assert.deepEqual(cancelled, [], "A meeting another session still uses was cancelled");

// 4. …and so does one two sessions both recorded.
world([made("s1", "444"), made("s2", "444")]);
r = await del("s2");
assert.equal(r.body.reason, "shared");
assert.deepEqual(cancelled, []);

// 5. Another session on a different meeting doesn't count as sharing.
world([made("s1", "555"), made("s2", "556")]);
r = await del("s1");
assert.deepEqual(r.body, { deleted: true, id: "555" });

// 6. Only tutors may ask, and the old "cancel whatever meeting this link names"
//    request is refused rather than obeyed.
world([made("s1", "666")]);
r = await del("s1", STUDENT);
assert.equal(r.status, 403);
const old = await zoom(
  post(
    { action: "delete", meeting_id: "https://zoom.us/j/666" },
    { Authorization: `Bearer ${TUTOR}` },
  ),
);
assert.equal(old.status, 400);
assert.deepEqual(cancelled, [], "A refused request cancelled a meeting");

// 7. A session the function can't find cancels nothing.
world([made("s1", "777")]);
r = await del("gone");
assert.equal(r.body.reason, "not_created_here");
assert.deepEqual(cancelled, []);

console.log("zoom-meeting delete: all checks passed");
