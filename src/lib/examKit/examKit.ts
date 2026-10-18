/**
 * Which tools a task sheet offers: what the student's real paper lets them
 * have, and nothing more, so practising here is practising for the exam.
 *
 * Every GCSE, IGCSE and A-level science paper allows a calculator. Chemistry
 * papers print the board's periodic table. Physics papers come with an
 * equation sheet only where the board prints one (see equationSheets.ts):
 * GCSE in England does, the international GCSEs don't.
 */

import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { periodicSheetFor, type PeriodicSheet } from "@/lib/examKit/periodicTable";
import { equationSheetFor, type EquationSheet } from "@/lib/examKit/equationSheets";

export type ExamTool = "calculator" | "periodic" | "equations";

export interface ExamKitSpec {
  tools: ExamTool[];
  periodic: PeriodicSheet | null;
  equations: EquationSheet | null;
}

export function examKitFor(subject: string, board: BoardV | null, level: LevelV): ExamKitSpec {
  const periodic = subject === "chemistry" ? periodicSheetFor(board, level) : null;
  const equations = subject === "physics" ? equationSheetFor(board, level) : null;
  const tools: ExamTool[] = ["calculator"];
  if (periodic) tools.push("periodic");
  if (equations) tools.push("equations");
  return { tools, periodic, equations };
}
