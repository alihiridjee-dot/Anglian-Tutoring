import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { PlannerPointItem } from "./PlannerPointItem";
import { EmptyRevision } from "./EmptyRevision";
import { CatchUpWeek } from "./CatchUpWeek";
import { currentWeekKey, PLANNER_TIME_ZONE } from "@/lib/week";
import { Spinner, Meter, EmptyState } from "@/components/Shared";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleDot, Repeat, CheckCircle2, Plus, RotateCcw } from "lucide-react";
import { type PlanPoint, type WeeklyPlan } from "@/lib/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/programDal";
import { isTeachBand, mondayOnOrAfter, type PacingBand } from "@/lib/planner/pacing";
import {
  type PointCoverage,
  type PointWorkItem,
  statusOfPoint,
  laneOf,
} from "@/lib/planner/coverage";
import { weekKeyToDate } from "@/lib/week";
import { parseVideoUrl } from "@/lib/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { CoveragePill } from "./CoveragePill";
import { WorkChips } from "./WorkChips";
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
  isPast,
  showCoverage,
  onFocusAgain,
}: {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  loading: boolean;
  weekStart: string;
  isPast: boolean;
  showCoverage: boolean;
  onFocusAgain?: (point: PlanPoint) => void;
}) {
  // The video a Watch chip has opened, if any. Same modal the checklist uses —
  // a point's video plays where the student pressed it, not on another page.
  const [playing, setPlaying] = useState<PointWorkItem | null>(null);

  // The spine band this week sits in — the core topic, whether or not it still
  // has points outstanding.
  const band: PacingBand | null = useMemo(() => {
    const bands = roadmap?.baselineBands ?? [];
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
  const returningIds = new Set([
    ...(roadmap?.catchUpSchedule?.weeks[weekStart] ?? []).map((p) => p.specPointId),
    ...(roadmap?.backlog ?? []).filter((p) => p.plannedWeek < weekStart).map((p) => p.specPointId),
  ]);
  const upcomingCatchUp =
    !plan && weekStart > currentWeekKey() && !!roadmap?.catchUpSchedule?.weeks[weekStart]?.length;

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
    const work = activity.get(p.spec_point_id);
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
    const hasPractice = !!(work?.hasHomework || work?.hasQuiz);
    return (
      <PlannerPointItem
        key={p.spec_point_id}
        code={p.code}
        title={p.title}
        status={
          !hasPractice ? (
            <span className="chip tint-slate text-[11px]">Practice not attached</span>
          ) : showCoverage ? (
            <CoveragePill status={statusOfPoint(cov, work)} score={cov?.bestScore} />
          ) : undefined
        }
      >
        {!hasPractice && (
          <p className="text-muted-foreground">
            Your tutor can attach practice to this point. It does not count as unfinished practice.
          </p>
        )}
        {nextReview && (
          <p className="text-sm text-muted-foreground">
            {roadmap && nextReview >= weekKeyToDate(roadmap.examDate)
              ? "Next memory review falls beyond this exam period."
              : `Next review eligible from ${nextReview.toLocaleDateString(undefined, { timeZone: PLANNER_TIME_ZONE, day: "numeric", month: "short" })}. It will be assigned at the next weekly opening.`}
          </p>
        )}
        {p.carried_from && (
          <span className="chip text-[11px]">
            <RotateCcw className="size-3" />
            Carried from an earlier week
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <WorkChips work={work} coverage={showCoverage ? cov : null} onPlay={setPlaying} />
          {hasPractice && isPast && onFocusAgain && (
            <button type="button" onClick={() => onFocusAgain(p)} className="chip text-xs">
              <RotateCcw className="size-3" />
              Focus again
            </button>
          )}
        </div>
      </PlannerPointItem>
    );
  };

  if (loading) {
    return <Spinner className="py-10" />;
  }

  const embed = playing ? parseVideoUrl(playing.videoUrl) : null;

  return (
    <div className="space-y-4">
      {points.length === 0 && (
        <EmptyState
          title={upcomingCatchUp ? "Upcoming week preview" : "Nothing assigned this week"}
          body={
            upcomingCatchUp
              ? "The catch-up estimate below will be confirmed when this week arrives. It assumes earlier work is completed."
              : "Your next review will appear when it is eligible. There is no extra practice to complete here today."
          }
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

      <div className="grid gap-4 md:grid-cols-2 items-start">
        {/* Core topic — the curriculum, on schedule for the exam. */}
        <div className="h-full flex flex-col rounded-xl premium-card tint-primary p-4">
          <div className="flex items-center gap-1.5 mb-1">
            {covered ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="eyebrow eyebrow-bare text-xs tint-emerald">
                  New learning · covered
                </span>
              </>
            ) : (
              <>
                <CircleDot className="w-3.5 h-3.5 text-primary" />
                <span className="eyebrow eyebrow-bare text-xs">New learning</span>
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
                    <SpecPointList>{coreThisWeek.map(row)}</SpecPointList>
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
                <div key={g.topicId} className="border-t border-border pt-4 tint-amber">
                  {g.points.some((p) => returningIds.has(p.spec_point_id)) && (
                    <p className="eyebrow eyebrow-bare text-xs mb-3">Missed work returning</p>
                  )}
                  <TopicBlock
                    title={g.title}
                    accent="primary"
                    header={
                      g.points.some((p) => returningIds.has(p.spec_point_id)) ? (
                        <ReturningTopicInfo
                          title={g.title}
                          points={(
                            roadmap?.catchUpSchedule?.weeks[weekStart] ??
                            roadmap?.backlog ??
                            []
                          ).filter((p) =>
                            g.points.some((point) => point.spec_point_id === p.specPointId),
                          )}
                        />
                      ) : undefined
                    }
                  >
                    <SpecPointList>{g.points.map(row)}</SpecPointList>
                  </TopicBlock>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No core topic scheduled this week.</p>
          )}
          {upcomingCatchUp && (
            <CatchUpWeek schedule={roadmap?.catchUpSchedule} weekStart={weekStart} />
          )}
        </div>

        {/* Focused topics — what came back round. Same anatomy as the core card
            (topic, how well it's sticking, this week's spec points), repeated
            once per topic, so the two halves read as one idea in two colours. */}
        <div className="rounded-xl premium-card tint-rose p-4">
          {focus.length > 0 ? (
            <>
              <p className="eyebrow eyebrow-bare text-xs flex items-center gap-2 mb-3">
                <Repeat className="size-4" />
                Revision<span className="chip ml-auto text-xs">{focusPointCount} points</span>
              </p>
              <div className="space-y-5">
                {focus.map((g) => (
                  <TopicBlock key={g.topicId} title={g.title} accent="rose">
                    <SpecPointList>{g.points.map(row)}</SpecPointList>
                  </TopicBlock>
                ))}
              </div>
            </>
          ) : (
            <EmptyRevision isPast={isPast} />
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
                <SpecPointList>{g.points.map(row)}</SpecPointList>
              </TopicBlock>
            ))}
          </div>
        </div>
      )}

      {playing && embed && (
        <VideoModal embed={embed} title={playing.title} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}

function TopicBlock({
  title,
  children,
  header,
}: {
  title: string;
  accent: "primary" | "rose" | "muted";
  children: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div>
      {header ?? <h3 className="text-base font-bold leading-snug">{title}</h3>}
      {children}
    </div>
  );
}

/** The week's spec points stay visible directly beneath their topic. */
function SpecPointList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 mt-3">{children}</div>;
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
