import { PauseCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
  // Recorded only once a break is over, so never the stop in force.
  break: "On a break",
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: PLANNER_TIME_ZONE,
  });

/**
 * In place of a week, for a subject that is stopped. Nothing is planned while
 * it is, so there is nothing else to show: no empty lanes, and no sentence
 * explaining them. Just what stopped and since when.
 */
export function PausedWeek({
  subject,
  pause,
  canManage = false,
  past,
}: {
  subject: string;
  pause: SubjectPause;
  /** The student's own view: every reason here is settled on their billing page. */
  canManage?: boolean;
  /**
   * A week gone by inside the stop, rather than the stop in force: said in the
   * past tense, with when it ended. `endedAt` null means it still stands.
   */
  past?: { endedAt: string | null };
}) {
  const since = day(pause.startedAt);
  return (
    <div className="tint-amber flex flex-col items-center gap-2.5 py-6 text-center">
      <span className="icon-tile inline-flex w-11 h-11">
        <PauseCircle className="w-5 h-5" />
      </span>
      <h3 className="text-base font-bold">
        {subjectLabel(subject)} {past ? "was" : "is"} paused
      </h3>
      <div className="flex flex-wrap justify-center gap-1.5">
        <span className="chip">{WHY[pause.reason]}</span>
        <span className="chip">
          {past?.endedAt ? `${since} – ${day(past.endedAt)}` : `Since ${since}`}
        </span>
      </div>
      {canManage && (
        <Link
          to="/billing"
          className="btn-soft mt-2 inline-flex min-h-11 items-center rounded-xl px-5 py-2.5 text-sm sm:pointer-fine:min-h-0"
        >
          Manage my plan
        </Link>
      )}
    </div>
  );
}
