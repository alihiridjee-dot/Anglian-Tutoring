/**
 * How stored question text is laid out.
 *
 * Questions are plain text. Whoever writes one (the generator, a tutor, a
 * past paper) puts a key, a method's steps or a set of results one item per
 * line, and a table as a header row then one row per line, its cells
 * separated by " | ". An equation on its own line is lifted out of the
 * paragraph, and the lines under it say what goes on its arrows (`reactionAt`).
 * The page draws by these rules (`SciBlock`) and the generator is held to
 * them (`flattenedLayout`), so what is written one way is never drawn another.
 */

/** What is written on an arrow: a reagent, a condition, or a catalyst, which is highlighted. */
export type ReactionLabel = { text: string; catalyst: boolean };
/** One arrow of an equation: which way it points and what is written over and under it. */
export type ReactionArrow = { reversible: boolean; above: ReactionLabel[]; below: ReactionLabel[] };
/** An equation or a route: its stops in the order written, and the arrow after each but the last. */
export type Reaction = { stops: string[]; arrows: ReactionArrow[] };

export type TextBlock =
  | { kind: "text"; text: string }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | ({ kind: "reaction" } & Reaction);

/** Words of a sentence, never of a substance: a line holding one is prose with an arrow in it. */
const PROSE =
  /\b(the|this|that|these|is|are|was|were|which|what|when|shows?|shown|reacts?|forms?|gives?|equation|reaction)\b/i;

/** One side of an arrow: substances joined by " + ", each a formula or a short name. */
function isSide(side: string): boolean {
  return side.split(/\s+\+\s+/).every((term) => {
    const t = term.trim();
    if (!t || t.split(/\s+/).length > 4) return false;
    // Sentence punctuation; a decimal point or a comma inside a name (2,4-D) is fine.
    return !/[?!;:]|[.,](\s|$)/.test(t) && !PROSE.test(t);
  });
}

/**
 * A line that is an equation and nothing else: "Cl₂ + 2KBr → 2KCl + Br₂",
 * a word equation, or a route of several steps, "propene → Y → propanone".
 * The arrows are the ones written, in the places written. Null for a
 * sentence that only mentions an equation, which stays a sentence.
 */
function equationOf(line: string): Reaction | null {
  const t = line.trim();
  if (!/[→⇌]/.test(t) || t.length > 160) return null;
  const pieces = t.split(/\s*([→⇌])\s*/);
  const stops = pieces.filter((_, i) => i % 2 === 0);
  if (!stops.every(isSide)) return null;
  const arrows = pieces
    .filter((_, i) => i % 2 === 1)
    .map((a) => ({ reversible: a === "⇌", above: [], below: [] }));
  return { stops, arrows };
}

/** "Step 2: NaOH(aq); heat under reflux", or "Conditions: …" under a one-step equation. */
const ON_ARROW = /^\s*(?:Step\s+(\d{1,2})|Conditions?)\s*:\s*(\S.*)$/i;

/** The labels in one half of a step line, a catalyst told apart by the word itself. */
function labelsOf(text: string): ReactionLabel[] {
  return text
    .split(/,\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const catalyst = /\bcatalyst\b/i.test(item);
      const name = item
        .replace(/\(?\bcatalyst\b\)?:?/i, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { text: catalyst ? name : item, catalyst };
    });
}

/**
 * The equation that starts at line `i`, with the lines under it that say
 * what goes on its arrows, and how many lines that took. "Step n:" names
 * the nth arrow; "Conditions:" the only arrow of a one-step equation. What
 * is written before a ";" goes over the arrow (reagents) and what follows
 * goes under it (conditions); with no ";" it all goes over. A line that
 * names no arrow of this equation, or reads as a sentence (a method's
 * "Step 1: Weigh the crucible."), is left as text.
 */
function reactionAt(lines: string[], i: number): { reaction: Reaction; used: number } | null {
  const reaction = equationOf(lines[i]);
  if (!reaction) return null;
  let j = i + 1;
  const seen = new Set<number>();
  for (; j < lines.length; j++) {
    const m = ON_ARROW.exec(lines[j]);
    if (!m || m[2].length > 80 || /[.?!]$/.test(m[2].trim())) break;
    const n = m[1] ? Number(m[1]) - 1 : reaction.arrows.length === 1 ? 0 : -1;
    if (n < 0 || n >= reaction.arrows.length || seen.has(n)) break;
    seen.add(n);
    const [over, ...under] = m[2].split(/\s*;\s*/);
    reaction.arrows[n].above = labelsOf(over);
    reaction.arrows[n].below = labelsOf(under.join(", "));
  }
  return { reaction, used: j - i };
}

