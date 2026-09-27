import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Video, Radio } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import {
  DAY_MS,
  MINUTE_MS as MINUTE,
  fetchLiveSessions,
  nextSession,
  sessionStartMs,
  sessionTiming,
} from "@/lib/live/liveSessions";

function formatShort(diff: number) {
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / (60 * MINUTE));
  const mins = Math.floor((diff % (60 * MINUTE)) / MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(1, mins)}m`;
}

/**
 * Compact live-session affordance for the app header ribbon. Shows a pulsing
 * "Join" button once a session is joinable (live, or within 10 min of start),
 * and a subtle countdown chip for a session coming up later today. Renders
 * nothing otherwise, so the ribbon stays clean when there's no session soon.
 *
 * Shares the ["live","countdown"] query with the This Week card, so both agree
 * and there's no extra fetch.
 */
export function HeaderLiveButton({ liveHref }: { liveHref: "/live" | "/demo/student/live" }) {
  const { data } = useQuery({
    queryKey: ["live", "countdown"],
    queryFn: () => fetchLiveSessions(),
  });
  // This chip shows minutes, on every page of the app — it has no use for a
  // one-second tick.
  const now = useNow(15_000);

  const next = useMemo(() => nextSession(data ?? [], now), [data, now]);
  const start = next ? sessionStartMs(next) : null;
  if (!next || start === null) return null;

  const { untilStart: diff, isLive, withinDay, joinable } = sessionTiming(start, now);

  // Keep the ribbon uncluttered: only surface a session that's live or coming up
  // within the day.
  if (!isLive && !withinDay) return null;

  const remaining = formatShort(diff);

  // Joinable → a direct one-click Join button. The room owns the join window, so
  // this is the "catch their attention and jump straight in" affordance.
  if (joinable && next.join_url) {
    return (
      <a
        href={next.join_url}
        target="_blank"
        rel="noreferrer"
        title={`${next.title}${isLive ? " — live now" : " — starting soon"}`}
        className={`tap-target inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-bold text-white shadow-sm transition ${
          isLive ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#2D8CFF] hover:bg-[#2681F2]"
        }`}
      >
        {isLive ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/70" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
        ) : (
          <Video className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">{isLive ? "Join live" : `Join · ${remaining}`}</span>
        <span className="sm:hidden">Join</span>
      </a>
    );
  }

  // Not yet joinable but coming up today → a gentle countdown chip into Live Sessions.
  return (
    <Link
      to={liveHref}
      title={next.title}
      className="tap-target inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border border-[#2D8CFF]/40 bg-[#2D8CFF]/10 text-[#2D8CFF] hover:bg-[#2D8CFF]/15 transition"
    >
      <Radio className="w-3.5 h-3.5 animate-pulse" />
      <span className="hidden sm:inline">Live in {remaining}</span>
      <span className="sm:hidden">{remaining}</span>
    </Link>
  );
}
