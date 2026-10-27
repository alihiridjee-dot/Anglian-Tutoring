import { useState } from "react";
import { toast } from "sonner";
import {
  MAX_WEEK_POINTS,
  WeeklyPlanDAL,
  type PlanPoint,
  type WeeklyPlan,
} from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { indexOverrides, programmeMayAssign } from "@/lib/planner/overrides";
import { spineReach } from "@/lib/planner/admissibility";

/** How many waiting reviews one press of "Review more now" pulls into the week. */
export const REVIEW_MORE_BATCH = 10;

export { MAX_WEEK_POINTS };

/**
 * "Review more now": pull the next reviews that are due but waiting — the ones
 * this week's review budget pushed into later weeks — into this week, oldest
 * due first, as ordinary reviews. A week holds about three times its teaching
 * in reviews, so a student back after weeks away isn't met with a wall of
 * them; this is how a student who wants to keep going is never told to stop.
 *
 * Never pulls a week past what it can save. Offered only on the current week.
 */
export function useReviewMore(params: {
  plan: WeeklyPlan | null;
  points: PlanPoint[];
  roadmap: RoadmapResult | null;
  isCurrent: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const weekStart = params.plan?.week_start ?? "";
  const overrides = indexOverrides(params.roadmap?.overrides);
  const reach = spineReach(params.roadmap?.baselineBands ?? [], true);
  // Only reviews this week may actually hold: not ones the tutor took out of
  // it, and not ones for a topic the programme has not opened yet. Offering
  // those read "10 more ready", then "0 added", for ever.
  const waiting = params.isCurrent
    ? (params.roadmap?.reviewsWaiting ?? []).filter(
        (c) =>
          programmeMayAssign(
            overrides,
            { specPointId: c.specPointId, origin: "focus" },
            weekStart,
          ) && !((reach.get(c.topicId) ?? "") > weekStart),
      )
    : [];
  const room = Math.max(0, MAX_WEEK_POINTS - params.points.length);
  const next = waiting.slice(0, Math.min(REVIEW_MORE_BATCH, room));

  const pull = async () => {
    if (!params.plan || next.length === 0) return;
    setBusy(true);
    try {
      const added = await WeeklyPlanDAL.addPoints(
        params.plan.id,
        next.map((c) => c.specPointId),
        "focus",
      );
      await params.reload();
      if (added === 0) toast.error("Those reviews can't be added to this week right now.");
      else toast.success(`${added} more ${added === 1 ? "review" : "reviews"} added to this week`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add more reviews");
    } finally {
      setBusy(false);
    }
  };

  return {
    /** Due now, but in a later week. */
    waiting: waiting.length,
    /** How many one press adds. */
    batch: next.length,
    available: !!params.plan && next.length > 0,
    busy,
    pull,
  };
}

export type ReviewMore = ReturnType<typeof useReviewMore>;