/** A compound the student has to work out, written as its letter: "Y", "compound Y". */
export const isUnknown = (stop: string) => /^(?:[Cc]ompound\s+)?[A-Z]$/.test(stop.trim());

/** A table row: cells separated by a spaced pipe, or a row fenced by pipes. */
const isRow = (line: string) => / \| /.test(line) || /^\|.+\|$/.test(line.trim());

/**
 * A row's cells. A fenced row, "| a | b |", drops its fences; an unfenced
 * one keeps a trailing empty cell, so "proton | |" is three cells, two blank.
 */
function cellsOf(line: string): string[] {
  const t = line.trim();
  const inner = t.startsWith("|") && t.endsWith("|") ? t.slice(1, -1) : t;
  return inner.split("|").map((c) => c.trim());
}

/**
 * A cell left for the student to fill in: empty, or drawn as a rule
 * ("______", "....."). See lib/homework/answerSheet.
 */
export const isGap = (cell: string) => /^(_{2,}|\.{3,}|…+)?$/.test(cell);

/** A Markdown rule row, "--- | :---:", says nothing to a student. */
const isRule = (cells: string[]) => cells.every((c) => /^:?-{3,}:?$/.test(c));

/**
 * Rows fitted to the header's width: a short row is padded with blanks, and
 * blank cells past the header are dropped. Null when a row holds more than
 * the header names, so it can't be drawn as that table, and when every row
 * names itself ("Age in years: 37–39 | 48–72"): those read better as lines
 * than as a table whose first row isn't a header.
 */
function fitted(rows: string[][]): string[][] | null {
  if (rows.every((r) => /:\s/.test(r[0]))) return null;
  const width = rows[0].length;
  const out: string[][] = [];
  for (const r of rows) {
    if (r.slice(width).some(Boolean)) return null;
    out.push([...r.slice(0, width), ...Array<string>(Math.max(0, width - r.length)).fill("")]);
  }
  return out;
}

/**
 * The text as paragraphs and tables. A paragraph keeps its own line breaks;
 * a blank line starts the next one. Two or more rows in a run make a table,
 * the first row its header. Rows that can't make one stay lines as written.
 */
export function textBlocks(text: string): TextBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "text", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length;) {
    if (isRow(lines[i])) {
      let j = i;
      while (j < lines.length && isRow(lines[j])) j++;
      const rows = lines
        .slice(i, j)
        .map(cellsOf)
        .filter((r) => !isRule(r));
      const table = rows.length >= 2 && rows[0].length >= 2 ? fitted(rows) : null;
      if (table) {
        flush();
        blocks.push({ kind: "table", columns: table[0], rows: table.slice(1) });
      } else paragraph.push(...lines.slice(i, j));
      i = j;
    } else {
      // "Hydrochloric acid reacts with calcium oxide: CaO + 2HCl → …": the
      // words stay a line of the paragraph and the equation is lifted out.
      const lead = /^(.*[^\s:]:)\s+(\S.*)$/.exec(lines[i]);
      const own = reactionAt(lines, i);
      const led =
        !own && lead && !/[→⇌]/.test(lead[1])
          ? reactionAt([lead[2], ...lines.slice(i + 1)], 0)
          : null;
      const found = own ?? led;
      if (found) {
        if (led) paragraph.push(lead![1]);
        flush();
        blocks.push({ kind: "reaction", ...found.reaction });
        i += found.used;
      } else {
        if (lines[i].trim()) paragraph.push(lines[i]);
        else flush();
        i++;
      }
    }
  }
  flush();
  return blocks;
}

/** Key statements on one line: "1a Has legs – go to 2 1b No legs – earthworm". */
const KEY_STEP = /(?:^|\s)\d{1,2}[ab](?=[\s.:)])/g;

/**
 * Why a question's layout would be lost on the page, or null when it is
 * kept. A key run into one line, or table rows that can't be drawn as a
 * table, read as a jumble however they are shown. A lone row of headings is
 * fine: a "Which row…?" question's options are its rows (`rowOptions`).
 */
export function flattenedLayout(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if ((line.match(KEY_STEP)?.length ?? 0) >= 2 && /\bgo to\b/i.test(line))
      return "runs its key into one line: put each statement on its own line";
  }
  for (const b of textBlocks(text)) {
    const lines = b.kind === "text" ? b.text.split("\n") : [];
    if (lines.some((l, i) => i > 0 && isRow(l) && isRow(lines[i - 1])))
      return 'has a table that can\'t be drawn: write its header row, then each row on its own line, with a cell for every heading, separated by " | "';
  }
  return null;
}

