import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SignedImage } from "@/components/SignedImage";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";

/**
 * Marking a built-in homework question by question.
 *
 * The tutor sees each question next to what the student wrote and the mark
 * scheme they set, and awards marks there rather than inventing a single
 * percentage at the end. The awarded total drives `score_pct` — which is what
 * feeds predicted grades — so the number the student sees is derived from the
 * marking rather than estimated.
 *
 * Loading is lazy: a marking queue can hold dozens of submissions, and only the
 * open one needs its answers.
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

    for (const u of updates) {
      const { error } = await supabase
        .from("homework_answers")
        .update({ awarded_marks: u.awarded_marks, feedback: u.feedback })
        .eq("id", u.id);
      if (error) throw error;
    }
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

export function AnswerMarkingList({
  questions,
  answers,
  marks,
  setMark,
}: {
  questions: HomeworkQuestion[];
  answers: Record<string, HomeworkAnswer>;
  marks: Record<string, QuestionMark>;
  setMark: (questionId: string, changes: Partial<QuestionMark>) => void;
}) {
  return (
    <ol className="space-y-3">
      {questions.map((q, i) => {
        const a = answers[q.id];
        const m = marks[q.id] ?? { marks: "", feedback: "" };
        return (
          <li key={q.id} className="rounded-xl bg-card border border-border p-4 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-xs font-semibold text-muted-foreground shrink-0">Q{i + 1}</span>
              <p className="text-sm font-medium whitespace-pre-wrap flex-1">{q.prompt}</p>
              <span className="text-[11px] text-muted-foreground shrink-0">[{q.marks}]</span>
            </div>
            {q.image_path && (
              <SignedImage
                path={q.image_path}
                alt={q.image_name ?? "Question figure"}
                className="max-h-48 rounded-lg border border-border object-contain"
              />
            )}

            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-1">
                Student's answer
              </p>
              <p className="text-sm whitespace-pre-wrap">
                {a?.answer_text || <span className="italic text-muted-foreground">Left blank</span>}
              </p>
              {a && a.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.images.map((img) => (
                    <SignedImage
                      key={img.path}
                      path={img.path}
                      alt={img.name}
                      className="max-h-48 rounded-lg border border-border object-contain"
                    />
                  ))}
                </div>
              )}
            </div>

            {q.mark_scheme && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Mark scheme</summary>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{q.mark_scheme}</p>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                Marks
                <input
                  type="number"
                  min={0}
                  max={q.marks}
                  value={m.marks}
                  onChange={(e) => setMark(q.id, { marks: e.target.value })}
                  placeholder={`/${q.marks}`}
                  className="w-20 h-9 rounded-lg premium-input px-2 text-sm"
                />
              </label>
              <input
                value={m.feedback}
                onChange={(e) => setMark(q.id, { feedback: e.target.value })}
                placeholder="Comment on this answer (optional)"
                className="flex-1 min-w-48 h-9 rounded-lg premium-input px-3 text-sm"
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
