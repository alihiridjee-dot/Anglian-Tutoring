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
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS for browser-invoked calls (the tutor dashboard uses functions.invoke).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  meeting_id: string; // numeric Zoom meeting id, or a Zoom join URL to parse
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

async function zoomFetch(path: string, init?: RequestInit): Promise<any> {
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

  const isTutor = (roles ?? []).some((r: { role: string }) => r.role === "tutor" || r.role === "admin");
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

// Cancels a scheduled meeting on Zoom. Idempotent: a meeting that Zoom no
// longer knows about (already deleted, or created before this integration) is
// treated as success so the caller can still remove the local session row.
async function handleDelete(p: DeletePayload) {
  if (!p.meeting_id) throw new HttpError(400, "`meeting_id` is required.");
  const id = parseMeetingId(p.meeting_id);
  if (!id) return { deleted: false, reason: "no_zoom_meeting" };
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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

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
