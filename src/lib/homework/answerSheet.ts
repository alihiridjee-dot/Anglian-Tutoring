/**
 * A table the student fills in, and the answer that holds it.
 *
 * A question that says "Complete the table" over a table with cells left
 * empty is answered in those cells, as on a paper. The answer is still one
 * piece of plain text: each filled table written as the question writes it
 * (a header row, then one row per line, fenced by pipes), then whatever was
 * typed in the lined box. So the marker, a tutor and the marked sheet all
 * read the same table, and nothing about how answers are stored changes.
 *
 * The lined box goes when the table is all the question asks for. It stays
 * when the question asks for something more (another lettered part, an
 * "Explain why…"), so there is always somewhere to write it.
 */
import { COMMAND, isGap, questionLayout, spacedLines, textBlocks } from "@/lib/platform/textBlocks";
import { isBlank } from "@/lib/platform/textLimits";

export type FillTable = { columns: string[]; rows: string[][]; gaps: boolean[][] };

/** A question's tables to fill, in the order drawn, and whether it keeps its lined box. */
export type AnswerSheet = { tables: FillTable[]; boxed: boolean };

/** What was typed: each table's cells (every cell, the given ones blank) and the box. */
export type SheetAnswer = { cells: string[][][]; text: string };

/** Where a piece of a stored answer sits in its text. */
type Span = { from: number; to: number };

/** A stored answer read back: what `SheetAnswer` holds, and where each piece is. */
export type ReadAnswer = SheetAnswer & {
  /** True when the answer holds the tables, filled; false when it is all box. */
  tabled: boolean;
  at: Span[][][];
  textAt: Span;
};

const NO_TABLES: AnswerSheet = { tables: [], boxed: true };

const ASKS_TO_FILL = /\b(complete|fill in)\b/i;
/** How to fill the table or set the answer out, not a second thing to answer. */
const GUIDES =
  /^(Complete|Fill in|Write your answer|Give your answer|Show (all )?(of )?your working)\b/i;
/** "Use the data to calculate…" asks; "Use words from the box." guides. */
const USE_TO_ASK =
  /\bto (explain|calculate|describe|show|determine|work out|suggest|predict|deduce|state|give|name|identify|compare|estimate|find|justify|evaluate)\b/i;

/** The tables in one drawn piece of a question that have cells left empty. */
export function gapTables(text: string): FillTable[] {
  const out: FillTable[] = [];
  for (const b of textBlocks(text)) {
    if (b.kind !== "table") continue;
    const gaps = b.rows.map((r) => r.map(isGap));
    if (gaps.some((r) => r.some(Boolean))) out.push({ columns: b.columns, rows: b.rows, gaps });
  }
  return out;
}

/** A question's pieces as the sheet draws them: its facts, its parts, its ask. */
function pieces(text: string): { stem: string; parts: string[]; ask: string | null } {
  const { stem, parts, ask } = questionLayout(text);
  return { stem: stem ? spacedLines(stem) : "", parts: parts.map((p) => p.text), ask };
}

/** Whether a question with no lettered parts asks for more than its table. */
function asksMore(text: string): boolean {
  const prose = textBlocks(text)
    .map((b) => (b.kind === "text" ? b.text : ""))
    .join("\n");
  return prose
    .split(/(?<=[.?!])\s+|\n+/)
    .map((s) => s.trim())
    .some((s) => COMMAND.test(s) && !GUIDES.test(s) && (!/^Use\b/.test(s) || USE_TO_ASK.test(s)));
}

/** The tables a question is answered in, and whether it still needs its lined box. */
export function answerSheet(prompt: string): AnswerSheet {
  if (!ASKS_TO_FILL.test(prompt)) return NO_TABLES;
  const { stem, parts, ask } = pieces(prompt);
  const tables = [stem, ...parts, ask ?? ""].flatMap(gapTables);
  if (!tables.length) return NO_TABLES;
  const boxed = parts.length ? !parts.every((p) => gapTables(p).length > 0) : asksMore(prompt);
  return { tables, boxed };
}

