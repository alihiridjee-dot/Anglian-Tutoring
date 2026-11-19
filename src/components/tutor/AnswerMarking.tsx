import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";
import type { QuestionMark } from "@/hooks/data/useAnswerMarking";
import { useMemo } from "react";
import { Chip, DataTable, SciBlock, SciText } from "@/components/Shared";
import { answerSheet, readAnswer } from "@/lib/homework/answerSheet";
import { SciAnswerBox } from "@/components/homework/SciAnswerBox";
import { MarkScheme } from "@/components/homework/MarkScheme";
import { StoredFigure } from "@/components/QuestionFigure";
import { cn } from "@/lib/utils";

type ListProps = {
  questions: HomeworkQuestion[];
  answers: Record<string, HomeworkAnswer>;
  marks: Record<string, QuestionMark>;
  setMark: (questionId: string, changes: Partial<QuestionMark>) => void;
  /** The marker's reason for holding a question, by question id. */
  held?: Record<string, string>;
};

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
export function AnswerMarkingList(props: ListProps) {
  return (
    <ol className="space-y-4">
      {props.questions.map((q, i) => (
        <li key={q.id} className="premium-card p-4 sm:p-5">
          <MarkQuestion {...one(props, q)} index={i} />
        </li>
      ))}
    </ol>
  );
}

type OneProps = {
  q: HomeworkQuestion;
  answer: string;
  mark: QuestionMark;
  setMark: (changes: Partial<QuestionMark>) => void;
  held?: string;
  notation: string;
};

function one(props: ListProps, q: HomeworkQuestion): OneProps {
  return {
    q,
    answer: props.answers[q.id]?.answer_text ?? "",
    mark: props.marks[q.id] ?? { marks: "", feedback: "" },
    setMark: (changes) => props.setMark(q.id, changes),
    held: props.held?.[q.id],
    // Read with the question, so "Cl3" beside a Cl₂ question reads Cl₃.
    notation: `${q.prompt}\n${q.mark_scheme ?? ""}`,
  };
}

/**
 * One question: the student's work and the mark scheme on the left, the marks
 * and the comment on the right. On a narrow screen they stack.
 */
function MarkQuestion({ index, ...p }: OneProps & { index: number }) {
  return (
    <div className="space-y-4">
      <QuestionHead index={index} q={p.q} />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 min-w-0">
          <StoredFigure figure={p.q.figure} className="max-w-md" />
          <StudentAnswer prompt={p.q.prompt} answer={p.answer} notation={p.notation} />
          {p.q.mark_scheme && <SchemeBlock q={p.q} notation={p.notation} open />}
        </div>
        <div className="space-y-4 min-w-0">
          {p.held && <HeldNote reason={p.held} notation={p.notation} />}
          <MarkTiles
            max={p.q.marks}
            value={p.mark.marks}
            onChange={(marks) => p.setMark({ marks })}
          />
          <FeedbackBox
            value={p.mark.feedback}
            onChange={(feedback) => p.setMark({ feedback })}
            notation={p.notation}
          />
        </div>
      </div>
    </div>
  );
}

/** The question's number, wording and marks. */
function QuestionHead({ index, q }: { index: number; q: HomeworkQuestion }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-display font-extrabold text-lg leading-6 shrink-0">Q{index + 1}</span>
      <SciBlock text={q.prompt} className="min-w-0 flex-1 text-base font-medium" />
      <span className="numeral text-lg leading-6 shrink-0">[{q.marks}]</span>
    </div>
  );
}

/**
 * The marks as buttons, 0 up to the question's total: one press, no spinner.
 * A long question (more than ten marks) keeps a number box.
 */
function MarkTiles({
  max,
  value,
  onChange,
}: {
  max: number;
  value: string;
  onChange: (marks: string) => void;
}) {
  if (max > 10) {
    return (
      <label className="inline-flex items-center gap-2 text-sm font-semibold">
        Marks
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 h-11 rounded-lg premium-input px-3 text-base"
        />
        <span className="numeral">/{max}</span>
      </label>
    );
  }
  return (
    <div role="radiogroup" aria-label={`Marks out of ${max}`} className="flex flex-wrap gap-2">
      {Array.from({ length: max + 1 }, (_, n) => {
        const on = value !== "" && Number(value) === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? "" : String(n))}
            className={cn(
              "size-11 rounded-full numeral text-lg",
              on ? "btn-solid tint-emerald" : "btn-soft",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/** The comment the student will read, in a box that grows with it. */
function FeedbackBox({
  value,
  onChange,
  notation,
}: {
  value: string;
  onChange: (feedback: string) => void;
  notation: string;
}) {
  return (
    <SciAnswerBox
      value={value}
      onValueChange={onChange}
      context={notation}
      rows={4}
      placeholder="Comment on this answer"
      aria-label="Comment on this answer"
      className="w-full min-h-32 rounded-lg premium-input px-3 py-2.5 text-base leading-relaxed resize-y [field-sizing:content]"
    />
  );
}

function HeldNote({ reason, notation }: { reason: string; notation: string }) {
  return (
    <div className="tint-amber flex flex-wrap items-center gap-2">
      <Chip>✋ Held for you</Chip>
      <span className="text-sm font-medium">
        <SciText text={reason} context={notation} />
      </span>
    </div>
  );
}

function SchemeBlock({
  q,
  notation,
  open,
}: {
  q: HomeworkQuestion;
  notation: string;
  open?: boolean;
}) {
  return (
    <details open={open} className="group">
      <summary className="cursor-pointer text-sm font-semibold">📋 Mark scheme</summary>
      <MarkScheme
        scheme={q.mark_scheme ?? ""}
        context={notation}
        marks={q.marks}
        compact
        className="mt-2 text-sm"
      />
    </details>
  );
}

/**
 * What the student wrote, on the ruled lines of their sheet. A table they
 * filled in is drawn as that table, their entries in bold, then anything typed
 * in the lined box.
 */
function StudentAnswer({
  prompt,
  answer,
  notation,
}: {
  prompt: string;
  answer: string;
  notation: string;
}) {
  const sheet = useMemo(() => answerSheet(prompt), [prompt]);
  const read = useMemo(() => readAnswer(sheet, answer), [sheet, answer]);
  const text = (
    <div className="premium-input answer-lines text-base whitespace-pre-wrap break-words">
      {read.text.trim() ? (
        <SciText text={read.text} context={notation} />
      ) : (
        <span className="italic">Left blank</span>
      )}
    </div>
  );
  if (!read.tabled) return text;
  return (
    <div className="space-y-2 text-sm">
      {sheet.tables.map((t, i) => (
        <DataTable
          key={i}
          columns={t.columns}
          rows={t.rows}
          cell={(c) => <SciText text={c} context={notation} />}
          gap={(r, c) =>
            t.gaps[r][c] ? (
              <b>
                <SciText text={read.cells[i][r][c] || "–"} context={notation} />
              </b>
            ) : undefined
          }
        />
      ))}
      {(sheet.boxed || read.text.trim()) && text}
    </div>
  );
}
