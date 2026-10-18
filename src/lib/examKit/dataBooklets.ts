/**
 * The A-level data booklets: what each board hands out with its papers
 * beyond the periodic table.
 *
 * Physics papers come with the board's data and formulae booklet: AQA's 7408
 * Data and Formulae Booklet, OCR's H556 Data, Formulae and Relationships
 * Booklet, Pearson's 9PH0 List of data, formulae and relationships, and the
 * data and formulae pages Cambridge prints at the front of 9702 papers.
 * Chemistry papers come with the board's data sheet: the infrared and NMR
 * tables, and the constants, where the board prints them. Biology papers give
 * nothing but the calculator (a statistics formula is printed in the question
 * that needs it).
 *
 * Each booklet is copied from the board's own document, block for block, in
 * its order and its symbols, written in the notation in formula.ts.
 */

import type { BoardV, LevelV } from "@/lib/curriculum/taxonomy";
import { AQA_PHYSICS } from "@/lib/examKit/booklets/aqaPhysics";
import { OCR_PHYSICS } from "@/lib/examKit/booklets/ocrPhysics";
import { EDEXCEL_PHYSICS } from "@/lib/examKit/booklets/edexcelPhysics";
import { CAMBRIDGE_PHYSICS } from "@/lib/examKit/booklets/cambridgePhysics";
import { AQA_CHEMISTRY } from "@/lib/examKit/booklets/aqaChemistry";
import { OCR_CHEMISTRY } from "@/lib/examKit/booklets/ocrChemistry";
import { EDEXCEL_CHEMISTRY } from "@/lib/examKit/booklets/edexcelChemistry";
import { CAMBRIDGE_CHEMISTRY } from "@/lib/examKit/booklets/cambridgeChemistry";

/** A line of a formulae block: the booklet's label for it, then its formulae. */
export interface FormulaRow {
  /** As printed beside the formulae ("uniformly accelerated motion"); empty to run on from the row above. */
  label: string;
  formulae: string[];
}

/** One NMR shift range on a chart, as the booklet draws it. */
export interface ShiftBand {
  label: string;
  /** The ends of the band in ppm, high end first as the axis runs. */
  high: number;
  low: number;
}

export type BookletBlock =
  | {
      kind: "formulae";
      title: string;
      /** Set where the block is for some papers only: "Paper 4", "A level only". */
      only?: string;
      rows: FormulaRow[];
      notes?: string[];
    }
  | {
      kind: "table";
      title: string;
      only?: string;
      /** Column headings; left out where the booklet prints none. */
      head?: string[];
      rows: string[][];
      notes?: string[];
    }
  | {
      kind: "shifts";
      title: string;
      only?: string;
      /** The axis as printed: from its left end to its right end, ticks every `step`. */
      axis: { from: number; to: number; step: number; unit: string };
      bands: ShiftBand[];
      notes?: string[];
    };

export interface DataBooklet {
  /** Whose booklet this is, as the panel names it: "AQA A-level Physics". */
  label: string;
  /** The tab that opens it. */
  tab: string;
  blocks: BookletBlock[];
}

export const DATA_BOOKLETS = {
  aqaPhysics: AQA_PHYSICS,
  ocrPhysics: OCR_PHYSICS,
  edexcelPhysics: EDEXCEL_PHYSICS,
  cambridgePhysics: CAMBRIDGE_PHYSICS,
  aqaChemistry: AQA_CHEMISTRY,
  ocrChemistry: OCR_CHEMISTRY,
  edexcelChemistry: EDEXCEL_CHEMISTRY,
  cambridgeChemistry: CAMBRIDGE_CHEMISTRY,
} satisfies Record<string, DataBooklet>;

/**
 * The booklet a student's A-level paper comes with, or null where there is
 * none: biology, any other level, or a brief set for every board (no one
 * board's booklet is right for it).
 */
export function dataBookletFor(
  subject: string,
  board: BoardV | null,
  level: LevelV,
): DataBooklet | null {
  if (level !== "alevel") return null;
  if (subject === "physics") {
    if (board === "aqa") return DATA_BOOKLETS.aqaPhysics;
    if (board === "ocr") return DATA_BOOKLETS.ocrPhysics;
    if (board === "edexcel") return DATA_BOOKLETS.edexcelPhysics;
    if (board === "cambridge") return DATA_BOOKLETS.cambridgePhysics;
  }
  if (subject === "chemistry") {
    if (board === "aqa") return DATA_BOOKLETS.aqaChemistry;
    if (board === "ocr") return DATA_BOOKLETS.ocrChemistry;
    if (board === "edexcel") return DATA_BOOKLETS.edexcelChemistry;
    if (board === "cambridge") return DATA_BOOKLETS.cambridgeChemistry;
  }
  return null;
}