/**
 * A "Which row…?" question: its last line is the table's headings and each
 * option is a row ("regular | touching | vibrate about fixed positions").
 * The options are then drawn as that table's rows, as a paper prints them.
 * Null for any other question.
 */
export function rowOptions(
  question: string,
  options: string[],
): { question: string; columns: string[]; rows: string[][] } | null {
  const lines = question.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const last = lines[lines.length - 1];
  if (lines.length < 2 || !isRow(last) || isRow(lines[lines.length - 2])) return null;
  const columns = cellsOf(last);
  const rows = options.map(cellsOf);
  if (columns.length < 2 || rows.some((r) => r.length !== columns.length)) return null;
  return { question: lines.slice(0, -1).join("\n").trimEnd(), columns, rows };
}

/** One lettered part of a question: "(a) Give the genotype… (1 mark)". */
export type QuestionPart = { label: string; text: string; marks: number | null };

/**
 * A task question as its pieces, so a long one reads in steps: the facts it
 * gives (`stem`), its lettered parts, and, when it has none, the line that
 * asks (`ask`), drawn apart from the facts.
 *
 * Only what is written plainly is read. Parts start a line with "(a)", "(b)"…
 * in order from (a), and need at least two; a part's own marks are taken off
 * the end of its text ("(1 mark)", "[2 marks]", "[2]"). The ask is a last
 * line starting with a command word, after at least one line of facts. Any
 * other question comes back as its stem alone, drawn as it always was.
 */
export function questionLayout(text: string): {
  stem: string;
  parts: QuestionPart[];
  ask: string | null;
} {
  const lines = text.replace(/\r\n?/g, "\n").trimEnd().split("\n");
  const starts: number[] = [];
  for (const [i, line] of lines.entries()) {
    const m = PART_LABEL.exec(line);
    if (m && m[1] === "abcdefgh"[starts.length]) starts.push(i);
  }
  if (starts.length >= 2) {
    const parts = starts.map((from, k) => {
      const body = lines
        .slice(from, starts[k + 1] ?? lines.length)
        .join("\n")
        .replace(PART_LABEL, "")
        .trim();
      const marks = PART_MARKS.exec(body);
      return {
        label: "abcdefgh"[k],
        text: marks ? body.slice(0, marks.index).trimEnd() : body,
        marks: marks ? Number(marks[1] ?? marks[2]) : null,
      };
    });
    return { stem: lines.slice(0, starts[0]).join("\n").trim(), parts, ask: null };
  }
  // "Show your working." after the ask goes with it, not in its place.
  let at = lines.length - 1;
  while (at > 0 && HOW_TO_ANSWER.test(lines[at].trim())) at--;
  while (at > 0 && !lines[at].trim()) at--;
  const asks = lines[at].trim();
  const facts = lines.slice(0, at).join("\n").trim();
  if (facts && COMMAND.test(asks) && !HOW_TO_ANSWER.test(asks) && !isRow(asks))
    return { stem: facts, parts: [], ask: lines.slice(at).join("\n").trim() };
  return { stem: text, parts: [], ask: null };
}

/** An instruction on how to answer, not what to answer. */
const HOW_TO_ANSWER = /^(Show (all )?(of )?your working|Give your answer|Write your answer)/i;
const PART_LABEL = /^\s*\(([a-h])\)\s+/;
/** "(1 mark)", "[2 marks]" or "[2]", but not "(2)", which may be an equation's number. */
const PART_MARKS = /\s*(?:\((\d{1,2})\s*marks?\)|\[(\d{1,2})(?:\s*marks?)?\])\.?\s*$/;
// prettier-ignore
export const COMMAND = new RegExp(
  "^(Explain|Give|State|Describe|Suggest|Calculate|Compare|Evaluate|Name|Identify|Determine|" +
    "Use|Write|Predict|Show|Draw|Complete|Sketch|Deduce|Justify|Discuss|Outline|Define|" +
    "Estimate|Plan|Balance|Work out|Find|What|Which|Why|How)\\b",
);

/**
 * Text with each line its own paragraph, so facts given one per line read
 * as separate statements. A table's rows stay together, so it is still a table.
 */
export function spacedLines(text: string): string {
  const lines = text.split("\n");
  // The lines under an equation that label its arrows stay with it too.
  const held = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const used = isRow(lines[i]) ? 1 : (reactionAt(lines, i)?.used ?? 1);
    for (let k = 1; k < used; k++) held.add(i + k);
    i += used - 1;
  }
  return lines
    .map((l, i) => (i && !(isRow(l) && isRow(lines[i - 1])) && !held.has(i) ? `\n${l}` : l))
    .join("\n");
}
