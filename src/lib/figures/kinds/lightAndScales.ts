/** Physics: ray diagrams, and readings on instrument scales. */
import type { FigureKind } from "./kind";
import { rayDiagram } from "./rayDiagram";
import { scaleReading } from "./scaleReading";

export const LIGHT_AND_SCALE_KINDS: FigureKind[] = [
  rayDiagram as unknown as FigureKind,
  scaleReading as unknown as FigureKind,
];
