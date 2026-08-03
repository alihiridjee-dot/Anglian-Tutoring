import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent } from "@/lib/demo/studentDemo";

/**
 * The built-in questions attached to homework briefs, and the answers a student
 * has given to them.
 *
 * Both are fetched for every brief on screen in one round trip and grouped by
 * id, rather than per card — a student with eight briefs would otherwise fire
 * eight queries on mount.
 */

export type HomeworkQuestion = {
  id: string;
  resource_id: string;
  position: number;
  prompt: string;
  marks: number;
  answer_type: "short" | "long" | "numeric";
  image_path: string | null;
  image_name: string | null;
  mark_scheme: string | null;
  spec_point_id: string | null;
};

export type HomeworkAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  images: Array<{ path: string; name: string }>;
  awarded_marks: number | null;
  feedback: string | null;
};

/** Questions for the given briefs, keyed by resource id and already in order. */
export function useHomeworkQuestions(resourceIds: string[], enabled = true) {
  const ids = [...resourceIds].sort();
  return useQuery({
    queryKey: ["homework", "questions", ids],
    queryFn: async (): Promise<Record<string, HomeworkQuestion[]>> => {
      // Demo briefs are fixtures with no rows behind them.
      if (isDemoStudent() || ids.length === 0) return {};

      const { data, error } = await supabase
        .from("homework_questions")
        .select(
          "id, resource_id, position, prompt, marks, answer_type, image_path, image_name, mark_scheme, spec_point_id",
        )
        .in("resource_id", ids)
        .order("position", { ascending: true });
      if (error) throw error;

      const map: Record<string, HomeworkQuestion[]> = {};
      for (const q of (data ?? []) as HomeworkQuestion[]) {
        (map[q.resource_id] ??= []).push(q);
      }
      return map;
    },
    enabled: enabled && ids.length > 0,
  });
}

/** This student's answers for the given submissions, keyed by question id. */
export function useHomeworkAnswers(submissionIds: string[], enabled = true) {
  const ids = [...submissionIds].sort();
  return useQuery({
    queryKey: ["homework", "answers", ids],
    queryFn: async (): Promise<Record<string, HomeworkAnswer>> => {
      if (isDemoStudent() || ids.length === 0) return {};

      const { data, error } = await supabase
        .from("homework_answers")
        .select("id, submission_id, question_id, answer_text, images, awarded_marks, feedback")
        .in("submission_id", ids);
      if (error) throw error;

      const map: Record<string, HomeworkAnswer> = {};
      for (const a of data ?? []) {
        map[a.question_id] = {
          ...a,
          images: (a.images as unknown as Array<{ path: string; name: string }>) ?? [],
        } as HomeworkAnswer;
      }
      return map;
    },
    enabled: enabled && ids.length > 0,
  });
}
