import type { DraftQuestion } from "@/lib/homeworkQuestions.functions";

/**
 * A homework question while it is still being written.
 *
 * A question is a draft until the brief is saved. Nothing here is uploaded —
 * questions are written text and marks, and the only figure a question can ever
 * carry is one the model draws itself. `QuestionBuilder` edits these;
 * `HomeworkForm` creates and persists them.
 */
export type BuilderQuestion = DraftQuestion & {
  /** Stable key for React across reordering — drafts have no id yet. */
  key: string;
  /**
   * The row this question already is, when the brief is being edited rather
   * than written. Absent means "new question, insert it"; present means "update
   * that row", which is what lets a question keep the answers already written
   * against it while its wording is corrected.
   */
  id?: string;
};

/** An empty question, optionally pre-tagged to a spec point. */
export function blankQuestion(specPointId: string | null = null): BuilderQuestion {
  return {
    key: crypto.randomUUID(),
    prompt: "",
    marks: 2,
    answer_type: "short",
    mark_scheme: "",
    spec_point_id: specPointId,
  };
}
