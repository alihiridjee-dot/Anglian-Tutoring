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

// "Thu 17 Jul · 11:58 PM" — far more scannable than a raw locale timestamp.
// Lives here rather than in SessionMeta so the component file exports only
// components, which is what keeps fast refresh working across the live views.
export function formatWhen(ms: number) {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

/* ---------- When a session is "on" ----------
 *
 * One definition, used by the header button, the dashboard banner, the
 * countdown and the Live Sessions list. Each of the first three kept its own
 * copy of these numbers, and the list had a different rule altogether: it filed
 * a session under Previous → "Completed" the second it started, so a student
 * two minutes late — or a tutor, who gets no countdown — found the lesson they
 * were trying to join listed as finished, without a Join button.
 */

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;
/** Joinable from this long before the start — early enough to settle in. */
export const JOIN_LEAD_MS = 10 * MINUTE_MS;
/** …and treated as running for this long after it, which covers a lesson. */
export const LIVE_TAIL_MS = 90 * MINUTE_MS;

/** The session's start as epoch ms, or null if it has no (valid) start time. */
export function sessionStartMs(session: Pick<LiveSession, "starts_at">): number | null {
  if (!session.starts_at) return null;
  const ms = new Date(session.starts_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** True once a session's running window has closed. Undated sessions never have. */
export function hasSessionFinished(session: Pick<LiveSession, "starts_at">, now: number): boolean {
  const start = sessionStartMs(session);
  return start !== null && start + LIVE_TAIL_MS <= now;
}

export interface SessionTiming {
  /** Ms until the start; zero or negative once it has begun. */
  untilStart: number;
  /** Started, and still inside its running window. */
  isLive: boolean;
  /** Not started yet, but starts within 24 hours. */
  withinDay: boolean;
  /** Live, or close enough to the start that the room is worth opening. */
  joinable: boolean;
}

/** Where `now` sits relative to a dated session. */
export function sessionTiming(startMs: number, now: number): SessionTiming {
  const untilStart = startMs - now;
  const isLive = untilStart <= 0 && now < startMs + LIVE_TAIL_MS;
  return {
    untilStart,
    isLive,
    withinDay: untilStart > 0 && untilStart <= DAY_MS,
    joinable: isLive || (untilStart > 0 && untilStart <= JOIN_LEAD_MS),
  };
}

/** The soonest dated session that hasn't finished — including one running now. */
export function nextSession<T extends Pick<LiveSession, "starts_at">>(
  sessions: readonly T[],
  now: number,
): T | null {
  let best: T | null = null;
  let bestStart = Infinity;
  for (const s of sessions) {
    const start = sessionStartMs(s);
    if (start === null || start + LIVE_TAIL_MS <= now) continue;
    if (start < bestStart) {
      best = s;
      bestStart = start;
    }
  }
  return best;
}
