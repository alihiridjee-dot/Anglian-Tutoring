import { useMemo } from "react";
import { type RoadmapResult } from "@/lib/planner/roadmap";
import { type TopicProgress } from "@/lib/planner/scheduleDal";
import { type BacklogPoint } from "@/lib/planner/backlog";

/** The roadmap re-keyed the ways the week table looks things up: by topic, and by week owed. */
export function useRoadmapIndexes(data: RoadmapResult | null) {
  const progressByTopic = useMemo(
    () => new Map<string, TopicProgress>((data?.progress ?? []).map((t) => [t.topicId, t])),
    [data],
  );
  const masteryByTopic = useMemo(
    () => new Map<string, number>((data?.progress ?? []).map((t) => [t.topicId, t.masteryPct])),
    [data],
  );
  // Which topics were rescheduled, keyed by topic, so the table can flag them
  // inline (badge at the topic's new start week) instead of a separate list.
  const changeByTopic = useMemo(
    () => new Map((data?.changes ?? []).map((c) => [c.topicId, c])),
    [data],
  );
  // Which of a past week's promises are still outstanding, so a history row can
  // say what actually happened in it rather than just which topic was due.
  const owedByWeek = useMemo(() => {
    const out = new Map<string, BacklogPoint[]>();
    // From the display backlog, so work already pulled into this week stops
    // being reported as outstanding in the week it was originally promised.
    for (const topic of data?.backlogByTopic ?? [])
      for (const point of topic.points)
        out.set(point.plannedWeek, [...(out.get(point.plannedWeek) ?? []), point]);
    return out;
  }, [data]);

  return { progressByTopic, masteryByTopic, changeByTopic, owedByWeek };
}
