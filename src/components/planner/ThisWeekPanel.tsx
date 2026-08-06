import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  CircleDot,
  CheckCircle2,
  Repeat,
  ClipboardList,
  ListChecks,
  Plus,
  X,
  RotateCcw,
  Sparkles,
  Loader2,
} from "lucide-react";
import { type PlanPoint, type WeeklyPlan } from "@/lib/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/programDal";
import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";
import { SETTLED_THRESHOLD } from "@/lib/planner/scheduler";
import { type PointCoverage, statusOf } from "@/lib/planner/coverage";
import { weekKeyToDate } from "@/lib/week";
import { CoveragePill } from "./CoveragePill";
import { type Activity } from "./useWeekPlan";

/**
 * "This week", as both the dashboard and the planner show it.
 *
 * Two cards, the same two the roadmap uses, because they are the same two ideas:
 * the **core topic** is the curriculum marching through the year toward the
 * exam, and **focused topics** are the points that came back round because the
 * student flagged them or flopped them. Both are always shown — a week with
 * nothing to revisit still has a course to get through, and a week of pure
 * revision still sits somewhere on the spine. Showing only whichever lane
 * happened to be non-empty was the thing that made the week unreadable.
 *
 * Purely presentational: the plan, its coverage and the programme all arrive
 * from `useWeekPlan`, so every surface renders one answer.
 */
/**
 * Is this point core curriculum? `ai` is the pre-lanes value and has always
 * meant "generated, lane unknown" — it reads as core because presenting
 * unlabelled work as revision tells the student they flagged something they
 * never flagged.
 */
function isCoreLane(p: PlanPoint): boolean {
  return p.origin === "core" || p.origin === "ai";
}

