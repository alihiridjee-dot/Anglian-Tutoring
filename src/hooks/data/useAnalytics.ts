import { useEffect, useState } from "react";
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

export function useAnalytics(userId: string | null, subjects: string[]) {
  const [rows, setRows] = useState<SubjectAnalytics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Demo student: serve the fixed showcase profile, never real analytics.
    if (isDemoStudent()) {
      setRows(DEMO_ANALYTICS.filter((r) => subjects.length === 0 || subjects.includes(r.subject)));
      setLoading(false);
      return;
    }
    if (!userId || subjects.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // MCQ attempts joined to sets (for subject)
      const { data: attempts } = await supabase
        .from("mcq_attempts")
        .select("score, total, mcq_sets(subject)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200);

      const { data: subs } = await supabase
        .from("homework_submissions")
        .select("score_pct, resources(subject)")
        .eq("student_id", userId)
        .not("score_pct", "is", null)
        .order("graded_at", { ascending: false })
        .limit(200);

      if (cancelled) return;

      const bySubject: Record<string, SubjectAnalytics> = {};
      for (const s of subjects) {
        bySubject[s] = {
          subject: s,
          mcqAttempts: 0,
          mcqAverage: 0,
          hwGraded: 0,
          hwAverage: 0,
          predictedGrade: 1,
        };
      }

      const mcqTotals: Record<string, { sum: number; count: number }> = {};
      for (const a of attempts ?? []) {
        const subj = (a.mcq_sets as unknown as { subject: string | null } | null)?.subject;
        if (!subj || !bySubject[subj]) continue;
        const pct = a.total > 0 ? (a.score / a.total) * 100 : 0;
        mcqTotals[subj] = mcqTotals[subj] ?? { sum: 0, count: 0 };
        mcqTotals[subj].sum += pct;
        mcqTotals[subj].count += 1;
      }

      const hwTotals: Record<string, { sum: number; count: number }> = {};
      for (const h of subs ?? []) {
        const subj = (h.resources as unknown as { subject: string | null } | null)?.subject;
        if (!subj || !bySubject[subj] || h.score_pct == null) continue;
        hwTotals[subj] = hwTotals[subj] ?? { sum: 0, count: 0 };
        hwTotals[subj].sum += Number(h.score_pct);
        hwTotals[subj].count += 1;
      }

      for (const subj of subjects) {
        const m = mcqTotals[subj] ?? { sum: 0, count: 0 };
        const h = hwTotals[subj] ?? { sum: 0, count: 0 };
        const mcqAvg = m.count > 0 ? m.sum / m.count : 0;
        const hwAvg = h.count > 0 ? h.sum / h.count : 0;
        // Weight only the components that exist: a student with quizzes but no
        // marked homework yet shouldn't have a phantom 0% dragging their grade
        // down (70/30 split applies once both are present).
        const mcqW = m.count > 0 ? 0.7 : 0;
        const hwW = h.count > 0 ? 0.3 : 0;
        const composite = mcqW + hwW > 0 ? (mcqW * mcqAvg + hwW * hwAvg) / (mcqW + hwW) : 0;
        bySubject[subj] = {
          subject: subj,
          mcqAttempts: m.count,
          mcqAverage: Math.round(mcqAvg),
          hwGraded: h.count,
          hwAverage: Math.round(hwAvg),
          predictedGrade: gradeFromPct(composite),
        };
      }

      setRows(Object.values(bySubject));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, subjects.join(",")]); // eslint-disable-line

  return { rows, loading };
}
