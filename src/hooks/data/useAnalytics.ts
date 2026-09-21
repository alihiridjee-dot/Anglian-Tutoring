import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_ANALYTICS } from "@/lib/demo/studentDemo";
import { summariseAnalytics, type SubjectAnalytics } from "@/lib/analytics";

async function fetchAnalytics(userId: string, subjects: string[]): Promise<SubjectAnalytics[]> {
  const [attempts, subs] = await Promise.all([
    // MCQ attempts joined to sets (for subject)
    supabase
      .from("mcq_attempts")
      .select("score, total, mcq_sets(subject)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("homework_submissions")
      .select("score_pct, resources(subject)")
      .eq("student_id", userId)
      .not("score_pct", "is", null)
      .order("graded_at", { ascending: false })
      .limit(200),
  ]);
  // A failed read must not be averaged as "no work done" — that put a predicted
  // grade of 1 in front of a parent because a request timed out.
  if (attempts.error) throw attempts.error;
  if (subs.error) throw subs.error;

  return summariseAnalytics(
    subjects,
    (attempts.data ?? []).map((a) => ({
      subject: (a.mcq_sets as unknown as { subject: string | null } | null)?.subject,
      pct: a.total > 0 ? (a.score / a.total) * 100 : 0,
    })),
    (subs.data ?? []).map((h) => ({
      subject: (h.resources as unknown as { subject: string | null } | null)?.subject,
      pct: Number(h.score_pct),
    })),
  );
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

  const { data, isLoading } = useQuery({
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

  return { rows: data ?? EMPTY_ROWS, loading: isLoading };
}

const EMPTY_ROWS: SubjectAnalytics[] = [];
