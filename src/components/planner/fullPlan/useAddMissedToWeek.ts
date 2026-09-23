import { useState } from "react";
import { toast } from "sonner";
import { WeeklyPlanDAL } from "@/lib/planner/weeklyPlanDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { currentWeekKey } from "@/lib/planner/week";
import { type MissedTopic } from "./formatSchedule";

/**
 * Put a missed topic's outstanding points into the current week, as the
 * tutor's choice.
 *
 * The programme already brings missed work back a little each week; this is
 * for "do Topic 1 now". The rows are written with a `tutor` origin, which is
 * what it is — a person overruling the pace — and hand-picked origins survive
 * a re-cut of the week.
 */
export function useAddMissedToWeek({
  course,
  onAdded,
}: {
  course: { studentId: string; subject: SubjectV; board: BoardV; level: LevelV };
  onAdded: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (topic: MissedTopic) => {
    setBusy(topic.topicId);
    const n = topic.specPointIds.length;
    try {
      await WeeklyPlanDAL.addToWeek({
        ...course,
        weekStart: currentWeekKey(),
        specPointIds: topic.specPointIds,
        origin: "tutor",
      });
      toast.success(`Added ${n} ${n === 1 ? "point" : "points"} from ${topic.title} to this week.`);
      await onAdded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add those — try again.");
    } finally {
      setBusy(null);
    }
  };

  return { busy, add };
}
