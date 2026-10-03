import { useState } from "react";
import { toast } from "sonner";
import { WeeklyPlanDAL, type PlanPoint, type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { type RoadmapResult } from "@/lib/planner/roadmap";

/** How many waiting reviews one press of "Review more now" pulls into the week. */
export const REVIEW_MORE_BATCH = 10;

/** `save_weekly_plan` refuses a week holding more spec points than this. */
export const MAX_WEEK_POINTS = 200;

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
  const waiting = params.isCurrent ? (params.roadmap?.reviewsWaiting ?? []) : [];
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
      toast.success(`${added} more ${added === 1 ? "review" : "reviews"} added to this week`);
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
