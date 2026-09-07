import {
  applyReview,
  reviewEligibleAt,
  Rating,
  type Card,
  type Grade,
} from "../src/lib/planner/scheduler";
import { projectReviews, type FocusCandidate } from "../src/lib/planner/pacing";
import { addWeeks, toDateKey } from "../src/lib/week";

// Synthetic evidence, not student predictions. All skills weigh one unit.
const start = new Date(2026, 8, 7);
const scenarios: {
  name: string;
  weeks: number;
  skills: number;
  grade: (week: number, id: number) => Grade;
  skip?: number;
}[] = [
  { name: "consistent success", weeks: 36, skills: 90, grade: () => Rating.Good },
  {
    name: "mixed results",
    weeks: 36,
    skills: 90,
    grade: (w, id) => ((w + id) % 4 === 0 ? Rating.Again : Rating.Good),
  },
  { name: "persistent difficulty", weeks: 36, skills: 90, grade: () => Rating.Again },
  { name: "late joiner", weeks: 12, skills: 90, grade: () => Rating.Hard },
  { name: "missed weeks", weeks: 36, skills: 90, grade: () => Rating.Good, skip: 4 },
];
const report = scenarios.map((s) => {
  const cards = new Map<number, Card>();
  const exam = addWeeks(start, s.weeks);
  let completed = 0,
    peak = 0,
    spacingViolations = 0;
  for (let w = 0; w < s.weeks; w++) {
    const monday = addWeeks(start, w);
    const candidates: FocusCandidate[] = [...cards].map(([id, card]) => ({
      specPointId: String(id),
      topicId: "course",
      topicTitle: "Synthetic course",
      code: String(id),
      pointTitle: String(id),
      dueAt: card.due.toISOString(),
      eligibleAt: reviewEligibleAt(card).toISOString(),
      lastReviewedAt: card.last_review!.toISOString(),
      weight: 1,
    }));
    const projection = projectReviews({ candidates, currentMonday: monday, examMonday: exam });
    const reviewIds = projection.bands
      .filter((b) => b.startWeek === toDateKey(monday))
      .flatMap((b) => b.points ?? [])
      .map((p) => Number(p.specPointId));
    peak = Math.max(peak, reviewIds.length);
    if (!s.skip || w % s.skip !== 0) {
      for (const id of reviewIds) {
        const card = cards.get(id)!;
        if (monday.getTime() - card.last_review!.getTime() < 7 * 86400000) spacingViolations++;
        cards.set(id, applyReview(card, s.grade(w, id), monday));
        completed++;
      }
    }
    // Introduce evenly throughout the full teaching window.
    const teachWeeks = Math.max(1, s.weeks);
    if (w < teachWeeks)
      for (
        let id = Math.floor((w * s.skills) / teachWeeks);
        id < Math.floor(((w + 1) * s.skills) / teachWeeks);
        id++
      ) {
        cards.set(id, applyReview(null, s.grade(w, id), monday));
      }
  }
  const stillDueAtExam = [...cards.values()].filter((c) => reviewEligibleAt(c) < exam).length;
  return {
    scenario: s.name,
    weeks: s.weeks,
    skills: s.skills,
    completedReviews: completed,
    peakWeeklyReviews: peak,
    stillDueAtExam,
    spacingViolations,
  };
});
console.log(
  JSON.stringify(
    {
      assumptions:
        "90 unit-weight skills; uncapped eligible reviews; seven-day floor; grading on Monday; full teaching window",
      report,
    },
    null,
    2,
  ),
);
if (report.some((r) => r.spacingViolations)) process.exitCode = 1;
