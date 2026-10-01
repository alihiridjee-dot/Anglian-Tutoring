/**
 * The revision-note format.
 *
 * One note per *concept* (see scripts/notes/concepts), shared by every board
 * that teaches it, plus a thin per-board layer holding the parts that come
 * from that board's own papers: its spec codes, the mark-scheme phrases that
 * score, the usual mistakes and a worked past-paper question.
 *
 * The shape is deliberately small. A note is prose, lists, numbered steps,
 * tables and a handful of diagram kinds — enough to explain GCSE science
 * clearly, and few enough that every note looks like every other note.
 *
 * Inline text supports **bold** and nothing else.
 */

export const NOTE_FORMAT_VERSION = 1;

export const NOTE_BOARDS = ["aqa", "edexcel", "ocr"] as const;
export type NoteBoard = (typeof NOTE_BOARDS)[number];

export type NoteBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: { lead: string; text: string }[] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "diagram"; diagram: NoteDiagram };

/** A line graph of one or more series over a shared x axis. Shape, not data: y is 0–1. */
export interface LineGraphDiagram {
  kind: "line-graph";
  alt: string;
  x: { label: string; min: number; max: number; ticks: number[]; unit?: string };
  y: { label: string };
  series: { name: string; points: [number, number][] }[];
  markers?: { x: number; label: string }[];
  bands?: { from: number; to: number; label: string }[];
}

/** Boxes joined by arrows; `loop` draws the arrow back from the last box to the first. */
export interface FlowDiagram {
  kind: "flow";
  alt: string;
  steps: string[];
  loop?: boolean;
}

/** Two or more things side by side, compared feature by feature. */
export interface CompareDiagram {
  kind: "compare";
  alt: string;
  items: string[];
  rows: { feature: string; values: string[] }[];
}

export type NoteDiagram = LineGraphDiagram | FlowDiagram | CompareDiagram;

export interface NoteCheck {
  q: string;
  a: string;
  marks?: number;
}

export interface WorkedExample {
  /** exam_exemplars.id the question was taken from. */
  exemplar_id: string;
  /** e.g. "AQA, June 2022, Paper 1H, Q03.2" */
  source: string;
  question: string;
  marks: number;
  answer_points: string[];
  /** One sentence on how the marks are awarded, if it helps. */
  tip?: string;
}

export interface BoardLayer {
  spec_codes: string[];
  /** Phrases from this board's mark schemes, written as a student should write them. */
  exam_phrases: string[];
  mistakes: { wrong: string; right: string }[];
  worked_example?: WorkedExample;
  /** Board-only content that the shared note doesn't cover. */
  extra?: { heading: string; blocks: NoteBlock[] }[];
}

export interface Note {
  format: typeof NOTE_FORMAT_VERSION;
  concept_id: string;
  subject: "biology" | "chemistry" | "physics";
  title: string;
  key_idea: string;
  sections: { heading: string; blocks: NoteBlock[] }[];
  checks: NoteCheck[];
  boards: Partial<Record<NoteBoard, BoardLayer>>;
  meta: {
    status: "draft" | "approved";
    written_by: string;
    written_at: string;
    spec_point_ids: string[];
    exemplar_ids: string[];
  };
}

// ---------------------------------------------------------------------------
// Validation. Structural only: it proves a note will render, not that it is
// right. Scientific review is a person's job.

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isStrArr = (v: unknown, min = 1): v is string[] =>
  Array.isArray(v) && v.length >= min && v.every(isStr);

function checkBlock(b: unknown, at: string, errs: string[]) {
  const block = b as NoteBlock;
  switch (block?.type) {
    case "paragraph":
      if (!isStr(block.text)) errs.push(`${at}: paragraph needs text`);
      break;
    case "list":
      if (!isStrArr(block.items, 2)) errs.push(`${at}: list needs 2+ items`);
      break;
    case "steps":
      if (!Array.isArray(block.items) || block.items.length < 2 || !block.items.every((s) => isStr(s?.lead) && isStr(s?.text)))
        errs.push(`${at}: steps need 2+ items with lead and text`);
      break;
    case "table":
      if (!isStrArr(block.columns, 2)) errs.push(`${at}: table needs 2+ columns`);
      else if (!Array.isArray(block.rows) || block.rows.length < 1 || !block.rows.every((r) => Array.isArray(r) && r.length === block.columns.length && r.every(isStr)))
        errs.push(`${at}: every table row needs ${block.columns.length} cells`);
      break;
    case "diagram":
      checkDiagram(block.diagram, `${at}.diagram`, errs);
      break;
    default:
      errs.push(`${at}: unknown block type ${JSON.stringify((block as { type?: unknown })?.type)}`);
  }
}

