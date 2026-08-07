import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";

/**
 * Loads one submission's questions and answers, and holds the marks the tutor
 * awards as they work down them.
 *
 * Loading is lazy: a marking queue can hold dozens of submissions, and only the
 * open one needs its answers — hence the `open` flag rather than fetching on
 * mount. Rendering lives in `AnswerMarkingList`.
 */
export type QuestionMark = { marks: string; feedback: string };

export function useAnswerMarking(
  resourceId: string | undefined,
  submissionId: string,
  open: boolean,
) {
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, HomeworkAnswer>>({});
  const [marks, setMarks] = useState<Record<string, QuestionMark>>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded || !resourceId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [qRes, aRes] = await Promise.all([
        supabase
          .from("homework_questions")
          .select(
            "id, resource_id, position, prompt, marks, answer_type, image_path, image_name, mark_scheme, spec_point_id",
          )
          .eq("resource_id", resourceId)
          .order("position", { ascending: true }),
        supabase
          .from("homework_answers")
          .select("id, submission_id, question_id, answer_text, images, awarded_marks, feedback")
          .eq("submission_id", submissionId),
      ]);
      if (cancelled) return;

      const qs = (qRes.data ?? []) as HomeworkQuestion[];
      const map: Record<string, HomeworkAnswer> = {};
      const initial: Record<string, QuestionMark> = {};
      for (const a of aRes.data ?? []) {
        const row = {
          ...a,
          images: (a.images as unknown as Array<{ path: string; name: string }>) ?? [],
        } as HomeworkAnswer;
        map[row.question_id] = row;
        initial[row.question_id] = {
          marks: row.awarded_marks != null ? String(Number(row.awarded_marks)) : "",
          feedback: row.feedback ?? "",
        };
      }
      setQuestions(qs);
      setAnswers(map);
      setMarks(initial);
      setLoaded(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, resourceId, submissionId]);

  const setMark = useCallback((questionId: string, changes: Partial<QuestionMark>) => {
    setMarks((prev) => ({
      ...prev,
      [questionId]: { ...{ marks: "", feedback: "" }, ...prev[questionId], ...changes },
    }));
  }, []);

  const totalMarks = useMemo(() => questions.reduce((sum, q) => sum + q.marks, 0), [questions]);

  // Only questions the tutor has actually marked count towards the awarded
  // total, so a part-marked submission doesn't read as zeros.
  const awarded = useMemo(() => {
    let sum = 0;
    for (const q of questions) {
      const raw = marks[q.id]?.marks ?? "";
      if (raw.trim() === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }, [questions, marks]);

  const markedCount = useMemo(
    () => questions.filter((q) => (marks[q.id]?.marks ?? "").trim() !== "").length,
    [questions, marks],
  );

  const scorePct =
    totalMarks > 0 && markedCount > 0 ? Math.round((awarded / totalMarks) * 100) : null;

  /** Persist the per-question marks. Called as part of saving the overall mark. */
  const saveMarks = useCallback(async () => {
    const updates = questions
      .filter((q) => answers[q.id])
      .map((q) => {
        const m = marks[q.id];
        const raw = m?.marks?.trim() ?? "";
        const value = raw === "" ? null : Number(raw);
        if (value != null && (!Number.isFinite(value) || value < 0 || value > q.marks)) {
          throw new Error(`Q${q.position + 1}: marks must be between 0 and ${q.marks}`);
        }
        return {
          id: answers[q.id].id,
          awarded_marks: value,
          feedback: m?.feedback?.trim() || null,
        };
      });

    // One request per answer, but concurrently rather than in a queue. Marking a
    // twelve-question paper was twelve sequential round trips — over a second of
    // the tutor staring at a spinner on a normal connection, for writes that
    // don't depend on each other. Supabase has no "update many rows to many
    // different values" call, so a batch needs a SECURITY DEFINER RPC in the
    // shape of `record_reviews_atomic`; until that exists this is the same set
    // of writes with the waiting removed.
    //
    // Partial failure is unchanged: neither form is a transaction, so a rejected
    // write leaves the rest applied. This version at least attempts them all
    // rather than abandoning everything after the first error.
    const results = await Promise.allSettled(
      updates.map((u) =>
        supabase
          .from("homework_answers")
          .update({ awarded_marks: u.awarded_marks, feedback: u.feedback })
          .eq("id", u.id)
          .then(({ error }) => {
            if (error) throw error;
          }),
      ),
    );
    const failed = results.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }, [questions, answers, marks]);

  return {
    questions,
    answers,
    marks,
    setMark,
    loading,
    hasQuestions: questions.length > 0,
    totalMarks,
    awarded,
    markedCount,
    scorePct,
    saveMarks,
  };
}
