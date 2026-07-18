// Confidence is one 0-100 scale everywhere. The termly planner renders it as
// three bands (the drag-to-bucket columns); the expanded sliders read/write the
// raw number. Keeping the thresholds in one place means the board, the cards
// and the AI weekly-plan prompt all agree on what "shaky" means.

export type BandKey = "shaky" | "getting" | "confident";

export interface Band {
  key: BandKey;
  label: string;
  /** Inclusive lower bound on the 0-100 scale. */
  min: number;
  /** Inclusive upper bound. */
  max: number;
  /** Value a card snaps to when dropped into this band. */
  midpoint: number;
  /** Tailwind accent classes (text / ring / soft bg), light+dark aware. */
  accent: string;
  dot: string;
}

// Ordered most-confident first — that is how the board reads left→right.
export const BANDS: Band[] = [
  {
    key: "confident",
    label: "Confident",
    min: 67,
    max: 100,
    midpoint: 83,
    accent: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  {
    key: "getting",
    label: "Getting there",
    min: 34,
    max: 66,
    midpoint: 50,
    accent: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  {
    key: "shaky",
    label: "Needs work",
    min: 0,
    max: 33,
    midpoint: 17,
    accent: "text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
];

export function bandOf(confidence: number): Band {
  return BANDS.find((b) => confidence >= b.min && confidence <= b.max) ?? BANDS[1];
}

export function bandByKey(key: BandKey): Band {
  return BANDS.find((b) => b.key === key) ?? BANDS[1];
}

/** A colour ramp for a raw 0-100 value — used by rings and slider fills. */
export function confidenceColor(confidence: number): string {
  if (confidence >= 67) return "#10b981"; // emerald-500
  if (confidence >= 34) return "#f59e0b"; // amber-500
  return "#f43f5e"; // rose-500
}
