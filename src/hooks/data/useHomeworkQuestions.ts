import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_ANSWERS, DEMO_QUESTIONS, isDemoStudent } from "@/lib/demo/studentDemo";

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
  mark_scheme: string | null;
  spec_point_id: string | null;
};

export type HomeworkAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  answer_text: string | null;
  awarded_marks: number | null;
  feedback: string | null;
};

/** How much work a brief holds, without pulling the work itself. */
export type HomeworkSummary = { count: number; marks: number };

/**
 * Question counts and mark totals for a list of briefs.
 *
 * The homework list shows "5 questions · 24 marks" on a card and nothing more,
 * but it used to get there by fetching every question of every brief — prompts,
 * mark schemes and all — and taking `.length`. That was tolerable when a
 * student had four briefs. It is not once the planner has generated a sheet per
 * spec point and the list runs to hundreds, at which point the page downloads
 * the entire question bank for their subjects to render a few counts.
 *
 * The full text is fetched on the sheet's own page, for one brief at a time.
 */
export function useHomeworkSummaries(resourceIds: string[], enabled = true) {
  const ids = [...resourceIds].sort();
  return useQuery({
    queryKey: ["homework", "summaries", ids],
    queryFn: async (): Promise<Record<string, HomeworkSummary>> => {
      if (isDemoStudent()) return summariseDemo(ids);
      if (ids.length === 0) return {};

      const { data, error } = await supabase
        .from("homework_questions")
        .select("resource_id, marks")
        .in("resource_id", ids);
      if (error) throw error;

      const map: Record<string, HomeworkSummary> = {};
      for (const q of data ?? []) {
        const entry = (map[q.resource_id] ??= { count: 0, marks: 0 });
        entry.count += 1;
        entry.marks += q.marks;
      }
      return map;
    },
    enabled: enabled && ids.length > 0,
  });
}

/** Questions for the given briefs, keyed by resource id and already in order. */
export function useHomeworkQuestions(resourceIds: string[], enabled = true) {
  const ids = [...resourceIds].sort();
  return useQuery({
    queryKey: ["homework", "questions", ids],
    queryFn: async (): Promise<Record<string, HomeworkQuestion[]>> => {
      // Demo sheets are fixtures with no rows behind them.
      if (isDemoStudent()) {
        return Object.fromEntries(
          ids.filter((id) => DEMO_QUESTIONS[id]).map((id) => [id, DEMO_QUESTIONS[id]]),
        );
      }
      if (ids.length === 0) return {};

      const { data, error } = await supabase
        .from("homework_questions")
        .select("id, resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id")
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
      if (isDemoStudent()) {
        const wanted = new Set(ids);
        return Object.fromEntries(
          Object.entries(DEMO_ANSWERS).filter(([, a]) => wanted.has(a.submission_id)),
        );
      }
      if (ids.length === 0) return {};

      const { data, error } = await supabase
        .from("homework_answers")
        .select("id, submission_id, question_id, answer_text, awarded_marks, feedback")
        .in("submission_id", ids);
      if (error) throw error;

      const map: Record<string, HomeworkAnswer> = {};
      for (const a of data ?? []) {
        map[a.question_id] = {
          ...a,
        } as HomeworkAnswer;
      }
      return map;
    },
    enabled: enabled && ids.length > 0,
  });
}

/** Counts and mark totals straight off the demo fixtures. */
function summariseDemo(ids: string[]): Record<string, HomeworkSummary> {
  const map: Record<string, HomeworkSummary> = {};
  for (const id of ids) {
    const questions = DEMO_QUESTIONS[id];
    if (!questions) continue;
    map[id] = {
      count: questions.length,
      marks: questions.reduce((sum, q) => sum + q.marks, 0),
    };
  }
  return map;
}
