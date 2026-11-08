/**
 * A note's figures, drawn and checked exactly as exam-question figures are.
 *
 * A brief is read by the figure library's own reader, drawn by code, then the
 * drawing is held to the checker against that brief: every value, label and
 * line the brief names must be there, and nothing else. Notes use only the
 * kinds code draws, so the same brief always gives the same, checked picture.
 * validate.ts and load-notes.ts refuse a note whose figure fails, and the page
 * draws through the same function, so a figure that ever stopped passing
 * (a checker rule tightened later) would vanish rather than show wrong.
 */
import { readBrief } from "../figures/figureBrief";
import { checkFigure } from "../figures/figureCheck";
import { drawWithCode, drawnByCode } from "../figures/figureDraw";
import type { Note, NoteBlock } from "./noteFormat";

export type DrawnNoteFigure = { svg: string; alt: string };

/** The checked drawing for a brief, or why there isn't one. */
export function drawNoteFigure(brief: unknown): DrawnNoteFigure | { problem: string } {
  const read = readBrief(brief);
  if ("problem" in read) return { problem: `the brief ${read.problem}` };
  if (!drawnByCode(read.brief))
    return {
      problem: `a ${read.brief.kind} is drawn by a model, not by code, so a note can't use one`,
    };
  const drawn = drawWithCode(read.brief);
  if (!drawn) return { problem: "code could not fit this figure on its canvas" };
  const check = checkFigure(drawn.svg, read.brief);
  if (check.problems.length || !check.svg)
    return { problem: `the drawing fails its check: ${check.problems.join("; ")}` };
  return { svg: check.svg, alt: drawn.alt };
}

/** Every figure in a note, shared sections and board layers alike, that doesn't draw and pass. */
export function noteFigureProblems(note: Note): string[] {
  const errs: string[] = [];
  const walk = (blocks: NoteBlock[] | undefined, at: string) =>
    blocks?.forEach((b, j) => {
      if (b?.type !== "diagram" || b.diagram?.kind !== "figure") return;
      const r = drawNoteFigure(b.diagram.brief);
      if ("problem" in r) errs.push(`${at}.blocks[${j}].diagram: ${r.problem}`);
    });
  note.sections?.forEach((s, i) => walk(s?.blocks, `sections[${i}]`));
  for (const [board, layer] of Object.entries(note.boards ?? {}))
    layer?.extra?.forEach((s, i) => walk(s?.blocks, `boards.${board}.extra[${i}]`));
  return errs;
}
