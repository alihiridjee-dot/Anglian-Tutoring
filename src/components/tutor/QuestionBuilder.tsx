import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { generateHomeworkQuestions, type DraftQuestion } from "@/lib/homeworkQuestions.functions";
import { blankQuestion, type BuilderQuestion } from "@/lib/builderQuestion";
import { inputCls } from "./Field";
import type { SubjectV, BoardV, LevelV } from "@/lib/taxonomy";

/**
 * The questions themselves, built in the homework form.
 *
 * Generation is the fast path (the tutor picks spec points and asks for N
 * questions) but every field stays editable, and a question can be written by
 * hand. The draft shape itself lives in `@/lib/builderQuestion`.
 */

const ANSWER_TYPE_LABELS: Record<DraftQuestion["answer_type"], string> = {
  short: "Short answer",
  long: "Extended answer",
  numeric: "Numeric",
};

export function QuestionBuilder({
  questions,
  onChange,
  subject,
  board,
  level,
  specPointIds,
  editing = false,
}: {
  questions: BuilderQuestion[];
  onChange: (next: BuilderQuestion[]) => void;
  subject: SubjectV;
  board: BoardV;
  level: LevelV;
  specPointIds: string[];
  /** Correcting a brief students may already have answered. */
  editing?: boolean;
}) {
  const [count, setCount] = useState(5);
  const [notes, setNotes] = useState("");
  const [generating, setGenerating] = useState(false);

  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);

  const patch = (key: string, changes: Partial<BuilderQuestion>) =>
    onChange(questions.map((q) => (q.key === key ? { ...q, ...changes } : q)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const generate = async () => {
    if (specPointIds.length === 0) {
      return toast.error("Pick the spec points this homework covers first");
    }
    setGenerating(true);
    try {
      const { questions: drafts } = await generateHomeworkQuestions({
        data: { specPointIds, subject, board, level, count, notes },
      });
      // Append rather than replace — a tutor can generate twice, or top up a
      // set they've already started writing by hand.
      onChange([...questions, ...drafts.map((d) => ({ ...d, key: crypto.randomUUID() }))]);
      toast.success(
        `Drafted ${drafts.length} question${drafts.length === 1 ? "" : "s"} — review before setting`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate questions");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-muted/40 border-b border-border">
        <span className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">
          Questions
        </span>
        <span className="text-xs text-muted-foreground">
          {questions.length} · {totalMarks} mark{totalMarks === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => onChange([...questions, blankQuestion(specPointIds[0] ?? null)])}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60"
        >
          <Plus className="w-3.5 h-3.5" />
          Add question
        </button>
      </div>

      {editing && (
        <p className="px-4 py-3 text-xs text-muted-foreground border-b border-border">
          Editing a question leaves it attached to the answers students have already written.
          Deleting one removes those answers.
        </p>
      )}

      {/* AI drafting — the tutor's fast path, but nothing is saved until they
          review it and set the homework. */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border bg-primary/[0.03]">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            How many
          </span>
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className={`${inputCls} w-20 mt-1`}
          />
        </label>
        <label className="block flex-1 min-w-48">
          <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Steer (optional)
          </span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. focus on required practical 4, include a calculation"
            className={`${inputCls} mt-1`}
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg btn-solid text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          {generating ? "Drafting…" : "Generate with AI"}
        </button>
      </div>

      {questions.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">
          No questions yet. Generate a set from the spec points below, or add one by hand — students
          answer them on the site, with no files to download.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {questions.map((q, i) => (
            <li key={q.key} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Q{i + 1}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === questions.length - 1}
                    aria-label="Move down"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Removing a question that already exists takes every
                      // answer written against it with it, so make that the
                      // tutor's decision rather than a stray click's.
                      if (
                        q.id &&
                        !window.confirm(
                          "Delete this question? Any answers students have already written for it are deleted too.",
                        )
                      ) {
                        return;
                      }
                      onChange(questions.filter((x) => x.key !== q.key));
                    }}
                    aria-label="Delete question"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <textarea
                value={q.prompt}
                onChange={(e) => patch(q.key, { prompt: e.target.value })}
                placeholder="Question the student will answer…"
                className="w-full min-h-20 rounded-lg bg-secondary border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  Marks
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={q.marks}
                    onChange={(e) =>
                      patch(q.key, {
                        marks: Math.min(Math.max(Number(e.target.value) || 1, 1), 30),
                      })
                    }
                    className={`${inputCls} w-20 h-9`}
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  Answer
                  <select
                    value={q.answer_type}
                    onChange={(e) =>
                      patch(q.key, {
                        answer_type: e.target.value as DraftQuestion["answer_type"],
                      })
                    }
                    className={`${inputCls} h-9 w-40`}
                  >
                    {Object.entries(ANSWER_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <textarea
                value={q.mark_scheme}
                onChange={(e) => patch(q.key, { mark_scheme: e.target.value })}
                placeholder="Mark scheme — one credit-worthy point per line. Shown to you while marking, and to the student once marked."
                className="w-full min-h-16 rounded-lg bg-secondary border border-border px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
