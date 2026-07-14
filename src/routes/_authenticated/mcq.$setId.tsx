import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { isDemoStudent, DEMO_MCQ } from "@/lib/demo/studentDemo";

export const Route = createFileRoute("/_authenticated/mcq/$setId")({
  head: () => ({ meta: [{ title: "MCQ | StudyHub" }] }),
  component: TakeMcq,
});

type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
};
type SetRow = { id: string; title: string; description: string | null; published: boolean };

function TakeMcq() {
  const { setId } = useParams({ from: "/_authenticated/mcq/$setId" });
  const { userId } = useRoles();
  const [set, setSet] = useState<SetRow | null>(null);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      // Demo student: render a self-contained fixture quiz, never real content.
      if (isDemoStudent()) {
        const demo = DEMO_MCQ[setId];
        if (demo) {
          setSet(demo.set);
          setQuestions(demo.questions);
        } else {
          setSet(null);
        }
        return;
      }
      const { data: s } = await supabase
        .from("mcq_sets")
        .select("id, title, description, published")
        .eq("id", setId)
        .maybeSingle();
      setSet(s as SetRow | null);
      const { data: qs } = await supabase
        .from("mcq_questions")
        .select("id, position, question, options, correct_index, explanation")
        .eq("set_id", setId)
        .order("position");
      setQuestions((qs ?? []).map((q) => ({ ...q, options: q.options as string[] })));
    })();
  }, [setId]);

  const submit = async () => {
    let correct = 0;
    for (const q of questions) if (answers[q.id] === q.correct_index) correct += 1;
    setScore(correct);
    setSubmitted(true);

    // Demo student: score locally, never write an attempt to the DB.
    if (isDemoStudent()) {
      toast.success(`Scored ${correct}/${questions.length}`);
      return;
    }

    if (!userId || questions.length === 0) return;
    const { error } = await supabase.from("mcq_attempts").insert({
      set_id: setId,
      user_id: userId,
      score: correct,
      total: questions.length,
      answers,
    });
    if (error) toast.error(error.message);
    else toast.success(`Scored ${correct}/${questions.length}`);
  };

  if (!set) return <AppLayout title="MCQ">Loading…</AppLayout>;

  return (
    <AppLayout title={set.title}>
      <div className="max-w-3xl">
        {set.description && <p className="text-sm text-muted-foreground mb-6">{set.description}</p>}
        <ol className="space-y-5">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            return (
              <li key={q.id} className="rounded-2xl bg-card border border-border p-5">
                <p className="text-xs uppercase tracking-widest text-primary font-semibold">
                  Question {idx + 1}
                </p>
                <p className="font-display text-lg mt-1">{q.question}</p>
                <div className="mt-3 space-y-2">
                  {q.options.map((opt, i) => {
                    const isChosen = chosen === i;
                    const isCorrect = submitted && i === q.correct_index;
                    const isWrong = submitted && isChosen && i !== q.correct_index;
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
                {submitted && q.explanation && (
                  <p className="mt-3 text-xs text-muted-foreground border-t border-border pt-3">
                    <span className="font-semibold text-foreground">Explanation:</span>{" "}
                    {q.explanation}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {!submitted ? (
          <button
            onClick={submit}
            disabled={Object.keys(answers).length !== questions.length}
            className="mt-6 w-full h-11 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
          >
            Submit answers
          </button>
        ) : (
          <div className="mt-6 rounded-2xl bg-card border border-border p-6 text-center">
            <p className="text-xs uppercase tracking-widest text-primary font-semibold">
              Your score
            </p>
            <p className="font-display text-4xl font-semibold mt-1">
              {score}/{questions.length}
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
