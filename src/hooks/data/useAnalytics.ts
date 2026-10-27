import { useCallback, useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_ANALYTICS } from "@/lib/demo/studentDemo";
import {
  summariseScoredWork,
  type ScoredWorkRow,
  type SubjectAnalytics,
} from "@/lib/profile/analytics";

/**
 * Every scored quiz and marked task of one student (the newest 500 of each),
 * read once and shared. The predicted grades, the weekly trend and the
 * feedback list are all cut from this one fetch; each used to call the same
 * function itself, three times per Parent Portal visit. Under the "analytics"
 * key, so a finished quiz (which invalidates "analytics") refreshes all three.
 */
export const scoredWorkQuery = (studentId: string | null) =>
  queryOptions({
    queryKey: ["analytics", studentId, "scored-work"],
    queryFn: async (): Promise<ScoredWorkRow[]> => {
      // Through the read model, not embeds of mcq_sets and resources: those sit
      // behind the paywall, so a paused or lapsed child's work lost its subject
      // and every card said "No marked work yet" (S-23).
      const { data, error } = await supabase.rpc("student_scored_work", {
        _student_id: studentId!,
      });
      // A failed read must not be averaged as "no work done" — that put a
      // predicted grade of 1 in front of a parent because a request timed out.
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!studentId,
  });

/**
 * Per-subject quiz and homework averages, with the predicted grade.
 *
 * A query, so the dashboard, the homework page and the Parent Portal share one
 * fetch. It was a `useEffect` with its own state: the student dashboard called
 * it "to warm the cache" when there was no cache to warm — two requests whose
 * result was dropped — and every page that showed the numbers fetched them
 * again from scratch, flashing zeros while it did.
 */
export function useAnalytics(userId: string | null, subjects: string[]) {
  const demo = isDemoStudent();
  // The caller's order: rows are shown in the order asked for.
  const subjectList = subjects.join(",");
  const select = useCallback(
    (rows: ScoredWorkRow[]) => summariseScoredWork(subjectList ? subjectList.split(",") : [], rows),
    [subjectList],
  );

  const { data, isLoading, error, refetch } = useQuery({
    ...scoredWorkQuery(userId),
    select,
    enabled: !demo && !!userId && subjects.length > 0,
  });

  // Demo student: the fixed showcase profile, never real analytics.
  const demoRows = useMemo(() => {
    if (!demo) return EMPTY_ROWS;
    const asked = subjectList ? subjectList.split(",") : [];
    return DEMO_ANALYTICS.filter((r) => asked.length === 0 || asked.includes(r.subject));
  }, [demo, subjectList]);
  if (demo) return { rows: demoRows, loading: false, error: null, refetch };
  return { rows: data ?? EMPTY_ROWS, loading: isLoading, error, refetch };
}

const EMPTY_ROWS: SubjectAnalytics[] = [];
