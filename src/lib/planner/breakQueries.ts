import { queryOptions } from "@tanstack/react-query";
import { plannerKey } from "@/lib/planner/queries";
import { BreakDAL } from "@/lib/planner/breaksDal";

/**
 * The student's breaks that stand, oldest first (`student_breaks`).
 *
 * A failed read reads as "no break" (see BreakDAL), which is safe: the
 * database still refuses to plan a break week.
 */
export const studentBreaksQuery = (studentId: string) =>
  queryOptions({
    // Under the student's planner key, so every planner refresh re-reads it.
    queryKey: [...plannerKey(studentId), "breaks"],
    queryFn: () => BreakDAL.list(studentId),
    staleTime: 30_000,
  });

/** Each programme's exam date, for the booking form (BreakDAL.examDates). */
export const examDatesQuery = (studentId: string) =>
  queryOptions({
    queryKey: [...plannerKey(studentId), "exam-dates"],
    queryFn: () => BreakDAL.examDates(studentId),
    staleTime: 60_000,
  });
