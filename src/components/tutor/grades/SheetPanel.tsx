import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, Loader2, Pause, RefreshCw, Trash2, Undo2, X } from "lucide-react";
import { Spinner } from "@/components/Shared";
import { useSheetQuestions, type QuestionPatch } from "@/hooks/data/useOutgoingHomework";
import type { HomeworkQuestion } from "@/hooks/data/useHomeworkQuestions";
import { generateHomeworkQuestions } from "@/lib/homeworkQuestions.functions";
import { SUBJECT_TINT } from "@/lib/subjectTheme";
import { cn } from "@/lib/utils";
import { facetLabel, isLive, timeLeft, type Sheet, type SheetStatus } from "@/lib/homeworkReview";

/**
 * One sheet, opened beside the table it came from.
 *
 * A slide-over rather than a page: the tutor's place in the queue — filters,
 * scroll position, the row they were on — stays exactly where it was, and
 * "Approve & next" swaps the panel's contents without anything else moving.
 * Every field saves when it loses focus. There is no Save button because there
 * is nothing to forget to press.
 */
export function SheetPanel({
  sheet,
  position,
  onClose,
  onDecide,
  onChanged,
}: {
  sheet: Sheet;
  position: string;
  onClose: () => void;
  onDecide: (status: SheetStatus) => void;
  /** Question count or marks changed, so the table's totals are stale. */
  onChanged: () => void;
}) {
  const { questions, isLoading, patch, remove } = useSheetQuestions(sheet.id);
  // Once work is in, a question's maximum is part of somebody's grade. Wording
  // and mark schemes can still be corrected; the arithmetic cannot.
  const locked = sheet.submissionCount > 0;
  const left = timeLeft(sheet.publishAt);

  const save = async (id: string, changes: QuestionPatch) => {
    try {
      await patch(id, changes);
      if (changes.marks !== undefined) onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the question");
    }
  };

  // Portalled to the body: the page content is its own stacking context, so a
  // panel rendered inside it slides *under* the app's sticky header however
  // high its z-index. z-40 clears that header and stays below the sidebar.
  return createPortal(
    <aside
      aria-label={`Review ${sheet.title}`}
      className={cn(
        SUBJECT_TINT[sheet.subject],
        "fixed inset-y-0 right-0 z-40 flex w-full max-w-2xl flex-col border-l-2 border-border bg-card shadow-elegant",
      )}
    >
      <header className="flex items-start gap-3 border-b border-border p-5">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{position}</p>
          <h3 className="mt-1 text-lg font-bold leading-snug">{sheet.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip">{facetLabel(sheet.subject)}</span>
            <span className="chip tint-slate">{facetLabel(sheet.level)}</span>
            {sheet.board && <span className="chip tint-slate">{facetLabel(sheet.board)}</span>}
            {sheet.tier && <span className="chip tint-slate">{facetLabel(sheet.tier)}</span>}
            {sheet.status === "to_review" &&
              (left ? (
                <span className="chip tint-amber">Publishes in {left}</span>
              ) : (
                <span className="chip tint-rose">Live, unread</span>
              ))}
            {sheet.status === "held" && <span className="chip tint-rose">Held</span>}
            {sheet.status === "approved" && <span className="chip tint-emerald">Approved</span>}
            {locked && (
              <span className="chip tint-slate">
                {sheet.submissionCount} handed in · marks locked
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="icon-tile size-9 shrink-0 cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <Spinner label="Loading questions" className="py-10" />
        ) : (
          <ol className="space-y-4">
            {questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                index={i}
                question={q}
                sheet={sheet}
                locked={locked}
                canDelete={!locked && questions.length > 1}
                onSave={(changes) => save(q.id, changes)}
                onDelete={async () => {
                  try {
                    await remove(q.id);
                    onChanged();
                  } catch (err) {
                    toast.error(
                      err instanceof Error ? err.message : "Could not delete the question",
                    );
                  }
                }}
              />
            ))}
          </ol>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
        <span className="text-xs text-muted-foreground">
          {isLive(sheet) ? "Students can see this sheet" : "Hidden from students"}
        </span>
        <div className="flex gap-2">
          {sheet.status !== "to_review" && (
            <button
              type="button"
              onClick={() => onDecide("to_review")}
              className="btn-premium inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm"
            >
              <Undo2 className="size-4" /> Send back
            </button>
          )}
          {sheet.status !== "held" && (
            <button
              type="button"
              onClick={() => onDecide("held")}
              className="btn-premium inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm"
            >
              <Pause className="size-4" /> Hold
              <kbd className="text-[10px] opacity-60">H</kbd>
            </button>
          )}
          {sheet.status !== "approved" && (
            <button
              type="button"
              onClick={() => onDecide("approved")}
              className="btn-solid inline-flex h-10 items-center gap-2 rounded-lg px-5 text-sm font-bold"
            >
              <Check className="size-4" /> Approve &amp; next
              <kbd className="text-[10px] opacity-70">A</kbd>
            </button>
          )}
        </div>
      </footer>
    </aside>,
    document.body,
  );
}

/** Tall enough to show the text: wrapped lines plus the line breaks it contains. */
const rowsFor = (text: string, max: number) =>
  Math.min(
    max,
    Math.max(
      2,
      text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 80)), 0),
    ),
  );

