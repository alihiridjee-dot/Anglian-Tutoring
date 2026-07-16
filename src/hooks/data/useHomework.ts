import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isDemoStudent, DEMO_HOMEWORK, DEMO_SUBMISSIONS } from "@/lib/demo/studentDemo";

export type Homework = {
  id: string;
  title: string;
  instructions: string | null;
  subject: string;
  due_at: string | null;
  created_at: string;
};

export type SubmissionRow = {
  id: string;
  resource_id: string;
  student_id: string;
  files: Array<{ path: string; name: string }>;
  notes: string | null;
  submitted_at: string;
  grade: string | null;
  score_pct: number | null;
  feedback: string | null;
  graded_at: string | null;
  acknowledged_at: string | null;
  files_deleted_at: string | null;
};

/** Both homework queries sit under this prefix so one invalidate refreshes the page. */
const HOMEWORK_KEY = ["homework"] as const;

/**
 * The homework briefs visible to the caller: every brief for a tutor, and only
 * the enrolled subjects for a student.
 *
 * `subjects` must be settled before this runs — an empty list while the profile
 * is still loading would read as "no filter" and flash every subject's homework
 * at the student. Pass `enabled: false` until enrolments have resolved.
 */
export function useHomework({
  isTutor,
  subjects,
  enabled = true,
}: {
  isTutor: boolean;
  subjects: string[];
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "briefs", { isTutor, subjects: [...subjects].sort() }],
    queryFn: async (): Promise<Homework[]> => {
      // Demo student: render the self-contained fixture set, never real content.
      if (isDemoStudent()) return DEMO_HOMEWORK;

      let q = supabase
        .from("resources")
        .select("id, title, instructions, subject, due_at, created_at")
        .eq("kind", "homework")
        .order("due_at", { ascending: true });
      if (!isTutor && subjects.length > 0)
        q = q.in("subject", subjects as ("biology" | "chemistry" | "physics")[]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Homework[];
    },
    enabled,
  });
}

/** This student's submissions, keyed by the homework they answer. */
export function useHomeworkSubmissions({
  userId,
  enabled = true,
}: {
  userId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: [...HOMEWORK_KEY, "submissions", userId],
    queryFn: async (): Promise<Record<string, SubmissionRow>> => {
      if (isDemoStudent()) return DEMO_SUBMISSIONS;
      if (!userId) return {};

      const { data, error } = await supabase
        .from("homework_submissions")
        .select("*")
        .eq("student_id", userId);
      if (error) throw error;

      const map: Record<string, SubmissionRow> = {};
      for (const s of data ?? []) {
        map[s.resource_id] = {
          ...s,
          files: (s.files as unknown as Array<{ path: string; name: string }>) ?? [],
        };
      }
      return map;
    },
    enabled: enabled && (isDemoStudent() || !!userId),
  });
}

/** Refetches briefs and submissions together — use after submitting or acknowledging. */
export function useInvalidateHomework() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: HOMEWORK_KEY });
  }, [queryClient]);
}
