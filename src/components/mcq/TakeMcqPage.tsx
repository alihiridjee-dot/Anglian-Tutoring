import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorNote, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { isDemoStudent, DEMO_MCQ } from "@/lib/demo/studentDemo";
import { describeError } from "@/lib/platform/errors";
import {
  clearMcqAnswers,
  loadMcqAnswers,
  reconcileAnswers,
  saveMcqAnswers,
  type McqAnswers,
} from "@/lib/mcq/mcqAnswers";
import type { Json } from "@/integrations/supabase/types";

type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
};

type SetRow = { id: string; title: string; description: string | null; published: boolean };

type Paper = { set: SetRow; questions: Q[] };

/** What the server sends back once the paper has been marked. */
type Marked = {
  score: number;
  total: number;
  byQuestion: Record<string, { correctIndex: number; explanation: string | null }>;
};

/** Stable identity for "no questions yet", so effects keyed on it don't re-run every render. */
const EMPTY_QUESTIONS: Q[] = [];

/**
 * The paper: its title and its questions, without the answers.
 *
 * Resolves to null when the set doesn't exist or isn't this student's to open,
 * and throws when it simply couldn't be fetched — those are different screens.
 * The first is final; the second gets a "Try again".
 */
async function fetchPaper(setId: string): Promise<Paper | null> {
  // Demo student: render a self-contained fixture quiz, never real content.
  if (isDemoStudent()) {
    const demo = DEMO_MCQ[setId];
    return demo ? { set: demo.set, questions: demo.questions } : null;
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
  if (sErr) throw sErr;
  if (qErr) throw qErr;
  if (!s) return null;
  return {
    set: s as SetRow,
    questions: ((qs ?? []) as Q[]).map((q) => ({
      ...q,
      options: Array.isArray(q.options) ? (q.options as string[]) : [],
    })),
  };
}

export function TakeMcq() {
  const plannerQueryClient = useQueryClient();
  // `strict: false` because this component is mounted twice — here, and again
  // under /demo/student for the signed-out showcase. Binding the params to one
  // route id makes it readable from only one of them, and the showcase mount
  // threw on every render until the list stopped linking past it.
  const params = useParams({ strict: false }) as { setId?: string };
  const setId = params.setId ?? "";
  const { userId } = useRoles();
  const demo = isDemoStudent();
  const [answers, setAnswers] = useState<McqAnswers>({});
  const [marked, setMarked] = useState<Marked | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitted = marked !== null;

  // Keyed by the set, so moving between quizzes can't paint the previous
  // quiz's questions under the new quiz's title. Never refetched behind the
  // student's back: a paper that re-ordered itself mid-attempt would be worse
  // than one a few minutes old.
  const paper = useQuery({
    queryKey: ["mcq", "paper", setId, demo],
    queryFn: () => fetchPaper(setId),
    enabled: !!setId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const set = paper.data?.set ?? null;
  const questions = paper.data?.questions ?? EMPTY_QUESTIONS;

  // A new quiz starts clean — then picks up whatever this student had already
  // chosen on it before a reload took the page away.
  //
  // Once per (student, quiz), which is what the ref is for. Keyed on the
  // questions alone, anything that handed back a fresh array — an invalidation,
  // a refetch — would re-run this and clear `marked`, taking the score and the
  // explanations off the screen while the student was still reading them.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (questions.length === 0) return;
    const attempt = `${userId ?? ""}:${setId}`;
    if (startedFor.current === attempt) return;
    startedFor.current = attempt;
    setMarked(null);
    setAnswers(userId && !demo ? reconcileAnswers(loadMcqAnswers(userId, setId), questions) : {});
  }, [setId, userId, demo, questions]);

  const choose = (questionId: string, index: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: index };
      if (userId && !demo) saveMcqAnswers(userId, setId, next);
      return next;
    });
  };

  const backTo = demo ? "/demo/student/curriculum" : "/curriculum";

  const submit = async () => {
    // An in-flight guard, not just a disabled button. Marking is a round trip,
    // and two clicks landing before the first response would file two attempts
    // — which the planner then reads as two separate pieces of practice.
    if (submitting || submitted) return;
    if (questions.length === 0) return;

    // Demo student: mark locally against the fixture, never write an attempt.
    if (demo) {
      const fixture = DEMO_MCQ[setId];
      const byQuestion: Marked["byQuestion"] = {};
      let correct = 0;
      for (const q of fixture?.questions ?? []) {
        byQuestion[q.id] = { correctIndex: q.correct_index, explanation: q.explanation };
        if (answers[q.id] === q.correct_index) correct += 1;
      }
      setMarked({ score: correct, total: questions.length, byQuestion });
      toast.success(`Scored ${correct}/${questions.length}`);
      return;
    }

    // Said out loud rather than returned from: a Submit button that does
    // nothing is the one failure a student can't tell from a frozen page.
    if (!userId) {
      toast.error("Your session has ended — sign in again to submit.");
      return;
    }
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
      } | null;
      if (!graded || typeof graded.score !== "number") {
        throw new Error("The quiz couldn't be marked — try submitting again.");
      }
      const byQuestion: Marked["byQuestion"] = {};
      for (const r of graded.results ?? []) {
        byQuestion[r.question_id] = {
          correctIndex: r.correct_index,
          explanation: r.explanation,
        };
      }
      setMarked({ score: graded.score, total: graded.total, byQuestion });
      clearMcqAnswers(userId, setId);
      toast.success(`Scored ${graded.score}/${graded.total}`);
      void invalidatePlanner(plannerQueryClient, userId);
      // The averages and predicted grade are built from attempts like this one.
      void plannerQueryClient.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err) {
      // Nothing is marked on a failure, so the student keeps their answers and
      // can simply press submit again.
      toast.error(describeError(err, "Couldn't submit — try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const back = (
    <Link
      to={backTo}
      className="mt-4 inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:min-h-0"
    >
      ← Back to curriculum
    </Link>
  );

  if (paper.error) {
    return (
      <AppLayout title="MCQ">
        <div className="max-w-3xl">
          <ErrorNote error={paper.error} onRetry={() => void paper.refetch()} />
          {back}
        </div>
      </AppLayout>
    );
  }
  if (paper.isPending)
    return (
      <AppLayout title="MCQ">
        <Spinner label="Loading the quiz" />
      </AppLayout>
    );
  if (!set) {
    return (
      <AppLayout title="MCQ">
        <p className="text-sm text-muted-foreground">That quiz isn&apos;t available.</p>
        {back}
      </AppLayout>
    );
  }
  // A set with nothing in it used to render a title over an enabled Submit
  // button that did nothing when pressed.
  if (questions.length === 0) {
    return (
      <AppLayout title={set.title}>
        <div className="max-w-3xl">
          <EmptyState
            mascot="books"
            title="This quiz has no questions yet"
            body="Your tutor is still putting it together."
            action={{ to: backTo, label: "Back to curriculum" }}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title={set.title}>
      <div className="max-w-3xl">
        {set.description && <p className="text-sm text-muted-foreground mb-6">{set.description}</p>}
        <ol className="space-y-5">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            return (
              <li key={q.id} className="rounded-2xl premium-card p-4 sm:p-5">
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
                        onClick={() => choose(q.id, i)}
                        className={`w-full min-h-11 text-left px-4 py-2.5 rounded-lg border text-sm break-words transition sm:min-h-0 ${
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
            data-guide="quiz-submit"
            onClick={submit}
            disabled={submitting || Object.keys(answers).length !== questions.length}
            className="mt-6 w-full h-11 rounded-xl btn-solid font-semibold disabled:opacity-50"
          >
            {submitting ? "Marking…" : "Submit answers"}
          </button>
        ) : (
          <div className="mt-6 rounded-2xl premium-card p-4 text-center sm:p-6">
            <p className="text-xs uppercase tracking-widest text-primary font-semibold">
              Your score
            </p>
            <p className="font-display text-4xl font-bold mt-1">
              {marked?.score}/{marked?.total}
            </p>
            <div>{back}</div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
