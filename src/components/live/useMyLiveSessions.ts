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
 *
 * `subject` narrows it further, to the header slider's subject on the pages
 * that follow it. The header's Join button passes none: a lesson starting in
 * another subject must never be missed for want of switching.
 */
export function useMyLiveSessions(subject?: string | null) {
  const { level, enrolments, loading } = useEnrolments();
  const query = useQuery({
    queryKey: ["live", "countdown"],
    queryFn: () => fetchLiveSessions(),
  });
  const data = useMemo(() => {
    if (!query.data || loading) return undefined;
    const mine = sessionsOnCourse(query.data, { level, enrolments });
    return subject ? mine.filter((s) => s.subject === subject) : mine;
  }, [query.data, loading, level, enrolments, subject]);
  return { data };
}
