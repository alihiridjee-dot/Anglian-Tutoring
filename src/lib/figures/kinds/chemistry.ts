/** Chemistry: displayed formulae, dot-and-cross, electron shells, particle diagrams, the periodic table. */
import { displayedFormula } from "./displayedFormula";
import { dotAndCross } from "./dotAndCross";
import { electronShells } from "./electronShells";
import type { FigureKind } from "./kind";
import { particleDiagram } from "./particleDiagram";
import { periodicTable } from "./periodicTable";

export const CHEMISTRY_KINDS: FigureKind[] = [
  displayedFormula as unknown as FigureKind,
  dotAndCross as unknown as FigureKind,
  electronShells as unknown as FigureKind,
  particleDiagram as unknown as FigureKind,
  periodicTable as unknown as FigureKind,
];
