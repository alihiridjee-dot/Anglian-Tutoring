import { useMemo } from "react";
import { useNow } from "@/hooks/useNow";
import {
  DAY_MS,
  MINUTE_MS as MINUTE,
  joinClick,
  nextSession,
  sessionStartMs,
  sessionTiming,
  type LiveSession,
} from "@/lib/live/liveSessions";
import { shortDayLabel } from "@/lib/planner/week";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { SUBJECT_TINT } from "@/lib/curriculum/subjectTheme";
import { Ring, SciText } from "@/components/Shared";
import { useMyLiveSessions } from "@/components/live/useMyLiveSessions";
import { cn } from "@/lib/utils";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type Unit = { value: string; word: string; pct: number };

/**
 * Live countdown to a student's next scheduled session. Shared by the student
 * dashboard (under the welcome banner) and the Live Sessions page. Picks the
 * soonest session that hasn't finished yet — including one that's happening
 * right now — and surfaces a Join button once we're within the join window.
 *
 * Playful minimalism: one card in the subject's tint (green while the lesson
 * is on), the title and one dark line saying when, each figure of the
 * countdown inside a ring with its word under it, then the lesson's own words
 * and the points it covers as bare rows. No pills and no small grey labels.
 *
 * Renders nothing when there's no upcoming session, so it can be dropped in
 * unconditionally.
 */
export function NextSessionCountdown({
  className = "",
  subject,
}: {
  className?: string;
  /** Only this subject's sessions — the header slider's, where the page follows it. */
  subject?: string | null;
}) {
  const { data } = useMyLiveSessions(subject);
  // Seconds are on screen here, so this one does tick every second.
  const now = useNow();

  const next = useMemo(() => nextSession(data ?? [], now), [data, now]);
  const start = next ? sessionStartMs(next) : null;
  if (!next || start === null) return null;

  // Join button only appears 10 min before or while live, avoiding empty waiting rooms.
  // The showcase's lessons are days away, and the tour promises a join button,
  // so there it shows from the start — and only says what it would open.
  const timing = sessionTiming(start, now);
  const { untilStart: diff, isLive } = timing;
  const joinable = timing.joinable || isDemoStudent();

  const days = Math.max(0, Math.floor(diff / DAY_MS));
  const hours = Math.max(0, Math.floor((diff % DAY_MS) / (60 * MINUTE)));
  const mins = Math.max(0, Math.floor((diff % (60 * MINUTE)) / MINUTE));
  const secs = Math.max(0, Math.floor((diff % MINUTE) / 1000));

  // Each figure sits in its own ring, filled as far as the clock has it: the
  // days out of a week, the hours out of a day, the minutes out of an hour.
  const units: Unit[] = isLive
    ? []
    : [
        ...(days > 0
          ? [{ value: String(days), word: days === 1 ? "day" : "days", pct: (days / 7) * 100 }]
          : []),
        {
          value: days > 0 ? String(hours) : pad(hours),
          word: hours === 1 ? "hour" : "hours",
          pct: (hours / 24) * 100,
        },
        { value: pad(mins), word: "mins", pct: (mins / 60) * 100 },
        ...(days === 0 ? [{ value: pad(secs), word: "secs", pct: (secs / 60) * 100 }] : []),
      ];

  const d = new Date(start);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const when = isLive ? `On now, from ${time}` : `${shortDayLabel(d)} at ${time}`;
  const tint = isLive ? "tint-emerald" : (SUBJECT_TINT[next.subject] ?? "tint-primary");
  return (
    <div className={cn(tint, "premium-card live-card p-5 sm:p-7", className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span aria-hidden className={cn("live-dot", isLive && "live-dot-on")}>
            {isLive ? "🔴" : "🎥"}
          </span>
          <div className="min-w-0">
            <h2 className="text-2xl leading-tight font-extrabold">{next.title}</h2>
            <p className="mt-1 text-base font-semibold">{when}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          {units.length > 0 && (
            <div className="flex gap-3">
              {units.map((u) => (
                <RingUnit key={u.word} unit={u} />
              ))}
            </div>
          )}
          {joinable && <JoinButton session={next} isLive={isLive} />}
        </div>
      </div>
      <Covered session={next} />
    </div>
  );
}

/** The one solid button into the lesson; its hand hops when pointed at. */
function JoinButton({ session, isLive }: { session: LiveSession; isLive: boolean }) {
  if (!session.join_url) {
    return <span className="text-base font-semibold">The join link is on its way</span>;
  }
  return (
    <a
      href={session.join_url}
      target="_blank"
      rel="noreferrer"
      onClick={joinClick(session.id)}
      className="btn-solid live-go inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-base"
    >
      <span aria-hidden className="live-emoji">
        👋
      </span>
      {isLive ? "Join now" : "Join"}
    </a>
  );
}

/** The lesson's own words, then the points it covers as bare rows. */
function Covered({ session }: { session: LiveSession }) {
  return (
    <>
      {session.description && (
        <p className="mt-4 text-base leading-relaxed">
          <SciText text={session.description} />
        </p>
      )}
      {session.specPoints.length > 0 && (
        <ul className="mt-4 space-y-2">
          {session.specPoints.map((p) => (
            <li key={p.id} className="flex items-baseline gap-3">
              <span aria-hidden className="live-bullet" />
              <span className="font-display min-w-0 text-lg leading-snug font-bold">{p.title}</span>
              <span className="live-code">{p.code}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RingUnit({ unit }: { unit: Unit }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Ring value={unit.pct} size={64} stroke={7}>
        <span className="numeral text-xl">{unit.value}</span>
      </Ring>
      <span className="live-word">{unit.word}</span>
    </div>
  );
}
