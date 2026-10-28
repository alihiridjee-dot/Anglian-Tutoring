import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Check,
  ClipboardCheck,
  Clock3,
  Loader2,
  PenLine,
  Send,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { dbError } from "@/lib/platform/errors";
import {
  clearDraft,
  draftsClearedCount,
  editStamp,
  loadDraft,
  mergeDrafts,
  saveDraft,
  syncServerDraft,
  type TimestampedDraft,
} from "@/lib/homework/homeworkDrafts";
import { isAlreadySubmitted, markingStalled, startMarking } from "@/lib/homework/startMarking";
import { creditRuns, creditsToShow } from "@/lib/homework/creditedQuotes";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";
import { Meter, SciBlock, SciText, Spinner } from "@/components/Shared";
import { Confetti, Mascot, Sparkles } from "@/components/Doodles";
import { SciAnswerBox } from "@/components/homework/SciAnswerBox";
import { MarkScheme } from "@/components/homework/MarkScheme";
import { isDemoStudent } from "@/lib/demo/studentDemo";
import { StoredFigure } from "@/components/QuestionFigure";
import { questionLayout, spacedLines } from "@/lib/platform/textBlocks";
import { ANSWER_MAX, isBlank } from "@/lib/platform/textLimits";

/**
 * The body of a homework sheet: the questions, and either the boxes to answer
 * them in or what was written and what it scored.
 *
 * Homework is an on-site activity. The student reads each question and types
 * the answer here — nothing is downloaded, nothing is uploaded, and nothing is
 * handed in as a document. That is also what makes it markable in place and
 * attributable to a spec point.
 *
 * It rules out photographed working, so the questions have to be written to
 * suit: the generator is told to avoid anything needing a diagram *from* the
 * student, and to keep every answer expressible as typed text.
 *
 * Submitting writes the submission and every answer in one transaction
 * (`submit_homework_answers`), so a network failure mid-way can't leave a
 * submission with half its answers — and submissions are final either way.
 */

const TYPE_HINT: Record<HomeworkQuestion["answer_type"], string> = {
  short: "A sentence or two.",
  long: "Write in full — several sentences, using the marks as your guide.",
  numeric: "Give the value and its unit. Show your working if it helps.",
};

/**
 * How many ruled lines a question's answer box starts with. An exam paper
 * leaves room by the marks, so the space itself says how much to write; the
 * box still grows past it.
 */
function answerLines(q: HomeworkQuestion): number {
  if (q.answer_type === "numeric") return 3;
  const perMark = q.answer_type === "long" ? 2 : 1;
  return Math.min(8, Math.max(2, q.marks * perMark + 1));
}

const linesStyle = (q: HomeworkQuestion) => ({ "--lines": answerLines(q) }) as CSSProperties;

export function BuiltInHomework({
  hw,
  questions,
  userId,
  submission,
  answers,
  onChanged,
  readonly,
  showMarkScheme = false,
}: {
  hw: { id: string; title: string };
  questions: HomeworkQuestion[];
  userId: string | null;
  submission?: { id: string; graded_at: string | null; release_at?: string | null };
  answers: Record<string, HomeworkAnswer>;
  onChanged: () => void;
  readonly: boolean;
  /** Tutors previewing a sheet see the mark schemes; nobody else does. */
  showMarkScheme?: boolean;
}) {
  return submission ? (
    <AnsweredView questions={questions} answers={answers} marked={!!submission.graded_at} />
  ) : (
    <AnswerForm
      hw={hw}
      questions={questions}
      userId={userId}
      onChanged={onChanged}
      readonly={readonly}
      showMarkScheme={showMarkScheme}
    />
  );
}

