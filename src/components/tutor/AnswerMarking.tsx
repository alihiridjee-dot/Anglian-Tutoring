import { SignedImage } from "@/components/SignedImage";
import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";
import type { QuestionMark } from "@/hooks/data/useAnswerMarking";

/**
 * Marking a built-in homework question by question.
 *
 * The tutor sees each question next to what the student wrote and the mark
 * scheme they set, and awards marks there rather than inventing a single
 * percentage at the end. The awarded total drives `score_pct` — which is what
 * feeds predicted grades — so the number the student sees is derived from the
 * marking rather than estimated.
 *
 * Purely presentational: the loading and mark state live in
 * `useAnswerMarking`, which the marking queue owns.
 */
export function AnswerMarkingList({
  questions,
  answers,
  marks,
  setMark,
}: {
  questions: HomeworkQuestion[];
  answers: Record<string, HomeworkAnswer>;
  marks: Record<string, QuestionMark>;
  setMark: (questionId: string, changes: Partial<QuestionMark>) => void;
}) {
  return (
    <ol className="space-y-3">
      {questions.map((q, i) => {
        const a = answers[q.id];
        const m = marks[q.id] ?? { marks: "", feedback: "" };
        return (
          <li key={q.id} className="rounded-xl bg-card border border-border p-4 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-xs font-semibold text-muted-foreground shrink-0">Q{i + 1}</span>
              <p className="text-sm font-medium whitespace-pre-wrap flex-1">{q.prompt}</p>
              <span className="text-[11px] text-muted-foreground shrink-0">[{q.marks}]</span>
            </div>
            {q.image_path && (
              <SignedImage
                path={q.image_path}
                alt={q.image_name ?? "Question figure"}
                className="max-h-48 rounded-lg border border-border object-contain"
              />
            )}

            <div className="rounded-lg bg-muted/50 border border-border px-3 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground mb-1">
                Student's answer
              </p>
              <p className="text-sm whitespace-pre-wrap">
                {a?.answer_text || <span className="italic text-muted-foreground">Left blank</span>}
              </p>
              {a && a.images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.images.map((img) => (
                    <SignedImage
                      key={img.path}
                      path={img.path}
                      alt={img.name}
                      className="max-h-48 rounded-lg border border-border object-contain"
                    />
                  ))}
                </div>
              )}
            </div>

            {q.mark_scheme && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Mark scheme</summary>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{q.mark_scheme}</p>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                Marks
                <input
                  type="number"
                  min={0}
                  max={q.marks}
                  value={m.marks}
                  onChange={(e) => setMark(q.id, { marks: e.target.value })}
                  placeholder={`/${q.marks}`}
                  className="w-20 h-9 rounded-lg premium-input px-2 text-sm"
                />
              </label>
              <input
                value={m.feedback}
                onChange={(e) => setMark(q.id, { feedback: e.target.value })}
                placeholder="Comment on this answer (optional)"
                className="flex-1 min-w-48 h-9 rounded-lg premium-input px-3 text-sm"
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