function QuestionEditor({
  index,
  question,
  sheet,
  locked,
  canDelete,
  onSave,
  onDelete,
}: {
  index: number;
  question: HomeworkQuestion;
  sheet: Sheet;
  locked: boolean;
  canDelete: boolean;
  onSave: (changes: QuestionPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [scheme, setScheme] = useState(question.mark_scheme ?? "");
  const [marks, setMarks] = useState(String(question.marks));
  const [busy, setBusy] = useState(false);

  // A regenerated question arrives through the cache, not through typing.
  useEffect(() => {
    setPrompt(question.prompt);
    setScheme(question.mark_scheme ?? "");
    setMarks(String(question.marks));
  }, [question.prompt, question.mark_scheme, question.marks]);

  const commitMarks = () => {
    const n = Math.round(Number(marks));
    if (!Number.isFinite(n) || n < 1 || n > 30) return setMarks(String(question.marks));
    if (n !== question.marks) void onSave({ marks: n });
  };

  /** Swap this question for a fresh one on the same spec point. */
  const regenerate = async () => {
    const point = question.spec_point_id ?? sheet.specPointId;
    if (!point || !sheet.board) return;
    setBusy(true);
    try {
      const { questions } = await generateHomeworkQuestions({
        data: {
          specPointIds: [point],
          subject: sheet.subject,
          board: sheet.board,
          level: sheet.level,
          count: 1,
          notes: `Replace this question with a different one on the same point: "${question.prompt.slice(0, 300)}"`,
        },
      });
      const fresh = questions[0];
      if (!fresh) throw new Error("Nothing came back — try again");
      await onSave({
        prompt: fresh.prompt,
        mark_scheme: fresh.mark_scheme,
        // A locked sheet keeps its maximum; see `locked` above.
        ...(locked ? {} : { marks: fresh.marks }),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate the question");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-background/60 p-4 space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="numeral text-sm">Q{index + 1}</span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          Marks
          <input
            type="number"
            min={1}
            max={30}
            value={marks}
            disabled={locked}
            onChange={(e) => setMarks(e.target.value)}
            onBlur={commitMarks}
            className="premium-input h-8 w-16 px-2 text-sm disabled:opacity-60"
          />
        </label>
        {sheet.board && (question.spec_point_id ?? sheet.specPointId) && (
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            title="Write a different question"
            aria-label={`Regenerate question ${index + 1}`}
            className="icon-tile size-8 cursor-pointer disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => void onDelete()}
            title="Delete question"
            aria-label={`Delete question ${index + 1}`}
            className="icon-tile tint-rose size-8 cursor-pointer"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <textarea
        value={prompt}
        aria-label={`Question ${index + 1}`}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => {
          const next = prompt.trim();
          if (!next) return setPrompt(question.prompt);
          if (next !== question.prompt) void onSave({ prompt: next });
        }}
        rows={rowsFor(prompt, 10)}
        className="premium-input w-full px-3 py-2 text-sm"
      />
      <label className="block">
        <span className="eyebrow eyebrow-bare">Mark scheme</span>
        <textarea
          value={scheme}
          onChange={(e) => setScheme(e.target.value)}
          onBlur={() => {
            const next = scheme.trim() || null;
            if (next !== question.mark_scheme) void onSave({ mark_scheme: next });
          }}
          rows={rowsFor(scheme, 10)}
          className="premium-input mt-1 w-full px-3 py-2 text-xs"
        />
      </label>
    </li>
  );
}
