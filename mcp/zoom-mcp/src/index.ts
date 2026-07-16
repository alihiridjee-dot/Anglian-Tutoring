#!/usr/bin/env node
/**
 * Anglian Tutoring — Zoom MCP server.
 *
 * Exposes two tools to MCP clients (Claude Desktop, Claude Code, etc.) so an
 * agent can create and inspect Zoom live sessions:
 *   - create_zoom_meeting
 *   - get_meeting_details
 *
 * It deliberately holds NO Zoom credentials. Every call is proxied to the
 * `zoom-meeting` Supabase Edge Function, which is the single source of truth for
 * Zoom Server-to-Server OAuth. The server authenticates to the edge function
 * with the Supabase service-role key, which the edge function trusts as a
 * backend caller. Keep that key secret — this server is meant to run locally or
 * in a trusted backend, never in a browser.
 *
 * Required environment:
 *   SUPABASE_URL                e.g. https://peohauhwquuvghrpmotf.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   Project Settings → API → service_role
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const FUNCTION_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/zoom-meeting`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`[zoom-mcp] Missing required env var ${name}\n`);
    process.exit(1);
  }
  return v;
}

async function callEdge(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Service-role key doubles as both apikey and bearer for the platform,
      // and the edge function trusts it as a backend caller.
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(json?.error ?? `Edge function error (${res.status})`);
  }
  return json;
}

const server = new McpServer({
  name: "anglian-zoom-mcp",
  version: "0.1.0",
});

server.registerTool(
  "create_zoom_meeting",
  {
    title: "Create Zoom meeting",
    description:
      "Schedule a Zoom live session and return its join URL and meeting id. Use for tutoring sessions.",
    inputSchema: {
      topic: z.string().describe("Meeting title, e.g. 'Biology: Exam Technique'."),
      start_time: z
        .string()
        .describe("Start time in ISO 8601, preferably UTC, e.g. 2026-08-01T14:00:00Z."),
      duration_minutes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Length in minutes. Defaults to 60."),
      timezone: z.string().optional().describe("IANA timezone. Defaults to Europe/London."),
      agenda: z.string().optional().describe("Optional agenda / description."),
    },
  },
  async (args) => {
    const result = await callEdge({
      action: "create",
      topic: args.topic,
      start_time: args.start_time,
      duration: args.duration_minutes,
      timezone: args.timezone,
      agenda: args.agenda,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.registerTool(
  "get_meeting_details",
  {
    title: "Get Zoom meeting details",
    description:
      "Fetch status and details for an existing Zoom meeting by numeric id or join URL. Status is one of waiting/started/finished.",
    inputSchema: {
      meeting_id: z
        .string()
        .describe("Numeric Zoom meeting id, or a full Zoom join URL like https://zoom.us/j/123..."),
    },
  },
  async (args) => {
    const result = await callEdge({ action: "get", meeting_id: args.meeting_id });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[zoom-mcp] ready on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[zoom-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
