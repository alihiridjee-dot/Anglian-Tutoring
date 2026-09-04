/**
 * Shared subject labels and colours.
 *
 * The three sciences are colour-coded across the whole product — Biology
 * green, Chemistry violet, Physics blue — and those three colours are design
 * tokens (`--bio` / `--chem` / `--phys`, see styles.css), not Tailwind palette
 * classes. Reading them from the tokens is what keeps a Chemistry card, its
 * chart line and its badge the same violet.
 *
 * `SUBJECT_TINT` is the one to reach for. Wrapping any subtree in it repaints
 * every card, meter, icon tile and shadow inside to that subject, because the
 * whole kit mixes against `--tint`. The other exports are for the places that
 * need a bare colour (a chart stroke) or a single coloured word.
 */

export const SUBJECT_LABEL: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

/** The wrapper class. `<div className={subjectTint(subject)}>` and you're done. */
export const SUBJECT_TINT: Record<string, string> = {
  biology: "tint-bio",
  chemistry: "tint-chem",
  physics: "tint-phys",
};

/**
 * Badge. Now tint-driven rather than three hand-picked Tailwind triples, so it
 * matches the card it sits on instead of approximating it.
 */
export const SUBJECT_BADGE: Record<string, string> = {
  biology: "tint-bio",
  chemistry: "tint-chem",
  physics: "tint-phys",
};

/** Bare colour, for Recharts strokes and anything else that can't take a class. */
export const SUBJECT_STROKE: Record<string, string> = {
  biology: "var(--bio)",
  chemistry: "var(--chem)",
  physics: "var(--phys)",
};

export const SUBJECT_TEXT: Record<string, string> = {
  biology: "text-[color:var(--bio)]",
  chemistry: "text-[color:var(--chem)]",
  physics: "text-[color:var(--phys)]",
};

export function subjectLabel(subject: string): string {
  return SUBJECT_LABEL[subject] ?? subject;
}

/** The tint class for a subject, falling back to the brand tint. */
export function subjectTint(subject: string): string {
  return SUBJECT_TINT[subject] ?? "tint-primary";
}
