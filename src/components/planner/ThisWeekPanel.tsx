import { Spinner, EmptyState } from "@/components/Shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { currentWeekKey, plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";
import { type PlanPoint, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PointCoverage, type PointWorkItem } from "@/lib/planner/coverage";
import { reviewLock } from "@/lib/planner/reviewLock";
import { parseVideoUrl } from "@/lib/curriculum/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { type Activity } from "./useWeekPlan";
import { useWeekLanes } from "./useWeekLanes";
import { WeekPointRow } from "./WeekPointRow";
import { ReviewMoreStrip } from "./ReviewMoreStrip";
import { type ReviewMore } from "./useReviewMore";
import {
  NewLearningLane,
  ReturningLane,
  RevisionLane,
  WeekProgressCard,
  TutorLane,
  YoursLane,
} from "./ThisWeekLanes";

/**
 * "This week", as both the dashboard and the planner show it.
 *
 * Three distinct lanes: new learning, missed work returning, and revision.
 *
 * Purely presentational: the plan, its coverage and the programme all arrive
 * from `useWeekPlan`, so every surface renders one answer.
 */
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
  reviewMore,
  onSetExamDate,
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
  /** "Review more now", where the surface offers it (the current week). */
  reviewMore?: ReviewMore;
  /**
   * On the planner itself: open its Full plan tab, where the exam date is set.
   * "Set my exam date" links there too, but a link to the address already
   * open (`?tab=plan`) goes nowhere, so the planner switches the tab directly.
   */
  onSetExamDate?: () => void;
}) {
  // The video a Watch chip has opened, if any. Same modal the checklist uses —
  // a point's video plays where the student pressed it, not on another page.
  const [playing, setPlaying] = useState<PointWorkItem | null>(null);

  const {
    band,
    covered,
    coreThisWeek,
    focus,
    tutor,
    yours,
    extraCore,
    returning,
    focusPointCount,
    upcomingCatchUp,
    assigned,
    completed,
  } = useWeekLanes({ plan, points, activity, coverage, roadmap, weekStart });

  const row = (p: PlanPoint) => (
    <WeekPointRow
      key={p.spec_point_id}
      p={p}
      activity={activity}
      coverage={coverage}
      roadmap={roadmap}
      weekStart={weekStart}
      isPast={isPast}
      showCoverage={showCoverage}
      onFocusAgain={onFocusAgain}
      onPlay={setPlaying}
    />
  );

  if (loading) {
    return <Spinner className="py-10" />;
  }

  const embed = playing ? parseVideoUrl(playing.videoUrl) : null;
  const isFuture = weekStart > currentWeekKey();

  return (
    <div className="space-y-4">
      {points.length === 0 &&
        (roadmap && weekStart >= roadmap.examDate ? (
          // Nothing is ever planned at or after the exam date. Said so, with the
          // way forward: the old copy told the student to wait for a review that
          // could never come.
          <div className="space-y-3">
            <EmptyState
              mascot="owl"
              title="Your exam date has passed"
              body="Nothing is planned after your exams. Set your next exam date and your plan carries on from there."
            />
            <div className="text-center">
              {isDemoStudent() ? (
                <Link
                  to="/demo/student/planner"
                  className="btn-soft inline-flex min-h-11 items-center rounded-xl px-5 py-2.5 text-sm sm:pointer-fine:min-h-0"
                >
                  Set my exam date
                </Link>
              ) : (
                <Link
                  to="/planner"
                  search={{ tab: "plan" }}
                  onClick={onSetExamDate}
                  className="btn-soft inline-flex min-h-11 items-center rounded-xl px-5 py-2.5 text-sm sm:pointer-fine:min-h-0"
                >
                  Set my exam date
                </Link>
              )}
            </div>
          </div>
        ) : roadmap && weekStart < roadmap.programStart ? (
          // A first visit at the weekend starts the programme next Monday.
          <EmptyState
            title={`Your plan starts ${plannerDateLabel(weekKeyToDate(roadmap.programStart))}`}
            body="Your first week of work is being lined up. Nothing is set before then."
          />
        ) : (
          <EmptyState
            title={
              upcomingCatchUp
                ? "Upcoming week preview"
                : isFuture
                  ? "Not built yet"
                  : "Nothing assigned this week"
            }
            body={
              upcomingCatchUp
                ? "The catch-up estimate below will be confirmed when this week arrives. It assumes earlier work is completed."
                : isFuture
                  ? "This week fills itself from your course plan when it comes round."
                  : "Your next review will appear when it is eligible. There is no extra practice to complete here today."
            }
          />
        ))}
      {showCoverage && assigned.length > 0 && (
        <WeekProgressCard
          assigned={assigned}
          completed={completed}
          lock={reviewLock({
            weekStart,
            entries: points.map((p) => ({
              coverage: coverage.get(p.spec_point_id),
              activity: activity.get(p.spec_point_id),
            })),
          })}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3 items-stretch">
        <NewLearningLane
          band={band}
          covered={covered}
          coreThisWeek={coreThisWeek}
          extraCore={extraCore}
          row={row}
        />
        <ReturningLane
          returning={returning}
          upcomingCatchUp={upcomingCatchUp}
          roadmap={roadmap}
          weekStart={weekStart}
          row={row}
        />
        <RevisionLane focus={focus} focusPointCount={focusPointCount} row={row} />
      </div>

      {/* Why the week is what it is — the catch-up queue, what the tutor set
          aside. Written at every cut and, until now, shown only in the demo. */}
      {plan?.ai_rationale && !isPast && (
        <p className="flex items-start gap-2 text-sm leading-relaxed">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-[color:var(--tint)]" aria-hidden />
          <span>{plan.ai_rationale}</span>
        </p>
      )}

      {reviewMore && <ReviewMoreStrip more={reviewMore} />}

      {tutor.length > 0 && <TutorLane tutor={tutor} row={row} />}
      {yours.length > 0 && <YoursLane yours={yours} row={row} />}

      {playing && embed && (
        <VideoModal embed={embed} title={playing.title} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}
