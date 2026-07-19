import { useEffect, useMemo, useState } from "react";
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
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { isTeachBand, FOCUS_RED_BELOW, type PacingBand } from "@/lib/planner/pacing";
import { ProgramDAL, type RoadmapResult } from "@/lib/programDal";
import { ScheduleDAL, type MemoryStats, type ProgressPoint, type TopicProgress } from "@/lib/scheduleDal";
import { type PointStatus } from "@/lib/planner/scheduler";
import { bandOf } from "@/lib/planner/bands";
import { type Enrolment } from "@/hooks/data/useEnrolments";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";
import { currentWeekKey, weekKeyToDate, sundayOf, addWeeks, toDateKey } from "@/lib/week";
import { PlannerBoard } from "./PlannerBoard";
import { CoveredLedger } from "./CoveredLedger";

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
  const [tab, setTab] = useState<TabKey>("week");

  const [data, setData] = useState<RoadmapResult | null>(null);
  const [memory, setMemory] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped when the confidence board writes, so the plan re-flows live.
  const [boardRev, setBoardRev] = useState(0);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setLoading(true);
    const params = {
      studentId,
      subject: active.subject as SubjectV,
      board: active.board as BoardV,
      level,
    };
    Promise.all([
      ProgramDAL.loadRoadmap(params),
      ScheduleDAL.getMemoryStats(params).catch(() => null),
    ])
      .then(([road, mem]) => {
        if (!alive) return;
        setData(road);
        setMemory(mem);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [studentId, active?.subject, active?.board, level, boardRev]);

  if (!active) {
    return (
      <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
        <p className="text-sm text-muted-foreground">
          You're not enrolled in any subjects yet — contact your tutor to get set up.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden">
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
            onAcked={() => setBoardRev((r) => r + 1)}
            onRateTopics={() => setTab("topics")}
          />
        ) : (
          <FullPlanTab data={data} />
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
    return { nowKey, covered, spine, nowBand, focus, focusNow, progressByTopic };
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
  onAcked,
  onRateTopics,
}: {
  data: RoadmapResult;
  memory: MemoryStats | null;
  studentId: string;
  subject: SubjectV;
  onAcked: () => void;
  onRateTopics: () => void;
}) {
  const { covered, nowBand, focusNow, progressByTopic } = useRoadmapView(data);
  const [acking, setAcking] = useState(false);
  const [openPoints, setOpenPoints] = useState(false);

  const acknowledge = async () => {
    setAcking(true);
    try {
      await ProgramDAL.acknowledge({
        studentId,
        subject,
        bands: data.bands,
        programStart: data.programStart,
        examDate: data.examDate,
      });
      toast.success("Plan updated — you're all set.");
      onAcked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update — try again.");
    } finally {
      setAcking(false);
    }
  };

  const tp = nowBand ? progressByTopic.get(nowBand.topicId) : undefined;
  const mastery = tp && tp.points.length > 0 ? tp.masteryPct : null;
  const nothingRated = data.progress.every((t) => t.points.every((p) => p.confidence == null));

  return (
    <div className="space-y-4">
      {data.needsAck && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="flex-1 min-w-[200px] text-sm">
            <span className="font-semibold">Your plan has shifted.</span>{" "}
            <span className="text-muted-foreground">
              {data.changes.length} {data.changes.length === 1 ? "topic" : "topics"} moved to keep
              you on track for the exams — see the new dates in Full plan.
            </span>
          </p>
          <button
            type="button"
            onClick={acknowledge}
            disabled={acking}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {acking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            OK, update my plan
          </button>
        </div>
      )}

      {/* Learning this week — the core topic and any focused revisits, side by side. */}
      <section>
        <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold tracking-tight mb-2.5">
          <CalendarDays className="w-4 h-4 text-primary" />
          Learning this week
        </h2>
        <div className="grid gap-4 md:grid-cols-2 items-stretch">
          {/* Core topic */}
          <div className="h-full flex flex-col rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
            <div className="flex items-center gap-1.5 mb-1">
              {nowBand && covered.has(nowBand.topicId) ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    Core topic · covered
                  </span>
                </>
              ) : (
                <>
                  <CircleDot className="w-3.5 h-3.5 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wide text-primary">
                    Core topic
                  </span>
                </>
              )}
              {nowBand && (
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {fmtRange(nowBand.startWeek, nowBand.endWeek)}
                </span>
              )}
            </div>
            {nowBand ? (
              <>
                <p className="font-display text-lg font-semibold leading-snug">{nowBand.title}</p>
                {mastery != null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="text-muted-foreground">How well it's sticking</span>
                      <span className="font-semibold tabular-nums">{mastery}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.max(2, mastery)}%` }}
                      />
                    </div>
                  </div>
                )}
                {tp && tp.points.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpenPoints((v) => !v)}
                      aria-expanded={openPoints}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${
                          openPoints ? "rotate-180" : ""
                        }`}
                      />
                      {openPoints ? "Hide the detail" : "What's in this topic"}
                    </button>
                    {openPoints && (
                      <ul className="mt-2 space-y-1 border-t border-border/60 pt-2.5">
                        {tp.points.map((p) => (
                          <PointRow key={p.id} point={p} />
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No core topic scheduled this week.</p>
            )}
          </div>

          {/* Focused topics — personal, from spaced repetition. */}
          <div className="h-full flex flex-col rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Repeat className="w-3.5 h-3.5 text-rose-500" />
              <span className="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                Focused topics
              </span>
            </div>
            {focusNow.length > 0 ? (
              <ul className="space-y-1.5">
                {focusNow.map((b) => (
                  <FocusRow
                    key={`${b.topicId}-${b.kind}-${b.startWeek}`}
                    b={b}
                    mastery={progressByTopic.get(b.topicId)?.masteryPct ?? 0}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex-1 flex items-center">
                <p className="text-sm text-muted-foreground">
                  {nothingRated ? (
                    <>
                      Nothing yet — head to{" "}
                      <button
                        type="button"
                        onClick={onRateTopics}
                        className="font-semibold text-primary hover:underline"
                      >
                        My topics
                      </button>{" "}
                      and rate how confident you feel, and we'll plan your revision from it.
                    </>
                  ) : (
                    "Nothing to revisit this week — you're on track. 🎯"
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

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
              due now ·{" "}
              <span className="font-semibold tabular-nums">{memory.dueThisWeek}</span> due this week
              · <span className="font-semibold tabular-nums">{memory.stable}</span> holding
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

function FullPlanTab({ data }: { data: RoadmapResult }) {
  const { nowKey, covered, spine, focus, progressByTopic } = useRoadmapView(data);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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

  return (
    <div>
      <div className="flex items-start gap-2 rounded-xl bg-muted/40 px-3 py-2.5 mb-4">
        <Target className="w-4 h-4 text-primary mt-0.5 shrink-0" />
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Week by week: <span className="font-medium text-foreground">core topics</span> are what the
          class is working through, and{" "}
          <span className="font-medium text-foreground">focused topics</span> are the ones we bring
          back until they stick.{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {doneCount} of {spine.length}
          </span>{" "}
          topics covered · exams from {fmtDate(weekKeyToDate(data.examDate))}{" "}
          {weekKeyToDate(data.examDate).getFullYear()}.
        </p>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[6.5rem_1fr_1fr] bg-muted/50 border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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

        <div className="max-h-[34rem] overflow-y-auto divide-y divide-border">
          {weeks.map((wk) => {
            const isNow = wk === nowKey;
            const core = spine.find((b) => inBand(b, wk));
            const focused = focus.filter((b) => inBand(b, wk));
            const tp = core ? progressByTopic.get(core.topicId) : undefined;
            const isOpen = core ? expanded.has(core.topicId) : false;
            const hasDetail = (tp?.points.length ?? 0) > 0;
            const isCovered = core ? covered.has(core.topicId) : false;
            return (
              <div key={wk}>
                <div
                  className={`grid grid-cols-[6.5rem_1fr_1fr] items-stretch ${
                    isNow ? "bg-primary/[0.04]" : ""
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
                        onClick={() => hasDetail && toggle(core.topicId)}
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
                        const tone = focusTone(b, progressByTopic.get(b.topicId)?.masteryPct ?? 0);
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
  onChanged,
}: {
  studentId: string;
  enrolments: Enrolment[];
  level: LevelV;
  subject: string;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-display text-sm font-semibold tracking-tight">
          How confident do you feel?
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Drag each topic into a column — your weekly plan and revision are built from this. Tap a
          topic to rate its individual points.
        </p>
        <PlannerBoard
          studentId={studentId}
          enrolments={enrolments}
          level={level}
          subject={subject}
          onChanged={onChanged}
        />
      </div>
      <CoveredLedger studentId={studentId} enrolments={enrolments} level={level} subject={subject} />
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

function FocusRow({ b, mastery }: { b: PacingBand; mastery: number }) {
  const tone = focusTone(b, mastery);
  const Icon = tone.icon;
  const nowKey = currentWeekKey();
  const isCurrent = b.startWeek <= nowKey && nowKey <= b.endWeek;
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 min-w-0">
      <span
        className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md border text-[10px] font-semibold shrink-0 ${tone.badge}`}
      >
        <Icon className="w-2.5 h-2.5" />
        {tone.label}
      </span>
      <span className="flex-1 text-[13px] truncate">{b.title}</span>
      <span className="text-[11px] text-muted-foreground shrink-0">
        {isCurrent ? "This week" : `wk of ${fmtDate(weekKeyToDate(b.startWeek))}`}
      </span>
    </li>
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
