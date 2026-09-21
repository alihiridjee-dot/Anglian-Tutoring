import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_ANALYTICS } from "@/lib/demo/studentDemo";

export interface SubjectAnalytics {
  subject: string;
  mcqAttempts: number;
  mcqAverage: number; // 0-100
  hwGraded: number;
  hwAverage: number; // 0-100
  predictedGrade: number; // 1-9 GCSE
}

/**
 * Simple grade predictor:
 *   composite = 0.7 * mcqAvg% + 0.3 * hwAvg%
 *   mapped to GCSE 1-9 via a linear lookup.
 */
export function gradeFromPct(pct: number): number {
  if (pct >= 90) return 9;
  if (pct >= 80) return 8;
  if (pct >= 70) return 7;
  if (pct >= 60) return 6;
  if (pct >= 50) return 5;
  if (pct >= 40) return 4;
  if (pct >= 30) return 3;
  if (pct >= 20) return 2;
  return 1;
}

/** One scored piece of work, reduced to the subject it belongs to and its percentage. */
export interface ScoredWork {
  subject: string | null | undefined;
  pct: number;
}

/**
 * Per-subject averages and the predicted grade, from the scored work.
 *
 * Pure, so the arithmetic can be tested without a database. Work in a subject
 * the student isn't enrolled in is ignored rather than invented into a row.
 */
export function summariseAnalytics(
  subjects: readonly string[],
  quizzes: readonly ScoredWork[],
  homework: readonly ScoredWork[],
): SubjectAnalytics[] {
  const totals = (work: readonly ScoredWork[]) => {
    const bySubject = new Map<string, { sum: number; count: number }>();
    for (const w of work) {
      if (!w.subject || !subjects.includes(w.subject) || !Number.isFinite(w.pct)) continue;
      const t = bySubject.get(w.subject) ?? { sum: 0, count: 0 };
      t.sum += w.pct;
      t.count += 1;
      bySubject.set(w.subject, t);
    }
    return bySubject;
  };
  const mcqTotals = totals(quizzes);
  const hwTotals = totals(homework);

  return subjects.map((subject) => {
    const m = mcqTotals.get(subject) ?? { sum: 0, count: 0 };
    const h = hwTotals.get(subject) ?? { sum: 0, count: 0 };
    const mcqAvg = m.count > 0 ? m.sum / m.count : 0;
    const hwAvg = h.count > 0 ? h.sum / h.count : 0;
    // Weight only the components that exist: a student with quizzes but no
    // marked homework yet shouldn't have a phantom 0% dragging their grade
    // down (70/30 split applies once both are present).
    const mcqW = m.count > 0 ? 0.7 : 0;
    const hwW = h.count > 0 ? 0.3 : 0;
    const composite = mcqW + hwW > 0 ? (mcqW * mcqAvg + hwW * hwAvg) / (mcqW + hwW) : 0;
    return {
      subject,
      mcqAttempts: m.count,
      mcqAverage: Math.round(mcqAvg),
      hwGraded: h.count,
      hwAverage: Math.round(hwAvg),
      predictedGrade: gradeFromPct(composite),
    };
  });
}

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
