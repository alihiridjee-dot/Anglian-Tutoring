import { WeekBreakdown } from "./WeekBreakdown";
import { FullPlanTimeline } from "./FullPlanTimeline";
import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote } from "@/components/Shared";
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
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Loader2,
  Map as MapIcon,
  Repeat,
  RefreshCw,
  Scale,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { ScheduleDAL, type MemoryStats, type TopicProgress } from "@/lib/scheduleDal";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, addWeeks, toDateKey, weekRangeLabel } from "@/lib/week";
import { CoveredLedger } from "./CoveredLedger";
import { CatchUpPanel } from "./CatchUpPanel";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";
import { subjectLabel } from "@/lib/courseSummary";

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
  // Keep the current assignment in sync even when Full plan is the open tab.
  // The weekly view shares this query, so only one load/write can run per course.
  const currentWeek = useWeekPlan({
    ...courseParams,
    weekStart: currentWeekKey(),
    isCurrent: true,
    withCoverage: false,
    roadmap: data,
    enabled: !!active,
  });
  const memory = memQuery.data ?? null;
  const loading = roadQuery.isLoading || memQuery.isLoading || currentWeek.loading;
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
        {currentWeek.error ? (
          <ErrorNote error={currentWeek.error} />
        ) : tab === "topics" ? (
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
            board={active.board as BoardV}
            level={level}
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
  /**
   * 0 = this week, -1 = last week, +1 = next.
   *
   * The planner used to be pinned to `currentWeekKey()` with no way back, so a
   * week that has passed — and everything the student did or missed in it — was
   * unreachable from the surface that plans their weeks. The dashboard's panel
   * has had these arrows all along; this is the same gesture, on the screen
   * where it is actually looked for.
   */
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = toDateKey(addWeeks(weekKeyToDate(currentWeekKey()), weekOffset));
  const isCurrent = weekOffset === 0;
  const isPast = weekOffset < 0;
  // History is read-only, and — more importantly — never generated: cutting a
  // fresh plan for a week that has gone by would invent a record of work that
  // was never set. `useWeekPlan` only materialises a week when `isCurrent`.
  const editable = !isPast;
  const showReview = weekOffset <= 0;
  // The same week the dashboard shows, from the same hook — the roadmap this
  // screen has already loaded is handed over so it isn't fetched twice.
  const week = useWeekPlan({
    studentId,
    subject,
    board,
    level,
    weekStart,
    isCurrent,
    withCoverage: showReview,
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
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
          <h2 className="flex items-center gap-1.5 font-display text-sm font-bold tracking-tight">
            <CalendarDays className="w-4 h-4 text-primary" />
            {isCurrent ? "Learning this week" : isPast ? "That week" : "An upcoming week"}
            <span className="font-normal text-muted-foreground">
              {weekRangeLabel(weekKeyToDate(weekStart))}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-1">
            {isCurrent && week.plan && !week.loading && (
              <WeekBreakdown
                id="week-breakdown"
                points={week.points}
                roadmap={week.roadmap}
                weekStart={weekStart}
              />
            )}
            {!isCurrent && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="inline-flex items-center gap-1 h-6 px-2 mr-1 rounded-full bg-muted text-[10px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <Undo2 className="w-3 h-3" /> Today
              </button>
            )}
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w - 1)}
              className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Previous week"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekOffset((w) => w + 1)}
              className="w-7 h-7 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              aria-label="Next week"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!week.loading && week.points.length === 0 && isPast ? (
          // Said plainly, because the alternative reading — "you did nothing" —
          // is the wrong one, and on this account it was the common one: three
          // consecutive weeks of Topic 1 were saved with no points at all.
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No plan was set for this week.
          </p>
        ) : (
          <ThisWeekPanel
            plan={week.plan}
            points={week.points}
            activity={week.activity}
            coverage={week.coverage}
            roadmap={week.roadmap}
            loading={week.loading}
            weekStart={weekStart}
            isPast={isPast}
            showCoverage={showReview}
          />
        )}
      </section>

      <WithheldPlanPoints points={week.withheld} coverage={week.coverage} />

      {/* Re-cutting a week is a statement about the week ahead. Offering it on a
          week that has gone by would let a student rewrite what was set for
          them after the fact. */}
      {week.plan && isCurrent && (
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
      {week.plan && showReview && (
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
  board,
  level,
  newFocusKeys,
  onChanged,
}: {
  data: RoadmapResult;
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  /** Focus-lane band keys that are new/moved since the last re-rate. */
  newFocusKeys: Set<string>;
  /** Jump to My topics — the one place an overloaded plan can be fixed. */
  onChanged: () => void;
}) {
  const { nowKey, covered, spine, reviewing } = useRoadmapView(data);
  const [savingDate, setSavingDate] = useState(false);
  const [accepting, setAccepting] = useState(false);

  /**
   * Accept the proposed plan. Until this runs the student keeps the plan they
   * already agreed to; accepting writes the re-flowed spine as the new baseline,
   * which closes the proposed-learning sections on the next load.
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
  const doneCount = spine.filter((b) => covered.has(b.topicId)).length;

  return (
    <div>
      {/* Proposed learning stays separate until the student accepts it. */}
      {reviewing && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 mb-3">
          <RefreshCw className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="flex-1 min-w-[220px] text-[12px] leading-relaxed">
            <span className="font-semibold">A new plan is ready for you.</span>{" "}
            <span className="text-muted-foreground">
              {data.changes.length} {data.changes.length === 1 ? "topic" : "topics"} would move.
              Compare the proposed learning in each week — your current plan stays exactly as it is
              until you accept.
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
              in the revision sections below.
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

      {(data.backlogByTopic ?? []).length > 0 && (
        <details className="premium-card tint-amber rounded-xl px-4 py-3 mb-5">
          <summary className="cursor-pointer text-sm font-bold">
            {data.backlogByTopic.reduce((count, topic) => count + topic.points.length, 0)} points
            still to cover
            <span className="block mt-1 text-xs font-normal text-muted-foreground">
              They return gradually in the plan below. Open to take on a whole topic now.
            </span>
          </summary>
          <div className="mt-3">
            <CatchUpPanel
              studentId={studentId}
              subject={subject}
              board={board}
              level={level}
              weekStart={nowKey}
              backlog={data.backlogByTopic ?? []}
              asTutor={false}
              onAdded={onChanged}
            />
          </div>
        </details>
      )}

      {!!data.catchUpSchedule?.held.length && (
        <p className="text-sm text-muted-foreground mb-3" role="status">
          {data.catchUpSchedule.held.length} missed spec points cannot fit before the exam at the
          current catch-up pace. Use Practise now or ask your tutor to adjust the workload.
        </p>
      )}
      <FullPlanTimeline data={data} newFocusKeys={newFocusKeys} />
    </div>
  );
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
