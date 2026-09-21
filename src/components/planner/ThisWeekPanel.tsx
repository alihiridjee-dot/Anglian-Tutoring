import { Spinner, EmptyState } from "@/components/Shared";
import { useState } from "react";
import { type PlanPoint, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type PointCoverage, type PointWorkItem } from "@/lib/planner/coverage";
import { parseVideoUrl } from "@/lib/curriculum/videoEmbed";
import { VideoModal } from "@/components/VideoPlayer";
import { type Activity } from "./useWeekPlan";
import { useWeekLanes } from "./useWeekLanes";
import { WeekPointRow } from "./WeekPointRow";
import {
  NewLearningLane,
  ReturningLane,
  RevisionLane,
  WeekProgressCard,
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

  const {
    band,
    covered,
    coreThisWeek,
    focus,
    yours,
    extraCore,
    returning,
    focusPointCount,
    upcomingCatchUp,
    assigned,
    completed,
    next,
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
        <WeekProgressCard
          assigned={assigned}
          completed={completed}
          next={next}
          activity={activity}
          coverage={coverage}
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

      {yours.length > 0 && <YoursLane yours={yours} row={row} />}

      {playing && embed && (
        <VideoModal embed={embed} title={playing.title} onClose={() => setPlaying(null)} />
      )}
    </div>
  );
}
