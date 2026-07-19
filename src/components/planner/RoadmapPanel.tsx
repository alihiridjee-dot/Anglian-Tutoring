import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Map as MapIcon,
  CheckCircle2,
  CircleDot,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CalendarDays,
  ClipboardList,
  ListChecks,
  Repeat,
  Sparkles,
  Target,
} from "lucide-react";
import { isTeachBand, FOCUS_RED_BELOW, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { type ProgressPoint, type TopicProgress } from "@/lib/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { bandOf } from "@/lib/planner/bands";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, sundayOf, addWeeks, toDateKey } from "@/lib/week";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function fmtRange(startKey: string, endKey: string): string {
  const start = weekKeyToDate(startKey);
  const end = sundayOf(weekKeyToDate(endKey));
  const y = end.getFullYear() !== new Date().getFullYear() ? ` ${end.getFullYear()}` : "";
  return `${fmtDate(start)} – ${fmtDate(end)}${y}`;
}

/**
 * The year-long programme: every topic laid out from now to the exams, sized by
 * how big it is, so the student can see the whole road ahead. It re-flows as they
 * progress, and when a slip shifts future topics it asks them to acknowledge the
 * new plan rather than moving the goalposts silently. (Reused on the tutor's
 * planner to review a student's road.)
 */
export function RoadmapPanel({
  studentId,
  enrolments,
  level,
  refreshToken,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** Bump to force a reload (e.g. after the confidence board changes). */
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

  // Reset to the first subject when the student changes (tutor view reuses this
  // component across students, so the previous pick must not carry over).
  useEffect(() => {
    setActiveSubject(ordered[0]?.subject ?? "biology");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const [data, setData] = useState<RoadmapResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acking, setAcking] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (topicId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  const progressByTopic = useMemo(
    () => new Map<string, TopicProgress>((data?.progress ?? []).map((t) => [t.topicId, t])),
    [data],
  );
  const masteryByTopic = useMemo(
    () => new Map<string, number>((data?.progress ?? []).map((t) => [t.topicId, t.masteryPct])),
    [data],
  );

  const load = async () => {
    if (!active) return;
    setLoading(true);
    setExpanded(new Set());
    const res = await ProgramDAL.loadRoadmap({
      studentId,
      subject: active.subject as SubjectV,
      board: active.board as BoardV,
      level,
    });
    setData(res);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, active?.subject, active?.board, level, refreshToken]);

  const acknowledge = async () => {
    if (!data || !active) return;
    setAcking(true);
    try {
      await ProgramDAL.acknowledge({
        studentId,
        subject: active.subject as SubjectV,
        bands: data.bands,
        programStart: data.programStart,
        examDate: data.examDate,
      });
      toast.success("Plan updated — you're all set.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update — try again.");
    } finally {
      setAcking(false);
    }
  };

  if (!active) return null;

  const covered = new Set(data?.coveredTopicIds ?? []);
  const spine = data?.bands.filter(isTeachBand) ?? [];
  const total = spine.length;
  const doneCount = spine.filter((b) => covered.has(b.topicId)).length;

  return (
    <div className="rounded-2xl bg-card border border-border p-4 sm:p-5 shadow-sm mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <MapIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">
              Your programme to the exams
            </h2>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${doneCount} of ${total} topics covered · exams from ${fmtDate(
                    weekKeyToDate(data.examDate),
                  )} ${weekKeyToDate(data.examDate).getFullYear()}`
                : "How we'll cover the whole course before your exams."}
            </p>
          </div>
        </div>
        {ordered.length > 1 && (
          <div className="flex items-center gap-1.5">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                onClick={() => setActiveSubject(e.subject)}
                className={`h-8 px-3 rounded-lg text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
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
      ) : !data ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No curriculum found for this course yet.
        </p>
      ) : (
        <>
          {/* Acknowledge banner — the plan shifted, accept the new road */}
          {data.needsAck && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    Your plan has shifted
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Based on how things are going, {data.changes.length}{" "}
                    {data.changes.length === 1 ? "topic has" : "topics have"} moved. Here's the new
                    plan:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {data.changes.slice(0, 6).map((c) => (
                      <li key={c.topicId} className="text-xs flex items-center gap-1.5">
                        <span className="font-medium">{c.title}</span>
                        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">
                          wk of {fmtDate(weekKeyToDate(c.to))}
                        </span>
                      </li>
                    ))}
                    {data.changes.length > 6 && (
                      <li className="text-xs text-muted-foreground">
                        +{data.changes.length - 6} more
                      </li>
                    )}
                  </ul>
                  <button
                    type="button"
                    onClick={acknowledge}
                    disabled={acking}
                    className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Got it, update my plan
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* How the plan works — plain-language reassurance for the student. */}
          <div className="mb-4 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
            <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">This plan is built around you.</span>{" "}
              Week by week, <span className="font-medium text-foreground">core topics</span> are what
              the class is working through, and{" "}
              <span className="font-medium text-foreground">focused topics</span> are the ones we keep
              bringing back until they stick.
            </p>
          </div>

          <WeekTable
            spine={spine}
            focusBands={data.bands.filter((b) => !isTeachBand(b))}
            examDate={data.examDate}
            covered={covered}
            progressByTopic={progressByTopic}
            masteryByTopic={masteryByTopic}
            expanded={expanded}
            onToggle={toggle}
          />

          <p className="mt-4 text-[11px] text-muted-foreground">
            Mastery blends how you've rated each topic with your homework and quiz results. Expand a
            core topic to see which spec points are sticking and which need another look.
          </p>
        </>
      )}
    </div>
  );
}

