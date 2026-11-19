import type { HomeworkQuestion, HomeworkAnswer } from "@/hooks/data/useHomeworkQuestions";
import type { QuestionMark } from "@/hooks/data/useAnswerMarking";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Eraser, Highlighter, Underline, type LucideIcon } from "lucide-react";
import { Chip, DataTable, SciBlock, SciText } from "@/components/Shared";
import { answerSheet, readAnswer } from "@/lib/homework/answerSheet";
import { PenMark } from "@/components/homework/PenMark";
import {
  answerChunks,
  chunkContext,
  marksOver,
  paintTutorMark,
  snapToChunks,
  type Chunk,
  type Pen,
  type Span,
  type TutorMark,
} from "@/lib/homework/tutorMarks";
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
  /** The tutor's highlights and underlines on each answer, by question id. */
  tutorMarks?: Record<string, TutorMark[]>;
  /** Given, the tutor can draw on an answer: select words, then pick a pen. */
  setTutorMarks?: (questionId: string, next: TutorMark[]) => void;
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
  pens: TutorMark[];
  setPens?: (next: TutorMark[]) => void;
};

const NO_PENS: TutorMark[] = [];

function one(props: ListProps, q: HomeworkQuestion): OneProps {
  return {
    q,
    answer: props.answers[q.id]?.answer_text ?? "",
    mark: props.marks[q.id] ?? { marks: "", feedback: "" },
    setMark: (changes) => props.setMark(q.id, changes),
    held: props.held?.[q.id],
    pens: props.tutorMarks?.[q.id] ?? NO_PENS,
    setPens: props.setTutorMarks && ((next) => props.setTutorMarks!(q.id, next)),
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
          <StudentAnswer
            prompt={p.q.prompt}
            answer={p.answer}
            notation={p.notation}
            pens={p.pens}
            setPens={p.setPens}
          />
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
 *
 * The tutor can draw on it: select some words and a bar offers the
 * highlighter, the pen line and the rubber. The marks are the tutor's own
 * (see `tutorMarks`) and reach the student when the marks are published.
 */
function StudentAnswer({
  prompt,
  answer,
  notation,
  pens,
  setPens,
}: {
  prompt: string;
  answer: string;
  notation: string;
  pens: TutorMark[];
  setPens?: (next: TutorMark[]) => void;
}) {
  const sheet = useMemo(() => answerSheet(prompt), [prompt]);
  const read = useMemo(() => readAnswer(sheet, answer), [sheet, answer]);
  const root = useRef<HTMLDivElement | null>(null);
  const [picked, drop] = usePickedWords(root, !!setPens);

  const draw = (kind: Pen | null) => {
    if (!picked || !setPens) return;
    setPens(paintTutorMark(pens, picked.span, kind, answer));
    document.getSelection()?.removeAllRanges();
    drop();
  };
  const words = (at: Span) => (
    <PennedWords answer={answer} at={at} notation={notation} pens={pens} />
  );

  const text = (
    <div className="premium-input answer-lines text-base whitespace-pre-wrap break-words">
      {read.text.trim() ? words(read.textAt) : <span className="italic">Left blank</span>}
    </div>
  );
  return (
    <div ref={root} className="relative">
      {read.tabled ? (
        <div className="space-y-2 text-sm">
          {sheet.tables.map((t, i) => (
            <DataTable
              key={i}
              columns={t.columns}
              rows={t.rows}
              cell={(c) => <SciText text={c} context={notation} />}
              gap={(r, c) =>
                t.gaps[r][c] ? (
                  <b>{read.cells[i][r][c] ? words(read.at[i][r][c]) : "–"}</b>
                ) : undefined
              }
            />
          ))}
          {(sheet.boxed || read.text.trim()) && text}
        </div>
      ) : (
        text
      )}
      {picked && <PenBar top={picked.top} rubber={marksOver(picked.span, pens)} onPick={draw} />}
    </div>
  );
}

/**
 * A stretch of the answer as the pieces a pen picks up (see `answerChunks`),
 * each knowing its place in the stored answer, the marked ones under their pen.
 */
function PennedWords({
  answer,
  at,
  notation,
  pens,
}: {
  answer: string;
  at: Span;
  notation: string;
  pens: TutorMark[];
}) {
  const text = answer.slice(at.from, at.to);
  const chunks = useMemo(() => answerChunks(text, notation), [text, notation]);
  const context = chunkContext(text, notation);
  // Pieces under the same mark are drawn in one stroke, gaps and all.
  const runs: { mark: number; chunks: Chunk[] }[] = [];
  for (const c of chunks) {
    const span = { from: at.from + c.from, to: at.from + c.to };
    const mark = pens.findIndex((m) => m.from < span.to && span.from < m.to);
    const last = runs[runs.length - 1];
    if (last && last.mark === mark) last.chunks.push(c);
    else runs.push({ mark, chunks: [c] });
  }
  return (
    <>
      {runs.map((run) => (
        <PenMark key={run.chunks[0].from} pen={pens[run.mark]?.kind}>
          {run.chunks.map((c) => (
            <span
              key={c.from}
              data-from={at.from + c.from}
              data-to={at.from + c.to}
              data-space={c.space ? "" : undefined}
            >
              <SciText text={text.slice(c.from, c.to)} context={context} />
            </span>
          ))}
        </PenMark>
      ))}
    </>
  );
}

/** The pens, under the words just selected. */
function PenBar({
  top,
  rubber,
  onPick,
}: {
  top: number;
  rubber: boolean;
  onPick: (kind: Pen | null) => void;
}) {
  // Each pen's name is written in its own ink, so the button shows what it does.
  const pen = (label: string, Icon: LucideIcon, kind: Pen | null) => (
    <button
      type="button"
      onClick={() => onPick(kind)}
      aria-label={label}
      className="btn-soft inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap sm:pointer-fine:min-h-9"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="hidden sm:inline">
        <PenMark pen={kind ?? undefined}>{label}</PenMark>
      </span>
    </button>
  );
  return (
    <div
      role="toolbar"
      aria-label="Mark the selected words"
      style={{ top: top + 6 }}
      // Pressing a pen must not let go of the words it is for.
      onMouseDown={(e) => e.preventDefault()}
      className="pop-card pop-in absolute left-1/2 z-20 flex -translate-x-1/2 gap-1.5 p-1.5"
    >
      {pen("Highlight", Highlighter, "highlight")}
      {pen("Underline", Underline, "underline")}
      {rubber && pen("Rub out", Eraser, null)}
    </div>
  );
}

/**
 * The words of the answer inside `root` that are selected, rounded out to
 * whole pieces, and how far down `root` the selection ends (where the pen bar
 * goes). Read a moment after the selection settles, so the bar does not chase
 * a drag.
 */
function usePickedWords(root: RefObject<HTMLDivElement | null>, on: boolean) {
  const [picked, setPicked] = useState<{ span: Span; top: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      const el = root.current;
      const sel = document.getSelection();
      const range = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!el || !range || !el.contains(range.commonAncestorContainer)) return setPicked(null);
      const chunks: Chunk[] = [];
      for (const node of el.querySelectorAll<HTMLElement>("[data-from]")) {
        if (!holdsSelectedText(range, node)) continue;
        chunks.push({
          from: Number(node.dataset.from),
          to: Number(node.dataset.to),
          space: node.dataset.space !== undefined,
        });
      }
      const span = snapToChunks(chunks);
      const rects = range.getClientRects();
      const last = rects[rects.length - 1];
      if (!span || !last) return setPicked(null);
      setPicked({ span, top: last.bottom - el.getBoundingClientRect().top });
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 180);
    };
    document.addEventListener("selectionchange", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", changed);
    };
  }, [root, on]);
  return [picked, () => setPicked(null)] as const;
}

/** Whether any of `node`'s own text is inside the selection, not just its edge. */
function holdsSelectedText(range: Range, node: Node): boolean {
  if (!range.intersectsNode(node)) return false;
  const whole = document.createRange();
  whole.selectNodeContents(node);
  const part = range.cloneRange();
  if (part.compareBoundaryPoints(Range.START_TO_START, whole) < 0)
    part.setStart(whole.startContainer, whole.startOffset);
  if (part.compareBoundaryPoints(Range.END_TO_END, whole) > 0)
    part.setEnd(whole.endContainer, whole.endOffset);
  return part.toString().length > 0;
}
