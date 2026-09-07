import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote } from "@/components/Shared";
import { PLANNER_TIME_ZONE } from "@/lib/week";
import { usePlannerRoadmap, usePlannerMemory } from "@/hooks/data/usePlanner";
import { ScheduleComparison } from "./ScheduleComparison";
import { Spinner } from "@/components/Shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Loader2,
  Map as MapIcon,
  Repeat,
  RefreshCw,
  Scale,
  SlidersHorizontal,
} from "lucide-react";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { ScheduleDAL, type MemoryStats, type TopicProgress } from "@/lib/scheduleDal";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, addWeeks, toDateKey } from "@/lib/week";
import { CoveredLedger } from "./CoveredLedger";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";
import { subjectLabel } from "@/lib/courseSummary";
import { PointRow } from "./PointRow";
import { FocusedTopicsHeaderCell, FocusKey, FocusPointsPanel, FocusTopicButton } from "./FocusLane";
import { focusHasDetail, focusRowKey } from "./focusMeta";
import { PacingChangeBadge } from "./PacingChangeBadge";

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    timeZone: PLANNER_TIME_ZONE,
    day: "numeric",
    month: "short",
  });
}
/** Stable identity for one focus-lane band — topic + kind + week it lands on. */
function focusKey(b: PacingBand): string {
  return `${b.topicId}|${b.kind}|${b.startWeek}`;
}

type TabKey = "week" | "plan" | "topics";

const TABS: { key: TabKey; label: string; icon: typeof CalendarDays }[] = [
  { key: "week", label: "This week", icon: CalendarDays },
  { key: "plan", label: "Full plan", icon: MapIcon },
  { key: "topics", label: "Practice history", icon: SlidersHorizontal },
];

/**
 * The whole student planner in one place: subject picked once up top, then
 * three tabs. "This week" is the landing view — the one topic being taught,
 * anything to revisit, and how memory is holding. "Full plan" is the road to
 * the exams. "My topics" is where the student reviews
 * what's been practised. Replaces the old four stacked panels, each of which
 * had its own subject tabs.
 */