/** An answer with nothing typed, shaped to the sheet. */
export function blankAnswer(sheet: AnswerSheet): SheetAnswer {
  return { cells: sheet.tables.map((t) => t.rows.map((r) => r.map(() => ""))), text: "" };
}

/** A typed cell as stored: one line, and no pipe to split it in two. */
const stored = (cell: string) => cell.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const rowLine = (cells: string[]) => `| ${cells.join(" | ")} |`;

/**
 * The answer as stored. With no cell filled it is the box alone, so a sheet
 * nobody has typed on is blank and an answer typed only in the box is as it
 * always was.
 */
export function writeAnswer(sheet: AnswerSheet, answer: SheetAnswer): string {
  const typed = (t: number, r: number, c: number) => stored(answer.cells[t]?.[r]?.[c] ?? "");
  const filled = sheet.tables.some((table, t) =>
    table.gaps.some((row, r) => row.some((gap, c) => gap && typed(t, r, c) !== "")),
  );
  if (!filled) return answer.text;
  const tables = sheet.tables.map((table, t) =>
    [
      rowLine(table.columns),
      ...table.rows.map((row, r) =>
        rowLine(row.map((given, c) => (table.gaps[r][c] ? typed(t, r, c) : given))),
      ),
    ].join("\n"),
  );
  return tables.join("\n\n") + (isBlank(answer.text) ? "" : `\n\n${answer.text}`);
}

/** A fenced row's cells and where each sits in the answer, or null when it isn't one. */
function fencedCells(line: string, from: number): { text: string; at: Span }[] | null {
  const t = line.trimEnd();
  if (t.length < 2 || !t.startsWith("|") || !t.endsWith("|")) return null;
  const out: { text: string; at: Span }[] = [];
  let at = from + 1;
  for (const piece of t.slice(1, -1).split("|")) {
    const text = piece.trim();
    const start = at + (piece.length - piece.trimStart().length);
    out.push({ text, at: { from: start, to: start + text.length } });
    at += piece.length + 1;
  }
  return out;
}

/**
 * A stored answer read back into its cells and its box. An answer that does
 * not open with the sheet's own tables (typed before the cells existed, or
 * with no cell filled) is all box.
 */
export function readAnswer(sheet: AnswerSheet, answer: string): ReadAnswer {
  const allBox: ReadAnswer = {
    ...blankAnswer(sheet),
    text: answer,
    tabled: false,
    at: sheet.tables.map((t) => t.rows.map((r) => r.map(() => ({ from: 0, to: 0 })))),
    textAt: { from: 0, to: answer.length },
  };
  if (!sheet.tables.length) return allBox;

  const lines = answer.split("\n");
  const cells: string[][][] = [];
  const at: Span[][][] = [];
  let line = 0;
  let offset = 0;
  const next = () => {
    const text = lines[line++];
    const from = offset;
    offset += text.length + 1;
    return fencedCells(text, from);
  };
  for (const table of sheet.tables) {
    if (line + table.rows.length >= lines.length) return allBox;
    const header = next();
    if (!header || header.length !== table.columns.length) return allBox;
    if (header.some((h, c) => h.text !== table.columns[c])) return allBox;
    const tableCells: string[][] = [];
    const tableAt: Span[][] = [];
    for (const gaps of table.gaps) {
      const row = next();
      if (!row || row.length !== gaps.length) return allBox;
      tableCells.push(row.map((cell, c) => (gaps[c] ? cell.text : "")));
      tableAt.push(row.map((cell) => cell.at));
    }
    cells.push(tableCells);
    at.push(tableAt);
    if (line < lines.length) {
      if (lines[line].trim()) return allBox;
      offset += lines[line++].length + 1;
    }
  }
  const from = Math.min(offset, answer.length);
  return {
    cells,
    at,
    tabled: true,
    text: answer.slice(from),
    textAt: { from, to: answer.length },
  };
}
