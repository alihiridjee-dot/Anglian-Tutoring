import { PauseCircle } from "lucide-react";
import { subjectLabel } from "@/lib/curriculum/courseSummary";
import { PLANNER_TIME_ZONE } from "@/lib/planner/week";
import type { PauseReason, SubjectPause } from "@/lib/planner/subjectPauses";

/** Why the subject is stopped, as a chip. */
const WHY: Record<PauseReason, string> = {
  paused: "Plan on hold",
  payment: "Payment due",
  cancelled: "Plan ended",
  subject_removed: "Removed from the plan",
  not_on_plan: "Not on the plan",
};

/**
 * In place of a week, for a subject that is stopped. Nothing is planned while
 * it is, so there is nothing else to show: no empty lanes, and no sentence
 * explaining them. Just what stopped and since when.
 */
export function PausedWeek({ subject, pause }: { subject: string; pause: SubjectPause }) {
  const since = new Date(pause.startedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: PLANNER_TIME_ZONE,
  });
  return (
    <div className="tint-amber flex flex-col items-center gap-2.5 py-6 text-center">
      <span className="icon-tile inline-flex w-11 h-11">
        <PauseCircle className="w-5 h-5" />
      </span>
      <h3 className="text-base">{subjectLabel(subject)} is paused</h3>
      <div className="flex flex-wrap justify-center gap-1.5">
        <span className="chip">{WHY[pause.reason]}</span>
        <span className="chip">Since {since}</span>
      </div>
    </div>
  );
}
