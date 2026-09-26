import { sessionStartMs, sessionTiming, type LiveSession } from "@/lib/live/liveSessions";
import { SessionIdentity, WhatsCovered } from "@/components/live/SessionMeta";
import { Video, CalendarClock, Smartphone, Loader2, Trash2 } from "lucide-react";

export type LiveTab = "upcoming" | "previous";

export function LiveTabs({
  tab,
  onSelect,
  upcomingCount,
  pastCount,
}: {
  tab: LiveTab;
  onSelect: (tab: LiveTab) => void;
  upcomingCount: number;
  pastCount: number;
}) {
  return (
    <div
      data-guide="live-tabs"
      className="flex items-center gap-1 p-1 rounded-xl bg-secondary/60 border border-border w-fit mb-5"
    >
      {(["upcoming", "previous"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          className={`min-h-11 sm:min-h-0 px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition ${
            tab === t
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t}
          <span className="ml-1.5 text-xs text-muted-foreground">
            {t === "upcoming" ? upcomingCount : pastCount}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A session that has not finished: when it is, what it covers, and how to join. */
export function UpcomingSessionCard({
  s,
  now,
  isTutor,
  deletingId,
  onRemind,
  onDelete,
}: {
  s: LiveSession;
  now: number;
  isTutor: boolean;
  deletingId: string | null;
  onRemind: (session: LiveSession) => void;
  onDelete: (session: LiveSession) => void;
}) {
  const isZoom = s.join_url?.toLowerCase().includes("zoom");
  const { isLive } = sessionTiming(sessionStartMs(s) ?? now, now);
  return (
    <div
      data-guide="live-session"
      className="rounded-xl premium-card p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4"
    >
      <div className="flex items-start gap-3 lg:w-72 shrink-0">
        <div className="w-11 h-11 rounded-xl bg-[#2D8CFF]/10 text-[#2D8CFF] flex items-center justify-center shrink-0">
          <CalendarClock className="w-5 h-5" />
        </div>
        <SessionIdentity
          session={s}
          eyebrow={isLive ? "● Live now" : "Upcoming"}
          tone={isLive ? "emerald" : "blue"}
        />
      </div>
      <div className="flex-1 min-w-0">
        <WhatsCovered points={s.specPoints} />
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {/* WhatsApp Reminder Button */}
        <button
          onClick={() => onRemind(s)}
          className="min-h-11 sm:min-h-0 border border-[#25D366]/40 hover:border-[#25D366] text-[#128C7E] hover:bg-[#25D366]/5 px-3.5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Smartphone className="w-4 h-4 text-[#25D366]" />
          Remind on WhatsApp
        </button>

        {/* Conditional join buttons (Zoom vs General) */}
        {s.join_url ? (
          isZoom ? (
            <a
              href={s.join_url}
              target="_blank"
              rel="noreferrer"
              className="min-h-11 sm:min-h-0 bg-[#2D8CFF] hover:bg-[#2681F2] text-white px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Video className="w-4 h-4" />
              Join Zoom Meeting
            </a>
          ) : (
            <a
              href={s.join_url}
              target="_blank"
              rel="noreferrer"
              className="btn-solid inline-flex min-h-11 sm:min-h-0 items-center gap-2 rounded-xl px-4 py-2 text-sm"
            >
              <Video className="size-4" aria-hidden />
              Join Session
            </a>
          )
        ) : null}

        {isTutor && (
          <button
            onClick={() => onDelete(s)}
            disabled={deletingId === s.id}
            className="min-h-11 sm:min-h-0 border border-destructive/40 hover:border-destructive text-destructive hover:bg-destructive/5 px-3 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            title="Delete session and cancel its Zoom meeting"
          >
            {deletingId === s.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** A finished session, kept for a week as a record of what it covered. */
export function PastSessionCard({
  s,
  isTutor,
  deletingId,
  onDelete,
}: {
  s: LiveSession;
  isTutor: boolean;
  deletingId: string | null;
  onDelete: (session: LiveSession) => void;
}) {
  return (
    <div
      data-guide="live-session"
      className="rounded-xl premium-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3"
    >
      <div className="flex items-start gap-3 lg:w-72 shrink-0">
        <div className="w-11 h-11 rounded-xl bg-secondary text-muted-foreground flex items-center justify-center shrink-0">
          <CalendarClock className="w-5 h-5" />
        </div>
        <SessionIdentity session={s} eyebrow="Completed" tone="muted" />
      </div>
      <div className="flex-1 min-w-0">
        <WhatsCovered points={s.specPoints} label="Covered" />
        {s.specPoints.length === 0 && !s.description && (
          <p className="text-xs text-muted-foreground italic mt-1">
            No curriculum points recorded.
          </p>
        )}
      </div>
      {isTutor && (
        <button
          onClick={() => onDelete(s)}
          disabled={deletingId === s.id}
          className="tap-target text-muted-foreground hover:text-destructive p-1.5 shrink-0 disabled:opacity-60"
          title="Delete session now"
          aria-label={`Delete ${s.title}`}
        >
          {deletingId === s.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
