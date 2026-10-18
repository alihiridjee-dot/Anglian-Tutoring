/**
 * Which tools a task sheet offers: what the student's real paper lets them
 * have, and nothing more, so practising here is practising for the exam.
 *
 * Every GCSE, IGCSE and A-level science paper allows a calculator. Chemistry
 * papers print the board's periodic table. Physics papers come with an
 * equation sheet only where the board prints one (see equationSheets.ts):
 * GCSE in England and Edexcel's International GCSE do, Cambridge IGCSE
 * doesn't. At A-level every board hands out a data booklet instead: the
 * physics data and formulae, the chemistry infrared and NMR tables (see
 * dataBooklets.ts). Biology papers give nothing else.
 */

import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { periodicSheetFor, type PeriodicSheet } from "@/lib/examKit/periodicTable";
import { equationSheetFor, type EquationSheet } from "@/lib/examKit/equationSheets";
import { dataBookletFor, type DataBooklet } from "@/lib/examKit/dataBooklets";

export type ExamTool = "calculator" | "periodic" | "equations" | "data";

export interface ExamKitSpec {
  tools: ExamTool[];
  periodic: PeriodicSheet | null;
  equations: EquationSheet | null;
  data: DataBooklet | null;
}

export function examKitFor(subject: string, board: BoardV | null, level: LevelV): ExamKitSpec {
  const periodic = subject === "chemistry" ? periodicSheetFor(board, level) : null;
  const equations = subject === "physics" ? equationSheetFor(board, level) : null;
  const data = dataBookletFor(subject, board, level);
  const tools: ExamTool[] = ["calculator"];
  if (periodic) tools.push("periodic");
  if (equations) tools.push("equations");
  if (data) tools.push("data");
  return { tools, periodic, equations, data };
}
