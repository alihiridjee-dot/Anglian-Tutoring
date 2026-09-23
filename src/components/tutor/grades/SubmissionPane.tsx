import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Clock, Loader2, MessageSquare, Save, Sparkles } from "lucide-react";
import { Spinner } from "@/components/Shared";
import { supabase } from "@/integrations/supabase/client";
import { AnswerMarkingList } from "@/components/tutor/AnswerMarking";
import { useAnswerMarking, type QuestionMark } from "@/hooks/data/useAnswerMarking";
import { gradeFromPct } from "@/hooks/data/useAnalytics";
import {
  useStudentHistory,
  type QueueSubmission,
  type StudentGroup,
} from "@/hooks/data/useGradingQueue";
import { invalidatePlanner } from "@/lib/planner/assessmentSync";
import { SUBJECT_TINT } from "@/lib/subjectTheme";
import { cn } from "@/lib/utils";
import { facetLabel, markStatusOf, timeLeft, type MarkStatus } from "@/lib/homeworkReview";

/**
 * One student, and the piece of their work that is open.
 *
 * The marks arrive filled in by the model; the tutor's job is to disagree where
 * they need to. Corrections save themselves as a draft — into the staged marks,
 * so that if the review window runs out it is the tutor's numbers that publish,
 * not the model's — and "Finalize & next" publishes now and moves on.
 */

const AUTOSAVE_MS = 1500;
const STATUS_TINT: Record<MarkStatus, string> = {
  pending: "tint-amber",
  edited: "tint-primary",
  finalized: "tint-emerald",
};
const STATUS_LABEL: Record<MarkStatus, string> = {
  pending: "Pending review",
  edited: "Edited",
  finalized: "Finalized",
};