/** What the student wrote, alongside the marks and comments once it's been marked. */
export function AnsweredView({
  questions,
  answers,
  marked,
}: {
  questions: HomeworkQuestion[];
  answers: Record<string, HomeworkAnswer>;
  marked: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">Your answers</p>
      <ol className="mt-3 space-y-3">
        {questions.map((q, i) => {
          const a = answers[q.id];
          // Read with the question, so "Cl3" beside a Cl₂ question reads Cl₃.
          const notation = `${q.prompt}\n${q.mark_scheme ?? ""}`;
          return (
            <li key={q.id} className="premium-card p-4 sm:p-5">
              <QuestionHeader
                q={q}
                index={i}
                awarded={a?.awarded_marks != null ? Number(a.awarded_marks) : undefined}
              />
              <MarkedAnswer q={q} index={i} answer={a} notation={notation} />
              {a?.feedback && (
                <TitledBox icon={PenLine} title="Feedback">
                  <p className="text-sm leading-relaxed font-medium whitespace-pre-wrap">
                    <SciText text={a.feedback} context={notation} />
                  </p>
                </TitledBox>
              )}
              {/* The mark scheme is the answer — it stays hidden until the work
                  has actually been marked. */}
              {marked && q.mark_scheme && (
                <TitledBox icon={ClipboardCheck} title="Mark scheme">
                  <MarkScheme
                    scheme={q.mark_scheme}
                    context={notation}
                    marks={q.marks}
                    className="text-sm"
                  />
                </TitledBox>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * What the student typed, on the same ruled lines they typed it on, with the
 * words that earned each mark under the highlighter and a tick after them.
 * Tapping a tick names the mark-scheme point it earned. The ticks are the
 * marker's own quotes (see `creditedQuotes`); an answer marked before they
 * were kept, or whose mark a tutor changed, shows without them.
 */
function MarkedAnswer({
  q,
  index,
  answer,
  notation,
}: {
  q: HomeworkQuestion;
  index: number;
  answer: HomeworkAnswer | undefined;
  notation: string;
}) {
  const text = answer?.answer_text ?? "";
  const credits = useMemo(
    () =>
      creditsToShow(
        answer?.credited,
        answer?.awarded_marks != null ? Number(answer.awarded_marks) : null,
      ),
    [answer?.credited, answer?.awarded_marks],
  );
  const runs = useMemo(() => creditRuns(text, credits), [text, credits]);
  const [open, setOpen] = useState<number | null>(null);
  const shown = open != null ? credits[open] : undefined;

  return (
    <div className="mt-4">
      <div
        style={linesStyle(q)}
        aria-label={`Your answer to question ${index + 1}`}
        className="premium-input answer-lines w-full text-base break-words whitespace-pre-wrap"
      >
        {isBlank(text) ? (
          <span className="text-muted-foreground italic">Left blank</span>
        ) : (
          runs.map((r, k) => {
            if (r.credit == null) return <SciText key={k} text={r.text} context={notation} />;
            const c = credits[r.credit];
            const on = open === r.credit;
            return (
              <span key={k} className="tint-emerald">
                <mark className="marker bg-transparent text-inherit">
                  <SciText text={r.text} context={notation} />
                </mark>
                <button
                  type="button"
                  onClick={() => setOpen(on ? null : r.credit!)}
                  aria-pressed={on}
                  aria-label={`${c.marks} mark${c.marks === 1 ? "" : "s"}${c.point ? `: ${c.point}` : ""}`}
                  title={c.point || undefined}
                  className={cn(
                    "chip mx-0.5 gap-0.5 px-1.5 py-0 align-[0.08em] text-[0.7rem]",
                    on && "chip-solid",
                  )}
                >
                  <Check className="size-3" strokeWidth={3.25} aria-hidden />
                  {c.marks}
                </button>
              </span>
            );
          })
        )}
      </div>
      {shown?.point && (
        <p className="tint-emerald mt-2 flex gap-1.5 text-sm font-bold" role="status">
          <Check
            className="mt-[0.2em] size-[1.1em] shrink-0 text-[color:var(--tint)]"
            strokeWidth={2.75}
            aria-hidden
          />
          <span>
            {shown.marks} mark{shown.marks === 1 ? "" : "s"}:{" "}
            <SciText text={shown.point} context={notation} />
          </span>
        </p>
      )}
    </div>
  );
}

/** A boxed part of a marked question — the feedback, the mark scheme — under its own heading. */
function TitledBox({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("premium-card wash-top mt-3 p-3.5 sm:p-4", className)}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="icon-tile size-8 shrink-0" aria-hidden>
          <Icon className="size-4" />
        </span>
        <h4 className="text-base font-extrabold">{title}</h4>
      </div>
      {children}
    </section>
  );
}

type Draft = { text: string };

const EMPTY_WORK: TimestampedDraft = { answers: {}, notes: "", stamps: {}, savedAt: 0 };

const hasAnswers = (draft: TimestampedDraft | null) =>
  !!draft && Object.values(draft.answers).some((text) => text.trim().length > 0);

/**
 * How long a hand-in may take before it counts as failed. A phone between
 * masts can hold a request open for minutes, with the hand-in screen up and no
 * way out; past this the student can simply press it again. Kept under 20 s,
 * the no-answer limit for any database request (answerTimeout, PR #317), so
 * the student sees this message rather than a plain "Could not submit".
 */
const SUBMIT_TIMEOUT_MS = 15_000;

export function AnswerForm({
  hw,
  questions,
  userId: viewerId,
  onChanged,
  readonly,
  showMarkScheme = false,
}: {
  hw: { id: string; title: string };
  questions: HomeworkQuestion[];
  userId: string | null;
  onChanged: () => void;
  readonly: boolean;
  showMarkScheme?: boolean;
}) {
  // The showcase lets a visitor type, but keeps every word in this component:
  // no draft is read or saved and nothing is handed in. It has no student, yet
  // whoever is signed in to this browser comes through as `userId`, so it is
  // dropped here — every load, save and catch-up below waits on it.
  const demo = isDemoStudent();
  const userId = demo ? null : viewerId;
  // Every answer and the note, each with the time it was last edited here.
  // The times are what let copies from other devices merge in per question
  // (see mergeDrafts) instead of one whole draft overwriting another.
  const [work, setWork] = useState<TimestampedDraft>(EMPTY_WORK);
  // Counts the student's own edits. Saving follows this, not `work`, so taking
  // in another device's answers doesn't write them straight back.
  const [edits, setEdits] = useState(0);
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [handedIn, setHandedIn] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Handed in: a moment of well done, then off to the Weekly task list, where
  // this task now shows as handed in. The sheet reloads only as this form
  // goes; reloading straight away would swap it for the answers, and take the
  // well-done screen with it.
  useEffect(() => {
    if (!handedIn) return;
    // Only a student hands in, so their own dashboard, at the list (DoNowPanel).
    const go = setTimeout(() => {
      // From the top, as any page opens. The router leaves a `#` address at
      // the old offset until the list it names has loaded.
      window.scrollTo({ top: 0, behavior: "instant" });
      void navigate({ to: "/student-dashboard", hash: "weekly-task-list" });
    }, 2400);
    return () => {
      clearTimeout(go);
      // The sheet as it was before the hand-in is still cached, and Back from
      // the dashboard drew this blank form from it until the reload landed.
      // Dropped, it loads afresh, as handed in.
      queryClient.removeQueries({ queryKey: ["homework", "sheet", hw.id] });
      onChanged();
    };
  }, [handedIn, navigate, onChanged, queryClient, hw.id]);

  // Typing not yet kept on this device (the 400 ms save below) or on the
  // server (the 2.5 s sync): what leaving the sheet saves on the way out.
  const unsaved = useRef({ local: false, remote: false });

  const draftOf = (id: string): Draft => ({ text: work.answers[id] ?? "" });
  // Answers only. The sheet no longer has a box for a note to the tutor, so a
  // note left in an older draft stays in the draft and is never handed in.
  const edit = (id: string, text: string) => {
    // Later than any edit before it, even if the clock was put back since.
    const at = editStamp(workRef.current.stamps[id]);
    setWork((prev) => ({
      ...prev,
      answers: { ...prev.answers, [id]: text },
      stamps: { ...prev.stamps, [id]: at },
    }));
    setEdits((n) => n + 1);
    unsaved.current = { local: true, remote: true };
  };
  // Fold in another copy: the newer edit of each field wins, and typing done
  // here since stays, because it is newer.
  const takeIn = useCallback((other: TimestampedDraft | null) => {
    if (other) setWork((prev) => mergeDrafts(prev, other) ?? prev);
  }, []);

  // The latest work, for timers and listeners that outlive the render they
  // were set up in.
  const workRef = useRef(work);
  useEffect(() => {
    workRef.current = work;
  }, [work]);

  // Sign-out clears every draft on this device. A sheet still open then must
  // not write its own back on the way out.
  const clearings = useRef(draftsClearedCount());
  const saveHere = useCallback(() => {
    if (!userId || draftsClearedCount() !== clearings.current) return;
    unsaved.current.local = false;
    saveDraft(userId, hw.id, workRef.current);
  }, [userId, hw.id]);
  const sendNow = useCallback(() => {
    unsaved.current.remote = false;
    return syncServerDraft(hw.id, workRef.current);
  }, [hw.id]);

  // Bring back anything typed but never submitted — from this device and from
  // whichever others they worked on, the newer edit of each answer winning.
  //
  // This device's copy comes in at once, and from then on typing is kept
  // here (`loaded`). It used to wait for the server's reply too, so on a slow
  // or hanging connection nothing typed was saved anywhere until it came.
  //
  // Anything typed while the server's copy loads is kept: it's newer, so the
  // merge keeps it, where it used to be replaced by the draft arriving.
  //
  // Nothing may be sent to the server until its copy has *arrived*, which is
  // what `ready` gates. Gating on the load having merely begun meant the first
  // autosave fired against empty state while the fetch was still in flight,
  // writing nothing over the draft it was about to restore and deleting the
  // server copy outright — a student picking their homework up on a second
  // device lost the lot, which is the precise accident this exists to prevent.
  // The local save is safe sooner: by then this device's copy is in the page.
  //
  // No ref guards the effect, deliberately. A `hasRun` ref plus StrictMode's
  // deliberate double-mount is a deadlock: the first pass sets the ref and
  // starts the load, the cleanup cancels it, and the second pass sees the ref
  // and returns — so the load never completes and `ready` never flips. The
  // dependencies are narrow enough that re-running is simply a second read.
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  // The same two, for the listeners that save on the way out.
  const may = useRef({ local: false, remote: false });
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const local = loadDraft(userId, hw.id);
    takeIn(local);
    if (hasAnswers(local)) setRestored(true);
    may.current.local = true;
    setLoaded(true);

    void (async () => {
      // Sent as well as fetched: edits this device made offline reach the
      // server now, rather than waiting for the next keystroke.
      const server = await syncServerDraft(hw.id, local);
      if (cancelled) return;

      takeIn(server);
      if (hasAnswers(server)) setRestored(true);
      // Only now may anything be sent.
      may.current.remote = true;
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, hw.id, takeIn]);

  // Persist as they type. Debounced so a fast typist isn't writing on every
  // keystroke; localStorage takes it immediately, the server a beat later. The
  // server sends back the merged draft, which brings in anything typed on
  // another device meanwhile.
  useEffect(() => {
    if (!userId || !loaded || edits === 0) return;
    const local = setTimeout(saveHere, 400);
    return () => clearTimeout(local);
  }, [edits, userId, loaded, saveHere]);
  useEffect(() => {
    if (!userId || !ready || edits === 0) return;
    const remote = setTimeout(() => void sendNow().then(takeIn), 2500);
    return () => clearTimeout(remote);
  }, [edits, userId, ready, sendNow, takeIn]);

  // Leaving the sheet — a link, the header's subject slider, the tab hidden or
  // closed — saves what the timers above haven't yet. They are cancelled as
  // the sheet goes, and took the last few words typed with them. A closed tab
  // keeps only this device's copy: the browser cancels the send to the server,
  // and that copy goes up when the sheet next opens here, or at sign-out.
  const flush = useCallback(() => {
    if (unsaved.current.local && may.current.local) saveHere();
    if (unsaved.current.remote && may.current.remote) void sendNow();
  }, [saveHere, sendNow]);
  useEffect(() => {
    if (!userId) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [userId, flush]);

  // Coming back to this tab, or back online: catch up with the other devices
  // before the next keystroke here is saved. A tab left open since yesterday
  // is exactly the one that would otherwise be out of date.
  const catchUp = useCallback(async () => {
    takeIn(await sendNow());
  }, [sendNow, takeIn]);
  useEffect(() => {
    if (!userId || !ready) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    window.addEventListener("online", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      window.removeEventListener("online", onReturn);
    };
  }, [userId, ready, catchUp]);

  const hasUnsent = Object.values(work.answers).some((text) => !isBlank(text));

  // A reload or a closed tab is recoverable now, but a student who navigates
  // away mid-answer still deserves the browser's own warning.
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  // Invisible characters alone are blank, as the server stores them.
  const isAnswered = (q: HomeworkQuestion) => !isBlank(draftOf(q.id).text);
  const answered = questions.filter(isAnswered).length;

  // The answers this page last tried to hand in: see "Already submitted" below.
  const lastTry = useRef<string | null>(null);

  const submit = async () => {
    if (!userId) return toast.error("Not signed in");
    if (answered === 0) return toast.error("Answer at least one question before submitting");

    setSaving(true);
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), SUBMIT_TIMEOUT_MS);
    try {
      const payload = questions.map((q) => ({
        question_id: q.id,
        answer_text: draftOf(q.id).text,
      }));
      const sent = JSON.stringify(payload);
      const retry = lastTry.current === sent;
      lastTry.current = sent;

      const { data: submissionId, error } = await supabase
        .rpc("submit_homework_answers", {
          _resource_id: hw.id,
          _answers: payload,
        })
        .abortSignal(stop.signal);
      // The database answered (a refusal has a code; a lost connection or
      // the timeout has none): whatever this page sent before is settled, so
      // a later "already submitted" can't be its own. Pressed again before
      // the sheet reloads, it is still someone else's hand-in.
      if (error?.code) lastTry.current = null;
      // "Already submitted" after this page sent these same answers means its
      // earlier try got through and only the reply was lost: the work is in,
      // which is what the student wanted. The sheet reloads with the
      // submission and starts its marking from there.
      //
      // Otherwise it was handed in from another tab or device, with whatever
      // was typed there, and these answers were not sent. Say so and show what
      // was handed in, rather than the well-done screen.
      if (error && isAlreadySubmitted(error) && !retry) {
        toast("This task was already handed in. Here are the answers that were sent.");
        unsaved.current = { local: false, remote: false };
        clearDraft(userId, hw.id);
        setConfirming(false);
        onChanged();
        void invalidatePlanner(queryClient, userId);
        return;
      }
      if (error && !isAlreadySubmitted(error)) {
        if (stop.signal.aborted)
          throw new Error(
            "Handing in is taking too long. Check your connection and press it again.",
          );
        throw dbError(error);
      }

      // Start the marking, but never wait on it or surface its failure. The
      // work is safely handed in either way; a submission that goes unmarked
      // simply waits for a tutor, which is what used to happen to all of them.
      if (submissionId) startMarking(submissionId);

      toast.success("Task submitted");
      unsaved.current = { local: false, remote: false };
      clearDraft(userId, hw.id);
      setWork(EMPTY_WORK);
      setRestored(false);
      setConfirming(false);
      setHandedIn(true);
      // The weekly task list reads hand-ins too; without this it kept offering
      // "Start" on the task just handed in until its cache went stale.
      void invalidatePlanner(queryClient, userId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
      clearTimeout(timer);
      setSaving(false);
    }
  };

  if (readonly) {
    // Two audiences reach this, wanting opposite things.
    //
    // A tutor previewing a sheet is checking it, so they get the mark schemes.
    // Anyone else read-only gets the boxes — disabled, but present, because a
    // page of questions with nowhere to type them reads as broken — and never
    // the mark schemes, which are the answers. (The public showcase used to be
    // read-only here; it now gets the form below, with nothing saved.)
    return (
      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={q.id} className="premium-card p-4 sm:p-5">
            <QuestionHeader q={q} index={i} />
            {showMarkScheme ? (
              q.mark_scheme && (
                <TitledBox icon={ClipboardCheck} title="Mark scheme" className="mt-4">
                  <MarkScheme
                    scheme={q.mark_scheme}
                    context={q.prompt}
                    marks={q.marks}
                    className="text-sm"
                  />
                </TitledBox>
              )
            ) : (
              <textarea
                disabled
                placeholder={TYPE_HINT[q.answer_type]}
                style={linesStyle(q)}
                className="premium-input answer-lines mt-4 w-full text-base opacity-60"
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (demo) {
          toast(
            "This is a demo, so nothing is saved. Sign up and your tasks are marked within minutes.",
          );
          return;
        }
        // Answers typed on another device belong in what's handed in, and in
        // the count the confirmation shows.
        void catchUp().finally(() => setConfirming(true));
      }}
      className="space-y-5"
    >
      {(saving || handedIn) && <HandInScreen done={handedIn} />}

      {restored && (
        <p className="tint-primary premium-card px-4 py-2.5 text-sm font-medium">
          We brought back what you&apos;d typed last time.
        </p>
      )}

      <AnswerProgress done={questions.map(isAnswered)} />

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="premium-card p-4 sm:p-5">
            <QuestionHeader q={q} index={i} answered={isAnswered(q)} />
            <div className="mt-4">
              <SciAnswerBox
                value={draftOf(q.id).text}
                onValueChange={(text) => edit(q.id, text)}
                context={q.prompt}
                noPaste
                maxLength={ANSWER_MAX}
                placeholder={TYPE_HINT[q.answer_type]}
                aria-label={`Answer to question ${i + 1}`}
                style={linesStyle(q)}
                className="premium-input answer-lines w-full text-base select-text"
              />
            </div>
          </li>
        ))}
      </ol>

      {confirming ? (
        <div className="tint-amber premium-card space-y-3 p-4 sm:p-5">
          <p className="font-display text-lg font-bold">
            Hand in {answered} of {questions.length} answers?
          </p>
          <p className="text-sm leading-relaxed">
            Submissions are final — you can&apos;t change your answers afterwards.
            {answered < questions.length && " Anything left blank scores nothing."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="btn-solid inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:opacity-60 sm:pointer-fine:h-10"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {saving ? "Submitting…" : "Yes, hand it in"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={saving}
              className="btn-premium inline-flex h-11 items-center rounded-lg px-4 text-sm font-semibold disabled:opacity-60 sm:pointer-fine:h-10"
            >
              Keep working
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit"
          className="btn-solid inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold"
        >
          <Send className="size-4" />
          Submit answers
        </button>
      )}
    </form>
  );
}

/**
 * Handing a task in, then a well done.
 *
 * It covers the sheet from the moment the answers are sent, so nothing on it
 * can be pressed twice. Once they are in, the rocket cheers, the sticker lands
 * and the confetti falls, for the moment before the student is taken to their
 * task list. A failed hand-in closes it again, leaving the answers to resend.
 */
function HandInScreen({ done }: { done: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-primary-deep/50 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <div className="premium-card pop-in relative flex w-full max-w-sm flex-col items-center overflow-hidden px-6 pt-8 text-center">
        {done && (
          <>
            <Confetti />
            {/* A second burst, mirrored and a beat behind, so it falls both ways. */}
            <Confetti delay="0.45s" className="-scale-x-100" />
          </>
        )}
        <Mascot
          name="rocket"
          mood={done ? "proud" : "happy"}
          size={112}
          idle={!done}
          inheritTint
          className={cn(done && "cheer")}
        />
        {done && (
          <span className="sticker stamp-in mt-4">
            <Sparkles className="size-3.5 text-[color:var(--pop-ink)]" />
            Well done!
          </span>
        )}
        <h2 className="mt-3 text-2xl font-extrabold">
          {done ? "Task handed in" : "Handing it in"}
        </h2>
        <Spinner
          label={done ? "Taking you to your task list" : "Sending your answers"}
          className="pt-4 pb-7"
        />
      </div>
    </div>
  );
}

/**
 * The marks a question or a whole sheet is worth, boxed like the total on the
 * front of an exam paper. Once marked, it shows the score out of them.
 */
export function MarksBox({
  marks,
  awarded,
  size = "md",
}: {
  marks: number;
  awarded?: number;
  /** `lg` for the sheet's total, `md` for one question's. */
  size?: "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "premium-card shrink-0 text-center",
        size === "lg" ? "px-4 py-2.5" : "min-w-16 px-3 py-2",
      )}
    >
      <p
        className={cn("numeral text-[color:var(--tint)]", size === "lg" ? "text-3xl" : "text-2xl")}
      >
        {awarded != null ? `${awarded}/${marks}` : marks}
      </p>
      <p className="mt-1 text-sm font-bold">mark{marks === 1 ? "" : "s"}</p>
    </div>
  );
}

/**
 * One bar per question, each filling as its question gets an answer, beside
 * the count. A sheet too long for a bar each gets one bar for the lot.
 */
function AnswerProgress({ done }: { done: boolean[] }) {
  const answered = done.filter(Boolean).length;
  return (
    <div className="flex items-center gap-3">
      <div className="flex min-w-0 flex-1 gap-1.5" aria-hidden>
        {done.length <= 12 ? (
          done.map((d, i) => <Meter key={i} value={d ? 100 : 0} className="flex-1" />)
        ) : (
          <Meter value={(answered / done.length) * 100} />
        )}
      </div>
      <p className="shrink-0 font-bold" role="status">
        <span className="numeral text-2xl text-[color:var(--tint)]">
          {answered}/{done.length}
        </span>{" "}
        answered
      </p>
    </div>
  );
}

/**
 * A question's number, its wording and its marks. The number turns into a tick
 * once the question has an answer, so the sheet shows at a glance what is left.
 * On a phone the wording takes its own line under the number and the marks.
 */
function QuestionHeader({
  q,
  index,
  answered = false,
  awarded,
}: {
  q: HomeworkQuestion;
  index: number;
  answered?: boolean;
  awarded?: number;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap sm:gap-4">
      <span
        className={cn("icon-tile numeral size-10 shrink-0 text-lg", answered && "icon-tile-solid")}
        aria-hidden
      >
        {answered ? <Check className="pop-in size-5" strokeWidth={3} /> : index + 1}
      </span>
      <div className="order-last w-full text-base leading-relaxed font-medium break-words sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:pt-1.5 sm:text-lg">
        <span className="sr-only">
          Question {index + 1}
          {answered ? ", answered" : ""}:{" "}
        </span>
        {/* Its key, a method's steps or a table, as written; then its figure. */}
        <QuestionText text={q.prompt} />
        <StoredFigure figure={q.figure} className="mt-3" />
      </div>
      <div className="ml-auto sm:ml-0">
        <MarksBox marks={q.marks} awarded={awarded} />
      </div>
    </div>
  );
}

/**
 * A question in steps: the facts it gives, one statement per line, then each
 * lettered part on its own row with its own marks, or the line that asks set
 * apart from the facts. A question written any other way is drawn as stored
 * (rules in lib/platform/textBlocks).
 */
function QuestionText({ text }: { text: string }) {
  const { stem, parts, ask } = useMemo(() => questionLayout(text), [text]);
  return (
    <div className="space-y-3">
      {stem && <SciBlock text={spacedLines(stem)} context={text} className="space-y-2" />}
      {parts.length > 0 && (
        <ol className="divide-y divide-border border-y border-border">
          {parts.map((p) => (
            <li key={p.label} className="flex items-baseline gap-3 py-2.5">
              <span className="font-display shrink-0 font-extrabold text-[var(--tint)]">
                ({p.label})
              </span>
              <SciBlock text={p.text} context={text} className="min-w-0 flex-1 space-y-2" />
              {p.marks !== null && (
                <span className="chip shrink-0">
                  {p.marks} {p.marks === 1 ? "mark" : "marks"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {ask && (
        <SciBlock
          text={ask}
          context={text}
          className="space-y-2 border-t border-border pt-3 font-bold"
        />
      )}
    </div>
  );
}

/**
 * Shown while a submission is inside its review window.
 *
 * A student who hands work in and sees nothing for a day assumes it went
 * nowhere. This says the opposite, without promising a particular hour.
 *
 * The countdown is worked out after mount rather than during render. "Within 9
 * hours" depends on the clock, so a server-rendered figure and the one the
 * browser computes a moment later need not agree — and a hydration mismatch on
 * a reassurance notice would be an odd thing to have caused.
 */
export function AwaitingMark({
  releaseAt,
  held = false,
  submittedAt = null,
}: {
  releaseAt: string | null;
  /** The marker finished but held the paper for a tutor: no clock to show. */
  held?: boolean;
  /**
   * When it was handed in. Unmarked once the page has stopped starting the
   * marker (an hour on), nothing will mark it but a tutor, so the notice stops
   * promising marks "shortly".
   */
  submittedAt?: string | null;
}) {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (releaseAt || held || !submittedAt) return;
    const check = () => setStalled(markingStalled(submittedAt));
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [releaseAt, held, submittedAt]);
  useEffect(() => {
    if (!releaseAt) return;
    const tick = () =>
      setMinutes(Math.max(0, Math.ceil((new Date(releaseAt).getTime() - Date.now()) / 60_000)));
    tick();
    // The wait is now minutes rather than a day, which is short enough that a
    // student will sit on this page watching it. A stale "in 28 minutes" while
    // they wait would be worse than no estimate at all.
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [releaseAt]);
  // Only while there is still nothing else to say: no clock, not held.
  const late = stalled && !releaseAt && !held;

  return (
    <div className="tint-primary premium-card flex items-start gap-3 p-4">
      <span className="icon-tile size-8 shrink-0">
        <Clock3 className="size-4" aria-hidden />
      </span>
      <div>
        <p className="font-display font-bold">
          {held
            ? "Handed in — your tutor is checking it"
            : late
              ? "Handed in — your tutor will mark it"
              : "Handed in — being marked"}
        </p>
        <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">
          {held
            ? "Your marks and feedback will appear here once your tutor has looked."
            : late
              ? "Your marks and feedback will appear here once your tutor has marked it."
              : minutes != null && minutes > 0
                ? `Your marks and feedback should appear here in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
                : "Your marks and feedback will appear here shortly."}
        </p>
      </div>
    </div>
  );
}
