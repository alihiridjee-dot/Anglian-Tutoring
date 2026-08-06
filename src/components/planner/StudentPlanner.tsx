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
  ClipboardList,
  ListChecks,
  Loader2,
  Map as MapIcon,
  Repeat,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { isTeachBand, FOCUS_RED_BELOW, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import {
  ScheduleDAL,
  type MemoryStats,
  type ProgressPoint,
  type TopicProgress,
} from "@/lib/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { bandOf } from "@/lib/planner/bands";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, addWeeks, toDateKey } from "@/lib/week";
import { PlannerBoard } from "./PlannerBoard";
import { CoveredLedger } from "./CoveredLedger";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";

const subjectLabel: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
/** Stable identity for one focus-lane band — topic + kind + week it lands on. */
function focusKey(b: PacingBand): string {
  return `${b.topicId}|${b.kind}|${b.startWeek}`;
}

type TabKey = "week" | "plan" | "topics";

const TABS: { key: TabKey; label: string; icon: typeof CalendarDays }[] = [
  { key: "week", label: "This week", icon: CalendarDays },
  { key: "plan", label: "Full plan", icon: MapIcon },
  { key: "topics", label: "My topics", icon: SlidersHorizontal },
];

/**
 * The whole student planner in one place: subject picked once up top, then
 * three tabs. "This week" is the landing view — the one topic being taught,
 * anything to revisit, and how memory is holding. "Full plan" is the road to
 * the exams. "My topics" is where the student rates confidence and reviews
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

  const [data, setData] = useState<RoadmapResult | null>(null);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped when the confidence board writes, so the plan re-flows live.
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

  // The plan's own mastery per topic, lifted here so the confidence board can
  // show the same number rather than inventing a second one. Comes free from the
  // roadmap that this screen already loads.
  const masteryByTopic = useMemo(
    () => new Map((data?.progress ?? []).map((t) => [t.topicId, t.masteryPct])),
    [data],
  );

  useEffect(() => {
    if (!activeCourseSubject || !activeBoard) return;
    let alive = true;
    setLoading(true);
    const params = {
      studentId,
      subject: activeCourseSubject as SubjectV,
      board: activeBoard as BoardV,
      level,
    };
    // A rating just landed (boardRev moved off 0): re-cut the current week from
    // the new programme before anything reads it. This has to happen here rather
    // than in the week panel — that panel lives in a tab which is unmounted
    // while the student is over on the board doing the rating, so it is the one
    // component that can never see the write. Keeps work already attempted.
    const recut =
      boardRev > 0
        ? ProgramDAL.refreshWeek({ ...params, weekStart: currentWeekKey() }).catch((e) => {
            console.error("refresh this week from the programme", e);
            return false;
          })
        : Promise.resolve(false);

    recut
      .then((changed) => {
        if (changed && alive) setWeekRev((r) => r + 1);
        return Promise.all([
          ProgramDAL.loadRoadmap(params),
          ScheduleDAL.getMemoryStats(params).catch(() => null),
        ]);
      })
      .then(([road, mem]) => {
        if (!alive) return;
        setData(road);
        setMemory(mem);
        // Diff the focus lane against the previous load of the same course.
        const course = `${activeCourseSubject}|${activeBoard}`;
        const keys = new Set((road?.bands ?? []).filter((b) => !isTeachBand(b)).map(focusKey));
        const prev = prevFocus.current;
        setNewFocusKeys(
          prev && prev.course === course
            ? new Set([...keys].filter((k) => !prev.keys.has(k)))
            : new Set(),
        );
        prevFocus.current = { course, keys };
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, activeCourseSubject, activeBoard, level, boardRev]);

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
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {subjectLabel[e.subject] ?? e.subject}
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
            masteryByTopic={masteryByTopic}
            studentId={studentId}
            enrolments={enrolments}
            level={level}
            subject={active.subject}
            onChanged={() => setBoardRev((r) => r + 1)}
          />
        ) : loading ? (
          <div className="py-12 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
          </div>
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
            onRateTopics={() => setTab("topics")}
            onReviewPlan={() => setTab("plan")}
            refreshKey={weekRev}
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
  onRateTopics,
  onReviewPlan,
  refreshKey,
}: {
  data: RoadmapResult;
  memory: MemoryStats | null;
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  onRateTopics: () => void;
  /** Jump to Full plan, where the proposal can be compared and accepted. */
  onReviewPlan: () => void;
  /** Bumped by the confidence board — re-cuts this week from the new ratings. */
  refreshKey: number;
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
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold tracking-tight mb-2.5">
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
          onRateTopics={onRateTopics}
        />
      </section>

      {/* The student's own read on the week, in its own box. */}
      {week.plan && (
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
      )}

      {/* Memory strip — how the course is held right now. */}
      {memory && memory.total - memory.newCount > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-3.5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold mb-2">
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
        </div>
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

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-3 py-2.5 mb-4">
        <p className="flex items-start gap-2 text-[12px] text-muted-foreground leading-relaxed min-w-[220px] flex-1">
          <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <span>
            Week by week: <span className="font-medium text-foreground">core topics</span> are what
            the class is working through, and{" "}
            <span className="font-medium text-foreground">focused topics</span> are the ones we
            bring back until they stick. The percentage on each topic is how well it's sticking —
            the same number as on its card in My topics.{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {doneCount} of {spine.length}
            </span>{" "}
            topics covered.
          </span>
        </p>
        <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground shrink-0">
          <CalendarDays className="w-3.5 h-3.5" />
          <span>Exam date</span>
          <input
            type="date"
            defaultValue={data.examDate}
            disabled={savingDate}
            onChange={(e) => saveExamDate(e.target.value)}
            className="h-8 rounded-lg premium-card px-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
        </label>
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
          <div className="flex items-center gap-1.5 px-3 py-2 border-l border-border">
            <Repeat className="w-3.5 h-3.5 text-rose-500" /> Focused topics
          </div>
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
                        {tp && tp.points.length > 0 && (
                          <div
                            className="mt-1.5 flex items-center gap-2"
                            title={`How well this is sticking: ${tp.masteryPct}% — the same number shown on this topic's card in My topics`}
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
                        const tone = focusTone(b, progressByTopic.get(b.topicId)?.masteryPct ?? 0);
                        const Icon = tone.icon;
                        const isNew = newFocusKeys.has(focusKey(b));
                        return (
                          <div key={`${b.topicId}-${b.kind}-${b.startWeek}`} className="min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-semibold shrink-0 ${tone.badge}`}
                              >
                                <Icon className="w-2.5 h-2.5" />
                                {tone.label}
                              </span>
                              <span className="text-[12px] font-medium truncate">{b.title}</span>
                              {isNew && (
                                <span className="inline-flex items-center h-4 px-1 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[9px] font-bold uppercase tracking-wide shrink-0">
                                  New
                                </span>
                              )}
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
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        Mastery blends how you've rated each topic with your homework and quiz results. Tap a core
        topic to see what's inside it.
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
/* Tab 3 — My topics (confidence board + practice history)             */
/* ------------------------------------------------------------------ */

function TopicsTab({
  studentId,
  enrolments,
  level,
  subject,
  masteryByTopic,
  onChanged,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  subject: string;
  /** Topic id → the mastery the plan uses, so the board shows the same number. */
  masteryByTopic: Map<string, number>;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-sm font-semibold tracking-tight">
          How confident do you feel?
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Drag each topic into a column to tell us how you feel. The number on each card is
          something different — it's how well the topic is actually sticking, and it's the same
          number your plan uses. Tap a topic to rate its individual points.
        </p>
        <PlannerBoard
          studentId={studentId}
          enrolments={enrolments}
          level={level}
          subject={subject}
          masteryByTopic={masteryByTopic}
          onChanged={onChanged}
        />
      </div>
      <CoveredLedger
        studentId={studentId}
        enrolments={enrolments}
        level={level}
        subject={subject}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

/** Colour + label a revisit item by why it's there. */
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
