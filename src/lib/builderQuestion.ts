import type { DraftQuestion } from "@/lib/homeworkQuestions.functions";

/**
 * A homework question while it is still being written.
 *
 * A question is a draft until the brief is saved: figures are held as local
 * `File`s and only uploaded by the form on submit, so abandoning a half-written
 * homework leaves no orphaned bytes in storage. `QuestionBuilder` edits these;
 * `HomeworkForm` creates and persists them.
 */
export type BuilderQuestion = DraftQuestion & {
  /** Stable key for React across reordering — drafts have no id yet. */
  key: string;
  /** Optional figure shown above the prompt. */
  image: File | null;
  imagePreview: string | null;
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
    image: null,
    imagePreview: null,
  };
}
