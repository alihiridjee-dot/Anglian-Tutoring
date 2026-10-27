/**
 * How stored question text is laid out.
 *
 * Questions are plain text. Whoever writes one (the generator, a tutor, a
 * past paper) puts a key, a method's steps or a set of results one item per
 * line, and a table as a header row then one row per line, its cells
 * separated by " | ". The page draws by these rules (`SciBlock`) and the
 * generator is held to them (`flattenedLayout`), so what is written one way
 * is never drawn another.
 */

export type TextBlock =
  { kind: "text"; text: string } | { kind: "table"; columns: string[]; rows: string[][] };

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
      if (lines[i].trim()) paragraph.push(lines[i]);
      else flush();
      i++;
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
const COMMAND = new RegExp(
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
  return lines.map((l, i) => (i && !(isRow(l) && isRow(lines[i - 1])) ? `\n${l}` : l)).join("\n");
}
