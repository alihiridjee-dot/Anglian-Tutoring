import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidatePlanner, roadmapQuery, type PlannerCourse } from "@/lib/planner/queries";

/** Shared keys serve student, dashboard and tutor views. Tokens are mutation
 * notifications, not cache keys, so they never create duplicate cache entries. */
export function usePlannerRoadmap(p: PlannerCourse, refreshToken = 0, enabled = true) {
  const client = useQueryClient();
  const previous = useRef(refreshToken);
  useEffect(() => {
    if (previous.current !== refreshToken) {
      previous.current = refreshToken;
      void invalidatePlanner(client, p.studentId);
    }
  }, [client, p.studentId, refreshToken]);
  return useQuery({ ...roadmapQuery(client, p), enabled });
}
