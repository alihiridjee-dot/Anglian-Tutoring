import { useEffect, useMemo, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { ScheduleDAL, type MemoryStats } from "@/lib/scheduleDal";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

/**
 * The memory dashboard: how well the course is actually held right now,
 * straight from the FSRS cards the weekly plan is built from. One segmented
 * bar of scheduling buckets (due now / due this week / holding / not started),
 * the mean retrievability as the headline, and the three points closest to
 * being forgotten. Every segment is labeled with its count — color is never
 * the only channel.
 */
export function MemoryPanel({
  studentId,
  enrolments,
  level,
  refreshToken = 0,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  refreshToken?: number;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const [activeSubject, setActiveSubject] = useState(ordered[0]?.subject ?? "biology");
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];

  useEffect(() => {
    setActiveSubject(ordered[0]?.subject ?? "biology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    ScheduleDAL.getMemoryStats({
      studentId,
      subject: active.subject as SubjectV,
      board: active.board as BoardV,
      level,
    })
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId, active, level, refreshToken]);

  if (!active) return null;

  const practised = stats ? stats.total - stats.newCount : 0;
  const segments = stats
    ? ([
        { key: "dueNow", label: "Due now", count: stats.dueNow, cls: "bg-rose-500" },
        { key: "dueWeek", label: "Due this week", count: stats.dueThisWeek, cls: "bg-amber-400" },
        { key: "stable", label: "Holding", count: stats.stable, cls: "bg-emerald-500" },
        { key: "new", label: "Not started", count: stats.newCount, cls: "bg-slate-300" },
      ] as const)
    : [];

  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 shadow-sm mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center shrink-0">
            <Brain className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">How it's held</h2>
            <p className="text-xs text-muted-foreground">
              What your revision has made stick — and what's about to slip.
            </p>
          </div>
        </div>
        {ordered.length > 1 && (
          <div className="flex gap-1.5" role="tablist" aria-label="Subject">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                role="tab"
                aria-selected={e.subject === activeSubject}
                onClick={() => setActiveSubject(e.subject)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  e.subject === activeSubject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {subjectLabel[e.subject] ?? e.subject}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
        </div>
      ) : !stats || stats.total === 0 ? (
        <p className="text-sm text-muted-foreground">No curriculum loaded for this subject yet.</p>
      ) : practised === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing practised yet — rate your confidence or finish some homework and this fills in.
        </p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex-1 min-w-0">
            {/* Scheduling buckets: one thin segmented bar, 2px gaps, counts in the legend. */}
            <div className="flex h-3 rounded-full overflow-hidden gap-0.5" aria-hidden="true">
              {segments
                .filter((s) => s.count > 0)
                .map((s) => (
                  <div
                    key={s.key}
                    className={`${s.cls} first:rounded-l-full last:rounded-r-full`}
                    style={{ width: `${(s.count / stats.total) * 100}%` }}
                  />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {segments.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
                  <span className={`w-2.5 h-2.5 rounded-full ${s.cls}`} aria-hidden="true" />
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                </span>
              ))}
            </div>
            {stats.weakest.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Closest to slipping
                </p>
                <ul className="space-y-1">
                  {stats.weakest.map((w) => (
                    <li key={w.code} className="flex items-baseline gap-2 text-xs min-w-0">
                      <span className="font-mono text-muted-foreground shrink-0">{w.code}</span>
                      <span className="truncate">{w.title}</span>
                      <span className="ml-auto shrink-0 font-semibold tabular-nums">
                        {Math.round(w.retention * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="lg:w-44 shrink-0 rounded-xl bg-muted/50 border border-border px-4 py-3 flex lg:flex-col items-center lg:justify-center gap-3 lg:gap-1">
            <p className="font-display text-3xl font-bold tabular-nums leading-none">
              {stats.avgRetention === null ? "—" : `${Math.round(stats.avgRetention * 100)}%`}
            </p>
            <p className="text-xs text-muted-foreground lg:text-center">
              average recall across the {practised} point{practised === 1 ? "" : "s"} you've
              practised
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
