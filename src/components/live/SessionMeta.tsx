import { BookOpen, CalendarClock } from "lucide-react";
import type { LiveSession } from "@/lib/liveSessions";

// "Thu 17 Jul · 11:58 PM" — far more scannable than a raw locale timestamp.
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

// The identity block for a session — status eyebrow, subject/level chips, title
// and start time. Shared by the countdown banner and the session rows so a
// session reads the same wherever it appears.
export function SessionIdentity({
  session,
  eyebrow,
  tone = "blue",
  showWhen = true,
  children,
}: {
  session: LiveSession;
  eyebrow: string;
  tone?: "blue" | "emerald" | "muted";
  showWhen?: boolean;
  children?: React.ReactNode;
}) {
  const eyebrowColor =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-[#2D8CFF]";
  const chipColor =
    tone === "emerald"
      ? "bg-emerald-500/15 text-emerald-700"
      : tone === "muted"
        ? "bg-secondary text-muted-foreground"
        : "bg-[#2D8CFF]/12 text-[#2D8CFF]";

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${eyebrowColor}`}>
          {eyebrow}
        </p>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full capitalize ${chipColor}`}
        >
          {session.subject}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full capitalize bg-secondary text-muted-foreground">
          {session.level}
        </span>
      </div>
      <p className="font-display font-semibold mt-1">{session.title}</p>
      {showWhen && session.starts_at && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground/80 mt-0.5">
          <CalendarClock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          {formatWhen(new Date(session.starts_at).getTime())}
        </p>
      )}
      {session.description && (
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-2">
          <span aria-hidden>✨</span> {session.description}
        </p>
      )}
      {children}
    </div>
  );
}

// "What's covered" — the curriculum spec points a session is linked to. Same
// data that surfaces the session on each curriculum point's page, shown back on
// the session itself so students know the syllabus scope at a glance.
export function WhatsCovered({
  points,
  label = "What's covered",
  className = "",
}: {
  points: LiveSession["specPoints"];
  label?: string;
  className?: string;
}) {
  if (points.length === 0) return null;
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {points.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-secondary border border-border"
          >
            <span className="font-mono font-medium text-primary">{p.code}</span>
            <span className="text-muted-foreground truncate max-w-[220px]">{p.title}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
