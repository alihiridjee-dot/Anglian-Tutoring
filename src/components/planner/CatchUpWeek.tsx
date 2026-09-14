import { PlannerPointItem } from "./PlannerPointItem";
import { ReturningTopicInfo } from "./ReturningTopicInfo";
import { byTopic, type CatchUpSchedule } from "@/lib/planner/backlog";

/** The same catch-up allocation used when the current week is saved. */
export function CatchUpWeek({
  schedule,
  weekStart,
}: {
  schedule?: CatchUpSchedule;
  weekStart: string;
}) {
  const groups = byTopic(schedule?.weeks[weekStart] ?? []);
  if (!groups.length) return null;
  const assigned = new Set(schedule?.assignedIds ?? []);
  return (
    <div className="mt-4 space-y-4 tint-amber">
      {groups.map((topic) => {
        const estimated = !topic.points.every((p) => assigned.has(p.specPointId));
        return (
          <div key={topic.topicId} className="space-y-3">
            <span className="chip text-xs">Catch-up · {estimated ? "Estimated" : "Assigned"}</span>
            <ReturningTopicInfo
              title={topic.topicTitle}
              points={topic.points}
              estimated={estimated}
            />
            <ul className="mt-3 space-y-1.5">
              {topic.points.map((point) => (
                <li key={point.specPointId}>
                  <PlannerPointItem code={point.code} title={point.title}>
                    <p className="text-muted-foreground">
                      {estimated ? "Expected" : "Assigned"} in this week’s catch-up allocation.
                    </p>
                  </PlannerPointItem>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
