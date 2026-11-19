/**
 * A tutor's own mark-up of a student's answer: words under the highlighter
 * (these earned credit) or with a pen line under them (look at this again).
 *
 * They are the tutor's alone. The AI marker's ticks live in
 * `homework_answers.credited` and are never touched from here, and a pen mark
 * carries no marks: the score is the number the tutor awards. A mark is where
 * its words sit in the answer as stored, which is final once handed in, plus
 * the words themselves, so a mark that no longer fits its answer is dropped
 * instead of landing on the wrong words.
 */
import { toSciNotation } from "@/lib/platform/sciNotation";

export type Pen = "highlight" | "underline";

/** A stretch of the stored answer, in its own characters. */
export type Span = { from: number; to: number };

export type TutorMark = Span & { kind: Pen; quote: string };

const PENS: readonly string[] = ["highlight", "underline"];

/** The stored list, in order, with anything that does not fit `answer` left out. */
export function parseTutorMarks(json: unknown, answer: string | null | undefined): TutorMark[] {
  if (!Array.isArray(json) || !answer) return [];
  const out: TutorMark[] = [];
  const sorted = json
    .filter((m): m is TutorMark => {
      const c = m as Partial<TutorMark> | null;
      return (
        Number.isInteger(c?.from) &&
        Number.isInteger(c?.to) &&
        PENS.includes(c?.kind as string) &&
        c!.from! >= 0 &&
        c!.from! < c!.to! &&
        answer.slice(c!.from, c!.to) === c?.quote
      );
    })
    .sort((a, b) => a.from - b.from);
  for (const m of sorted) {
    if (out.length && m.from < out[out.length - 1].to) continue;
    out.push({ from: m.from, to: m.to, kind: m.kind, quote: m.quote });
  }
  return out;
}

/**
 * The marks after a pen is drawn over `span`, or the rubber when `kind` is
 * null. Like a word processor: the new mark replaces whatever it covers, and
 * runs of the same pen that touch become one.
 */
export function paintTutorMark(
  marks: TutorMark[],
  span: Span,
  kind: Pen | null,
  answer: string,
): TutorMark[] {
  const kept: (Span & { kind: Pen })[] = [];
  for (const m of marks) {
    if (m.from < span.from)
      kept.push({ from: m.from, to: Math.min(m.to, span.from), kind: m.kind });
    if (m.to > span.to) kept.push({ from: Math.max(m.from, span.to), to: m.to, kind: m.kind });
  }
  if (kind && span.from < span.to) kept.push({ ...span, kind });
  kept.sort((a, b) => a.from - b.from);

  const joined: (Span & { kind: Pen })[] = [];
  for (const m of kept) {
    const last = joined[joined.length - 1];
    if (last && last.kind === m.kind && last.to === m.from) last.to = m.to;
    else joined.push({ ...m });
  }
  return joined.map((m) => ({ ...m, quote: answer.slice(m.from, m.to) }));
}

/** `span` cut wherever a mark starts or stops, each piece with the pen over it. */
export function cutByMarks(span: Span, marks: TutorMark[]): (Span & { pen?: Pen })[] {
  const out: (Span & { pen?: Pen })[] = [];
  let at = span.from;
  for (const m of marks) {
    const from = Math.max(m.from, at);
    const to = Math.min(m.to, span.to);
    if (from >= to) continue;
    if (from > at) out.push({ from: at, to: from });
    out.push({ from, to, pen: m.kind });
    at = to;
  }
  if (at < span.to) out.push({ from: at, to: span.to });
  return out;
}

/** Whether any mark lies over `span`. */
export const marksOver = (span: Span, marks: TutorMark[]) =>
  marks.some((m) => m.from < span.to && span.from < m.to);

/** A piece of an answer a pen picks up whole: a word, or the gap between two. */
export type Chunk = Span & { space: boolean };

/** Words that notation never rewrites, so they need not be asked about. */
const PLAIN_WORD = /^[a-z.,;:!?'"()]+$/;

/**
 * The answer cut into the pieces a pen picks up: words and the gaps between
 * them. A selection is rounded out to whole pieces, because the page shows
 * notation (H₂O) where the answer holds what was typed (H2O), and a place in
 * one is not a place in the other.
 *
 * Each piece is drawn through `SciText` by itself, so pieces that only read
 * right together are kept as one: "5 m2" is m² only after its number, and
 * "A -> B" takes its spaces from the arrow. The pieces drawn one by one then
 * spell exactly what the whole answer does. `context` is what `SciText` is
 * given for the whole answer; a piece is drawn with `chunkContext`.
 */
export function answerChunks(text: string, context = ""): Chunk[] {
  const chunks: Chunk[] = [];
  for (const m of text.matchAll(/\s+|\S+/g)) {
    chunks.push({ from: m.index, to: m.index + m[0].length, space: /^\s/.test(m[0]) });
  }
  const whole = toSciNotation(text, context);
  const clues = chunkContext(text, context);
  const draw = (c: Chunk) => {
    const piece = text.slice(c.from, c.to);
    return c.space || PLAIN_WORD.test(piece) ? piece : toSciNotation(piece, clues);
  };
  const drawn = chunks.map(draw);
  /** Where piece `i` starts in `whole`, the pieces before it having read right. */
  const startOf = (i: number) => drawn.slice(0, i).reduce((sum, d) => sum + d.length, 0);
  const join = (first: number, last: number, as: string) => {
    const merged: Chunk = { from: chunks[first].from, to: chunks[last].to, space: false };
    chunks.splice(first, last - first + 1, merged);
    drawn.splice(first, last - first + 1, as);
  };

  let i = 0;
  while (i < chunks.length) {
    if (whole.startsWith(drawn[i], startOf(i))) {
      i++;
      continue;
    }
    // This piece reads wrong alone. Join it to the fewest neighbours, before
    // or after, that read right together: "3.0 x 10-3" takes two each way.
    let fit: { first: number; last: number; as: string } | null = null;
    for (let more = 1; !fit && more < chunks.length; more++) {
      for (let back = 0; !fit && back <= Math.min(more, i); back++) {
        const first = i - back;
        const last = i + more - back;
        if (last >= chunks.length) continue;
        const as = toSciNotation(text.slice(chunks[first].from, chunks[last].to), clues);
        if (whole.startsWith(as, startOf(first))) fit = { first, last, as };
      }
    }
    if (!fit) break;
    join(fit.first, fit.last, fit.as);
    i = fit.first + 1;
  }
  // Nothing smaller reads right (or something is left over): one piece.
  if (chunks.length > 1 && drawn.join("") !== whole) {
    join(0, chunks.length - 1, whole);
  }
  return chunks;
}

/** What `SciText` reads for clues when it draws one piece of `text`. */
export const chunkContext = (text: string, context = "") => `${text}\n${context}`;

/**
 * The stretch a pen covers when these pieces were picked: from the first word
 * to the last, the gaps at either end left out. Null when no word was picked.
 */
export function snapToChunks(picked: Chunk[]): Span | null {
  const words = picked.filter((c) => !c.space);
  if (!words.length) return null;
  return {
    from: Math.min(...words.map((c) => c.from)),
    to: Math.max(...words.map((c) => c.to)),
  };
}