export function ThisWeekPanel({
  plan,
  points,
  activity,
  coverage,
  roadmap,
  loading,
  weekStart,
  editable,
  isPast,
  showRationale,
  showCoverage,
  onRemove,
  onFocusAgain,
  onAddTricky,
  onRateTopics,
}: {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  loading: boolean;
  weekStart: string;
  editable: boolean;
  isPast: boolean;
  showRationale: boolean;
  showCoverage: boolean;
  onRemove: (specPointId: string) => void;
  onFocusAgain?: (point: PlanPoint) => void;
  onAddTricky?: () => void;
  /** Sends the student to the confidence board when they've rated nothing. */
  onRateTopics?: () => void;
}) {
  // The spine band this week sits in — the core topic, whether or not it still
  // has points outstanding.
  const band: PacingBand | null = useMemo(() => {
    const bands = roadmap?.bands ?? [];
    return (
      bands.find((b) => isTeachBand(b) && b.startWeek <= weekStart && b.endWeek >= weekStart) ??
      null
    );
  }, [roadmap, weekStart]);

  const topicProgress = band
    ? roadmap?.progress.find((t) => t.topicId === band.topicId)
    : undefined;
  const mastery = topicProgress?.points.length ? topicProgress.masteryPct : null;
  const covered = !!band && (roadmap?.coveredTopicIds ?? []).includes(band.topicId);

  /**
   * This week's share of the core topic, read off the band's own division
   * ({@link withWeeklyPoints}) rather than off the saved plan.
   *
   * The plan is a snapshot: it records what the programme said the day it was
   * written, so a topic re-rated afterwards leaves the card claiming there is
   * nothing outstanding in a topic with a term's work left in it. The programme
   * is the live answer to "what am I studying this week", so the card asks it —
   * and enriches each point with the plan's coverage and practice links where
   * the two agree.
   *
   * Only the band's own topic lands here. Core-lane points from *other* topics
   * used to be appended to this list, which put them on screen under the band's
   * heading — a point from Topic 3 presented as part of Topic 1. They get their
   * own blocks ({@link extraCore}) instead.
   */
  const coreThisWeek = useMemo(() => {
    const inPlan = new Map(points.map((p) => [p.spec_point_id, p]));
    const settled = new Set(
      (topicProgress?.points ?? []).filter((p) => p.mastery >= SETTLED_THRESHOLD).map((p) => p.id),
    );
    const out = (band?.pointsByWeek?.[weekStart] ?? [])
      .filter((r) => !settled.has(r.specPointId))
      .map((r) => ({
        id: r.specPointId,
        code: r.code,
        title: r.title,
        planned: inPlan.get(r.specPointId) ?? null,
      }));
    // Anything the saved plan filed under this topic that the week's share
    // doesn't mention — a plan written before bands carried their division, or a
    // point carried in from an earlier week of the same run.
    const shown = new Set(out.map((o) => o.id));
    for (const p of points) {
      if (!band || p.topic_id !== band.topicId) continue;
      if (isCoreLane(p) && !shown.has(p.spec_point_id)) {
        out.push({ id: p.spec_point_id, code: p.code, title: p.title, planned: p });
      }
    }
    return out;
  }, [band, weekStart, points, topicProgress]);

  // Split the plan by the lane each point was saved with. Plans written before
  // lanes existed carry `ai`; they join the core column rather than being hidden
  // in a nameless third list.
  const { focus, yours, extraCore } = useMemo(() => {
    const titleOf = new Map((roadmap?.progress ?? []).map((t) => [t.topicId, t.title]));
    const group = (list: PlanPoint[]) => {
      const m = new Map<string, { topicId: string; title: string; points: PlanPoint[] }>();
      for (const p of list) {
        const g = m.get(p.topic_id) ?? {
          topicId: p.topic_id,
          // The plan's own title first, then the programme's — a point whose
          // topic row didn't come back should still be filed under a name.
          title: p.topic_title ?? titleOf.get(p.topic_id) ?? "—",
          points: [],
        };
        g.points.push(p);
        m.set(p.topic_id, g);
      }
      return [...m.values()];
    };
    return {
      focus: group(points.filter((p) => p.origin === "focus")),
      yours: group(points.filter((p) => ["student", "tutor", "carried_over"].includes(p.origin))),
      // Core-lane work outside this week's band — a week planned without a
      // programme (no band at all), or a point carried in from another topic.
      // Rendered under its own topic, and never dropped: it used to vanish from
      // the panel entirely whenever there was no band to hang it on.
      extraCore: group(
        points.filter((p) => isCoreLane(p) && (!band || p.topic_id !== band.topicId)),
      ),
    };
  }, [points, roadmap, band]);

  const focusPointCount = focus.reduce((n, g) => n + g.points.length, 0);

  const masteryByPoint = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of roadmap?.progress ?? []) for (const p of t.points) m.set(p.id, p.mastery);
    return m;
  }, [roadmap]);

  /**
   * Mastery of the points actually listed, for the cards that show a *selection*
   * from a topic rather than the topic itself.
   *
   * The topic average was the wrong number here and read as a contradiction: a
   * strong topic with two shaky points in it showed "80% — how well it's
   * sticking" directly above the two points the student had just told us they
   * couldn't do. The bar should describe the work on the card.
   */
  const masteryOfPoints = (pts: PlanPoint[]): number | null => {
    const vals = pts
      .map((p) => masteryByPoint.get(p.spec_point_id))
      .filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };

  const nothingRated = (roadmap?.progress ?? []).every((t) =>
    t.points.every((p) => p.confidence == null),
  );

  const row = (p: PlanPoint) => {
    const a = activity.get(p.spec_point_id);
    const cov = coverage.get(p.spec_point_id);
    return (
      <div
        key={p.spec_point_id}
        className="group flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
      >
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{p.code}</span>
          <span className="text-sm">{p.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showCoverage && <CoveragePill status={statusOf(cov)} score={cov?.bestScore} />}
          {a?.hasHomework && (
            <PracticeLink
              to="/homework"
              label="Homework"
              icon={ClipboardList}
              done={showCoverage && !!cov?.homeworkDone}
              score={cov?.homeworkScore}
            />
          )}
          {a?.hasQuiz && (
            <PracticeLink
              to="/mcqs"
              label="Quiz"
              icon={ListChecks}
              done={showCoverage && !!cov?.quizDone}
              score={cov?.quizScore}
            />
          )}
          {isPast && onFocusAgain && (
            <button
              type="button"
              onClick={() => onFocusAgain(p)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-md premium-card text-[11px] font-medium text-muted-foreground hover:text-primary hover:border-primary/40"
              title="Focus on this again this week"
            >
              <RotateCcw className="w-3 h-3" /> Focus again
            </button>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => onRemove(p.spec_point_id)}
              className="w-6 h-6 rounded-md text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              aria-label="Remove from this week"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="py-10 text-center">
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showRationale && plan?.ai_rationale && (
        <div className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 p-3">
          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-foreground/90">{plan.ai_rationale}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 items-stretch">
        {/* Core topic — the curriculum, on schedule for the exam. */}
        <div className="h-full flex flex-col rounded-xl border border-primary/30 bg-primary/[0.05] p-4">
          <div className="flex items-center gap-1.5 mb-1">
            {covered ? (
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
            {band && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {fmtRange(band.startWeek, band.endWeek)}
              </span>
            )}
          </div>

          {band || extraCore.length > 0 ? (
            <div className="space-y-5">
              {band && (
                <TopicBlock title={band.title} mastery={mastery} accent="primary">
                  {coreThisWeek.length > 0 ? (
                    <SpecPointList count={coreThisWeek.length}>
                      {coreThisWeek.map((p) =>
                        p.planned ? (
                          row(p.planned)
                        ) : (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
                          >
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              {p.code}
                            </span>
                            <span className="text-sm flex-1 min-w-0">{p.title}</span>
                          </div>
                        ),
                      )}
                    </SpecPointList>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {covered
                        ? "Nothing outstanding here — you've covered this topic. It'll come back for a light review before the exam."
                        : "This topic's spec points are all covered for this week."}
                    </p>
                  )}
                </TopicBlock>
              )}
              {extraCore.map((g) => (
                <TopicBlock
                  key={g.topicId}
                  title={g.title}
                  mastery={masteryOfPoints(g.points)}
                  masteryLabel="How well these are sticking"
                  accent="primary"
                >
                  <SpecPointList count={g.points.length}>{g.points.map(row)}</SpecPointList>
                </TopicBlock>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No core topic scheduled this week.</p>
          )}
        </div>

        {/* Focused topics — what came back round. Same anatomy as the core card
            (topic, how well it's sticking, this week's spec points), repeated
            once per topic, so the two halves read as one idea in two colours. */}
        <div className="h-full flex flex-col rounded-xl premium-card p-4">
          <div className="flex items-center gap-1.5 mb-1">
            <Repeat className="w-3.5 h-3.5 text-rose-500" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
              Focused topics
            </span>
            {focus.length > 0 && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {focusPointCount} to revisit
              </span>
            )}
          </div>
          {focus.length > 0 ? (
            <div className="space-y-5">
              {focus.map((g) => (
                <TopicBlock
                  key={g.topicId}
                  title={g.title}
                  mastery={masteryOfPoints(g.points)}
                  masteryLabel="How well these are sticking"
                  accent="rose"
                >
                  <SpecPointList count={g.points.length}>{g.points.map(row)}</SpecPointList>
                </TopicBlock>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <p className="text-sm text-muted-foreground">
                {nothingRated && onRateTopics ? (
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

      {yours.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Added by you
            </span>
          </div>
          <div className="space-y-5">
            {yours.map((g) => (
              <TopicBlock
                key={g.topicId}
                title={g.title}
                mastery={masteryOfPoints(g.points)}
                masteryLabel="How well these are sticking"
                accent="muted"
              >
                <SpecPointList count={g.points.length}>{g.points.map(row)}</SpecPointList>
              </TopicBlock>
            ))}
          </div>
        </div>
      )}

      {editable && onAddTricky && (
        <button
          type="button"
          onClick={onAddTricky}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted"
        >
          <Plus className="w-4 h-4" /> Add what's tricky
        </button>
      )}
    </div>
  );
}

const BAR: Record<"primary" | "rose" | "muted", string> = {
  primary: "bg-primary",
  rose: "bg-rose-500",
  muted: "bg-muted-foreground/50",
};

/**
 * One topic as this panel presents it: its name, how well it's sticking, and
 * what it asks of the student this week. Both cards are built from this, so the
 * core topic and a focused topic read identically apart from their accent —
 * they're the same kind of thing, differing only in why they're on the list.
 */
function TopicBlock({
  title,
  mastery,
  masteryLabel = "How well it's sticking",
  accent,
  children,
}: {
  title: string;
  mastery: number | null;
  /** What the bar measures — the whole topic, or just the points listed here. */
  masteryLabel?: string;
  accent: "primary" | "rose" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-display text-lg font-semibold leading-snug">{title}</p>
      {mastery != null && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-muted-foreground">{masteryLabel}</span>
            <span className="font-semibold tabular-nums">{mastery}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${BAR[accent]}`}
              style={{ width: `${Math.max(2, mastery)}%` }}
            />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

/** The week's spec points under a topic, with the same heading everywhere. */
function SpecPointList({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          This week's spec points
        </h3>
        <span className="text-[11px] text-muted-foreground/70 tabular-nums">{count}</span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function PracticeLink({
  to,
  label,
  icon: Icon,
  done,
  score,
}: {
  to: string;
  label: string;
  icon: typeof ClipboardList;
  done: boolean;
  score?: number | null;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-medium ${
        done
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
          : "bg-card border-border text-muted-foreground hover:text-foreground"
      }`}
      title={done ? `${label} completed` : `${label} available`}
    >
      {done ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
      {label}
      {done && score != null && <span className="tabular-nums font-semibold">{score}%</span>}
    </Link>
  );
}

/** "13 Jul – 16 Aug" for a band's week keys. */
function fmtRange(startWeek: string, endWeek: string): string {
  const fmt = (k: string) =>
    weekKeyToDate(k).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${fmt(startWeek)} – ${fmt(endWeek)}`;
}
