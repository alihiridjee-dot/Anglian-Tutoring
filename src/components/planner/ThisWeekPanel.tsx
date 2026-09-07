import { PLANNER_TIME_ZONE } from "@/lib/week";
import { Spinner, Meter, EmptyState } from "@/components/Shared";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  CircleDot,
  CheckCircle2,
  ClipboardList,
  ListChecks,
  Plus,
  X,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { type PlanPoint, type WeeklyPlan } from "@/lib/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/programDal";
import { isTeachBand, mondayOnOrAfter, type PacingBand } from "@/lib/planner/pacing";
import { type PointCoverage, statusOfPoint, laneOf } from "@/lib/planner/coverage";
import { weekKeyToDate } from "@/lib/week";
import { CoveragePill } from "./CoveragePill";
import { FocusedTopicsLabel } from "./FocusLane";
import { type Activity } from "./useWeekPlan";

/**
 * "This week", as both the dashboard and the planner show it.
 *
 * Two cards, the same two the roadmap uses, because they are the same two ideas:
 * the **core topic** is the curriculum marching through the year toward the
 * exam, and **focused topics** are the points that came back round because the
 * assessment history makes them eligible for review. Both are always shown — a week with
 * nothing to revisit still has a course to get through, and a week of pure
 * revision still sits somewhere on the spine. Showing only whichever lane
 * happened to be non-empty was the thing that made the week unreadable.
 *
 * Purely presentational: the plan, its coverage and the programme all arrive
 * from `useWeekPlan`, so every surface renders one answer.
 */
