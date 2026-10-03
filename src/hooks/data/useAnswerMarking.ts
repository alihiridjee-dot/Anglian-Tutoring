import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { QUESTION_COLUMNS, withMarkSchemes } from "@/lib/homework/markSchemes";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";

/**
 * Loads one submission's questions and answers, and holds the marks the tutor
 * awards as they work down them.
 *
 * Loading is lazy: a marking queue can hold dozens of submissions, and only the
 * open one needs its answers — hence the `open` flag rather than fetching on
 * mount. Rendering lives in `AnswerMarkingList`.
 *
 * The boxes come pre-filled. Work is marked automatically when it is handed in
 * and the result staged in `homework_ai_marks`, so what the tutor sees is a
 * proposal to check rather than an empty grid to fill — which is the difference
 * between marking a paper and reading one. A tutor's own saved marks always win
 * over the staged ones, so re-opening something already marked shows their
 * corrections and not the proposal they corrected. Once the work is published,
 * the proposal is not offered at all: what was saved is the mark, including a
 * comment the tutor cleared.
 *
 * The paper is the questions this student was set: those on the sheet when they
 * handed in, plus any they answered. A question a tutor adds afterwards is not
 * shown or counted against them, matching `publish_homework_marks`.
 */
export type QuestionMark = { marks: string; feedback: string };

/** One entry of the staged proposal held in `homework_ai_marks.marks`. */
type StagedMark = { question_id: string; marks: number; feedback: string };

export function useAnswerMarking(
  resourceId: string | undefined,
  submissionId: string,
  open: boolean,
  { submittedAt, graded }: { submittedAt: string; graded: boolean },
) {
  const [questions, setQuestions] = useState<HomeworkQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, HomeworkAnswer>>({});
  const [marks, setMarks] = useState<Record<string, QuestionMark>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || loaded || !resourceId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [qRes, aRes, sRes] = await Promise.all([
        supabase
          .from("homework_questions")
          .select(`${QUESTION_COLUMNS}, created_at`)
          .eq("resource_id", resourceId)
          .order("position", { ascending: true }),
        supabase
          .from("homework_answers")
          .select("id, submission_id, question_id, answer_text, awarded_marks, feedback")
          .eq("submission_id", submissionId),
        supabase
          .from("homework_ai_marks")
          .select("marks, summary")
          .eq("submission_id", submissionId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      // A failed read is not an empty paper: read as one, every answer showed
      // as "Left blank" and invited a 0.
      const failed = qRes.error ?? aRes.error ?? sRes.error;
      if (failed) {
        setError(new Error(failed.message));
        setLoading(false);
        return;
      }

      // A scheme that fails to load shows as none; marking still works.
      const all = (await withMarkSchemes(qRes.data ?? []).catch(() =>
        (qRes.data ?? []).map((q) => ({ ...q, mark_scheme: null })),
      )) as (HomeworkQuestion & { created_at: string })[];
      if (cancelled) return;
      const answered = new Set((aRes.data ?? []).map((a) => a.question_id));
      const handedIn = new Date(submittedAt).getTime();
      const qs = all.filter(
        (q) => answered.has(q.id) || new Date(q.created_at).getTime() <= handedIn,
      );

      // The staged proposal, if one was made, keyed for lookup below.
      const staged = new Map<string, StagedMark>();
      for (const m of (sRes.data?.marks as StagedMark[] | null) ?? []) {
        if (m && typeof m.question_id === "string") staged.set(m.question_id, m);
      }

      const map: Record<string, HomeworkAnswer> = {};
      const initial: Record<string, QuestionMark> = {};
      for (const a of aRes.data ?? []) {
        const row = a as HomeworkAnswer;
        map[row.question_id] = row;
        const proposal = graded ? undefined : staged.get(row.question_id);
        initial[row.question_id] = {
          marks:
            row.awarded_marks != null
              ? String(Number(row.awarded_marks))
              : proposal
                ? String(proposal.marks)
                : "",
          feedback: row.feedback ?? proposal?.feedback ?? "",
        };
      }
      setQuestions(qs);
      setAnswers(map);
      setMarks(initial);
      setSummary(graded ? null : (sRes.data?.summary ?? null));
      setLoaded(true);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, resourceId, submissionId, submittedAt, graded, attempt]);

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

  /**
   * Publish: every answer's marks and comment, and the overall mark, in one
   * transaction (`confirm_homework_marks`). Saved as separate requests, a
   * failure part-way left per-question marks with no grade, which the timer
   * then overwrote with the AI's. A comment the tutor emptied is sent as "",
   * so it stays cleared rather than the proposal filling it back in.
   */
  const confirm = useCallback(
    async (scorePct: number | null, feedback: string | null) => {
      if (error) throw new Error("The answers didn't load. Retry before publishing.");
      const payload = questions
        .filter((q) => answers[q.id])
        .map((q) => {
          const m = marks[q.id];
          const raw = m?.marks?.trim() ?? "";
          const value = raw === "" ? null : Number(raw);
          if (value != null && (!Number.isFinite(value) || value < 0 || value > q.marks)) {
            throw new Error(`Q${q.position + 1}: marks must be between 0 and ${q.marks}`);
          }
          return { question_id: q.id, marks: value, feedback: m?.feedback?.trim() ?? "" };
        });
      const { error: rpcError } = await supabase.rpc("confirm_homework_marks", {
        _submission_id: submissionId,
        _marks: payload,
        _score_pct: scorePct,
        _feedback: feedback,
      });
      if (rpcError) throw rpcError;
    },
    [error, questions, answers, marks, submissionId],
  );

  return {
    questions,
    answers,
    marks,
    setMark,
    /** The proposed overall comment, offered as a starting point for feedback. */
    summary,
    loading,
    /** The questions or answers failed to load; `retry` asks again. */
    error,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
    hasQuestions: questions.length > 0,
    totalMarks,
    awarded,
    markedCount,
    scorePct,
    confirm,
  };
}
