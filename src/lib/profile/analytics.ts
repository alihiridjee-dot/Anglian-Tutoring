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

/**
 * Scored pieces of work (quizzes plus marked homework) a subject needs before a
 * grade is predicted from it. Below this the prediction is one bad quiz: a
 * single 0% put "Grade 1" in front of a parent, which says far more than one
 * quiz can.
 */
export const MIN_WORK_FOR_PREDICTION = 3;

/** Whether a subject has enough scored work to show its predicted grade. */
export function hasPrediction(row: SubjectAnalytics): boolean {
  return row.mcqAttempts + row.hwGraded >= MIN_WORK_FOR_PREDICTION;
}

/**
 * How far up its scale a grade sits, 0–100: the sweep of a grade ring.
 *
 * `scale` runs best first and ends at "U" (`gradeOptions(level)`), so the top
 * grade fills the ring and a U leaves it empty. A grade not on the scale —
 * nothing set, or an A-Level letter on a GCSE scale — draws nothing.
 */
export function gradeFill(grade: string | null | undefined, scale: readonly string[]): number {
  const i = grade ? scale.indexOf(grade) : -1;
  if (i < 0 || scale.length < 2) return 0;
  return ((scale.length - 1 - i) / (scale.length - 1)) * 100;
}

/**
 * Grades between where a student is heading and their target, on `scale`
 * (best first). Zero or less means on or above target. Null when either grade
 * isn't on the scale, so there is nothing honest to compare.
 */
export function gradesToGo(
  workingTowards: string | null | undefined,
  target: string | null | undefined,
  scale: readonly string[],
): number | null {
  const at = workingTowards ? scale.indexOf(workingTowards) : -1;
  const goal = target ? scale.indexOf(target) : -1;
  if (at < 0 || goal < 0) return null;
  return at - goal;
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
