/** Biology: family trees, flow diagrams and cycles, evolutionary trees, timelines, agar plates, pyramids. */
import { agarPlate } from "./agarPlate";
import { evolutionaryTree } from "./evolutionaryTree";
import { familyTree } from "./familyTree";
import { flowDiagram } from "./flowDiagram";
import type { FigureKind } from "./kind";
import { pyramid } from "./pyramid";
import { timeline } from "./timeline";

export const BIOLOGY_KINDS: FigureKind[] = [
  familyTree as unknown as FigureKind,
  flowDiagram as unknown as FigureKind,
  evolutionaryTree as unknown as FigureKind,
  timeline as unknown as FigureKind,
  agarPlate as unknown as FigureKind,
  pyramid as unknown as FigureKind,
];
