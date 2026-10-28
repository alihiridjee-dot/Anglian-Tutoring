import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Chip, EmptyState, ErrorNote, SciBlock, SciText, Spinner } from "@/components/Shared";
import { AppLayout } from "@/components/AppLayout";
import { QuestionFlipCard } from "@/components/mcq/QuestionFlipCard";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRole";
import { usePinSubject } from "@/hooks/useActiveSubject";
import { toast } from "sonner";
import { CheckCircle2, Lightbulb, XCircle } from "lucide-react";
import { isDemoStudent, DEMO_MCQ } from "@/lib/demo/studentDemo";
import { rowOptions } from "@/lib/platform/textBlocks";
import {
  answersDiffer,
  attemptIdFor,
  clearMcqAnswers,
  loadMcqAnswers,
  reconcileAnswers,
  renewAttemptId,
  saveMcqAnswers,
  savedAttemptId,
  type McqAnswers,
} from "@/lib/mcq/mcqAnswers";
import { describeQuizError, isQuizChanged } from "@/lib/mcq/quizErrors";
import { retakeOpensAt, retakeOpensLabel } from "@/lib/mcq/retakeLock";
import type { Json } from "@/integrations/supabase/types";
import { StoredFigure } from "@/components/QuestionFigure";

type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
  /** The figure the question is answered from, `{ svg, alt }`, or null. */
  figure?: Json | null;
};

type SetRow = {
  id: string;
  title: string;
  description: string | null;
  published: boolean;
  /** Absent on the showcase fixtures, which have no header slider to move. */
  subject?: string | null;
};

type Paper = { set: SetRow; questions: Q[] };

/** What the server sends back once the paper has been marked. */
type Marked = {
  score: number;
  total: number;
  byQuestion: Record<string, { correctIndex: number; explanation: string | null }>;
  /** When the quiz opens again (see retakeLock). Null on the showcase, which has no lock. */
  retakeOpensAt: Date | null;
};

/** The marked paper, the answers it was marked on, and the attempt it was filed as. */
type Review = { marked: Marked; answers: McqAnswers; attemptId: string | null };

/**
 * Read `grade_mcq_attempt`'s reply. The answers come from it too: when the
 * server returns an attempt already filed (a retry, or a retake inside the
 * week from a second tab), those are the answers it marked, not the ones on
 * the screen.
 */
function readGraded(data: unknown): Review {
  const graded = data as {
    attempt_id?: string;
    score: number;
    total: number;
    results: Array<{
      question_id: string;
      correct_index: number;
      explanation: string | null;
      chosen_index: number | null;
    }>;
    retake_opens_at?: string;
  } | null;
  if (!graded || typeof graded.score !== "number") {
    throw new Error("The quiz couldn't be marked — try submitting again.");
  }
  const byQuestion: Marked["byQuestion"] = {};
  const answers: McqAnswers = {};
  for (const r of graded.results ?? []) {
    byQuestion[r.question_id] = { correctIndex: r.correct_index, explanation: r.explanation };
    if (typeof r.chosen_index === "number") answers[r.question_id] = r.chosen_index;
  }
  const opens = graded.retake_opens_at ? new Date(graded.retake_opens_at) : null;
  return {
    marked: {
      score: graded.score,
      total: graded.total,
      byQuestion,
      retakeOpensAt: opens && Number.isFinite(opens.getTime()) ? opens : null,
    },
    answers,
    attemptId: graded.attempt_id ?? null,
  };
}

/**
 * This student's attempt from the last week, marked — or null when the quiz is
 * open to them. The server won't file another attempt inside the week, so the
 * page opens on the one it has rather than a blank paper it would not keep.
 */