export function SubmissionPane({
  userId,
  studentId,
  studentName,
  submission,
  theirs,
  manualGroups,
  memberOf,
  onToggleGroup,
  onOpen,
  onSaved,
}: {
  userId: string | null;
  studentId: string;
  studentName: string;
  submission: QueueSubmission | null;
  /** This student's work inside the queue's window, any status. */
  theirs: QueueSubmission[];
  manualGroups: StudentGroup[];
  memberOf: Set<string>;
  onToggleGroup: (groupId: string, member: boolean) => void;
  onOpen: (s: QueueSubmission) => void;
  onSaved: (id: string, changes: Partial<QueueSubmission>, advance: boolean) => void;
}) {
  const [showOlder, setShowOlder] = useState(false);
  const older = useStudentHistory(studentId, showOlder);
  const strip = [...theirs].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

  return (
    <section
      aria-label={`${studentName}'s homework`}
      className={cn("premium-card rounded-2xl", SUBJECT_TINT[submission?.resource?.subject ?? ""])}
    >
      <header className="space-y-3 border-b border-border p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-xl font-bold">{studentName}</h3>
          {manualGroups.map((g) => {
            const member = memberOf.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={member}
                title={member ? `Remove from ${g.name}` : `Add to ${g.name}`}
                onClick={() => onToggleGroup(g.id, !member)}
                className={cn("chip tint-slate cursor-pointer", member && "chip-solid")}
              >
                {g.name}
              </button>
            );
          })}
        </div>

        {(strip.length > 0 || older.data?.length) && (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Their homework">
            {[...strip, ...(older.data ?? [])].map((s) => {
              const st = markStatusOf(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === submission?.id}
                  onClick={() => onOpen(s)}
                  className={cn(
                    "chip cursor-pointer max-w-56",
                    STATUS_TINT[st],
                    s.id === submission?.id && "chip-solid",
                  )}
                  title={`${s.resource?.title ?? "Homework"} · ${STATUS_LABEL[st]}`}
                >
                  <span className="truncate">{s.resource?.title ?? "Homework"}</span>
                  {s.score_pct != null && <span className="numeral">{s.score_pct}%</span>}
                </button>
              );
            })}
            {!showOlder && (
              <button
                type="button"
                onClick={() => setShowOlder(true)}
                className="chip tint-slate cursor-pointer"
              >
                Older
              </button>
            )}
          </div>
        )}
      </header>

      {submission && (
        <Marking
          // …and to one marking of it: a fresh AI mark reloads the boxes.
          key={`${submission.id}:${submission.ai_marked_at ?? ""}`}
          userId={userId}
          studentName={studentName}
          submission={submission}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

/**
 * The AI provider's errors arrive as a status code glued to a JSON blob. A tutor
 * needs the sentence inside it ("credit balance is too low"), not the envelope.
 */
function readable(message: string): string {
  try {
    const inner = JSON.parse(message.slice(message.indexOf("{")));
    return inner?.error?.message ?? message;
  } catch {
    return message;
  }
}

function Marking({
  userId,
  studentName,
  submission: sub,
  onSaved,
}: {
  userId: string | null;
  studentName: string;
  submission: QueueSubmission;
  onSaved: (id: string, changes: Partial<QueueSubmission>, advance: boolean) => void;
}) {
  const client = useQueryClient();
  const marking = useAnswerMarking(sub.resource?.id, sub.id, true);
  const status = markStatusOf(sub);
  const final = status === "finalized";

  const [feedback, setFeedback] = useState(sub.feedback ?? "");
  const [manualPct, setManualPct] = useState(sub.score_pct != null ? String(sub.score_pct) : "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"draft" | "final" | null>(null);
  const [aiMarking, setAiMarking] = useState(false);

  /**
   * Ask the model to mark work it never marked.
   *
   * The student's browser starts marking when they hand in, and deliberately
   * ignores a failure — so when the marker is down, work arrives here blank and
   * nothing says why. This runs the same marker again and, unlike that call,
   * shows the tutor what went wrong.
   */
  const markWithAi = async () => {
    setAiMarking(true);
    try {
      const { data, error } = await supabase.functions.invoke("mark-homework", {
        body: { submissionId: sub.id },
      });
      if (error) {
        // The function's own message is in the response body, not on the error.
        const body = await (error as { context?: Response }).context?.json().catch(() => null);
        throw new Error(readable(body?.error ?? error.message));
      }
      if (!data?.marked) throw new Error("There was nothing to mark");
      dirtyRef.current = false;
      toast.success("Marked — check it before it publishes");
      onSaved(
        sub.id,
        { ai_marked_at: new Date().toISOString(), release_at: data.releaseAt },
        false,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI marking failed");
    } finally {
      setAiMarking(false);
    }
  };

  // The model's overall comment is offered, not imposed: it fills an empty box once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !marking.summary || feedback.trim()) return;
    seeded.current = true;
    setFeedback(marking.summary);
  }, [marking.summary, feedback]);

  const setMark = (questionId: string, changes: Partial<QuestionMark>) => {
    marking.setMark(questionId, changes);
    setDirty(true);
  };

  const saveDraft = useCallback(async () => {
    if (final || !marking.hasQuestions) return;
    setSaving("draft");
    try {
      const { error } = await supabase.rpc("save_homework_mark_draft", {
        _submission_id: sub.id,
        _marks: marking.questions.map((q) => ({
          question_id: q.id,
          marks: marking.marks[q.id]?.marks ?? "",
          feedback: marking.marks[q.id]?.feedback ?? "",
        })),
        _summary: feedback,
      });
      if (error) throw error;
      setDirty(false);
      onSaved(sub.id, { tutor_reviewed_at: new Date().toISOString() }, false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the draft");
    } finally {
      setSaving(null);
    }
  }, [final, marking.hasQuestions, marking.questions, marking.marks, feedback, sub.id, onSaved]);

  // Drafts save themselves shortly after the last change, and once more on the
  // way out — so moving to another student never costs a correction.
  const latestSave = useRef(saveDraft);
  latestSave.current = saveDraft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirty || final) return;
    const timer = setTimeout(() => void latestSave.current(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, final, marking.marks, feedback]);
  useEffect(
    () => () => {
      if (dirtyRef.current) void latestSave.current();
    },
    [],
  );

  const pct = marking.hasQuestions
    ? marking.scorePct
    : manualPct.trim() === ""
      ? null
      : Number(manualPct);

  const finalize = useCallback(async () => {
    if (!userId) return toast.error("Not signed in");
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100))
      return toast.error("Score must be between 0 and 100");
    setSaving("final");
    try {
      // Per-question marks first: if one is out of range the overall mark isn't
      // written either, so the two can't disagree.
      if (marking.hasQuestions) await marking.saveMarks();
      const stamp = new Date().toISOString();
      const changes = {
        // Derived, never typed: the marks are the mark.
        grade: pct != null ? String(gradeFromPct(pct)) : null,
        score_pct: pct,
        feedback: feedback.trim() || null,
        graded_by: userId,
        graded_at: stamp,
        tutor_reviewed_at: stamp,
      };
      const { error } = await supabase
        .from("homework_submissions")
        .update(changes)
        .eq("id", sub.id);
      if (error) throw error;
      dirtyRef.current = false;
      setDirty(false);
      toast.success(`${final ? "Updated" : "Finalized"} ${studentName}'s mark`);
      void invalidatePlanner(client, sub.student_id);
      onSaved(sub.id, changes, !final);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the mark");
    } finally {
      setSaving(null);
    }
  }, [userId, pct, marking, feedback, sub.id, sub.student_id, final, studentName, client, onSaved]);

  // ⌘↵ finalizes from anywhere in the pane, including inside a text box.
  const latestFinalize = useRef(finalize);
  latestFinalize.current = finalize;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void latestFinalize.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void latestSave.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const left = timeLeft(sub.release_at);
  const late = !!sub.resource?.due_at && sub.submitted_at > sub.resource.due_at;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-display font-bold">{sub.resource?.title ?? "Homework"}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={cn("chip", STATUS_TINT[status])}>{STATUS_LABEL[status]}</span>
            {sub.resource?.subject && (
              <span className="chip">{facetLabel(sub.resource.subject)}</span>
            )}
            {sub.resource?.level && <span className="chip">{facetLabel(sub.resource.level)}</span>}
            {sub.resource?.board && <span className="chip">{facetLabel(sub.resource.board)}</span>}
            {late && <span className="chip tint-rose">Late</span>}
            {!final &&
              (sub.release_at ? (
                <span className="chip tint-amber">
                  <Clock className="size-3" /> {left ? `Publishes in ${left}` : "Publishing now"}
                </span>
              ) : (
                <>
                  <span className="chip tint-rose">No marks yet</span>
                  {marking.hasQuestions && (
                    <button
                      type="button"
                      onClick={() => void markWithAi()}
                      disabled={aiMarking}
                      className="chip tint-primary cursor-pointer disabled:opacity-60"
                    >
                      {aiMarking ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      Mark with AI
                    </button>
                  )}
                </>
              ))}
          </div>
        </div>
        {marking.hasQuestions && (
          <p className="text-right">
            <span className="numeral text-2xl">
              {marking.awarded}/{marking.totalMarks}
            </span>
            {pct != null && (
              <span className="block text-xs text-muted-foreground">
                {pct}% · grade {gradeFromPct(pct)}
              </span>
            )}
          </p>
        )}
      </div>

      {/* The answers scroll inside the pane, so the score above and the save
          bar below are on screen however long the paper is. */}
      <div className="max-h-[62vh] space-y-5 overflow-y-auto p-5">
        {marking.loading ? (
          <Spinner label="Loading answers" className="py-10" />
        ) : marking.hasQuestions ? (
          <AnswerMarkingList
            questions={marking.questions}
            answers={marking.answers}
            marks={marking.marks}
            setMark={setMark}
          />
        ) : (
          // Work from before on-site answering has no questions to mark against,
          // so its score is the one number that still has to be typed.
          <label className="block max-w-xs">
            <span className="eyebrow eyebrow-bare">Score %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={manualPct}
              onChange={(e) => setManualPct(e.target.value)}
              className="premium-input mt-1 h-10 w-full px-3 text-sm"
            />
          </label>
        )}

        {sub.notes && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
            <span className="italic">{sub.notes}</span>
          </p>
        )}

        <label className="block">
          <span className="eyebrow eyebrow-bare">Feedback to {studentName.split(" ")[0]}</span>
          <textarea
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              setDirty(true);
            }}
            className="premium-input mt-1 min-h-24 w-full px-3 py-2 text-sm"
          />
        </label>
      </div>

      <footer className="rounded-b-2xl flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
        <span className="text-xs text-muted-foreground">
          {saving === "draft"
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : status === "edited"
                ? "Draft saved"
                : final && sub.graded_at
                  ? `Published ${new Date(sub.graded_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
                  : ""}
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          {!final && marking.hasQuestions && (
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={!dirty || saving !== null}
              className="btn-premium inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm disabled:opacity-60"
            >
              <Save className="size-4" /> Save draft
            </button>
          )}
          <button
            type="button"
            onClick={() => void finalize()}
            disabled={saving !== null || marking.loading}
            className="btn-solid inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-bold disabled:opacity-60"
          >
            {saving === "final" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {final ? "Update mark" : "Finalize & next"}
            <kbd className="text-[10px] opacity-70">⌘↵</kbd>
          </button>
        </div>
      </footer>
    </>
  );
}
