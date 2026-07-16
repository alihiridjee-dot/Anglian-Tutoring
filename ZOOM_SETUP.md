# Zoom live sessions — setup & deploy

Live sessions were pivoted from a cosmetic Microsoft Teams link to **real Zoom
meeting generation**. The architecture:

```
Tutor dashboard (LiveForm) ─┐
                            ├─► zoom-meeting Edge Function ─► Zoom REST API
Zoom MCP server (agents) ───┘        (holds Zoom S2S creds)
```

All Zoom API access goes through one Supabase Edge Function so the credentials
live in exactly one place. Nothing Zoom-related ships in the browser bundle.

---

## 1. Create the Zoom app (you must do this)

1. Go to <https://marketplace.zoom.us> → **Develop → Build App**.
2. Choose **Server-to-Server OAuth**.
3. Copy the **Account ID**, **Client ID**, and **Client Secret**.
4. Under **Scopes**, add:
   - `meeting:write:admin` (create meetings)
   - `meeting:read:admin` (read meeting details/status)
5. **Activate** the app.

## 2. Set the edge-function secrets

```bash
supabase secrets set \
  ZOOM_ACCOUNT_ID=xxxxx \
  ZOOM_CLIENT_ID=xxxxx \
  ZOOM_CLIENT_SECRET=xxxxx
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are injected
automatically — do not set them by hand.

## 3. Deploy the function

Already deployed (v1, ACTIVE). Re-deploy after edits with:

```bash
supabase functions deploy zoom-meeting
```

Until the Zoom secrets in step 2 are set, `create` returns a clean
`"Zoom credentials are not configured on the server."` — the app surfaces this
as a toast. **Scheduling still works without it**: the join link is optional, so
a tutor can schedule now and add the Zoom link later (Auto Zoom or paste).

The function is defined in `supabase/functions/zoom-meeting/index.ts`. It:

- exchanges the S2S creds for a short-lived Zoom access token (cached in-memory);
- **`action: "create"`** → `POST /users/me/meetings`, returns
  `{ id, join_url, start_url, password, start_time, duration }`;
- **`action: "get"`** → `GET /meetings/{id}` (accepts a numeric id or a join URL),
  returns `{ id, topic, join_url, start_time, duration, status, timezone }`;
- authorizes callers two ways: a valid tutor/admin user JWT (the dashboard), or
  the service-role key (trusted backends / the MCP server).

## 4. Verify from the tutor dashboard

1. Sign in as a tutor and open **Live Sessions** (`/live`) or **Tutor Studio →
   Schedule Live**.
2. Fill in **Title** and **Starts at**, then click **Auto Zoom**.
3. A real Zoom meeting is created and its `https://zoom.us/j/...` join URL fills
   the field. Save the session; it appears in the list with a **Join Zoom
   Meeting** button.

## 5. (Optional) Agent-driven creation via MCP

See `mcp/zoom-mcp/README.md`. That standalone MCP server exposes
`create_zoom_meeting` and `get_meeting_details` to Claude Desktop / Claude Code,
proxying to the same edge function with the service-role key.

---

## What changed in the app

| File | Change |
| --- | --- |
| `supabase/functions/zoom-meeting/index.ts` | **New, deployed (v1)** — Zoom S2S OAuth + create/get. Self-contained (CORS inlined). |
| `src/lib/zoom.functions.ts` | **New** — `createZoomMeeting` / `getZoomMeeting` client helpers. |
| `src/components/tutor/LiveForm.tsx` | "Auto Teams" mock → **Auto Zoom** real meeting creation. Join link is now **optional** so a session can be scheduled before Zoom creds exist (link fills in via Auto Zoom or manual paste). |
| `src/routes/_authenticated/live.tsx` | Join button rebranded Teams → **Zoom**. |
| `src/lib/demo/studentDemo.ts` | Demo join URLs → `zoom.us`. |
| `src/components/landing/OfferSection.tsx` | Marketing copy → Zoom. |
| `mcp/zoom-mcp/` | **New** — MCP server for agent-driven creation. |

### Notes / trade-offs

- **No schema change.** Meeting status tracking parses the meeting id out of the
  stored `join_url`, so the `resources` table and the `LiveForm` insert are
  unchanged — the rest of the app keeps working untouched.
- The old Teams "integration" was entirely mock (a random client-side URL); there
  was no SDK or API to remove.
- `start_url` (host-only) is returned by create but never stored or shown to
  students; only `join_url` is persisted.