function checkDiagram(d: NoteDiagram, at: string, errs: string[]) {
  if (!isStr(d?.alt)) errs.push(`${at}: needs alt text`);
  if (d?.kind === "line-graph") {
    const { x, series } = d;
    if (!x || !(x.max > x.min) || !Array.isArray(x.ticks) || !isStr(x.label)) errs.push(`${at}: line-graph needs x {label, min < max, ticks}`);
    if (!isStr(d.y?.label)) errs.push(`${at}: line-graph needs y.label`);
    if (!Array.isArray(series) || series.length < 1 || series.length > 5) errs.push(`${at}: line-graph needs 1–5 series`);
    else
      for (const s of series) {
        if (!isStr(s.name) || !Array.isArray(s.points) || s.points.length < 2) errs.push(`${at}: series needs a name and 2+ points`);
        else if (s.points.some(([px, py]) => px < x.min || px > x.max || py < 0 || py > 1))
          errs.push(`${at}: series "${s.name}" has a point outside x ${x.min}–${x.max} or y 0–1`);
      }
  } else if (d?.kind === "flow") {
    if (!isStrArr(d.steps, 2) || d.steps.length > 7) errs.push(`${at}: flow needs 2–7 steps`);
  } else if (d?.kind === "compare") {
    if (!isStrArr(d.items, 2) || d.items.length > 4) errs.push(`${at}: compare needs 2–4 items`);
    else if (!Array.isArray(d.rows) || !d.rows.every((r) => isStr(r.feature) && Array.isArray(r.values) && r.values.length === d.items.length))
      errs.push(`${at}: every compare row needs ${d.items.length} values`);
  } else errs.push(`${at}: unknown diagram kind`);
}

export function validateNote(n: unknown): string[] {
  const errs: string[] = [];
  const note = n as Note;
  if (note?.format !== NOTE_FORMAT_VERSION) errs.push(`format must be ${NOTE_FORMAT_VERSION}`);
  for (const k of ["concept_id", "title", "key_idea"] as const) if (!isStr(note?.[k])) errs.push(`${k} is required`);
  if (!["biology", "chemistry", "physics"].includes(note?.subject)) errs.push("subject is invalid");
  if (!Array.isArray(note?.sections) || note.sections.length < 1) errs.push("needs at least one section");
  else
    note.sections.forEach((s, i) => {
      if (!isStr(s?.heading)) errs.push(`sections[${i}]: heading is required`);
      if (!Array.isArray(s?.blocks) || s.blocks.length < 1) errs.push(`sections[${i}]: needs blocks`);
      else s.blocks.forEach((b, j) => checkBlock(b, `sections[${i}].blocks[${j}]`, errs));
    });
  if (!Array.isArray(note?.checks) || note.checks.length < 2 || !note.checks.every((c) => isStr(c?.q) && isStr(c?.a)))
    errs.push("needs 2+ checks with q and a");
  const boards = Object.keys(note?.boards ?? {});
  if (boards.length < 1) errs.push("needs at least one board layer");
  for (const b of boards) {
    if (!(NOTE_BOARDS as readonly string[]).includes(b)) { errs.push(`boards.${b}: unknown board`); continue; }
    const l = note.boards[b as NoteBoard]!;
    if (!isStrArr(l.spec_codes)) errs.push(`boards.${b}: spec_codes required`);
    if (!isStrArr(l.exam_phrases, 2)) errs.push(`boards.${b}: needs 2+ exam_phrases`);
    if (!Array.isArray(l.mistakes) || !l.mistakes.every((m) => isStr(m?.wrong) && isStr(m?.right))) errs.push(`boards.${b}: mistakes need wrong and right`);
    const w = l.worked_example;
    if (w && (!isStr(w.exemplar_id) || !isStr(w.source) || !isStr(w.question) || !(w.marks > 0) || !isStrArr(w.answer_points)))
      errs.push(`boards.${b}: worked_example is incomplete`);
    l.extra?.forEach((s, i) => s.blocks.forEach((blk, j) => checkBlock(blk, `boards.${b}.extra[${i}].blocks[${j}]`, errs)));
  }
  if (!["draft", "approved"].includes(note?.meta?.status)) errs.push("meta.status must be draft or approved");
  if (!isStr(note?.meta?.written_by)) errs.push("meta.written_by is required");
  if (!Array.isArray(note?.meta?.spec_point_ids) || note.meta.spec_point_ids.length < 1) errs.push("meta.spec_point_ids required");
  return errs;
}

/** Splits text on **bold** markers into plain and bold runs. */
export function inlineRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((t) => (t.startsWith("**") && t.endsWith("**") ? { text: t.slice(2, -2), bold: true } : { text: t, bold: false }));
}
