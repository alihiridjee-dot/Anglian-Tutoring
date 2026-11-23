import { PlannerPointItem } from "./PlannerPointItem";
import { plannerDateLabel, weekKeyToDate } from "@/lib/planner/week";
import { mondayKeyOf } from "@/lib/planner/breaks";
import { RotateCcw } from "lucide-react";
import { type PlanPoint } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { mondayOnOrAfter } from "@/lib/planner/pacing";
import {
  type PointCoverage,
  type PointWorkItem,
  statusOfPoint,
  workItems,
} from "@/lib/planner/coverage";
import { CoveragePill } from "./CoveragePill";
import { WorkChips } from "./WorkChips";
import { type Activity } from "./useWeekPlan";

/** One spec point in a lane of "This week": its status, its work, and when it next comes round. */
export function WeekPointRow({
  p,
  activity,
  coverage,
  roadmap,
  weekStart,
  isPast,
  showCoverage,
  onFocusAgain,
  onPlay,
}: {
  p: PlanPoint;
  activity: Activity;
  coverage: Map<string, PointCoverage>;
  roadmap: RoadmapResult | null;
  weekStart: string;
  isPast: boolean;
  showCoverage: boolean;
  onFocusAgain?: (point: PlanPoint) => void;
  onPlay: (item: PointWorkItem) => void;
}) {
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
      {nextReview && (
        <p className="text-sm">
          {roadmap && nextReview >= weekKeyToDate(mondayKeyOf(roadmap.examDate))
            ? "Next memory review falls beyond this exam period."
            : `Next review from ${plannerDateLabel(nextReview)}. It is added to your week when it comes round.`}
        </p>
      )}
      {p.carried_from && (
        <span className="chip text-[11px]">
          <RotateCcw className="size-3" />
          Carried from an earlier week
        </span>
      )}
      {(hasPractice || workItems(work).length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <WorkChips work={work} coverage={showCoverage ? cov : null} onPlay={onPlay} />
          {hasPractice && isPast && onFocusAgain && (
            <button
              type="button"
              onClick={() => onFocusAgain(p)}
              className="chip tap-target text-xs"
            >
              <RotateCcw className="size-3" />
              Focus again
            </button>
          )}
        </div>
      )}
    </PlannerPointItem>
  );
}
