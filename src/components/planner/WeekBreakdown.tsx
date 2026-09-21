import type { PlanPoint } from "@/lib/planner/weeklyPlanDal";
import type { RoadmapResult } from "@/lib/planner/programDal";
import { laneOf } from "@/lib/planner/coverage";

export function WeekBreakdown({
  points,
  roadmap,
  weekStart,
  id,
}: {
  points: PlanPoint[];
  roadmap: RoadmapResult | null;
  weekStart: string;
  id: string;
}) {
  const focusPointCount = points.filter((p) => laneOf(p.origin) === "focus").length;
  const returningIds = new Set([
    ...(roadmap?.catchUpSchedule?.weeks[weekStart] ?? []).map((p) => p.specPointId),
    ...(roadmap?.backlog ?? []).filter((p) => p.plannedWeek < weekStart).map((p) => p.specPointId),
  ]);
  const returningCount = points.filter(
    (p) => laneOf(p.origin) === "core" && (returningIds.has(p.spec_point_id) || p.carried_from),
  ).length;
  const learningCount = points.filter((p) => laneOf(p.origin) === "core").length - returningCount;
  const manualCount = points.filter((p) => laneOf(p.origin) === "yours").length;
  return (
    <div id={id} className="flex items-center">
      <dl aria-label="Week breakdown" className="premium-card week-breakdown flex items-stretch">
        {[
          {
            label: "Revision",
            count: focusPointCount,
            tint: "tint-rose",
            description: "Revision of earlier learning, scheduled from your assessed practice.",
          },
          {
            label: "New",
            count: learningCount,
            tint: "tint-primary",
            description: "New learning assigned from your course timetable this week.",
          },
          {
            label: "Returning",
            count: returningCount,
            tint: "tint-amber",
            description:
              "Unfinished points from earlier weeks, brought back into this week’s plan.",
          },
          ...(manualCount
            ? [
                {
                  label: "Added by you",
                  count: manualCount,
                  tint: "tint-slate",
                  description: "Points you added to your plan for extra practice.",
                },
              ]
            : []),
        ].map((item) => (
          <div
            key={item.label}
            title={item.description}
            aria-description={item.description}
            tabIndex={0}
            className={`${item.tint} chip flex items-center gap-1.5 px-3 py-0 text-sm font-medium`}
          >
            <dt className="text-sm font-medium">{item.label}</dt>
            <dd className="order-first numeral text-sm">{item.count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
