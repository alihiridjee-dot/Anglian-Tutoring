import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { DEFAULT_QUESTION_LOAD, readLoad, type QuestionLoad } from "@/lib/practice/questionLoad";

export const questionLoadKey = (userId: string | null) => ["question-load", userId] as const;

/**
 * A student's level: Reduced, Normal or Enhanced (`profiles.question_load`).
 *
 * The pages that cut a shared quiz or task to the level read it here, so they
 * agree with each other and follow a change made on the profile page. The
 * server works the count out again when it marks, from the same column, so
 * this only has to match what the student is shown.
 *
 * Read again when the tab is returned to (the query default): a quiz left open
 * while the level was changed in another tab shows the new count before it is
 * submitted, as the server will mark it.
 *
 * A level that is held back (Enhanced, for now) reads as Normal.
 *
 * `userId` null (a tutor previewing, the showcase, nobody signed in) is Normal
 * and ready at once: nothing is cut for them.
 */
export function useQuestionLoad(userId: string | null) {
  const asked = !!userId && !isDemoStudent();
  const query = useQuery({
    queryKey: questionLoadKey(userId),
    enabled: asked,
    queryFn: async (): Promise<QuestionLoad> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("question_load")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return readLoad(data?.question_load);
    },
  });
  return {
    load: query.data ?? DEFAULT_QUESTION_LOAD,
    /** False while the level is being read, or when the read failed. */
    ready: !asked || query.data !== undefined,
    error: asked && query.data === undefined ? query.error : null,
    retry: () => void query.refetch(),
  };
}