/** Colour + label a focused-topic chip by why it's back this week. */
function focusTone(b: PacingBand, mastery: number) {
  if (b.kind !== "revisit") {
    return {
      label: "Quick refresh",
      icon: Sparkles,
      badge: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (mastery < FOCUS_RED_BELOW) {
    return {
      label: "Needs work",
      icon: Repeat,
      badge: "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300",
    };
  }
  return {
    label: "Revisit",
    icon: Repeat,
    badge: "bg-amber-500/[0.08] border-amber-500/25 text-amber-700/90 dark:text-amber-300/80",
  };
}

/** Every Monday date-key from `startKey` to `endKey` inclusive. */
function weekKeysBetween(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let d = weekKeyToDate(startKey);
  const end = weekKeyToDate(endKey);
  while (d <= end) {
    out.push(toDateKey(d));
    d = addWeeks(d, 1);
  }
  return out;
}

/**
 * The programme as a week-by-week table. The date leads each row; alongside it
 * sit that week's core topic (the class's chronological spine) and any focused
 * topics (the FSRS-driven revisits that resurface until they stick). It runs the
 * whole year from this week to the exams, and scrolls. Core topics stay
 * expandable to their spec-point breakdown.
 */
function WeekTable({
  spine,
  focusBands,
  examDate,
  covered,
  progressByTopic,
  masteryByTopic,
  expanded,
  onToggle,
}: {
  spine: PacingBand[];
  focusBands: PacingBand[];
  examDate: string;
  covered: Set<string>;
  progressByTopic: Map<string, TopicProgress>;
  masteryByTopic: Map<string, number>;
  expanded: Set<string>;
  onToggle: (topicId: string) => void;
}) {
  const nowKey = currentWeekKey();
  // Run from this week through to the exams.
  const weeks = weekKeysBetween(nowKey, examDate);

  const inBand = (b: PacingBand, wk: string) => b.startWeek <= wk && wk <= b.endWeek;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[7.5rem_1fr_1fr] bg-muted/50 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <div className="flex items-center gap-1.5 px-3 py-2">
          <CalendarDays className="w-3.5 h-3.5" /> Week
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
          <CircleDot className="w-3.5 h-3.5 text-primary" /> Core topics
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
          <Repeat className="w-3.5 h-3.5 text-rose-500" /> Focused topics
        </div>
      </div>

      <div className="max-h-[32rem] overflow-y-auto divide-y divide-border">
        {weeks.map((wk) => {
          const isNow = wk === nowKey;
          const core = spine.find((b) => inBand(b, wk));
          const focused = focusBands.filter((b) => inBand(b, wk));
          const tp = core ? progressByTopic.get(core.topicId) : undefined;
          const isOpen = core ? expanded.has(core.topicId) : false;
          const hasDetail = (tp?.points.length ?? 0) > 0;
          const isCovered = core ? covered.has(core.topicId) : false;
          return (
            <div key={wk}>
              <div
                className={`grid grid-cols-[7.5rem_1fr_1fr] items-stretch ${
                  isNow ? "bg-primary/[0.04]" : ""
                }`}
              >
                {/* Week */}
                <div className="px-3 py-2.5 flex flex-col justify-center">
                  {isNow && (
                    <span className="inline-flex w-fit items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-primary mb-0.5">
                      <CircleDot className="w-3 h-3" /> This week
                    </span>
                  )}
                  <span className="text-[13px] font-medium tabular-nums">
                    {fmtDate(weekKeyToDate(wk))}
                  </span>
                </div>

                {/* Core */}
                <div className="px-3 py-2.5 border-l border-border min-w-0">
                  {core ? (
                    <button
                      type="button"
                      onClick={() => hasDetail && onToggle(core.topicId)}
                      className={`w-full text-left rounded-md -mx-1 px-1 ${
                        hasDetail ? "hover:bg-muted/50" : "cursor-default"
                      }`}
                      aria-expanded={isOpen}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-medium leading-snug">{core.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {isCovered && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          )}
                          {hasDetail && (
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                                isOpen ? "rotate-180" : ""
                              }`}
                            />
                          )}
                        </div>
                      </div>
                      {tp && tp.points.length > 0 && (
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.max(2, tp.masteryPct)}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                            {tp.masteryPct}%
                          </span>
                        </div>
                      )}
                    </button>
                  ) : (
                    <span className="text-[12px] text-muted-foreground/60">—</span>
                  )}
                </div>

                {/* Focused */}
                <div className="px-3 py-2.5 border-l border-border min-w-0 space-y-1.5">
                  {focused.length > 0 ? (
                    focused.map((b) => {
                      const tone = focusTone(b, masteryByTopic.get(b.topicId) ?? 0);
                      const Icon = tone.icon;
                      return (
                        <div
                          key={`${b.topicId}-${b.kind}-${b.startWeek}`}
                          className="flex items-center gap-1.5 min-w-0"
                        >
                          <span
                            className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-semibold shrink-0 ${tone.badge}`}
                          >
                            <Icon className="w-2.5 h-2.5" />
                            {tone.label}
                          </span>
                          <span className="text-[12px] truncate">{b.title}</span>
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[12px] text-muted-foreground/60">—</span>
                  )}
                </div>
              </div>

              {/* Expanded spec-point breakdown for the core topic */}
              {isOpen && tp && (
                <ul className="bg-muted/20 px-4 py-2.5 space-y-1 border-t border-border">
                  {tp.points.map((p) => (
                    <PointRow key={p.id} point={p} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const statusMeta: Record<PointStatus, { label: string; cls: string }> = {
  new: { label: "Not started", cls: "bg-muted text-muted-foreground border-border" },
  due: {
    label: "Due again",
    cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  learning: {
    label: "Learning",
    cls: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  strong: {
    label: "Strong",
    cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
};

/** One spec point inside an expanded topic: its confidence, marks and standing. */
function PointRow({ point }: { point: ProgressPoint }) {
  const s = statusMeta[point.status];
  const band = point.confidence != null ? bandOf(point.confidence) : null;
  return (
    <li className="flex items-center gap-2 py-1">
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{point.code}</span>
        <span className="text-[13px]">{point.title}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {band && (
          <span
            className="inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-border text-[10px] font-medium text-muted-foreground"
            title={`You rated this ${band.label.toLowerCase()}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${band.dot}`} />
            {point.confidence}
          </span>
        )}
        {point.homeworkScore != null && <MarkChip kind="homework" score={point.homeworkScore} />}
        {point.quizScore != null && <MarkChip kind="quiz" score={point.quizScore} />}
        <span
          className={`inline-flex items-center h-5 px-1.5 rounded-md border text-[10px] font-semibold ${s.cls}`}
        >
          {s.label}
        </span>
      </div>
    </li>
  );
}

function MarkChip({ kind, score }: { kind: "homework" | "quiz"; score: number }) {
  const strong = score >= 70;
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-medium ${
        strong
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"
      }`}
      title={`${kind === "homework" ? "Homework" : "Quiz"}: best ${score}%`}
    >
      {kind === "homework" ? (
        <ClipboardList className="w-2.5 h-2.5" />
      ) : (
        <ListChecks className="w-2.5 h-2.5" />
      )}
      <span className="tabular-nums font-semibold">{score}%</span>
    </span>
  );
}
