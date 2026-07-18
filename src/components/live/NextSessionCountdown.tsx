import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, CalendarClock, Radio } from "lucide-react";
import { fetchLiveSessions, type LiveSession } from "@/lib/liveSessions";
import { SessionIdentity, WhatsCovered } from "@/components/live/SessionMeta";

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
// A session counts as "live" from 10 min before its start until 90 min after,
// so students can jump in slightly early and it stays joinable for the lesson.
const JOIN_LEAD_MS = 10 * MINUTE;
const LIVE_TAIL_MS = 90 * MINUTE;

// One ticking clock for the whole widget so the countdown updates every second.
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

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
  const now = useNow();

  const next = useMemo<LiveSession | null>(() => {
    return (
      (data ?? [])
        .filter((s) => s.starts_at && new Date(s.starts_at).getTime() + LIVE_TAIL_MS > now)
        .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())[0] ??
      null
    );
  }, [data, now]);

  if (!next) return null;

  const start = new Date(next.starts_at!).getTime();
  const diff = start - now;
  const isLive = diff <= 0 && now < start + LIVE_TAIL_MS;
  const withinDay = diff > 0 && diff <= DAY_MS;
  // Join button only appears 10 min before or while live, avoiding empty waiting rooms.
  const joinable = isLive || diff <= JOIN_LEAD_MS;

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
