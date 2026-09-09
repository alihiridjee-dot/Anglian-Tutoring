import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock3, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  clearDraft,
  loadDraft,
  loadServerDraft,
  mergeDrafts,
  saveDraft,
  saveServerDraft,
} from "@/lib/homeworkDrafts";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";

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
          return (
            <li key={q.id} className="premium-card p-4">
              <div className="flex items-start gap-2">
                <span className="numeral text-muted-foreground shrink-0 text-xs">Q{i + 1}</span>
                <p className="flex-1 text-sm font-medium whitespace-pre-wrap">{q.prompt}</p>
                <span className="numeral text-muted-foreground shrink-0 text-xs">
                  {a?.awarded_marks != null
                    ? `${Number(a.awarded_marks)}/${q.marks}`
                    : `${q.marks} marks`}
                </span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                {a?.answer_text || <span className="italic">Left blank</span>}
              </p>
              {a?.feedback && (
                <p className="mt-2 text-xs whitespace-pre-wrap text-[color:var(--tint)]">
                  {a.feedback}
                </p>
              )}
              {/* The mark scheme is the answer — it stays hidden until the work
                  has actually been marked. */}
              {marked && q.mark_scheme && (
                <div className="border-border mt-2 border-t pt-2">
                  <p className="eyebrow-bare">Mark scheme</p>
                  <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
                    {q.mark_scheme}
                  </p>
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

export function AnswerForm({
  hw,
  questions,
  userId,
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
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const draftOf = (id: string): Draft => drafts[id] ?? { text: "" };
  const patch = (id: string, changes: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id), ...changes } }));

  // Bring back anything typed but never submitted — from this device or from
  // whichever one they were last working on, whichever is more recent.
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
      const server = await loadServerDraft(hw.id);
      if (cancelled) return;

      const saved = mergeDrafts(local, server);
      if (saved) {
        setDrafts(
          Object.fromEntries(Object.entries(saved.answers).map(([qid, text]) => [qid, { text }])),
        );
        setNotes(saved.notes);
        setRestored(true);
      }
      // Only now may anything be written back.
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, hw.id]);

  // Persist as they type. Debounced so a fast typist isn't writing on every
  // keystroke; localStorage takes it immediately, the server a beat later.
  useEffect(() => {
    if (!userId || !ready) return;
    const draft = {
      answers: Object.fromEntries(Object.entries(drafts).map(([k, v]) => [k, v.text])),
      notes,
    };
    const local = setTimeout(() => saveDraft(userId, hw.id, draft), 400);
    const remote = setTimeout(() => void saveServerDraft(userId, hw.id, draft), 2500);
    return () => {
      clearTimeout(local);
      clearTimeout(remote);
    };
  }, [drafts, notes, userId, hw.id, ready]);

  const hasUnsent =
    notes.trim().length > 0 || Object.values(drafts).some((d) => d.text.trim().length > 0);

  // A reload or a closed tab is recoverable now, but a student who navigates
  // away mid-answer still deserves the browser's own warning.
  useEffect(() => {
    if (!hasUnsent) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsent]);

  const answered = questions.filter((q) => draftOf(q.id).text.trim().length > 0).length;
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

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
        _notes: notes || undefined,
      });
      if (error) throw error;

      // Start the marking, but never wait on it or surface its failure. The
      // work is safely handed in either way; a submission that goes unmarked
      // simply waits for a tutor, which is what used to happen to all of them.
      if (submissionId) {
        void supabase.functions
          .invoke("mark-homework", { body: { submissionId } })
          .catch(() => undefined);
      }

      toast.success("Homework submitted");
      clearDraft(userId, hw.id);
      setDrafts({});
      setNotes("");
      setRestored(false);
      setConfirming(false);
      onChanged();
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
    // The public showcase is a prospective student looking at what homework is
    // like here, so it gets the boxes — disabled, but present, because a page
    // of questions with nowhere to type them is a worse advert than the real
    // thing — and never the mark schemes, which are the answers.
    return (
      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className="premium-card space-y-2 p-4">
            <QuestionHeader q={q} index={i} />
            {showMarkScheme ? (
              q.mark_scheme && (
                <div className="border-border mt-3 border-t pt-2">
                  <p className="eyebrow-bare">Mark scheme</p>
                  <p className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap">
                    {q.mark_scheme}
                  </p>
                </div>
              )
            ) : (
              <textarea
                disabled
                placeholder={TYPE_HINT[q.answer_type]}
                className={`premium-input w-full rounded-lg px-3 py-2 text-sm opacity-60 ${
                  q.answer_type === "long" ? "min-h-32" : "min-h-16"
                }`}
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
        setConfirming(true);
      }}
      className="space-y-4"
    >
      {restored && (
        <p className="tint-primary premium-card px-3 py-2 text-xs">
          We brought back what you&apos;d typed last time.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow-bare">Answer on the page</p>
        <span className="text-muted-foreground text-xs">
          {answered}/{questions.length} answered · {totalMarks} marks
        </span>
      </div>

      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="premium-card space-y-2 p-4">
            <QuestionHeader q={q} index={i} />
            <textarea
              value={draftOf(q.id).text}
              onChange={(e) => patch(q.id, { text: e.target.value })}
              placeholder={TYPE_HINT[q.answer_type]}
              className={`premium-input w-full rounded-lg px-3 py-2 text-sm ${
                q.answer_type === "long" ? "min-h-32" : "min-h-16"
              }`}
            />
          </li>
        ))}
      </ol>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything you'd like your tutor to know (optional)"
        className="premium-input min-h-16 w-full rounded-lg px-3 py-2 text-sm"
      />

      {confirming ? (
        <div className="tint-amber premium-card space-y-3 p-4">
          <p className="text-sm font-semibold">
            Hand in {answered} of {questions.length} answers?
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Submissions are final — you can&apos;t change your answers afterwards.
            {answered < questions.length && " Anything left blank scores nothing."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="btn-solid inline-flex h-10 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {saving ? "Submitting…" : "Yes, hand it in"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={saving}
              className="btn-premium inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold disabled:opacity-60"
            >
              Keep working
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Your answers save as you type, on this device and to your account — you can come back to
            them. Submitting is final.
          </p>
          <button
            type="submit"
            className="btn-solid inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold"
          >
            <Send className="size-4" />
            Submit answers
          </button>
        </>
      )}
    </form>
  );
}

function QuestionHeader({ q, index }: { q: HomeworkQuestion; index: number }) {
  return (
    <div className="flex items-start gap-2">
      <span className="numeral text-muted-foreground shrink-0 text-xs">Q{index + 1}</span>
      <p className="flex-1 text-sm font-medium whitespace-pre-wrap">{q.prompt}</p>
      <span className="numeral text-muted-foreground shrink-0 text-xs">[{q.marks}]</span>
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
            ? `Your marks and feedback should appear in about ${minutes} minute${minutes === 1 ? "" : "s"} — refresh the page then.`
            : "Your marks and feedback will appear here shortly."}
        </p>
      </div>
    </div>
  );
}
