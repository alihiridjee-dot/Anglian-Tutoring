import { supabase } from "@/integrations/supabase/client";

/**
 * Client helpers for Zoom live-session provisioning.
 *
 * All Zoom API access is funnelled through the `zoom-meeting` Supabase Edge
 * Function, which is the single place the Zoom Server-to-Server OAuth
 * credentials live. `supabase.functions.invoke` automatically attaches the
 * caller's JWT, so the edge function can confirm the caller holds a tutor/admin
 * role before minting a meeting. The same edge function is reused by the
 * standalone MCP server (agent-driven creation), keeping one source of truth.
 */

const FUNCTION = "zoom-meeting";

export interface ZoomMeeting {
  id: string;
  join_url: string;
  /** Host-only start URL. Never surface this to students. */
  start_url?: string;
  password?: string | null;
  start_time: string;
  duration?: number;
}

export interface ZoomMeetingDetails {
  id: string;
  topic: string;
  join_url: string;
  start_time: string;
  duration: number;
  status: "waiting" | "started" | "finished" | string;
  timezone?: string;
}

export interface CreateZoomMeetingInput {
  /** Meeting title shown in Zoom, e.g. the session title. */
  topic: string;
  /** Session start, ISO 8601 (UTC). */
  startTime: string;
  /** Length in minutes. Defaults to 60 server-side. */
  durationMinutes?: number;
  /** IANA timezone. Defaults to Europe/London server-side. */
  timezone?: string;
  /** Optional agenda / description. */
  agenda?: string;
}

/** Create a real Zoom meeting and return its join URL and metadata. */
export async function createZoomMeeting(input: CreateZoomMeetingInput): Promise<ZoomMeeting> {
  const { data, error } = await supabase.functions.invoke<ZoomMeeting>(FUNCTION, {
    body: {
      action: "create",
      topic: input.topic,
      start_time: input.startTime,
      duration: input.durationMinutes,
      timezone: input.timezone,
      agenda: input.agenda,
    },
  });
  if (error) throw new Error(await readInvokeError(error));
  if (!data?.join_url) throw new Error("Zoom did not return a join URL.");
  return data;
}

/** Fetch live status/details for a meeting by numeric id or Zoom join URL. */
export async function getZoomMeeting(meetingIdOrUrl: string): Promise<ZoomMeetingDetails> {
  const { data, error } = await supabase.functions.invoke<ZoomMeetingDetails>(FUNCTION, {
    body: { action: "get", meeting_id: meetingIdOrUrl },
  });
  if (error) throw new Error(await readInvokeError(error));
  if (!data) throw new Error("Meeting not found.");
  return data;
}

export interface DeleteZoomMeetingResult {
  deleted: boolean;
  id?: string;
  reason?: "no_zoom_meeting" | "not_found";
}

/**
 * Cancel a Zoom meeting by numeric id or join URL. Idempotent server-side: a
 * meeting Zoom no longer knows about resolves as `{ deleted: false }` rather
 * than throwing, so callers can still remove the local session row.
 */
export async function deleteZoomMeeting(meetingIdOrUrl: string): Promise<DeleteZoomMeetingResult> {
  const { data, error } = await supabase.functions.invoke<DeleteZoomMeetingResult>(FUNCTION, {
    body: { action: "delete", meeting_id: meetingIdOrUrl },
  });
  if (error) throw new Error(await readInvokeError(error));
  return data ?? { deleted: false };
}

/**
 * Edge-function errors arrive as a FunctionsHttpError whose real message sits in
 * the JSON response body (`{ error }`). Surface that instead of the opaque
 * "non-2xx status code" wrapper.
 */
async function readInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    } catch {
      /* fall through to the generic message */
    }
  }
  return error instanceof Error ? error.message : "Zoom request failed.";
}
