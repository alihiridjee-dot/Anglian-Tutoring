import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { fetchLiveSessions, sessionsOnCourse } from "@/lib/live/liveSessions";

/**
 * The signed-in student's live sessions: the shared ["live","countdown"] read,
 * narrowed to their own course. The header button, the dashboard banner and the
 * countdown all read through here, so they agree with each other and with the
 * Live Sessions page. `data` stays undefined until the course has loaded, so no
 * other level's session flashes up first.
 */
export function useMyLiveSessions() {
  const { level, enrolments, loading } = useEnrolments();
  const query = useQuery({
    queryKey: ["live", "countdown"],
    queryFn: () => fetchLiveSessions(),
  });
  const data = useMemo(
    () =>
      query.data && !loading ? sessionsOnCourse(query.data, { level, enrolments }) : undefined,
    [query.data, loading, level, enrolments],
  );
  return { data };
}
