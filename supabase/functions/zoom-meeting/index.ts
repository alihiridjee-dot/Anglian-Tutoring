// Supabase Edge Function: zoom-meeting
//
// The single place Zoom credentials live. Exchanges Zoom Server-to-Server
// OAuth credentials for an access token, then creates or fetches meetings via
// the Zoom REST API. Invoked from the browser (tutor dashboard) and from the
// standalone MCP server (service-role bearer, for agent-driven creation).
//
// Required function secrets (set with `supabase secrets set ...`):
//   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
// Auto-injected by the platform:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, HttpError } from "../_shared/http.ts";

// CORS for browser-invoked calls (the tutor dashboard uses functions.invoke).

interface CreatePayload {
  action: "create";
  topic: string;
  start_time: string; // ISO 8601, e.g. 2026-08-01T14:00:00Z
  duration?: number; // minutes; default 60
  timezone?: string; // IANA tz; default Europe/London
  agenda?: string;
}

interface GetPayload {
  action: "get";
  meeting_id: string; // numeric Zoom meeting id, or a Zoom join URL to parse
}

interface DeletePayload {
  action: "delete";
  resource_id: string; // the live session being deleted; its row must still exist
}

type Payload = CreatePayload | GetPayload | DeletePayload;

// --- Zoom Server-to-Server OAuth -------------------------------------------

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getZoomAccessToken(): Promise<string> {
  const now = Date.now();
  // Reuse a still-valid token (minus a 60s safety margin).
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }

  const accountId = Deno.env.get("ZOOM_ACCOUNT_ID");
  const clientId = Deno.env.get("ZOOM_CLIENT_ID");
  const clientSecret = Deno.env.get("ZOOM_CLIENT_SECRET");
  if (!accountId || !clientId || !clientSecret) {
    throw new HttpError(500, "Zoom credentials are not configured on the server.");
  }

  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}` },
    },
  );

  if (!res.ok) {
    throw new HttpError(502, `Zoom OAuth failed (${res.status}): ${await res.text()}`);
  }
  const json = await res.json();
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/**
 * The fields this function actually reads off a Zoom meeting. Zoom returns far
 * more; naming only what is consumed keeps the contract honest and means a
 * field we depend on can't quietly disappear behind an untyped response.
 */
interface ZoomMeeting {
  id?: number | string;
  topic?: string;
  join_url?: string;
  /** Host-only — never returned to a student. */
  start_url?: string;
  password?: string | null;
  start_time?: string;
  duration?: number;
  status?: string;
  timezone?: string;
}

async function zoomFetch(path: string, init?: RequestInit): Promise<ZoomMeeting> {
  const token = await getZoomAccessToken();
  const res = await fetch(`https://api.zoom.us/v2${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new HttpError(res.status, body?.message ?? `Zoom API error (${res.status})`);
  }
  return body;
}

// --- Auth: tutor JWT or trusted service role -------------------------------

async function assertAuthorized(req: Request): Promise<void> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Missing Authorization header.");

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // The MCP server / trusted backends call with the service-role key.
  if (serviceKey && token === serviceKey) return;

  // Otherwise it must be an authenticated user who holds a tutor/admin role.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) throw new HttpError(401, "Invalid or expired session.");

  const { data: roles, error: rolesErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  if (rolesErr) throw new HttpError(500, "Could not verify permissions.");

  const isTutor = (roles ?? []).some(
    (r: { role: string }) => r.role === "tutor" || r.role === "admin",
  );
  if (!isTutor) throw new HttpError(403, "Tutor access required to manage live sessions.");
}

// --- Handlers ---------------------------------------------------------------

async function handleCreate(p: CreatePayload) {
  if (!p.topic || !p.start_time) {
    throw new HttpError(400, "`topic` and `start_time` are required.");
  }
  const meeting = await zoomFetch("/users/me/meetings", {
    method: "POST",
    body: JSON.stringify({
      topic: p.topic,
      type: 2, // scheduled meeting
      start_time: p.start_time,
      duration: p.duration ?? 60,
      timezone: p.timezone ?? "Europe/London",
      agenda: p.agenda ?? "",
      settings: {
        join_before_host: true,
        waiting_room: true,
        approval_type: 2, // no registration required
        mute_upon_entry: true,
      },
    }),
  });
  return {
    id: String(meeting.id),
    join_url: meeting.join_url,
    start_url: meeting.start_url, // host-only; do not expose to students
    password: meeting.password ?? null,
    start_time: meeting.start_time,
    duration: meeting.duration,
  };
}

// Accepts a numeric id or a full Zoom join URL like https://zoom.us/j/1234567890
function parseMeetingId(raw: string): string {
  const m = raw.match(/\/j\/(\d+)/);
  return m ? m[1] : raw.replace(/\D/g, "");
}

async function handleGet(p: GetPayload) {
  if (!p.meeting_id) throw new HttpError(400, "`meeting_id` is required.");
  const id = parseMeetingId(p.meeting_id);
  const meeting = await zoomFetch(`/meetings/${id}`);
  return {
    id: String(meeting.id),
    topic: meeting.topic,
    join_url: meeting.join_url,
    start_time: meeting.start_time,
    duration: meeting.duration,
    status: meeting.status, // "waiting" | "started" | "finished"
    timezone: meeting.timezone,
  };
}

// The meeting number in a Zoom join link, or null for any other link.
function meetingIdInLink(url: string | null): string | null {
  return url?.match(/\/j\/(\d+)/)?.[1] ?? null;
}

// Cancels the Zoom meeting behind a live session that is about to be deleted,
// but only a meeting this app created for that session ("Auto Zoom" records
// it in zoom_meeting_id), and only while no other session points at it. A
// pasted link is often one recurring meeting reused every week, and Zoom
// deletes a recurring meeting whole, so cancelling it killed every other
// session's link. Idempotent: a meeting Zoom no longer knows about is treated
// as success so the caller can still remove the session row.
async function handleDelete(p: DeletePayload) {
  if (!p.resource_id) throw new HttpError(400, "`resource_id` is required.");
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const { data: sessions, error } = await admin
    .from("resources")
    .select("id, join_url, zoom_meeting_id")
    .eq("kind", "live_session");
  if (error) throw new HttpError(500, "Could not read the live sessions.");
  const rows = (sessions ?? []) as {
    id: string;
    join_url: string | null;
    zoom_meeting_id: string | null;
  }[];

  const session = rows.find((r) => r.id === p.resource_id);
  if (!session?.zoom_meeting_id) return { deleted: false, reason: "not_created_here" };
  const id = session.zoom_meeting_id;
  const shared = rows.some(
    (r) => r.id !== session.id && (r.zoom_meeting_id === id || meetingIdInLink(r.join_url) === id),
  );
  if (shared) return { deleted: false, id, reason: "shared" };

  try {
    await zoomFetch(`/meetings/${id}`, { method: "DELETE" });
    return { deleted: true, id };
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      return { deleted: false, id, reason: "not_found" };
    }
    throw err;
  }
}

// --- Entrypoint -------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    await assertAuthorized(req);

    const payload = (await req.json()) as Payload;
    switch (payload.action) {
      case "create":
        return json(await handleCreate(payload));
      case "get":
        return json(await handleGet(payload));
      case "delete":
        return json(await handleDelete(payload));
      default:
        throw new HttpError(400, "Unknown action. Use 'create', 'get' or 'delete'.");
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return json({ error: message }, status);
  }
});
