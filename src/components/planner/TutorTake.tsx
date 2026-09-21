import { Loader2 } from "lucide-react";
import { type WeeklyPlan } from "@/lib/planner/weeklyPlanDal";
import { type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { useTutorTake, type FeedbackMetric } from "./useTutorTake";
import { NextWeekAssigner, TutorFeedbackEditor, TutorTakeReadOnly } from "./TutorTakeParts";

export type { FeedbackMetric };

/**
 * "Ali's take" — the personalized-tutoring heart of the week review. The tutor
 * writes how the student did and what to focus on next, and lines up the spec
 * points for next week; the panel previews exactly how that reshapes next week's
 * schedule, and the tutor can apply it in one click. The student sees the same
 * note read-only, so the plan always carries a human voice, not just the
 * algorithm's.
 *
 * `isTutor` (the review card's readOnly flag) switches between the editor and
 * the student's read-only view.
 */
export function TutorTake({
  studentId,
  plan,
  subject,
  board,
  level,
  weekStart,
  isTutor,
  onChanged,
  metrics = [],
  studentReflection = null,
  studentFeltReady = null,
}: {
  studentId: string;
  plan: WeeklyPlan;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  weekStart: string;
  isTutor: boolean;
  onChanged: () => void;
  /** This week's per-point performance, grounding the AI draft (tutor only). */
  metrics?: FeedbackMetric[];
  /** The student's own end-of-week reflection, if any (tutor only). */
  studentReflection?: string | null;
  /** Whether the student felt ready to move on (tutor only). */
  studentFeltReady?: boolean | null;
}) {
  const take = useTutorTake({
    studentId,
    plan,
    subject,
    board,
    level,
    weekStart,
    onChanged,
    metrics,
    studentReflection,
    studentFeltReady,
  });
  const { loaded, savedNote, existingNext } = take;

  if (!loaded) {
    return (
      <div className="mt-4 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Student's read-only view -------------------------------------------
  if (!isTutor) {
    if (!savedNote && existingNext.length === 0) return null;
    return <TutorTakeReadOnly take={take} />;
  }

  // ---- Tutor's editor ------------------------------------------------------
  return (
    <div className="mt-4 space-y-4">
      <TutorFeedbackEditor
        take={take}
        studentReflection={studentReflection}
        studentFeltReady={studentFeltReady}
      />

      <NextWeekAssigner take={take} subject={subject} board={board} level={level} />
    </div>
  );
}
