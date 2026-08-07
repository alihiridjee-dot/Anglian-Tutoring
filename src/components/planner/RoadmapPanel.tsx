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
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import {
  isTeachBand,
  FOCUS_RED_BELOW,
  type PacingBand,
  type PacingChange,
} from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { type ProgressPoint, type TopicProgress } from "@/lib/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { bandOf } from "@/lib/planner/bands";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, sundayOf, addWeeks, toDateKey } from "@/lib/week";
import { subjectLabel } from "@/lib/courseSummary";

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
  asTutor = false,
  studentName,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** Bump to force a reload (e.g. after the confidence board changes). */
  refreshToken?: number;
  /** Tutor review mode: neutral copy, and the plan-shift is informational only
   *  (the acknowledgement is the student's own gesture — a tutor never consumes it). */
  asTutor?: boolean;
  /** The student whose road this is, for tutor-voiced copy. */
  studentName?: string | null;
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
  const [showAllChanges, setShowAllChanges] = useState(false);

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
  // Which topics were rescheduled, keyed by topic, so the table can flag them
  // inline (badge at the topic's new start week) instead of a separate list.
  const changeByTopic = useMemo(
    () => new Map((data?.changes ?? []).map((c) => [c.topicId, c])),
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
  // The plan they are still living by. While a reschedule is pending it drives
  // the Core column, so the proposal has something to be compared against.
  const baselineSpine = data?.baselineBands.filter(isTeachBand) ?? [];
  // The review column is open exactly while there is a shift to accept, and
  // closes the moment they accept it (needsAck goes false on reload).
  const reviewing = !!data?.needsAck && baselineSpine.length > 0;
  const total = spine.length;
  const doneCount = spine.filter((b) => covered.has(b.topicId)).length;

  return (
    <div className="rounded-2xl premium-card p-4 sm:p-5 shadow-sm mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
            <MapIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold tracking-tight">
              {asTutor
                ? `${studentName ? `${studentName}'s` : "Student"} programme to the exams`
                : "Your programme to the exams"}
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
                {subjectLabel(e.subject)}
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
          {/* Plan-shift banner — a compact summary; the moved topics are flagged
              inline in the table below, so we don't repeat the full list here. */}
          {data.needsAck && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
                    {asTutor ? "This student's plan has shifted" : "Your plan has shifted"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {data.changes.length} {data.changes.length === 1 ? "topic" : "topics"}{" "}
                    rescheduled to stay on track for the exams —{" "}
                    <span className="text-amber-700 dark:text-amber-300 font-medium">
                      compare them in the Proposed column below
                    </span>
                    .{" "}
                    {asTutor
                      ? "The student will be asked to confirm the new dates."
                      : "Nothing changes until you accept it."}
                  </p>

                  <button
                    type="button"
                    onClick={() => setShowAllChanges((v) => !v)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                    aria-expanded={showAllChanges}
                  >
                    {showAllChanges ? "Hide the dates" : "See what moved"}
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showAllChanges ? "rotate-180" : ""}`}
                    />
                  </button>
                  {showAllChanges && (
                    <ul className="mt-2 space-y-1">
                      {data.changes.map((c) => (
                        <li key={c.topicId} className="text-xs flex items-center flex-wrap gap-1.5">
                          <span className="font-medium">{c.title}</span>
                          {c.from ? (
                            <span className="text-muted-foreground">
                              wk of {fmtDate(weekKeyToDate(c.from))}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">newly added</span>
                          )}
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="font-medium text-amber-700 dark:text-amber-300">
                            wk of {fmtDate(weekKeyToDate(c.to))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {!asTutor && (
                    <button
                      type="button"
                      onClick={acknowledge}
                      disabled={acking}
                      className="mt-2.5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                    >
                      {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Accept the new plan
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* How the plan works — plain-language reassurance, for the student only.
              A tutor knows core vs focused; the table headers say it, so we omit it. */}
          {!asTutor && (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5">
              <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">
                  This plan is built around you.
                </span>{" "}
                Week by week, <span className="font-medium text-foreground">core topics</span> are
                what the class is working through, and{" "}
                <span className="font-medium text-foreground">focused topics</span> are the ones we
                keep bringing back until they stick.
              </p>
            </div>
          )}

          <WeekTable
            spine={reviewing ? baselineSpine : spine}
            proposedSpine={reviewing ? spine : null}
            onAccept={asTutor ? null : acknowledge}
            accepting={acking}
            focusBands={data.bands.filter((b) => !isTeachBand(b))}
            examDate={data.examDate}
            covered={covered}
            progressByTopic={progressByTopic}
            masteryByTopic={masteryByTopic}
            changeByTopic={changeByTopic}
            expanded={expanded}
            onToggle={toggle}
          />

          <p className="mt-4 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Core</span> topics move only as they're
            covered; <span className="font-medium text-foreground">focused</span> topics are chosen
            live by the spaced-repetition engine from ratings, homework and quizzes — a weaker topic
            resurfaces more often. Expand a core topic to see its spec points.
          </p>
        </>
      )}
    </div>
  );
}

/** Colour + label a focused-topic chip by why the spaced-repetition engine put
 *  it back this week. `why` is the plain-English driver (shown on hover). */
function focusTone(b: PacingBand, mastery: number) {
  if (b.kind !== "revisit") {
    return {
      label: "Quick refresh",
      icon: Sparkles,
      badge: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
      why: "Already covered — a light review before the exams.",
    };
  }
  if (mastery < FOCUS_RED_BELOW) {
    return {
      label: "Needs work",
      icon: Repeat,
      badge: "bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300",
      why: `Low mastery (${Math.round(mastery)}%) — the engine resurfaces this often until it sticks.`,
    };
  }
  return {
    label: "Revisit",
    icon: Repeat,
    badge: "bg-amber-500/[0.08] border-amber-500/25 text-amber-700/90 dark:text-amber-300/80",
    why: `Getting there (${Math.round(mastery)}%) — due a spaced review so it doesn't slip.`,
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
  proposedSpine,
  onAccept,
  accepting,
  focusBands,
  examDate,
  covered,
  progressByTopic,
  masteryByTopic,
  changeByTopic,
  expanded,
  onToggle,
}: {
  /** The spine to show in the Core column — the accepted plan while reviewing. */
  spine: PacingBand[];
  /** The re-flowed spine awaiting acceptance, or null when there is nothing to review. */
  proposedSpine: PacingBand[] | null;
  /** Accept the proposal. Null in tutor mode — the gesture is the student's. */
  onAccept: (() => void) | null;
  accepting: boolean;
  focusBands: PacingBand[];
  examDate: string;
  covered: Set<string>;
  progressByTopic: Map<string, TopicProgress>;
  masteryByTopic: Map<string, number>;
  /** Topic id → its reschedule, so moved topics are flagged at their start week. */
  changeByTopic: Map<string, PacingChange>;
  expanded: Set<string>;
  onToggle: (topicId: string) => void;
}) {
  const nowKey = currentWeekKey();
  // Run from this week through to the exams.
  const weeks = weekKeysBetween(nowKey, examDate);

  const inBand = (b: PacingBand, wk: string) => b.startWeek <= wk && wk <= b.endWeek;

  // The proposal rides in a fourth column that exists only while there is
  // something to accept, so the layout returns to three once it is gone.
  const cols = proposedSpine
    ? "grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.05fr)]"
    : "grid-cols-[7.5rem_1fr_1fr]";

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div
        className={`grid ${cols} bg-muted/50 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        <div className="flex items-center gap-1.5 px-3 py-2">
          <CalendarDays className="w-3.5 h-3.5" /> Week
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
          <CircleDot className="w-3.5 h-3.5 text-primary" />
          {proposedSpine ? "Core topics · now" : "Core topics"}
        </div>
        <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
          <Repeat className="w-3.5 h-3.5 text-rose-500" /> Focused topics
        </div>
        {proposedSpine && (
          <div className="flex items-center gap-2 px-3 py-2 border-l-2 border-l-amber-500 bg-amber-500/[0.07]">
            <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <RefreshCw className="w-3.5 h-3.5" /> Proposed
            </span>
            {onAccept && (
              <button
                type="button"
                onClick={onAccept}
                disabled={accepting}
                className="ml-auto inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-amber-600 text-white text-[10px] font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-50"
              >
                {accepting ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                Accept
              </button>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[32rem] overflow-y-auto divide-y divide-border">
        {weeks.map((wk) => {
          const isNow = wk === nowKey;
          const core = spine.find((b) => inBand(b, wk));
          const focused = focusBands.filter((b) => inBand(b, wk));
          const tp = core ? progressByTopic.get(core.topicId) : undefined;
          // Expansion is per ROW, not per topic: a topic spans several weeks and
          // each one teaches a different slice, so opening "Topic 1" in October
          // must not also open its September and November rows.
          const rowKey = core ? `${core.topicId}@${wk}` : "";
          const isOpen = core ? expanded.has(rowKey) : false;
          const showWholeTopic = core ? expanded.has(`${rowKey}@all`) : false;
          // This week's share of the topic, as the year plan divided it. Bands
          // stored before `pointsByWeek` existed fall back to the whole topic.
          const weekPoints = core?.pointsByWeek?.[wk];
          const byId = new Map((tp?.points ?? []).map((p) => [p.id, p]));
          const shown =
            showWholeTopic || !weekPoints
              ? (tp?.points ?? [])
              : weekPoints.map((r) => byId.get(r.specPointId)).filter((p) => p !== undefined);
          const hasDetail = (tp?.points.length ?? 0) > 0;
          const isCovered = core ? covered.has(core.topicId) : false;
          // Flag a reschedule only at the topic's new start week, so the badge
          // shows once per moved topic rather than on every week it spans.
          const proposed = proposedSpine?.find((b) => inBand(b, wk));
          // While reviewing, the badge belongs to the proposal — it is the column
          // making the claim. Otherwise it sits on the accepted plan as before.
          const change = proposedSpine
            ? proposed && wk === proposed.startWeek
              ? changeByTopic.get(proposed.topicId)
              : undefined
            : core && wk === core.startWeek
              ? changeByTopic.get(core.topicId)
              : undefined;
          // A week where the proposal puts a different topic than today's plan —
          // the actual shift, worth calling out on the row.
          const shifted =
            !!proposedSpine && (proposed?.topicId ?? null) !== (core?.topicId ?? null);
          return (
            <div key={wk}>
              <div
                className={`grid ${cols} items-stretch ${
                  change || shifted
                    ? "bg-amber-500/[0.06] border-l-2 border-l-amber-500"
                    : isNow
                      ? "bg-primary/[0.04]"
                      : ""
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
                      onClick={() => hasDetail && onToggle(rowKey)}
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
                      {change && !proposedSpine && (
                        <span
                          className="mt-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                          title={
                            change.from
                              ? `Rescheduled from the week of ${fmtDate(weekKeyToDate(change.from))}`
                              : "Newly added to the plan"
                          }
                        >
                          <RefreshCw className="w-2.5 h-2.5" />
                          {change.from ? (
                            <>Moved from {fmtDate(weekKeyToDate(change.from))}</>
                          ) : (
                            <>New in plan</>
                          )}
                        </span>
                      )}
                      {tp && tp.points.length > 0 && (
                        <div
                          className="mt-1.5 flex items-center gap-2"
                          title={`How well this is sticking: ${tp.masteryPct}%`}
                        >
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
                          className="min-w-0"
                          title={tone.why}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-semibold shrink-0 ${tone.badge}`}
                            >
                              <Icon className="w-2.5 h-2.5" />
                              {tone.label}
                            </span>
                            <span className="text-[12px] font-medium truncate">{b.title}</span>
                          </div>
                          {b.points && b.points.length > 0 && (
                            <div className="mt-0.5 pl-[3.75rem] text-[11px] text-muted-foreground truncate">
                              {b.points.map((p) => p.code).join(", ")}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <span className="text-[12px] text-muted-foreground/60">—</span>
                  )}
                </div>

                {/* Proposed — the re-flowed plan, shown only until it is accepted */}
                {proposedSpine && (
                  <div
                    className={`px-3 py-2.5 border-l-2 border-l-amber-500 min-w-0 ${
                      shifted ? "bg-amber-500/[0.08]" : "bg-amber-500/[0.02]"
                    }`}
                  >
                    {proposed ? (
                      <>
                        <div className="flex items-start gap-2">
                          <span
                            className={`text-[13px] leading-snug ${
                              shifted
                                ? "font-semibold text-amber-800 dark:text-amber-200"
                                : "font-medium text-muted-foreground"
                            }`}
                          >
                            {proposed.title}
                          </span>
                          {!shifted && (
                            <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0">
                              unchanged
                            </span>
                          )}
                        </div>
                        {change && (
                          <span
                            className="mt-1.5 inline-flex items-center gap-1 h-5 px-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                            title={
                              change.from
                                ? `Rescheduled from the week of ${fmtDate(weekKeyToDate(change.from))}`
                                : "Newly added to the plan"
                            }
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                            {change.from ? (
                              <>Moved from {fmtDate(weekKeyToDate(change.from))}</>
                            ) : (
                              <>New in plan</>
                            )}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[12px] text-muted-foreground/60">—</span>
                    )}
                  </div>
                )}
              </div>

              {/* Expanded spec-point breakdown — this week's share of the topic,
                  not the whole thing. A six-week topic listing all 17 of its
                  points under every one of its weeks answered "what is in this
                  topic", when the question being asked is "what am I studying". */}
              {isOpen && tp && (
                <div className="bg-muted/20 px-4 py-2.5 border-t border-border">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {showWholeTopic || !weekPoints
                        ? `Whole topic · ${tp.points.length} spec ${tp.points.length === 1 ? "point" : "points"}`
                        : `This week · ${shown.length} of ${tp.points.length} spec points`}
                    </span>
                    {weekPoints && weekPoints.length < tp.points.length && (
                      <button
                        type="button"
                        onClick={() => onToggle(`${rowKey}@all`)}
                        className="text-[10px] font-semibold text-primary hover:underline shrink-0"
                      >
                        {showWholeTopic ? "Show this week only" : "Show whole topic"}
                      </button>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {shown.map((p) => (
                      <PointRow key={p.id} point={p} />
                    ))}
                  </ul>
                </div>
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
