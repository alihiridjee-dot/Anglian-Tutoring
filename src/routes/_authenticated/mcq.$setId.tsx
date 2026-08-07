import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { isDemoStudent, DEMO_MCQ } from "@/lib/demo/studentDemo";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/mcq/$setId")({
  head: () => ({ meta: [{ title: "MCQ | Anglia Educate" }] }),
  component: TakeMcq,
});

type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
};
type SetRow = { id: string; title: string; description: string | null; published: boolean };
/** What the server sends back once the paper has been marked. */
type Marked = {
  score: number;
  total: number;
  byQuestion: Record<string, { correctIndex: number; explanation: string | null }>;
};

export function TakeMcq() {
  const { setId } = useParams({ from: "/_authenticated/mcq/$setId" });
  const { userId } = useRoles();
  const [set, setSet] = useState<SetRow | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [marked, setMarked] = useState<Marked | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const submitted = marked !== null;

  useEffect(() => {
    let cancelled = false;
    // Reset when moving between quizzes, so a slow load can't paint the
    // previous quiz's questions under the new quiz's title.
    setSet(null);
    setQuestions([]);
    setAnswers({});
    setMarked(null);
    setLoadError(null);

    (async () => {
      // Demo student: render a self-contained fixture quiz, never real content.
      if (isDemoStudent()) {
        const demo = DEMO_MCQ[setId];
        if (cancelled) return;
        if (demo) {
          setSet(demo.set);
          setQuestions(demo.questions);
        } else {
          setLoadError("That quiz isn't available.");
        }
        return;
      }
      // The answers are deliberately absent from this select — they live
      // server-side now and arrive only once the paper has been marked.
      const [{ data: s, error: sErr }, { data: qs, error: qErr }] = await Promise.all([
        supabase
          .from("mcq_sets")
          .select("id, title, description, published")
          .eq("id", setId)
          .maybeSingle(),
        supabase
          .from("mcq_questions")
          .select("id, position, question, options")
          .eq("set_id", setId)
          .order("position"),
      ]);
      if (cancelled) return;
      if (sErr || qErr) {
        setLoadError("Couldn't load this quiz — check your connection and try again.");
        return;
      }
      if (!s) {
        setLoadError("That quiz isn't available.");
        return;
      }
      setSet(s as SetRow);
      setQuestions(((qs ?? []) as Q[]).map((q) => ({ ...q, options: q.options as string[] })));
    })();

    return () => {
      cancelled = true;
    };
  }, [setId]);

  const submit = async () => {
    // An in-flight guard, not just a disabled button. Marking is a round trip,
    // and two clicks landing before the first response would file two attempts
    // — which the planner then reads as two separate pieces of practice.
    if (submitting || submitted) return;
    if (questions.length === 0) return;

    // Demo student: mark locally against the fixture, never write an attempt.
    if (isDemoStudent()) {
      const demo = DEMO_MCQ[setId];
      const byQuestion: Marked["byQuestion"] = {};
      let correct = 0;
      for (const q of demo?.questions ?? []) {
        byQuestion[q.id] = { correctIndex: q.correct_index, explanation: q.explanation };
        if (answers[q.id] === q.correct_index) correct += 1;
      }
      setMarked({ score: correct, total: questions.length, byQuestion });
      toast.success(`Scored ${correct}/${questions.length}`);
      return;
    }

    if (!userId) return;
    setSubmitting(true);
    try {
      // Marked on the server: the browser never held the answers to mark with.
      const { data, error } = await supabase.rpc("grade_mcq_attempt", {
        _set_id: setId,
        _answers: answers as unknown as Json,
      });
      if (error) throw error;
      const graded = data as unknown as {
        score: number;
        total: number;
        results: Array<{ question_id: string; correct_index: number; explanation: string | null }>;
      };
      const byQuestion: Marked["byQuestion"] = {};
      for (const r of graded.results ?? []) {
        byQuestion[r.question_id] = {
          correctIndex: r.correct_index,
          explanation: r.explanation,
        };
      }
      setMarked({ score: graded.score, total: graded.total, byQuestion });
      toast.success(`Scored ${graded.score}/${graded.total}`);
    } catch (err) {
      // Nothing is marked on a failure, so the student keeps their answers and
      // can simply press submit again.
      toast.error(err instanceof Error ? err.message : "Couldn't submit — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <AppLayout title="MCQ">
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Link to="/curriculum" className="mt-4 inline-block text-sm text-primary hover:underline">
          ← Back to curriculum
        </Link>
      </AppLayout>
    );
  }
  if (!set) return <AppLayout title="MCQ">Loading…</AppLayout>;

  return (
    <AppLayout title={set.title}>
      <div className="max-w-3xl">
        {set.description && <p className="text-sm text-muted-foreground mb-6">{set.description}</p>}
        <ol className="space-y-5">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            return (
              <li key={q.id} className="rounded-2xl premium-card p-5">
                <p className="text-xs uppercase tracking-widest text-primary font-semibold">
                  Question {idx + 1}
                </p>
                <p className="font-display text-lg mt-1">{q.question}</p>
                <div className="mt-3 space-y-2">
                  {q.options.map((opt, i) => {
                    const mark = marked?.byQuestion[q.id];
                    const isChosen = chosen === i;
                    const isCorrect = !!mark && i === mark.correctIndex;
                    const isWrong = !!mark && isChosen && i !== mark.correctIndex;
                    return (
                      <button
                        key={i}
                        disabled={submitted}
                        onClick={() => setAnswers({ ...answers, [q.id]: i })}
                        className={`w-full text-left px-4 py-2.5 rounded-lg border text-sm transition ${
                          isCorrect
                            ? "bg-primary/15 border-primary text-foreground"
                            : isWrong
                              ? "bg-destructive/10 border-destructive/50"
                              : isChosen
                                ? "bg-secondary border-primary/50"
                                : "bg-secondary/40 border-border hover:border-primary/40"
                        }`}
                      >
                        <span className="font-mono text-xs mr-2 text-muted-foreground">
                          {String.fromCharCode(65 + i)}.
                        </span>
                        {opt}
                        {isCorrect && <CheckCircle2 className="w-4 h-4 text-primary inline ml-2" />}
                        {isWrong && <XCircle className="w-4 h-4 text-destructive inline ml-2" />}
                      </button>
                    );
                  })}
                </div>
                {marked?.byQuestion[q.id]?.explanation && (
                  <p className="mt-3 text-xs text-muted-foreground border-t border-border pt-3">
                    <span className="font-semibold text-foreground">Explanation:</span>{" "}
                    {marked.byQuestion[q.id]!.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!submitted ? (
          <button
            onClick={submit}
            disabled={submitting || Object.keys(answers).length !== questions.length}
            className="mt-6 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            {submitting ? "Marking…" : "Submit answers"}
          </button>
        ) : (
          <div className="mt-6 rounded-2xl premium-card p-6 text-center">
            <p className="text-xs uppercase tracking-widest text-primary font-semibold">
              Your score
            </p>
            <p className="font-display text-4xl font-semibold mt-1">
              {marked?.score}/{marked?.total}
            </p>
            <Link
              to="/curriculum"
              className="mt-4 inline-block text-sm text-primary hover:underline"
            >
              ← Back to curriculum
            </Link>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
