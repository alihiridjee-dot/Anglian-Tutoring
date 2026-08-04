import { useMemo } from "react";
import { useEnrolments } from "@/hooks/data/useEnrolments";
import { summariseCourse, type CourseSummary } from "@/lib/courseSummary";

/**
 * The current user's course — level plus the board of each enrolled subject.
 *
 * The labelling rules live in `@/lib/courseSummary` (pure, testable); this is
 * only the binding to the profile query, so any surface that wants to state
 * what a student is studying reads it the same way.
 */
export function useCourseSummary(): CourseSummary & { loading: boolean } {
  const { level, enrolments, loading } = useEnrolments();
  const summary = useMemo(() => summariseCourse(level, enrolments), [level, enrolments]);
  return { ...summary, loading };
}