/** Is this point core curriculum? See {@link laneOf} for what `ai` means. */
function isCoreLane(p: PlanPoint): boolean {
  return laneOf(p.origin) === "core";
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

  const covered = !!band && (roadmap?.coveredTopicIds ?? []).includes(band.topicId);

  // The saved assignment is authoritative; roadmap points are never added here.
  const coreThisWeek = useMemo(
    () => points.filter((p) => isCoreLane(p) && p.topic_id === band?.topicId),
    [points, band],
  );

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
      focus: group(points.filter((p) => laneOf(p.origin) === "focus")),
      yours: group(points.filter((p) => laneOf(p.origin) === "yours")),
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

  const assigned = points.filter((p) => {
    const a = activity.get(p.spec_point_id);
    return a?.hasHomework || a?.hasQuiz;
  });
  const completed = assigned.filter((p) => {
    const a = activity.get(p.spec_point_id);
    const c = coverage.get(p.spec_point_id);
    return (!a?.hasHomework || c?.homeworkDone) && (!a?.hasQuiz || c?.quizDone);
  }).length;
  const next = assigned.find((p) => {
    const a = activity.get(p.spec_point_id);
    const c = coverage.get(p.spec_point_id);
    return (a?.hasHomework && !c?.homeworkDone) || (a?.hasQuiz && !c?.quizDone);
  });

  const row = (p: PlanPoint) => {
    const a = activity.get(p.spec_point_id);
    const cov = coverage.get(p.spec_point_id);
    const progress = roadmap?.progress
      .flatMap((t) => t.points)
      .find((point) => point.id === p.spec_point_id);
    const nextReview =
      progress?.eligibleAt &&
      progress.lastReviewedAt &&
      new Date(progress.lastReviewedAt) >= weekKeyToDate(weekStart)
        ? mondayOnOrAfter(new Date(progress.eligibleAt))
        : null;
    if (!a?.hasHomework && !a?.hasQuiz)
      return (
        <details key={p.spec_point_id} className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">{p.title} · practice not attached yet</summary>
          <p className="mt-1">
            Your tutor can attach practice to this curriculum point. It does not count as unfinished
            practice.
          </p>
          {editable && (
            <button
              className="btn-premium px-2 py-1 text-xs mt-2"
              onClick={() => onRemove(p.spec_point_id)}
            >
              Remove from this week
            </button>
          )}
        </details>
      );
    return (
      <div
        key={p.spec_point_id}
        className="group flex items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 py-2"
      >
        <div className="flex-1 min-w-0">
          <span className="text-[11px] font-semibold text-muted-foreground mr-1.5">{p.code}</span>
          <span className="text-sm">{p.title}</span>
          {nextReview && (
            <p className="text-xs text-muted-foreground mt-1">
              {roadmap && nextReview >= weekKeyToDate(roadmap.examDate)
                ? "Next memory review falls beyond this exam period."
                : `Next review eligible from ${nextReview.toLocaleDateString(undefined, { timeZone: PLANNER_TIME_ZONE, day: "numeric", month: "short" })}; assigned at the next weekly opening before the exam.`}
            </p>
          )}
          {p.carried_from && (
            <span
              className="ml-1.5 inline-flex items-center gap-1 align-middle h-5 px-1.5 rounded-md bg-muted text-[10px] font-medium text-muted-foreground"
              title="Carried over from last week — it stays in this lane"
            >
              <RotateCcw className="w-2.5 h-2.5" /> Carried
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {showCoverage && <CoveragePill status={statusOfPoint(cov, a)} score={cov?.bestScore} />}
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
    return <Spinner className="py-10" />;
  }

  return (
    <div className="space-y-4">
      {points.length === 0 && (
        <EmptyState
          title="Nothing assigned this week"
          body="Your next review will appear when it is eligible. There is no extra practice to complete here today."
        />
      )}
      {showCoverage && assigned.length > 0 && (
        <div className="premium-card tint-primary rounded-xl p-4 space-y-2">
          <h3 className="text-base font-bold">
            {completed === assigned.length
              ? "This week’s assigned practice is complete"
              : `${completed} of ${assigned.length} points practised`}
          </h3>
          <Meter value={(completed / assigned.length) * 100} size="sm" />
          {next && (
            <Link
              className="btn-solid inline-flex px-3 py-2 text-sm"
              to={
                activity.get(next.spec_point_id)?.hasHomework &&
                !coverage.get(next.spec_point_id)?.homeworkDone
                  ? "/homework"
                  : "/mcqs"
              }
            >
              Next: {next.title}
            </Link>
          )}
          {completed === assigned.length && (
            <p className="text-sm text-muted-foreground">
              Your results will guide future reviews. You can finish here for this week.
            </p>
          )}
        </div>
      )}
      {showRationale && plan?.ai_rationale && !/flagged|confidence/i.test(plan.ai_rationale) && (
        <div className="flex items-start gap-2 rounded-xl bg-primary/5 border border-primary/15 p-3">
          <Sparkles className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-foreground/90">{plan.ai_rationale}</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 items-stretch">
        {/* Core topic — the curriculum, on schedule for the exam. */}
        <div className="h-full flex flex-col rounded-xl premium-card tint-primary p-4">
          <div className="flex items-center gap-1.5 mb-1">
            {covered ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="eyebrow eyebrow-bare tint-emerald">Core topic · covered</span>
              </>
            ) : (
              <>
                <CircleDot className="w-3.5 h-3.5 text-primary" />
                <span className="eyebrow eyebrow-bare">Core topic</span>
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
                <TopicBlock title={band.title} accent="primary">
                  {coreThisWeek.length > 0 ? (
                    <SpecPointList count={coreThisWeek.length}>
                      {coreThisWeek.map(row)}
                    </SpecPointList>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {covered
                        ? "No new learning is assigned here this week."
                        : "No new learning is assigned here this week."}
                    </p>
                  )}
                </TopicBlock>
              )}
              {extraCore.map((g) => (
                <TopicBlock key={g.topicId} title={g.title} accent="primary">
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
            <FocusedTopicsLabel className="eyebrow eyebrow-bare tint-rose" />
            {focus.length > 0 && (
              <span className="ml-auto text-[11px] text-muted-foreground">
                {focusPointCount} to revisit
              </span>
            )}
          </div>
          {focus.length > 0 ? (
            <div className="space-y-5">
              {focus.map((g) => (
                <TopicBlock key={g.topicId} title={g.title} accent="rose">
                  <SpecPointList count={g.points.length}>{g.points.map(row)}</SpecPointList>
                </TopicBlock>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center">
              <p className="text-sm text-muted-foreground">
                No reviews assigned this week. Future reviews follow your assessed practice.
              </p>
            </div>
          )}
        </div>
      </div>

      {yours.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Plus className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="eyebrow eyebrow-bare tint-slate">Added by you</span>
          </div>
          <div className="space-y-5">
            {yours.map((g) => (
              <TopicBlock key={g.topicId} title={g.title} accent="muted">
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

function TopicBlock({
  title,
  children,
}: {
  title: string;
  accent: "primary" | "rose" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-lg font-bold leading-snug">{title}</h3>
      {children}
    </div>
  );
}

/** The week's spec points under a topic, with the same heading everywhere. */
function SpecPointList({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <details className="mt-3" open={count <= 3}>
      <summary className="cursor-pointer text-sm font-bold">
        {count} curriculum {count === 1 ? "point" : "points"}
      </summary>
      <div className="space-y-1.5 mt-2">{children}</div>
    </details>
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
      className={`chip inline-flex text-[11px] hover:brightness-95 ${done ? "tint-emerald" : ""}`}
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
    weekKeyToDate(k).toLocaleDateString(undefined, {
      timeZone: PLANNER_TIME_ZONE,
      day: "numeric",
      month: "short",
    });
  return `${fmt(startWeek)} – ${fmt(endWeek)}`;
}
