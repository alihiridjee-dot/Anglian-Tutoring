import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TreePalm } from "lucide-react";
import { studentBreaksQuery } from "@/lib/planner/breakQueries";
import { backOn, breakDay, breakReasonLabel } from "@/lib/planner/breaks";
import { currentWeekKey } from "@/lib/planner/week";

/**
 * A child's break, on the parent's dashboard.
 *
 * While a break runs no weekly work is set, so "This week" has nothing to show
 * and the trends go quiet; this says why rather than leaving the page to look
 * as though the child stopped. A break still to come shows too, so a parent
 * sees one the child or a tutor booked. It is changed on Billing, where it was
 * booked.
 */
export function ChildBreakCard({ childId, childName }: { childId: string; childName: string }) {
  const { data: breaks = [] } = useQuery(studentBreaksQuery(childId));
  const thisWeek = currentWeekKey();
  const next = breaks.find((b) => b.endsOn >= thisWeek);
  if (!next) return null;
  const underWay = next.startsOn <= thisWeek;

  return (
    <section className="tint-accent premium-card rounded-2xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="icon-tile size-10 shrink-0">
          <TreePalm className="size-5" />
        </span>
        <h2 className="min-w-0 flex-1 text-lg leading-tight">
          {underWay ? `${childName} is on a break` : `${childName} has a break booked`}
        </h2>
        <Link
          to="/billing"
          className="btn-soft inline-flex h-11 items-center rounded-lg px-3.5 text-sm sm:pointer-fine:h-9"
        >
          Change it
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="chip">{breakReasonLabel(next.reason)}</span>
        <span className="chip">
          {underWay
            ? `Back ${breakDay(backOn(next))}`
            : `${breakDay(next.startsOn)} – ${breakDay(next.endsOn)}`}
        </span>
      </div>
    </section>
  );
}
