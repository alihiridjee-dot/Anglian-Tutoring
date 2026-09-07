import type { WithheldPlanPoint } from "@/lib/weeklyPlanDal";
import type { PointCoverage } from "@/lib/planner/coverage";
import { describeReason } from "@/lib/planner/admissibility";

/** Saved history stays accessible, but never feeds the active checklist or carry. */
export function WithheldPlanPoints({
  points,
  coverage,
}: {
  points: WithheldPlanPoint[];
  coverage: Map<string, PointCoverage>;
}) {
  if (!points.length) return null;
  return (
    <details className="premium-card tint-slate rounded-xl p-4 my-4">
      <summary className="cursor-pointer text-sm font-bold">
        Saved work outside this week’s plan ({points.length})
      </summary>
      <p className="text-sm text-muted-foreground mt-2">
        These assignments are kept for reference. They do not count as unfinished work. Your
        submitted work and results are unchanged.
      </p>
      <ul className="space-y-3 mt-3">
        {points.map(({ point, reason }) => {
          const work = coverage.get(point.spec_point_id);
          return (
            <li key={point.spec_point_id} className="text-sm">
              <span className="font-bold">
                {point.code} · {point.title}
              </span>
              <span className="chip ml-2 text-xs">
                {point.done_at
                  ? "Completed"
                  : work?.attempted
                    ? "Attempted"
                    : point.carried_from
                      ? "Carried assignment"
                      : "Saved assignment"}
              </span>
              <p className="text-muted-foreground mt-1">Not assigned: {describeReason(reason)}.</p>
              {work?.bestScore != null && (
                <p className="mt-1">
                  Recorded score: <span className="numeral">{work.bestScore}%</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
