import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Video, CalendarClock, Radio, BookOpen } from "lucide-react";
import { fetchLiveSessions, type LiveSession } from "@/lib/liveSessions";

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
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">{label}</span>
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
    return (data ?? [])
      .filter((s) => s.starts_at && new Date(s.starts_at).getTime() + LIVE_TAIL_MS > now)
      .sort(
        (a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime(),
      )[0] ?? null;
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
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
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
          <div className="min-w-0">
            <p
              className={`text-[10px] font-bold uppercase tracking-widest ${
                isLive ? "text-emerald-600" : "text-[#2D8CFF]"
              }`}
            >
              {isLive ? "● Live now" : withinDay ? "Starting soon" : "Next live session"}
            </p>
            <p className="font-display font-semibold truncate mt-0.5">{next.title}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {next.subject} · {next.level}
              {!isLive && ` · ${new Date(start).toLocaleString()}`}
            </p>
            {next.specPoints.length > 0 && (
              <div className="flex items-center flex-wrap gap-1.5 mt-2">
                <BookOpen className="w-3 h-3 text-muted-foreground shrink-0" />
                {next.specPoints.slice(0, 4).map((p) => (
                  <span
                    key={p.id}
                    title={p.title}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground"
                  >
                    {p.code}
                  </span>
                ))}
                {next.specPoints.length > 4 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{next.specPoints.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
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
