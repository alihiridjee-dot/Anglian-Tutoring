import { Link } from "@tanstack/react-router";
import { WeekBreakdown } from "./WeekBreakdown";
import { FullPlanTimeline } from "./FullPlanTimeline";
import { WithheldPlanPoints } from "./WithheldPlanPoints";
import { ErrorNote, Meter } from "@/components/Shared";
import { usePlannerRoadmap, usePlannerMemory } from "@/hooks/data/usePlanner";
import { ScheduleComparison } from "./ScheduleComparison";
import { Spinner } from "@/components/Shared";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  History,
  Map as MapIcon,
  Repeat,
  Scale,
  SlidersHorizontal,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/planner/programDal";
import { ScheduleDAL, type MemoryStats, type TopicProgress } from "@/lib/planner/scheduleDal";
import { type Enrolment } from "@/lib/profile/enrolment";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import {
  currentWeekKey,
  weekKeyToDate,
  addWeeks,
  toDateKey,
  weekRangeLabel,
} from "@/lib/planner/week";
import { CoveredLedger } from "./CoveredLedger";
import { CatchUpPanel } from "./CatchUpPanel";
import { ThisWeekPanel } from "./ThisWeekPanel";
import { useWeekPlan } from "./useWeekPlan";
import { WeekReview } from "./WeekReview";
import { subjectLabel } from "@/lib/curriculum/courseSummary";

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
  initialSubject,
  initialTab,
  focusWeek,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  /** Opens on this course when the student is enrolled on it. */
  initialSubject?: string;
  initialTab?: TabKey;
  /** A week the full plan opens at, e.g. from a curriculum point. */
  focusWeek?: string;
}) {
  const ordered = useMemo(
    () => [
      ...enrolments.filter((e) => e.subject === "biology"),
      ...enrolments.filter((e) => e.subject !== "biology"),
    ],
    [enrolments],
  );
  const [activeSubject, setActiveSubject] = useState(
    ordered.find((e) => e.subject === initialSubject)?.subject ?? ordered[0]?.subject ?? "biology",
  );
  const active = ordered.find((e) => e.subject === activeSubject) ?? ordered[0];
  // Named separately so the effect below can depend on the two values it uses.
  // Depending on `active` itself would re-run the whole roadmap load whenever
  // the enrolments query hands back a fresh object for the same course.
  const activeCourseSubject = active?.subject;
  const activeBoard = active?.board;
  const [tab, setTab] = useState<TabKey>(initialTab ?? "week");

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
  // A re-flowed plan left unapplied — the course changed, or an exam-date save
  // was cut short. It is settled quietly on sight, once per proposal, rather
  // than handed to the student as something to review.
  const settled = useRef(new Set<string>());
  useEffect(() => {
    if (!data?.needsAck || !activeCourseSubject || !activeBoard) return;
    const key = `${studentId}|${activeCourseSubject}|${JSON.stringify(data.changes)}`;
    if (settled.current.has(key)) return;
    settled.current.add(key);
    ProgramDAL.applyPending({
      studentId,
      subject: activeCourseSubject as SubjectV,
      board: activeBoard as BoardV,
      level,
    })
      .then(() => setBoardRev((r) => r + 1))
      // Stays pending and is tried again on the next visit.
      .catch(() => {});
  }, [data, studentId, activeCourseSubject, activeBoard, level]);
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
          <ErrorNote error={currentWeek.error} onRetry={() => void currentWeek.reload()} />
        ) : tab === "topics" ? (
          <TopicsTab
            studentId={studentId}
            enrolments={enrolments}
            level={level}
            subject={active.subject}
          />
        ) : roadQuery.error ? (
          <ErrorNote error={roadQuery.error} onRetry={() => void roadQuery.refetch()} />
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
            focusWeek={focusWeek}
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
    const focusNow = focus.filter((b) => b.startWeek <= nowKey && nowKey <= b.endWeek);
    const progressByTopic = new Map<string, TopicProgress>(
      data.progress.map((t) => [t.topicId, t]),
    );
    return {
      nowKey,
      covered,
      spine,
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
  refreshKey,
  onScheduleApplied,
}: {
  data: RoadmapResult;
  memory: MemoryStats | null;
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
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

  if (week.error) return <ErrorNote error={week.error} onRetry={() => void week.reload()} />;

  return (
    <div className="space-y-4">
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function SummaryLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <p className="eyebrow eyebrow-bare flex items-center gap-2">
      <span className="icon-tile size-8 shrink-0">
        <Icon className="size-4" aria-hidden />
      </span>
      {children}
    </p>
  );
}

function FullPlanTab({
  data,
  studentId,
  subject,
  board,
  level,
  newFocusKeys,
  focusWeek,
  onChanged,
}: {
  data: RoadmapResult;
  studentId: string;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  /** Focus-lane band keys that are new/moved since the last re-rate. */
  newFocusKeys: Set<string>;
  focusWeek?: string;
  /** Jump to My topics — the one place an overloaded plan can be fixed. */
  onChanged: () => void;
}) {
  const { nowKey, covered, spine } = useRoadmapView(data);
  const [savingDate, setSavingDate] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);

  const saveExamDate = async (value: string) => {
    if (!value || value === data.examDate) return;
    setSavingDate(true);
    try {
      await ProgramDAL.setExamDate({ studentId, subject, examDate: value });
      // The new date is the decision; the re-flowed weeks follow from it.
      const applied = await ProgramDAL.applyPending({ studentId, subject, board, level });
      const lastTeaching = applied?.bands
        .filter(isTeachBand)
        .reduce((end, b) => (b.endWeek > end ? b.endWeek : end), "");
      toast.success(
        lastTeaching
          ? `Exam date updated. Teaching now finishes the week of ${weekKeyToDate(
              lastTeaching,
            ).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}.`
          : "Exam date updated.",
      );
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the exam date — try again.");
    } finally {
      setSavingDate(false);
    }
  };
  const topicIds = new Set(spine.map((b) => b.topicId));
  const doneCount = [...topicIds].filter((id) => covered.has(id)).length;
  const backlog = data.backlogByTopic ?? [];
  const owed = backlog.reduce((count, topic) => count + topic.points.length, 0);
  const held = data.catchUpSchedule?.held.length ?? 0;
  const weeksToGo = Math.max(
    0,
    Math.round(
      (weekKeyToDate(data.examDate).getTime() - weekKeyToDate(nowKey).getTime()) / WEEK_MS,
    ),
  );

  return (
    <div>
      {/* The course at a glance. The exam date leads because every week below is
          paced from it; each tile carries the one action that changes its number. */}
      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <div className="premium-card tint-primary rounded-2xl p-4 flex flex-col gap-3">
          <SummaryLabel icon={CalendarDays}>Exams</SummaryLabel>
          <p className="numeral text-3xl text-[color:var(--tint)]">
            {weeksToGo}{" "}
            <span className="text-base">{weeksToGo === 1 ? "week" : "weeks"} to go</span>
          </p>
          <label className="mt-auto">
            <span className="sr-only">Exam date</span>
            <input
              type="date"
              defaultValue={data.examDate}
              disabled={savingDate}
              onChange={(e) => saveExamDate(e.target.value)}
              className="btn-soft h-9 w-full rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--tint)] disabled:opacity-50"
            />
          </label>
        </div>

        <div className="premium-card tint-emerald rounded-2xl p-4 flex flex-col gap-3">
          <SummaryLabel icon={CheckCircle2}>Topics covered</SummaryLabel>
          <p className="numeral text-3xl text-[color:var(--tint)]">
            {doneCount} <span className="text-base">of {topicIds.size}</span>
          </p>
          <Meter value={topicIds.size ? (doneCount / topicIds.size) * 100 : 0} size="sm" />
          <Link
            to="/planner-order"
            search={{ subject }}
            className="btn-soft mt-auto h-9 rounded-xl px-3 text-sm inline-flex items-center justify-center gap-2"
          >
            <SlidersHorizontal className="size-4" aria-hidden /> Reorder topics
          </Link>
        </div>

        <div className="premium-card tint-amber rounded-2xl p-4 flex flex-col gap-3">
          <SummaryLabel icon={History}>To catch up</SummaryLabel>
          <p className="numeral text-3xl text-[color:var(--tint)]">
            {owed} <span className="text-base">{owed === 1 ? "point" : "points"}</span>
          </p>
          {held > 0 && (
            <span className="chip tint-rose text-xs self-start" role="status">
              <AlertTriangle className="size-3.5" aria-hidden /> {held} won’t fit before exams
            </span>
          )}
          {owed > 0 ? (
            <button
              type="button"
              aria-expanded={catchUpOpen}
              onClick={() => setCatchUpOpen((open) => !open)}
              className="btn-soft mt-auto h-9 rounded-xl px-3 text-sm inline-flex items-center justify-center gap-2"
            >
              {catchUpOpen ? "Hide catch-up" : "Catch up now"}
              <ChevronDown
                className={`size-4 transition-transform ${catchUpOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          ) : (
            <span className="chip tint-emerald text-xs self-start mt-auto">
              <CheckCircle2 className="size-3.5" aria-hidden /> All caught up
            </span>
          )}
        </div>
      </div>

      {catchUpOpen && owed > 0 && (
        <div className="premium-card tint-amber rounded-2xl p-4 mb-4">
          <CatchUpPanel
            studentId={studentId}
            subject={subject}
            board={board}
            level={level}
            weekStart={nowKey}
            backlog={backlog}
            asTutor={false}
            onAdded={onChanged}
          />
        </div>
      )}
      {/* Your new schedule — what the latest ratings changed in the focus lane. */}
      {newFocusKeys.size > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2.5 mb-3">
          <Repeat className="w-4 h-4 text-rose-600 dark:text-rose-400 mt-0.5 shrink-0" />
          <p className="text-[12px] leading-relaxed">
            <span className="font-semibold">Your revision schedule updated.</span>{" "}
            <span>
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
            <span>
              {data.reviewBacklog.length} reviews cannot fit before the exam;{" "}
              {data.unscheduledTopicTitles.length} topics need teaching time. Ask your tutor to
              review the workload; completing your assigned work will not automatically add more.
            </span>
          </p>
        </div>
      )}

      <FullPlanTimeline data={data} newFocusKeys={newFocusKeys} focusWeek={focusWeek} />
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
