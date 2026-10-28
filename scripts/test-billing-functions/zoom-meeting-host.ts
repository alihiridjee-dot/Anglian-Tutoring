/** Lessons can be hosted by Ali or Nadia: "create" makes the meeting on the
 * chosen host's Zoom, whether Nadia is a user in Ali's account or has her own,
 * and "delete" finds a meeting in either account. Runs the real function code
 * against the in-memory Supabase in this folder, with Zoom's API stubbed.
 *
 *   DENO_NO_PACKAGE_JSON=1 deno run --no-config --cached-only \
 *     --import-map=scripts/test-billing-functions/import_map.json \
 *     --allow-env --allow-read scripts/test-billing-functions/zoom-meeting-host.ts
 */
import assert from "node:assert/strict";
import { loadHandler, post } from "./harness.ts";
import { DB, resetDb, table } from "./mock-supabase.ts";

Deno.env.set("ZOOM_ACCOUNT_ID", "ali-acct");
Deno.env.set("ZOOM_CLIENT_ID", "x");
Deno.env.set("ZOOM_CLIENT_SECRET", "x");

// Zoom: a token named after the account it was minted for, so each call shows
// which account it ran in. Meetings live in `meetings[account]`.
const calls: string[] = [];
const meetings: Record<string, string[]> = { "ali-acct": ["111"], "nadia-acct": ["222"] };
globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const oauth = url.match(/oauth\/token\?.*account_id=([^&]+)/);
  if (oauth) return Promise.resolve(Response.json({ access_token: oauth[1], expires_in: 3600 }));
  const account = new Headers(init?.headers).get("Authorization")!.replace("Bearer ", "");
  const path = url.replace("https://api.zoom.us/v2", "");
  calls.push(`${account} ${init?.method ?? "GET"} ${path}`);
  if (init?.method === "POST") {
    return Promise.resolve(Response.json({ id: 999, join_url: "https://zoom.us/j/999" }));
  }
  const id = path.match(/^\/meetings\/(\d+)$/)?.[1];
  if (id && meetings[account]?.includes(id)) {
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(
    Response.json({ code: 3001, message: "Meeting does not exist." }, { status: 404 }),
  );
};

const zoom = await loadHandler("../../supabase/functions/zoom-meeting/index.ts");

const TUTOR = "tutor-token";
resetDb();
DB.users[TUTOR] = { id: "tutor-1", email: "t@test" };
table("user_roles").push({ user_id: "tutor-1", role: "tutor" });
const auth = { Authorization: `Bearer ${TUTOR}` };
const create = async (host?: string) => {
  calls.length = 0;
  const res = await zoom(
    post({ action: "create", topic: "Cells", start_time: "2026-11-01T17:00:00Z", host }, auth),
  );
  return { status: res.status, body: await res.json() };
};

// 1. No host, or Ali, is Ali's own Zoom, as before.
let r = await create();
assert.equal(r.status, 200);
assert.deepEqual(calls, ["ali-acct POST /users/me/meetings"]);
await create("ali");
assert.deepEqual(calls, ["ali-acct POST /users/me/meetings"]);

// 2. Nadia before her Zoom is connected: a clear refusal, no meeting made.
r = await create("nadia");
assert.equal(r.status, 400);
assert.match(r.body.error, /Nadia's Zoom isn't connected/);
assert.deepEqual(calls, []);

// 3. Nadia as a user in Ali's account: Ali's token, her Zoom user.
Deno.env.set("ZOOM_NADIA_USER", "nadia@example.com");
r = await create("nadia");
assert.equal(r.status, 200);
assert.deepEqual(calls, ["ali-acct POST /users/nadia%40example.com/meetings"]);

// 4. Nadia's own account, once configured, wins over the email.
Deno.env.set("ZOOM_NADIA_ACCOUNT_ID", "nadia-acct");
Deno.env.set("ZOOM_NADIA_CLIENT_ID", "y");
Deno.env.set("ZOOM_NADIA_CLIENT_SECRET", "y");
r = await create("nadia");
assert.deepEqual(calls, ["nadia-acct POST /users/me/meetings"]);

// 5. An unknown host is refused.
r = await create("bob");
assert.equal(r.status, 400);

// 6. Delete cancels a meeting in whichever account holds it.
for (const [id, meeting] of [
  ["s1", "111"],
  ["s2", "222"],
]) {
  table("resources").push({
    id,
    kind: "live_session",
    join_url: `https://zoom.us/j/${meeting}`,
    zoom_meeting_id: meeting,
  });
}
const del = async (resourceId: string) => {
  calls.length = 0;
  const res = await zoom(post({ action: "delete", resource_id: resourceId }, auth));
  return await res.json();
};
assert.deepEqual(await del("s1"), { deleted: true, id: "111" });
assert.deepEqual(calls, ["ali-acct DELETE /meetings/111"]);
assert.deepEqual(await del("s2"), { deleted: true, id: "222" });
assert.deepEqual(calls, ["ali-acct DELETE /meetings/222", "nadia-acct DELETE /meetings/222"]);

// 7. A meeting neither account has is still "not found", so the row can go.
table("resources").push({
  id: "s3",
  kind: "live_session",
  join_url: "https://zoom.us/j/333",
  zoom_meeting_id: "333",
});
assert.deepEqual(await del("s3"), { deleted: false, id: "333", reason: "not_found" });

console.log("zoom-meeting host: all checks passed");
