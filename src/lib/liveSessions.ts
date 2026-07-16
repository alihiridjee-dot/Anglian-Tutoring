import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_LIVE } from "@/lib/demo/studentDemo";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

/**
 * Shared live-session reads. Both the Live Sessions page and the student
 * countdown widget go through here so they agree on shape — crucially, each
 * session carries the curriculum spec points it covers (many-to-many via
 * `resource_spec_points`), which drives the "What's covered" UI.
 *
 * Row visibility is still decided by RLS on `resources`; this just shapes what
 * comes back. The showcase has no session, so demo reads short-circuit to
 * fixtures (which carry no spec-point links).
 */

export interface LiveSessionSpecPoint {
  id: string;
  code: string;
  title: string;
}

export interface LiveSession {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  join_url: string | null;
  subject: string;
  level: string;
  board: string | null;
  specPoints: LiveSessionSpecPoint[];
}

export interface LiveFilters {
  subject?: SubjectV;
  board?: BoardV;
  level?: LevelV;
}

// PostgREST embeds `resource_spec_points(spec_points(...))` come back nested;
// flatten to a plain spec-point array, dropping any the join couldn't resolve.
type RawRow = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  join_url: string | null;
  subject: string;
  level: string;
  board: string | null;
  resource_spec_points: Array<{ spec_points: LiveSessionSpecPoint | null }> | null;
};

function mapRow(r: RawRow): LiveSession {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    starts_at: r.starts_at,
    join_url: r.join_url,
    subject: r.subject,
    level: r.level,
    board: r.board,
    specPoints: (r.resource_spec_points ?? [])
      .map((l) => l.spec_points)
      .filter((p): p is LiveSessionSpecPoint => !!p),
  };
}

export async function fetchLiveSessions(filters: LiveFilters = {}): Promise<LiveSession[]> {
  if (isDemoStudent()) {
    return DEMO_LIVE.filter(
      (s) =>
        (!filters.subject || s.subject === filters.subject) &&
        (!filters.board || s.board === filters.board) &&
        (!filters.level || s.level === filters.level),
    ).map((s) => ({ ...s, specPoints: [] }));
  }

  let q = supabase
    .from("resources")
    .select(
      "id, kind, title, description, starts_at, join_url, subject, level, board, resource_spec_points(spec_points(id, code, title))",
    )
    .eq("kind", "live_session")
    .order("starts_at", { ascending: true });
  if (filters.subject) q = q.eq("subject", filters.subject);
  if (filters.board) q = q.eq("board", filters.board);
  if (filters.level) q = q.eq("level", filters.level);

  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as unknown as RawRow[]).map(mapRow);
}
