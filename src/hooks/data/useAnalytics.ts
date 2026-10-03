import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_ANALYTICS } from "@/lib/demo/studentDemo";
import { summariseAnalytics, type SubjectAnalytics } from "@/lib/profile/analytics";

async function fetchAnalytics(userId: string, subjects: string[]): Promise<SubjectAnalytics[]> {
  // Through the read model, not embeds of mcq_sets and resources: those sit
  // behind the paywall, so a paused or lapsed child's work lost its subject and
  // every card said "No marked work yet" (S-23).
  const { data, error } = await supabase.rpc("student_scored_work", { _student_id: userId });
  // A failed read must not be averaged as "no work done" — that put a predicted
  // grade of 1 in front of a parent because a request timed out.
  if (error) throw error;

  // The newest 200 of each, as before.
  const newest = (kind: string) =>
    (data ?? [])
      .filter((w) => w.kind === kind)
      .sort((a, b) => b.scored_at.localeCompare(a.scored_at))
      .slice(0, 200)
      // A quiz with no questions has no percentage; it counted as 0 before.
      .map((w) => ({ subject: w.subject, pct: w.pct === null ? 0 : Number(w.pct) }));

  return summariseAnalytics(subjects, newest("quiz"), newest("homework"));
}

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
  // Sorted for the key only, so ["biology","physics"] and ["physics","biology"]
  // are one cache entry.
  const sorted = [...subjects].sort();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["analytics", demo ? "demo" : userId, sorted],
    queryFn: async (): Promise<SubjectAnalytics[]> => {
      // Demo student: serve the fixed showcase profile, never real analytics.
      if (demo) {
        return DEMO_ANALYTICS.filter((r) => subjects.length === 0 || subjects.includes(r.subject));
      }
      // The caller's order, not the key's: rows are shown in the order asked for.
      return fetchAnalytics(userId as string, subjects);
    },
    enabled: demo || (!!userId && sorted.length > 0),
  });

  return { rows: data ?? EMPTY_ROWS, loading: isLoading, error, refetch };
}

const EMPTY_ROWS: SubjectAnalytics[] = [];
