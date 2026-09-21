import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";

/** Where a homework came from: a tutor set it, or the planner generated it. */
export type HomeworkOrigin = "tutor" | "generated";

export type Homework = {
  id: string;
  title: string;
  instructions: string | null;
  subject: string;
  /** Null for a tutor brief set for the subject on every board. */
  board: BoardV | null;
  level: LevelV;
  due_at: string | null;
  created_at: string;
  origin: HomeworkOrigin;
};

export type SubmissionRow = {
  id: string;
  resource_id: string;
  student_id: string;
  notes: string | null;
  submitted_at: string;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
  acknowledged_at: string | null;
  /**
   * When the mark is due to appear. Held work is still being checked, and this
   * is what lets the page say so instead of leaving a submission looking
   * ignored for a day.
   */
  release_at: string | null;
};
