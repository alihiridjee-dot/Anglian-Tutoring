import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, CalendarClock, Radio } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import {
  DAY_MS,
  MINUTE_MS as MINUTE,
  fetchLiveSessions,
  nextSession,
  sessionStartMs,
  sessionTiming,
} from "@/lib/live/liveSessions";
import { SessionIdentity, WhatsCovered } from "@/components/live/SessionMeta";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function Segment({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-mono text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">
        {label}
      </span>
    </div>
  );
}

/**
 * Live countdown to a student's next scheduled session. Shared by the student
 * dashboard (under the welcome banner) and the Live Sessions page. Picks the
 * soonest session that hasn't finished yet — including one that's happening
 * right now — and surfaces a Join button once we're within the join window.
 *
 * Renders nothing when there's no upcoming session, so it can be dropped in
 * unconditionally.
 */
export function NextSessionCountdown({ className = "" }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ["live", "countdown"],
    queryFn: () => fetchLiveSessions(),
  });
  // Seconds are on screen here, so this one does tick every second.
  const now = useNow();

  const next = useMemo(() => nextSession(data ?? [], now), [data, now]);
  const start = next ? sessionStartMs(next) : null;
  if (!next || start === null) return null;

  // Join button only appears 10 min before or while live, avoiding empty waiting rooms.
  const { untilStart: diff, isLive, withinDay, joinable } = sessionTiming(start, now);

  const days = Math.max(0, Math.floor(diff / DAY_MS));
  const hours = Math.max(0, Math.floor((diff % DAY_MS) / (60 * MINUTE)));
  const mins = Math.max(0, Math.floor((diff % (60 * MINUTE)) / MINUTE));
  const secs = Math.max(0, Math.floor((diff % MINUTE) / 1000));

  return (
    <div
      className={`rounded-2xl border p-5 mb-6 ${
        isLive
          ? "border-emerald-500/50 bg-emerald-500/5"
          : withinDay
            ? "border-[#2D8CFF]/40 bg-[#2D8CFF]/5"
            : "border-border bg-card"
      } ${className}`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3 lg:w-72 shrink-0">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              isLive ? "bg-emerald-500/15 text-emerald-600" : "bg-[#2D8CFF]/10 text-[#2D8CFF]"
            }`}
          >
            {isLive ? (
              <Radio className="w-5 h-5 animate-pulse" />
            ) : (
              <CalendarClock className="w-5 h-5" />
            )}
          </div>
          <SessionIdentity
            session={next}
            eyebrow={isLive ? "● Live now" : withinDay ? "Starting soon" : "Next live session"}
            tone={isLive ? "emerald" : "blue"}
            showWhen={!isLive}
          />
        </div>

        {/* Spec points fill the middle, matching the session rows below. */}
        <div className="flex-1 min-w-0">
          <WhatsCovered points={next.specPoints} />
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {!isLive && (
            <div className="flex items-center gap-3">
              {days > 0 && <Segment value={String(days)} label={days === 1 ? "day" : "days"} />}
              <Segment value={pad(hours)} label="hrs" />
              <Segment value={pad(mins)} label="min" />
              {days === 0 && <Segment value={pad(secs)} label="sec" />}
            </div>
          )}

          {joinable && next.join_url ? (
            <a
              href={next.join_url}
              target="_blank"
              rel="noreferrer"
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2 text-white transition-colors ${
                isLive ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#2D8CFF] hover:bg-[#2681F2]"
              }`}
            >
              <Video className="w-4 h-4" />
              {isLive ? "Join now" : "Join"}
            </a>
          ) : joinable && !next.join_url ? (
            <span className="text-xs text-muted-foreground italic">Join link pending</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