export function StudentPlanner({
  studentId,
  enrolments,
  level,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
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
  // Named separately so the effect below can depend on the two values it uses.
  // Depending on `active` itself would re-run the whole roadmap load whenever
  // the enrolments query hands back a fresh object for the same course.
  const activeCourseSubject = active?.subject;
  const activeBoard = active?.board;
  const [tab, setTab] = useState<TabKey>("week");

  // Bumped after an explicit schedule update.
  const [boardRev, setBoardRev] = useState(0);
  // Bumped once the current week has actually been re-cut, so a mounted week
  // panel reloads its points. Separate from `boardRev`: a rating that doesn't
  // change the week's point set shouldn't make the panel flash.
  const [weekRev, setWeekRev] = useState(0);
  // Focus-lane bands added/moved since the last load of *this same course* — so
  // when a student re-rates topics we can point at exactly what their revision
  // schedule now does differently ("your new schedule"). Session-only, never
  // persisted: the diff is between the plan as it was and as it is right now.
  const prevFocus = useRef<{ course: string; keys: Set<string> } | null>(null);
  const [newFocusKeys, setNewFocusKeys] = useState<Set<string>>(new Set());

  const courseParams = {
    studentId,
    subject: (activeCourseSubject ?? "biology") as SubjectV,
    board: (activeBoard ?? "aqa") as BoardV,
    level,
  };
  const roadQuery = usePlannerRoadmap(courseParams, boardRev, !!active);
  const memQuery = usePlannerMemory(courseParams, !!active);
  const data = roadQuery.data ?? null;
  const memory = memQuery.data ?? null;
  const loading = roadQuery.isLoading || memQuery.isLoading;
  useEffect(() => {
    const course = `${studentId}|${activeCourseSubject}|${activeBoard}|${level}`;
    const keys = new Set((data?.bands ?? []).filter((b) => !isTeachBand(b)).map(focusKey));
    const prev = prevFocus.current;
    setNewFocusKeys(
      prev && prev.course === course
        ? new Set([...keys].filter((k) => !prev.keys.has(k)))
        : new Set(),
    );
    prevFocus.current = { course, keys };
  }, [data, studentId, activeCourseSubject, activeBoard, level]);

  if (!active) {
    return (
      <div className="rounded-2xl premium-card p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          You're not enrolled in any subjects yet — contact your tutor to get set up.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl premium-card shadow-sm overflow-hidden">
      {/* One header: subject picked once, tabs underneath. */}
      <div className="px-4 sm:px-5 pt-4 border-b border-border">
        {ordered.length > 1 && (
          <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Subject">
            {ordered.map((e) => (
              <button
                key={e.subject}
                type="button"
                role="tab"
                aria-selected={e.subject === activeSubject}
                onClick={() => setActiveSubject(e.subject)}
                className={`h-8 px-3.5 rounded-full text-sm font-medium transition ${
                  e.subject === activeSubject
                    ? "btn-solid"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel(e.subject)}
              </button>
            ))}
          </div>
        )}
        <nav className="flex gap-1 -mb-px" aria-label="Planner sections">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 px-3.5 h-10 text-sm font-medium border-b-2 transition ${
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="p-4 sm:p-5">
        {tab === "topics" ? (
          <TopicsTab
            studentId={studentId}
            enrolments={enrolments}
            level={level}
            subject={active.subject}
          />
        ) : roadQuery.error ? (
          <ErrorNote error={roadQuery.error} />
        ) : loading ? (
          <Spinner className="py-12" />
        ) : !data ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No curriculum found for this course yet.
          </p>
        ) : tab === "week" ? (
          <ThisWeekTab
            data={data}
            memory={memory}
            studentId={studentId}
            subject={active.subject as SubjectV}
            board={active.board as BoardV}
            level={level}
            onReviewPlan={() => setTab("plan")}
            refreshKey={weekRev}
            onScheduleApplied={() => setBoardRev((r) => r + 1)}
          />
        ) : (
          <FullPlanTab
            data={data}
            studentId={studentId}
            subject={active.subject as SubjectV}
            newFocusKeys={newFocusKeys}
            onChanged={() => setBoardRev((r) => r + 1)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared derivations                                                  */
/* ------------------------------------------------------------------ */

function useRoadmapView(data: RoadmapResult) {
  return useMemo(() => {
    const nowKey = currentWeekKey();
    const covered = new Set(data.coveredTopicIds);
    const spine = data.bands.filter(isTeachBand);
    const nowBand =
      spine.find((b) => b.startWeek <= nowKey && nowKey <= b.endWeek) ??
      spine.find((b) => b.endWeek >= nowKey) ??
      spine[spine.length - 1];
    const focus = data.bands.filter((b) => !isTeachBand(b));
    // The spine they last accepted. While a reschedule is pending this is the
    // plan they are still living by, and `spine` is the proposal.
    const baselineSpine = data.baselineBands.filter(isTeachBand);
    const reviewing = data.needsAck && baselineSpine.length > 0;
    const changeByTopic = new Map(data.changes.map((c) => [c.topicId, c]));
    const focusNow = focus.filter((b) => b.startWeek <= nowKey && nowKey <= b.endWeek);
    const progressByTopic = new Map<string, TopicProgress>(
      data.progress.map((t) => [t.topicId, t]),
    );
    return {
      nowKey,
      covered,
      spine,
      baselineSpine,
      reviewing,
      changeByTopic,
      nowBand,
      focus,
      focusNow,
      progressByTopic,
    };
  }, [data]);
}

/* ------------------------------------------------------------------ */
/* Tab 1 — This week                                                   */
/* ------------------------------------------------------------------ */

function ThisWeekTab({
  data,
  memory,
  studentId,
  subject,
  board,
  level,
  onReviewPlan,
  refreshKey,
  onScheduleApplied,
}: {
  data: RoadmapResult;
  memory: MemoryStats | null;
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  /** Jump to Full plan, where the proposal can be compared and accepted. */
  onReviewPlan: () => void;
  /** Reload after an explicit schedule update. */
  refreshKey: number;
  onScheduleApplied: () => void;
}) {
  // The same week the dashboard shows, from the same hook — the roadmap this
  // screen has already loaded is handed over so it isn't fetched twice.
  const weekStart = currentWeekKey();
  const week = useWeekPlan({
    studentId,
    subject,
    board,
    level,
    weekStart,
    isCurrent: true,
    withCoverage: true,
    roadmap: data,
    refreshKey,
  });

  if (week.error) return <ErrorNote error={week.error} />;

  return (
    <div className="space-y-4">
      {data.needsAck && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="flex-1 min-w-[200px] text-sm">
            <span className="font-semibold">Your plan has shifted.</span>{" "}
            <span className="text-muted-foreground">
              {data.changes.length} {data.changes.length === 1 ? "topic" : "topics"} would move to
              keep you on track for the exams. Compare it side by side in Full plan — nothing
              changes until you accept.
            </span>
          </p>
          <button
            type="button"
            onClick={onReviewPlan}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90"
          >
            Review it
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Learning this week — core topic and focused topics, the shared panel. */}
      <section>
        <h2 className="flex items-center gap-1.5 font-display text-sm font-bold tracking-tight mb-2.5">
          <CalendarDays className="w-4 h-4 text-primary" />
          Learning this week
        </h2>
        <ThisWeekPanel
          plan={week.plan}
          points={week.points}
          activity={week.activity}
          coverage={week.coverage}
          roadmap={week.roadmap}
          loading={week.loading}
          weekStart={weekStart}
          editable
          isPast={false}
          showRationale
          showCoverage
          onRemove={week.removePoint}
        />
      </section>

      <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

      {week.plan && (
        <ScheduleComparison
          studentId={studentId}
          subject={subject}
          board={board}
          level={level}
          weekStart={weekStart}
          week={week}
          roadmap={data}
          onApplied={onScheduleApplied}
        />
      )}
      {/* Optional reflection and tutor feedback. */}
      <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

      {week.plan && (
        <details className="premium-card rounded-xl p-3">
          <summary className="cursor-pointer text-sm font-bold">
            Weekly check-in and tutor feedback
          </summary>
          <WeekReview
            studentId={studentId}
            plan={week.plan}
            points={week.points}
            coverage={week.coverage}
            activity={week.activity}
            subject={subject}
            board={board}
            level={level}
            weekStart={weekStart}
            onChanged={week.reload}
          />
        </details>
      )}

      {/* Memory strip — how the course is held right now. */}
      {memory && memory.total - memory.newCount > 0 && (
        <details className="premium-card tint-primary rounded-xl p-3.5">
          <summary className="cursor-pointer text-sm font-bold">Memory details</summary>
          <h3 className="flex items-center gap-1.5 text-sm font-bold mb-2">
            <Brain className="w-4 h-4 text-violet-500" />
            Your memory right now
          </h3>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {memory.avgRetention != null && (
              <span>
                <span className="font-display font-bold tabular-nums text-lg">
                  {Math.round(memory.avgRetention * 100)}%
                </span>{" "}
                <span className="text-muted-foreground text-xs">average recall</span>
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                {memory.dueNow}
              </span>{" "}
              due now · <span className="font-semibold tabular-nums">{memory.dueThisWeek}</span> due
              this week · <span className="font-semibold tabular-nums">{memory.stable}</span>{" "}
              holding
            </span>
          </div>
          {memory.weakest.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {memory.weakest.map((w) => (
                <li key={w.code} className="flex items-baseline gap-2 text-xs min-w-0">
                  <span className="font-mono text-muted-foreground shrink-0">{w.code}</span>
                  <span className="truncate">{w.title}</span>
                  <span className="ml-auto shrink-0 font-semibold tabular-nums">
                    {Math.round(w.retention * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab 2 — Full plan                                                   */
/* ------------------------------------------------------------------ */

function FullPlanTab({
  data,
  studentId,
  subject,
  newFocusKeys,
  onChanged,
}: {
  data: RoadmapResult;
  studentId: string;
  subject: SubjectV;
  /** Focus-lane band keys that are new/moved since the last re-rate. */
  newFocusKeys: Set<string>;
  /** Jump to My topics — the one place an overloaded plan can be fixed. */
  onChanged: () => void;
}) {
  const {
    nowKey,
    covered,
    spine,
    baselineSpine,
    reviewing,
    changeByTopic,
    focus,
    progressByTopic,
  } = useRoadmapView(data);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savingDate, setSavingDate] = useState(false);
  const [accepting, setAccepting] = useState(false);

  /**
   * Accept the proposed plan. Until this runs the student keeps the plan they
   * already agreed to; accepting writes the re-flowed spine as the new baseline,
   * which is what closes the review column on the next load.
   */
  const acceptPlan = async () => {
    setAccepting(true);
    try {
      await ProgramDAL.acknowledge({
        studentId,
        subject,
        bands: data.bands,
        programStart: data.programStart,
        examDate: data.examDate,
      });
      toast.success("New plan accepted — your schedule is up to date.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update — try again.");
    } finally {
      setAccepting(false);
    }
  };

  const saveExamDate = async (value: string) => {
    if (!value || value === data.examDate) return;
    setSavingDate(true);
    try {
      await ProgramDAL.setExamDate({ studentId, subject, examDate: value });
      toast.success("Exam date updated — re-flowing your plan.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the exam date — try again.");
    } finally {
      setSavingDate(false);
    }
  };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doneCount = spine.filter((b) => covered.has(b.topicId)).length;
  const weeks = weekKeysBetween(nowKey, data.examDate);
  const inBand = (b: PacingBand, wk: string) => b.startWeek <= wk && wk <= b.endWeek;
  // While reviewing, the Core column holds the accepted plan and the proposal
  // sits beside it; once accepted there is nothing to compare and the fourth
  // column disappears.
  const coreSpine = reviewing ? baselineSpine : spine;
  const proposedSpine = reviewing ? spine : null;
  const cols = proposedSpine
    ? "grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.05fr)]"
    : "grid-cols-[6.5rem_1fr_1fr]";

  return (
    <div>
      {/* A pending re-flow: the proposal is open in its own column, and this says
          so plainly — the plan on screen is still the one they agreed to. */}
      {reviewing && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 mb-3">
          <RefreshCw className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="flex-1 min-w-[220px] text-[12px] leading-relaxed">
            <span className="font-semibold">A new plan is ready for you.</span>{" "}
            <span className="text-muted-foreground">
              {data.changes.length} {data.changes.length === 1 ? "topic" : "topics"} would move.
              Compare it in the{" "}
              <span className="font-semibold text-amber-700 dark:text-amber-300">Proposed</span>{" "}
              column — your current plan stays exactly as it is until you accept.
            </span>
          </p>
          <button
            type="button"
            onClick={acceptPlan}
            disabled={accepting}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 shrink-0"
          >
            {accepting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            Accept the new plan
          </button>
        </div>
      )}

      {/* Your new schedule — what the latest ratings changed in the focus lane. */}
      {newFocusKeys.size > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 mb-3">
          <Repeat className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <p className="text-[12px] leading-relaxed">
            <span className="font-semibold">Your revision schedule updated.</span>{" "}
            <span className="text-muted-foreground">
              {newFocusKeys.size} focus {newFocusKeys.size === 1 ? "slot" : "slots"} moved or added
              — flagged <span className="font-semibold text-rose-600 dark:text-rose-400">New</span>{" "}
              in the Focused column below.
            </span>
          </p>
        </div>
      )}

      {/* A plan asking for more revision than teaching. Said plainly and once,
          with the action attached — the cause is nearly always a topic dragged
          into a column in one go, which rates all twenty of its points at that
          same value. Rating them individually is both the lighter plan and the
          better data, so the nudge points there rather than at the workload. */}
      {data.focusLoad.overloaded && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-3 mb-3">
          <Scale className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="flex-1 min-w-[240px] text-[12px] leading-relaxed">
            <span className="font-semibold">This plan is asking a lot each week.</span>{" "}
            <span className="text-muted-foreground">
              {data.reviewBacklog.length} reviews cannot fit before the exam;{" "}
              {data.unscheduledTopicTitles.length} topics need teaching time. Ask your tutor to
              review the workload; completing your assigned work will not automatically add more.
            </span>
          </p>
        </div>
      )}

      {/* The exam date leads, because the plan is derived from it: every band
          below is the course divided across the weeks between the student's
          start and this date. Changing it re-flows the year. It used to sit as
          a footnote to a paragraph of definitions, which had it backwards. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/[0.05] px-3.5 py-3 mb-3">
        <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <CalendarDays className="w-4 h-4 text-primary shrink-0" />
          <span>
            <span className="block text-[13px] font-semibold leading-tight">Exams from</span>
            <span className="block text-[11px] text-muted-foreground">
              Every week below is paced from this date.
            </span>
          </span>
          <input
            type="date"
            defaultValue={data.examDate}
            disabled={savingDate}
            onChange={(e) => saveExamDate(e.target.value)}
            className="h-9 rounded-lg premium-card px-2.5 text-[13px] font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
        </label>
        <span className="text-[12px] text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">
            {doneCount} of {spine.length}
          </span>{" "}
          topics covered
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-2.5 text-[11px] text-muted-foreground">
        <p>
          <span className="font-semibold text-foreground">Core</span> is the course in order.{" "}
          <span className="font-semibold text-foreground">Focused</span> shows assigned reviews and
          estimates for the next review.
        </p>
        <FocusKey />
      </div>

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
            {proposedSpine ? "Core · your plan now" : "Core topics"}
          </div>
          <FocusedTopicsHeaderCell />
          {proposedSpine && (
            <div className="flex items-center gap-2 px-3 py-2 border-l-2 border-l-amber-500 bg-amber-500/[0.07]">
              <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
                <RefreshCw className="w-3.5 h-3.5" /> Proposed
              </span>
              <button
                type="button"
                onClick={acceptPlan}
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
            </div>
          )}
        </div>

        <div className="max-h-[34rem] overflow-y-auto divide-y divide-border">
          {weeks.map((wk) => {
            const isNow = wk === nowKey;
            const core = coreSpine.find((b) => inBand(b, wk));
            const focused = focus.filter((b) => inBand(b, wk));
            const tp = core ? progressByTopic.get(core.topicId) : undefined;
            // Expansion is per ROW, not per topic: a topic spans several weeks
            // and each one teaches a different slice, so opening "Topic 1" in
            // October must not also open its September and November rows.
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
            const proposed = proposedSpine?.find((b) => inBand(b, wk));
            // The week where the proposal actually differs from today's plan.
            const shifted =
              !!proposedSpine && (proposed?.topicId ?? null) !== (core?.topicId ?? null);
            const change =
              proposed && wk === proposed.startWeek
                ? changeByTopic.get(proposed.topicId)
                : undefined;
            return (
              <div key={wk}>
                <div
                  className={`grid ${cols} items-stretch ${
                    shifted
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
                        <CircleDot className="w-3 h-3" /> Now
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
                        onClick={() => hasDetail && toggle(rowKey)}
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
                      </button>
                    ) : (
                      <span className="text-[12px] text-muted-foreground/60">—</span>
                    )}
                  </div>

                  {/* Focused */}
                  <div className="px-3 py-2.5 border-l border-border min-w-0 space-y-1.5">
                    {focused.length > 0 ? (
                      focused.map((b) => {
                        const k = focusRowKey(b, wk);
                        return (
                          <FocusTopicButton
                            key={k}
                            band={b}
                            mastery={progressByTopic.get(b.topicId)?.masteryPct ?? 0}
                            isNew={newFocusKeys.has(focusKey(b))}
                            hasDetail={focusHasDetail(b, progressByTopic.get(b.topicId))}
                            open={expanded.has(k)}
                            onToggle={() => toggle(k)}
                          />
                        );
                      })
                    ) : (
                      <span className="text-[12px] text-muted-foreground/60">—</span>
                    )}
                  </div>

                  {/* Proposed — a temporary column, open only until it's accepted */}
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
                            {!shifted && !change && (
                              <span className="ml-auto text-[10px] text-muted-foreground/70 shrink-0">
                                same this week
                              </span>
                            )}
                          </div>
                          {change && <PacingChangeBadge change={change} />}
                        </>
                      ) : (
                        <span className="text-[12px] text-muted-foreground/60">—</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Expanded spec-point breakdown for the core topic */}
                {/* This week's share of the topic, not the whole thing. A topic
                    spanning six weeks used to list all 17 of its spec points
                    under every one of those weeks, which answered "what is in
                    this topic" when the question is "what am I studying now". */}
                {isOpen && tp && (
                  <div className="bg-muted/20 px-4 py-2.5 border-t border-border">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {showWholeTopic || !weekPoints
                          ? `Whole topic · ${tp.points.length} spec points`
                          : `This week · ${shown.length} of ${tp.points.length} spec points`}
                      </span>
                      {weekPoints && weekPoints.length < tp.points.length && (
                        <button
                          type="button"
                          onClick={() => toggle(`${rowKey}@all`)}
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

                {/* …and the same for any focused topic opened on this row. */}
                {focused.map((b) => {
                  const k = focusRowKey(b, wk);
                  if (!expanded.has(k)) return null;
                  return (
                    <FocusPointsPanel
                      key={k}
                      band={b}
                      progress={progressByTopic.get(b.topicId)}
                      wholeTopic={expanded.has(`${k}@all`)}
                      onToggleWholeTopic={() => toggle(`${k}@all`)}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Tap any topic to see its points and assessment results. Future review weeks are estimates;
        This week contains your confirmed assignment.
      </p>
    </div>
  );
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

/* ------------------------------------------------------------------ */
/* Tab 3 — My topics (practice history)             */
/* ------------------------------------------------------------------ */

function TopicsTab({
  studentId,
  enrolments,
  level,
  subject,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  subject: string;
}) {
  return (
    <CoveredLedger studentId={studentId} enrolments={enrolments} level={level} subject={subject} />
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */
