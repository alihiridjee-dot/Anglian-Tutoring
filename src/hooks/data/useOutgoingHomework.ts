import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { HomeworkQuestion } from "@/hooks/data/useHomeworkQuestions";
import type { Sheet, SheetStatus } from "@/lib/homeworkReview";

/**
 * The generated sheets standing at the tutor's review gate.
 *
 * Loaded whole, once. The set is "everything not yet approved, plus what was
 * decided in the last fortnight", which a week of generation keeps in the
 * hundreds however large the library behind it grows — and having all of it in
 * memory is what lets every filter on the screen answer without a request.
 * Question text is left out: a row needs a count and a total, and the wording
 * is fetched when a sheet is opened.
 */

const OUTGOING_KEY = ["tutor", "outgoing-homework"] as const;
const sheetKey = (id: string) => ["tutor", "sheet-questions", id] as const;
/** How far back decided sheets stay listed, so a wrong click can be found and undone. */
const DECIDED_WINDOW_DAYS = 14;

type Row = {
  id: string;
  title: string;
  subject: Sheet["subject"];
  board: Sheet["board"];
  level: Sheet["level"];
  review_status: string;
  publish_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  spec_point_id: string | null;
  spec_point: { code: string; topic: { title: string; exam_tier: string | null } | null } | null;
  questions: { marks: number }[];
  submissions: { count: number }[];
};

const toSheet = (r: Row): Sheet => ({
  id: r.id,
  title: r.title,
  subject: r.subject,
  board: r.board,
  level: r.level,
  tier: r.spec_point?.topic?.exam_tier ?? null,
  specCode: r.spec_point?.code ?? null,
  topicTitle: r.spec_point?.topic?.title ?? null,
  specPointId: r.spec_point_id,
  status: r.review_status as SheetStatus,
  publishAt: r.publish_at,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
  questionCount: r.questions.length,
  totalMarks: r.questions.reduce((sum, q) => sum + q.marks, 0),
  submissionCount: r.submissions[0]?.count ?? 0,
});

async function fetchSheets(): Promise<Sheet[]> {
  const since = new Date(Date.now() - DECIDED_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("resources")
    .select(
      // The spec point is named by its foreign key: `resource_spec_points` is a
      // second path between the two tables, and an unqualified embed is ambiguous.
      `id, title, subject, board, level, review_status, publish_at, reviewed_at, created_at, spec_point_id,
       spec_point:spec_points!resources_spec_point_id_fkey(code, topic:topics(title, exam_tier)),
       questions:homework_questions(marks),
       submissions:homework_submissions(count)`,
    )
    .eq("kind", "homework")
    .eq("origin", "generated")
    .or(`review_status.neq.approved,reviewed_at.gte.${since}`)
    .order("publish_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(toSheet);
}

export function useOutgoingHomework(userId: string | null) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: OUTGOING_KEY, queryFn: fetchSheets, staleTime: 60_000 });

  /**
   * Move sheets to a status, on screen first and in the database second.
   *
   * Returns what each sheet was before, which is what makes the undo toast
   * possible — and undo is why none of these actions asks "are you sure?".
   * Approving forty sheets should cost one click, and a slip should cost one
   * more, not forty confirmations up front.
   */
  const setStatus = useCallback(
    async (ids: string[], status: SheetStatus): Promise<Map<string, SheetStatus>> => {
      const before = new Map<string, SheetStatus>();
      const current = client.getQueryData<Sheet[]>(OUTGOING_KEY) ?? [];
      for (const s of current) if (ids.includes(s.id)) before.set(s.id, s.status);

      const stamp = new Date().toISOString();
      client.setQueryData<Sheet[]>(OUTGOING_KEY, (rows) =>
        (rows ?? []).map((s) =>
          before.has(s.id)
            ? { ...s, status, reviewedAt: status === "to_review" ? null : stamp }
            : s,
        ),
      );

      const { error } = await supabase
        .from("resources")
        .update({
          review_status: status,
          // Sending a sheet back to the queue clears the record that anyone read it.
          reviewed_at: status === "to_review" ? null : stamp,
          reviewed_by: status === "to_review" ? null : userId,
        })
        .in("id", [...before.keys()]);
      if (error) {
        await client.invalidateQueries({ queryKey: OUTGOING_KEY });
        throw error;
      }
      return before;
    },
    [client, userId],
  );

  /** Put sheets back exactly as they were, grouped so each status is one request. */
  const restore = useCallback(
    async (before: Map<string, SheetStatus>) => {
      const byStatus = new Map<SheetStatus, string[]>();
      for (const [id, status] of before)
        byStatus.set(status, [...(byStatus.get(status) ?? []), id]);
      for (const [status, ids] of byStatus) await setStatus(ids, status);
    },
    [setStatus],
  );

  /** Warm the next sheet's questions so "Approve & next" opens onto content, not a spinner. */
  const prefetch = useCallback(
    (id: string | undefined) => {
      if (!id) return;
      void client.prefetchQuery({
        queryKey: sheetKey(id),
        queryFn: () => fetchQuestions(id),
        staleTime: 60_000,
      });
    },
    [client],
  );

  const refreshCounts = useCallback(
    () => client.invalidateQueries({ queryKey: OUTGOING_KEY }),
    [client],
  );

  return { ...query, sheets: query.data ?? [], setStatus, restore, prefetch, refreshCounts };
}

async function fetchQuestions(resourceId: string): Promise<HomeworkQuestion[]> {
  const { data, error } = await supabase
    .from("homework_questions")
    .select("id, resource_id, position, prompt, marks, answer_type, mark_scheme, spec_point_id")
    .eq("resource_id", resourceId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HomeworkQuestion[];
}

export type QuestionPatch = Partial<Pick<HomeworkQuestion, "prompt" | "marks" | "mark_scheme">>;

/** One open sheet's questions, with the writes the review panel makes to them. */
export function useSheetQuestions(resourceId: string | undefined) {
  const client = useQueryClient();
  const key = sheetKey(resourceId ?? "");
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchQuestions(resourceId!),
    enabled: !!resourceId,
    staleTime: 60_000,
  });

  const patch = useCallback(
    async (id: string, changes: QuestionPatch) => {
      client.setQueryData<HomeworkQuestion[]>(key, (rows) =>
        (rows ?? []).map((q) => (q.id === id ? { ...q, ...changes } : q)),
      );
      const { error } = await supabase.from("homework_questions").update(changes).eq("id", id);
      if (error) {
        await client.invalidateQueries({ queryKey: key });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is derived from resourceId
    [client, resourceId],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("homework_questions").delete().eq("id", id);
      if (error) throw error;
      client.setQueryData<HomeworkQuestion[]>(key, (rows) =>
        (rows ?? []).filter((q) => q.id !== id),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is derived from resourceId
    [client, resourceId],
  );

  return { ...query, questions: query.data ?? [], patch, remove };
}
