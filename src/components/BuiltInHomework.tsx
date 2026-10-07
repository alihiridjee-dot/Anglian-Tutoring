import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock3, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { dbError } from "@/lib/platform/errors";
import {
  clearDraft,
  loadDraft,
  mergeDrafts,
  saveDraft,
  syncServerDraft,
  type TimestampedDraft,
} from "@/lib/homework/homeworkDrafts";
import { isAlreadySubmitted, startMarking } from "@/lib/homework/startMarking";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";
import { Meter, SciText } from "@/components/Shared";
import { SciAnswerBox } from "@/components/homework/SciAnswerBox";
import { MarkScheme } from "@/components/homework/MarkScheme";
import { isDemoStudent } from "@/lib/demo/studentDemo";

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
              <p className="mt-3 text-base leading-relaxed whitespace-pre-wrap">
                {a?.answer_text ? (
                  <SciText text={a.answer_text} context={notation} />
                ) : (
                  <span className="text-muted-foreground italic">Left blank</span>
                )}
              </p>
              {a?.feedback && (
                <p className="mt-2 text-sm leading-relaxed font-medium whitespace-pre-wrap text-[color:var(--tint)]">
                  <SciText text={a.feedback} context={notation} />
                </p>
              )}
              {/* The mark scheme is the answer — it stays hidden until the work
                  has actually been marked. */}
              {marked && q.mark_scheme && (
                <div className="border-border mt-2 border-t pt-2">
                  <p className="eyebrow-bare">Mark scheme</p>
                  <MarkScheme
                    scheme={q.mark_scheme}
                    context={notation}
                    className="mt-1.5 text-sm"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type Draft = { text: string };

const EMPTY_WORK: TimestampedDraft = { answers: {}, notes: "", stamps: {}, savedAt: 0 };

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
  const queryClient = useQueryClient();

  const draftOf = (id: string): Draft => ({ text: work.answers[id] ?? "" });
  // Answers only. The sheet no longer has a box for a note to the tutor, so a
  // note left in an older draft stays in the draft and is never handed in.
  const edit = (id: string, text: string) => {
    setWork((prev) => ({
      ...prev,
      answers: { ...prev.answers, [id]: text },
      stamps: { ...prev.stamps, [id]: Date.now() },
    }));
    setEdits((n) => n + 1);
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

  // Bring back anything typed but never submitted — from this device and from
  // whichever others they worked on, the newer edit of each answer winning.
  //
  // Anything typed while this loads is kept: it's newer than either copy, so
  // the merge keeps it, where it used to be replaced by the draft arriving.
  //
  // Nothing may be written back until the load has *finished*, which is what
  // `ready` gates. Gating on the load having merely begun meant the first
  // autosave fired against empty state while the fetch was still in flight,
  // writing nothing over the draft it was about to restore and deleting the
  // server copy outright — a student picking their homework up on a second
  // device lost the lot, which is the precise accident this exists to prevent.
  //
  // No ref guards the effect, deliberately. A `hasRun` ref plus StrictMode's
  // deliberate double-mount is a deadlock: the first pass sets the ref and
  // starts the load, the cleanup cancels it, and the second pass sees the ref
  // and returns — so the load never completes and `ready` never flips. The
  // dependencies are narrow enough that re-running is simply a second read.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      const local = loadDraft(userId, hw.id);
      // Sent as well as fetched: edits this device made offline reach the
      // server now, rather than waiting for the next keystroke.
      const server = await syncServerDraft(hw.id, local);
      if (cancelled) return;

      const saved = mergeDrafts(local, server);
      if (saved) {
        takeIn(saved);
        if (Object.values(saved.answers).some((text) => text.trim().length > 0)) setRestored(true);
      }
      // Only now may anything be written back.
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
    if (!userId || !ready || edits === 0) return;
    const local = setTimeout(() => saveDraft(userId, hw.id, workRef.current), 400);
    const remote = setTimeout(
      () => void syncServerDraft(hw.id, workRef.current).then(takeIn),
      2500,
    );
    return () => {
      clearTimeout(local);
      clearTimeout(remote);
    };
  }, [edits, userId, hw.id, ready, takeIn]);

  // Coming back to this tab, or back online: catch up with the other devices
  // before the next keystroke here is saved. A tab left open since yesterday
  // is exactly the one that would otherwise be out of date.
  const catchUp = useCallback(async () => {
    takeIn(await syncServerDraft(hw.id, workRef.current));
  }, [hw.id, takeIn]);
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

  const hasUnsent = Object.values(work.answers).some((text) => text.trim().length > 0);

  // A reload or a closed tab is recoverable now, but a student who navigates
  // away mid-answer still deserves the browser's own warning.
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  const isAnswered = (q: HomeworkQuestion) => draftOf(q.id).text.trim().length > 0;
  const answered = questions.filter(isAnswered).length;

  const submit = async () => {
    if (!userId) return toast.error("Not signed in");
    if (answered === 0) return toast.error("Answer at least one question before submitting");

    setSaving(true);
    try {
      const payload = questions.map((q) => ({
        question_id: q.id,
        answer_text: draftOf(q.id).text,
      }));

      const { data: submissionId, error } = await supabase.rpc("submit_homework_answers", {
        _resource_id: hw.id,
        _answers: payload,
      });
      // "Already submitted" means an earlier try got through and only its
      // reply was lost: the work is in, which is what the student wanted. The
      // sheet reloads with the submission and starts its marking from there.
      if (error && !isAlreadySubmitted(error)) throw dbError(error);

      // Start the marking, but never wait on it or surface its failure. The
      // work is safely handed in either way; a submission that goes unmarked
      // simply waits for a tutor, which is what used to happen to all of them.
      if (submissionId) startMarking(submissionId);

      toast.success("Task submitted");
      clearDraft(userId, hw.id);
      setWork(EMPTY_WORK);
      setRestored(false);
      setConfirming(false);
      onChanged();
      // The weekly task list reads hand-ins too; without this it kept offering
      // "Start" on the task just handed in until its cache went stale.
      void invalidatePlanner(queryClient, userId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit");
    } finally {
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
                <div className="border-border mt-4 border-t pt-3">
                  <p className="eyebrow-bare">Mark scheme</p>
                  <MarkScheme
                    scheme={q.mark_scheme}
                    context={q.prompt}
                    className="mt-1.5 text-sm"
                  />
                </div>
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
                placeholder={TYPE_HINT[q.answer_type]}
                aria-label={`Answer to question ${i + 1}`}
                style={linesStyle(q)}
                className="premium-input answer-lines w-full text-base"
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
      <p className="order-last w-full text-base leading-relaxed font-medium break-words whitespace-pre-wrap sm:order-none sm:w-auto sm:min-w-0 sm:flex-1 sm:pt-1.5 sm:text-lg">
        <span className="sr-only">
          Question {index + 1}
          {answered ? ", answered" : ""}:{" "}
        </span>
        <SciText text={q.prompt} />
      </p>
      <div className="ml-auto sm:ml-0">
        <MarksBox marks={q.marks} awarded={awarded} />
      </div>
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
export function AwaitingMark({ releaseAt }: { releaseAt: string | null }) {
  const [minutes, setMinutes] = useState<number | null>(null);
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

  return (
    <div className="tint-primary premium-card flex items-start gap-3 p-4">
      <span className="icon-tile size-8 shrink-0">
        <Clock3 className="size-4" aria-hidden />
      </span>
      <div>
        <p className="font-display font-bold">Handed in — being marked</p>
        <p className="text-muted-foreground mt-0.5 text-sm leading-relaxed">
          {minutes != null && minutes > 0
            ? `Your marks and feedback should appear here in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
            : "Your marks and feedback will appear here shortly."}
        </p>
      </div>
    </div>
  );
}
