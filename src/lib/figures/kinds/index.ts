/**
 * Every figure kind that lives in a file of its own (kind.ts says what one
 * holds). readBrief, drawWithCode and checkFigure fall back to this list for
 * a kind they don't draw themselves, and the writer's guide lists each one.
 */
import { BIOLOGY_KINDS } from "./biology";
import { CHEMISTRY_KINDS } from "./chemistry";
import type { FigureKind } from "./kind";
import { LIGHT_AND_SCALE_KINDS } from "./lightAndScales";
import { PHYSICS_KINDS } from "./physics";
import { pieChart } from "./pieChart";

export const KINDS: FigureKind[] = [
  pieChart as unknown as FigureKind,
  ...CHEMISTRY_KINDS,
  ...LIGHT_AND_SCALE_KINDS,
  ...PHYSICS_KINDS,
  ...BIOLOGY_KINDS,
];

/** The kind file for a brief's kind, if there is one. */
export const figureKind = (kind: unknown) => KINDS.find((k) => k.kind === kind);
