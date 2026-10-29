/**
 * Every figure kind that lives in a file of its own (kind.ts says what one
 * holds). readBrief, drawWithCode and checkFigure fall back to this list for
 * a kind they don't draw themselves, and the writer's guide lists each one.
 */
import type { FigureKind } from "./kind";
import { pieChart } from "./pieChart";

export const KINDS: FigureKind[] = [pieChart as unknown as FigureKind];

/** The kind file for a brief's kind, if there is one. */
export const figureKind = (kind: unknown) => KINDS.find((k) => k.kind === kind);
