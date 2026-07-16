# Anglian Tutoring — Zoom MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an agent create and
inspect Zoom live sessions. It is a **thin proxy** over the `zoom-meeting`
Supabase Edge Function, which is the only place Zoom credentials live. This
server authenticates to that function with the Supabase **service-role** key.

> The tutor dashboard does **not** use this server — it calls the same edge
> function directly from the browser with the tutor's own session. This MCP
> surface exists only for agent-driven creation.

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `create_zoom_meeting` | `topic`, `start_time` (ISO 8601), `duration_minutes?`, `timezone?`, `agenda?` | `{ id, join_url, start_url, password, start_time, duration }` |
| `get_meeting_details` | `meeting_id` (numeric id or join URL) | `{ id, topic, join_url, start_time, duration, status, timezone }` |

## Setup

```bash
cd mcp/zoom-mcp
npm install
npm run build      # compiles src → dist
```

Set env (see `.env.example`):

- `SUPABASE_URL` — e.g. `https://peohauhwquuvghrpmotf.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → service_role (secret)

The `zoom-meeting` edge function must be deployed and its Zoom secrets set first
(see `../../ZOOM_SETUP.md`).

## Register with an MCP client

**Claude Desktop** (`claude_desktop_config.json`) or **Claude Code**
(`.mcp.json`):

```json
{
  "mcpServers": {
    "anglian-zoom": {
      "command": "node",
      "args": ["/absolute/path/to/Anglian-Tutoring/mcp/zoom-mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://peohauhwquuvghrpmotf.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "REPLACE_WITH_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

Then ask the agent e.g. *"Create a Zoom meeting titled 'Chemistry Revision' for
2026-08-01 14:00 UTC"* and it will call `create_zoom_meeting`.
