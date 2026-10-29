/** Physics: moments, field patterns, the EM spectrum, longitudinal waves, shapes with their sizes. */
import { emSpectrum } from "./emSpectrum";
import { fieldPattern } from "./fieldPattern";
import type { FigureKind } from "./kind";
import { longitudinalWave } from "./longitudinalWave";
import { moments } from "./moments";
import { shapeSizes } from "./shapeSizes";

export const PHYSICS_KINDS: FigureKind[] = [
  moments as unknown as FigureKind,
  fieldPattern as unknown as FigureKind,
  emSpectrum as unknown as FigureKind,
  longitudinalWave as unknown as FigureKind,
  shapeSizes as unknown as FigureKind,
];