async function fetchLockedAttempt(userId: string, setId: string): Promise<Review | null> {
  const { data: last, error } = await supabase
    .from("mcq_attempts")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("set_id", setId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!last) return null;
  const opensAt = retakeOpensAt(last.created_at);
  if (opensAt.getTime() <= Date.now()) return null;
  // The filed attempt's own id replays it: marked, with explanations, and
  // nothing written.
  const { data, error: gradeError } = await supabase.rpc("grade_mcq_attempt", {
    _set_id: setId,
    _answers: {} as Json,
    _attempt_id: last.id,
  });
  if (gradeError) throw gradeError;
  const review = readGraded(data);
  review.marked.retakeOpensAt = opensAt;
  return review;
}

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
      .select("id, title, description, published, subject")
      .eq("id", setId)
      .maybeSingle(),
    supabase
      .from("mcq_questions")
      .select("id, position, question, options, figure")
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
  // A tutor opens a quiz from the quiz manager to see it as a student does. It
  // is a preview: staff accounts hold no student data, so nothing is filed.
  const { userId, isTutor } = useRoles();
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

  // Taken in the last week? Then it opens as a review of that attempt. Never
  // refetched behind the student's back, like the paper; a submission below
  // writes its result straight in, so coming back shows it.
  const lockKey = ["mcq", "locked", setId, userId] as const;
  const checkLock = !!setId && !!userId && !demo && !isTutor;
  const locked = useQuery({
    queryKey: lockKey,
    queryFn: () => fetchLockedAttempt(userId!, setId),
    enabled: checkLock,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const lockPending = checkLock && locked.isPending;

  // A quiz belongs to one subject: opening it moves the header slider there,
  // and switching subject mid-quiz goes to the quiz list for the new one. The
  // answers chosen so far are kept (see saveMcqAnswers) for coming back.
  const navigate = useNavigate();
  usePinSubject(set?.subject, () => navigate({ to: demo ? "/demo/student/mcqs" : "/mcqs" }));

  // A new quiz starts clean — then picks up whatever this student had already
  // chosen on it before a reload took the page away.
  //
  // Once per (student, quiz), which is what the ref is for. Keyed on the
  // questions alone, anything that handed back a fresh array — an invalidation,
  // a refetch — would re-run this and clear `marked`, taking the score and the
  // explanations off the screen while the student was still reading them.
  const startedFor = useRef<string | null>(null);
  // The id this sitting is filed under. Fixed when the quiz starts, so a
  // retry after a lost reply returns the attempt already filed (see
  // `attemptIdFor`); a fresh visit after a marked attempt gets a new one.
  const attemptId = useRef<string | null>(null);
  // Whether that id was kept from an earlier page load rather than made now.
  const restoredId = useRef(false);
  // The score card, which takes focus once Submit has marked the paper: the
  // button that had it is gone, and focus fell back to the top of the page.
  const scoreRef = useRef<HTMLDivElement>(null);
  const focusScore = useRef(false);
  useEffect(() => {
    if (!marked || !focusScore.current) return;
    focusScore.current = false;
    scoreRef.current?.focus();
  }, [marked]);
  useEffect(() => {
    if (questions.length === 0 || lockPending) return;
    const attempt = `${userId ?? ""}:${setId}`;
    if (startedFor.current === attempt) return;
    startedFor.current = attempt;
    if (locked.data) {
      setMarked(locked.data.marked);
      setAnswers(reconcileAnswers(locked.data.answers, questions));
      attemptId.current = null;
      restoredId.current = false;
      // Filed already, so nothing kept for a retry is wanted. Left behind, the
      // id came back on the next sitting a week later and replayed this one.
      if (userId) clearMcqAnswers(userId, setId);
      return;
    }
    setMarked(null);
    setAnswers(userId && !demo ? reconcileAnswers(loadMcqAnswers(userId, setId), questions) : {});
    restoredId.current = !!userId && !demo && savedAttemptId(userId, setId) !== null;
    attemptId.current = userId && !demo ? attemptIdFor(userId, setId) : null;
  }, [setId, userId, demo, questions, lockPending, locked.data]);

  const choose = (questionId: string, index: number) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: index };
      if (userId && !demo) saveMcqAnswers(userId, setId, next);
      return next;
    });
  };

  const backTo = demo ? "/demo/student/dashboard" : "/dashboard";

  const submit = async () => {
    // An in-flight guard, not just a disabled button. Marking is a round trip,
    // and two clicks landing before the first response would file two attempts
    // — which the planner then reads as two separate pieces of practice.
    if (submitting || submitted || isTutor) return;
    if (questions.length === 0) return;

    // Submit stays pressable with a question left blank, and says which: a
    // greyed-out button on a long quiz left the student hunting for the gap.
    const gap = questions.findIndex((q) => answers[q.id] === undefined);
    if (gap !== -1) {
      toast.info(`Answer question ${gap + 1} first.`);
      const card = document.getElementById(`question-${questions[gap].id}`);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      // An option, not the first button: a question with a picture has its
      // "Show full size" button above the options.
      card
        ?.querySelector<HTMLButtonElement>("button[aria-pressed]")
        ?.focus({ preventScroll: true });
      return;
    }

    // Demo student: mark locally against the fixture, never write an attempt.
    if (demo) {
      const fixture = DEMO_MCQ[setId];
      const byQuestion: Marked["byQuestion"] = {};
      let correct = 0;
      for (const q of fixture?.questions ?? []) {
        byQuestion[q.id] = { correctIndex: q.correct_index, explanation: q.explanation };
        if (answers[q.id] === q.correct_index) correct += 1;
      }
      focusScore.current = true;
      setMarked({ score: correct, total: questions.length, byQuestion, retakeOpensAt: null });
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
      // Only the questions on the screen are sent.
      const sent = reconcileAnswers(answers, questions);
      const file = async () => {
        const { data, error } = await supabase.rpc("grade_mcq_attempt", {
          _set_id: setId,
          _answers: sent as unknown as Json,
          _attempt_id: attemptId.current ?? undefined,
        });
        if (error) throw error;
        return readGraded(data);
      };
      let review = await file();
      // The server replayed this tab's own id from a sitting whose week is
      // over, so these answers were never filed: file them under a new id.
      // Only an id kept from an earlier page load can be that old; one made on
      // this load is new, however far ahead the device's clock is set.
      const opens = review.marked.retakeOpensAt;
      const firstId = review.attemptId;
      if (
        restoredId.current &&
        attemptId.current &&
        firstId === attemptId.current &&
        opens &&
        opens.getTime() <= Date.now()
      ) {
        attemptId.current = renewAttemptId(userId, setId);
        review = await file();
        // The same attempt again: it was filed this week after all, and only
        // the device's clock said otherwise. It is still this tab's own.
        if (review.attemptId === firstId) attemptId.current = firstId;
      }
      // An attempt other than this one: taken earlier this week, in another
      // tab or on another device. That is the one shown, so say so.
      const earlier =
        attemptId.current !== null &&
        review.attemptId !== null &&
        review.attemptId !== attemptId.current;
      // This tab's own id, filed before with other answers: a submit whose
      // reply was lost and then changed, or a duplicated tab. Shown as filed.
      const resent = !earlier && answersDiffer(sent, review.answers, questions);
      // A server from before the lock sends no date; the attempt is a moment old.
      review.marked.retakeOpensAt ??= retakeOpensAt(new Date());
      focusScore.current = true;
      setMarked(review.marked);
      setAnswers(reconcileAnswers(review.answers, questions));
      plannerQueryClient.setQueryData(lockKey, review);
      clearMcqAnswers(userId, setId);
      if (earlier) toast.info("You took this quiz earlier this week — here's that attempt.");
      else if (resent) toast.info("Your first submit went through — here's that attempt.");
      else toast.success(`Scored ${review.marked.score}/${review.marked.total}`);
      void invalidatePlanner(plannerQueryClient, userId);
      // The averages and predicted grade are built from attempts like this one.
      void plannerQueryClient.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err) {
      // The student keeps their answers and can simply press submit again. If
      // the attempt was in fact filed and only the reply was lost, the retry
      // carries the same id and gets that attempt back rather than a second.
      toast.error(describeQuizError(err, "Couldn't submit — try again."));
      // Rewritten since this page opened: fetch the new questions. Answers to
      // questions that are still there are kept.
      if (isQuizChanged(err)) void paper.refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const back = (
    <Link
      to={backTo}
      className="mt-4 inline-flex min-h-11 items-center text-sm text-primary hover:underline sm:pointer-fine:min-h-0"
    >
      ← Back to dashboard
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
        <div className="max-w-3xl">
          <EmptyState
            mascot="books"
            title="That quiz isn't available"
            action={{ to: demo ? "/demo/student/mcqs" : "/mcqs", label: "Back to quizzes" }}
          />
        </div>
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
            body={
              isTutor
                ? "Nothing has been written for it so far."
                : "Your tutor is still putting it together."
            }
            action={
              isTutor
                ? { to: "/mcqs", label: "Back to quizzes" }
                : { to: backTo, label: "Back to dashboard" }
            }
          />
        </div>
      </AppLayout>
    );
  }
  // After the checks above, so a quiz that has gone says so rather than
  // failing here: the lock's replay asks the same visibility question.
  if (locked.error) {
    return (
      <AppLayout title={set.title}>
        <div className="max-w-3xl">
          <ErrorNote error={locked.error} onRetry={() => void locked.refetch()} />
          {back}
        </div>
      </AppLayout>
    );
  }
  if (lockPending)
    return (
      <AppLayout title={set.title}>
        <Spinner label="Loading the quiz" />
      </AppLayout>
    );

  const opensLabel = marked?.retakeOpensAt ? retakeOpensLabel(marked.retakeOpensAt) : null;

  return (
    <AppLayout title={set.title}>
      <div className="max-w-3xl">
        {set.description && (
          <p className="text-sm text-muted-foreground mb-6">
            <SciText text={set.description} />
          </p>
        )}
        {/* A quiz opened inside its week lands here, already marked: say why
            before the student tries to change an answer. */}
        {marked && opensLabel && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="chip chip-solid">
              <span className="numeral">
                {marked.score}/{marked.total}
              </span>
            </span>
            <span className="chip">Retake opens {opensLabel}</span>
          </div>
        )}
        <ol className="space-y-5">
          {questions.map((q, idx) => {
            const chosen = answers[q.id];
            // Read together, so a wrong option is written like the right one.
            const notation = [q.question, ...q.options].join("\n");
            const mark = marked?.byQuestion[q.id];
            const letter = (i: number) => String.fromCharCode(65 + i);
            // "Which row…?": each option is a row of the table the question
            // heads, so the options line up under its headings, as on a paper.
            const table = rowOptions(q.question, q.options);
            const columns = table && {
              gridTemplateColumns: `1.5rem repeat(${table.columns.length}, minmax(0, 1fr)) 1rem`,
            };
            const headings = table && (
              <div
                className="font-display grid gap-x-3 border border-transparent px-4 text-sm font-extrabold break-words"
                style={columns!}
              >
                <span />
                {table.columns.map((c, j) => (
                  <span key={j}>
                    <SciText text={c} context={notation} />
                  </span>
                ))}
                <span />
              </div>
            );
            // An option as the card draws it, front and back alike: a row under
            // the headings, or its letter and text. On a phone the columns are too
            // narrow for words, so each cell sits under its column's name instead,
            // as a table does there.
            const option = (i: number, text: string, result?: "right" | "wrong") => {
              const place = table ? "" : "inline ml-2";
              // The icons are drawn only; a screen reader hears the words.
              const icon =
                result === "right" ? (
                  <>
                    <CheckCircle2 className={`w-4 h-4 text-primary ${place}`} />
                    <span className="sr-only">Correct answer</span>
                  </>
                ) : result === "wrong" ? (
                  <>
                    <XCircle className={`w-4 h-4 text-destructive ${place}`} />
                    <span className="sr-only">Your answer, wrong</span>
                  </>
                ) : null;
              return table ? (
                <>
                  <span className="hidden items-baseline gap-x-3 sm:grid" style={columns!}>
                    <span className="font-mono text-xs text-muted-foreground">{letter(i)}.</span>
                    {table.rows[i].map((c, j) => (
                      <span key={j}>
                        <SciText text={c} context={notation} />
                      </span>
                    ))}
                    <span className="self-center">{icon}</span>
                  </span>
                  <span className="flex items-start gap-2 sm:hidden">
                    <span className="font-mono text-xs text-muted-foreground pt-0.5">
                      {letter(i)}.
                    </span>
                    <span className="min-w-0 flex-1 space-y-0.5">
                      {table.rows[i].map((c, j) => (
                        <span key={j} className="block">
                          <b>
                            <SciText text={table.columns[j]} context={notation} />:
                          </b>{" "}
                          <SciText text={c} context={notation} />
                        </span>
                      ))}
                    </span>
                    {icon && <span className="self-center">{icon}</span>}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-mono text-xs mr-2 text-muted-foreground">{letter(i)}.</span>
                  <SciText text={text} context={notation} />
                  {icon}
                </>
              );
            };
            // The back of the card: the right answer as the front draws it, and
            // the explanation large enough to read on a phone.
            const back = mark?.explanation ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="icon-tile size-10 shrink-0" aria-hidden>
                    <Lightbulb className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="eyebrow">Question {idx + 1}</p>
                    <h3 className="text-2xl">Why it's {letter(mark.correctIndex)}</h3>
                  </div>
                  {chosen === mark.correctIndex ? (
                    <Chip icon={CheckCircle2} tint="tint-primary">
                      You got it
                    </Chip>
                  ) : chosen !== undefined ? (
                    <Chip icon={XCircle} tint="tint-rose">
                      You picked {letter(chosen)}
                    </Chip>
                  ) : null}
                </div>
                {headings && <div className="mt-4 hidden sm:block">{headings}</div>}
                <div
                  className={`${headings ? "mt-4 sm:mt-1.5" : "mt-4"} rounded-lg border border-primary bg-primary/15 px-4 py-2.5 text-sm break-words`}
                >
                  {option(mark.correctIndex, q.options[mark.correctIndex] ?? "", "right")}
                </div>
                <p className="mt-4 text-lg leading-relaxed text-foreground sm:text-xl">
                  <SciText text={mark.explanation} context={notation} />
                </p>
              </>
            ) : null;
            return (
              <QuestionFlipCard
                key={q.id}
                id={`question-${q.id}`}
                back={back}
                front={
                  <>
                    <p className="eyebrow">Question {idx + 1}</p>
                    <SciBlock
                      text={table ? table.question : q.question}
                      context={notation}
                      className="font-display text-lg mt-1 break-words"
                    />
                    <StoredFigure figure={q.figure} className="mt-3" />
                    {headings && <div className="mt-3 hidden sm:block">{headings}</div>}
                    <div className={`${headings ? "mt-3 sm:mt-1.5" : "mt-3"} space-y-2`}>
                      {q.options.map((opt, i) => {
                        const isChosen = chosen === i;
                        const isCorrect = !!mark && i === mark.correctIndex;
                        const isWrong = !!mark && isChosen && i !== mark.correctIndex;
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={isChosen}
                            disabled={submitted}
                            onClick={() => choose(q.id, i)}
                            className={`w-full min-h-11 text-left px-4 py-2.5 rounded-lg border text-sm break-words transition sm:pointer-fine:min-h-0 ${
                              isCorrect
                                ? "bg-primary/15 border-primary text-foreground"
                                : isWrong
                                  ? "bg-destructive/10 border-destructive/50"
                                  : isChosen
                                    ? "bg-secondary border-primary/50"
                                    : "bg-secondary/40 border-border hover:border-primary/40"
                            }`}
                          >
                            {option(i, opt, isCorrect ? "right" : isWrong ? "wrong" : undefined)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                }
              />
            );
          })}
        </ol>
        {isTutor ? (
          <div className="mt-6 text-center">
            <span className="chip tint-slate">Tutor preview</span>
          </div>
        ) : !submitted ? (
          <button
            data-guide="quiz-submit"
            onClick={submit}
            disabled={submitting}
            className="mt-6 w-full h-11 rounded-xl btn-solid font-semibold disabled:opacity-50"
          >
            {submitting ? "Marking…" : "Submit answers"}
          </button>
        ) : (
          <div
            ref={scoreRef}
            tabIndex={-1}
            className="mt-6 rounded-2xl premium-card p-4 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--tint)] sm:p-6"
          >
            <p className="eyebrow eyebrow-bare">Your score</p>
            <p className="font-display text-4xl font-bold mt-1">
              {marked?.score}/{marked?.total}
            </p>
            {opensLabel && (
              <div className="mt-3">
                <span className="chip">Retake opens {opensLabel}</span>
              </div>
            )}
            <div>{back}</div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
