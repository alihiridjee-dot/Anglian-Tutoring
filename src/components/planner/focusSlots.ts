import { isTeachBand, type PacingBand } from "@/lib/planner/pacing";

/** Stable identity for one focus-lane band — topic + kind + week it lands on. */
function focusKey(b: PacingBand): string {
  return `${b.topicId}|${b.kind}|${b.startWeek}`;
}

/** The focus-lane bands of one course's plan, as last seen. */
export interface SeenFocus {
  course: string;
  keys: Set<string>;
}

/**
 * Compare a plan's focus lane with the last one seen for the same course: the
 * slots it has now, and which of them are new. A different course starts
 * afresh, with nothing new.
 *
 * Null while the plan is still loading: there is nothing to compare, and
 * nothing to remember. A plan not loaded yet is not a plan with no reviews.
 * Remembered as one, it made every review slot read as new on every visit,
 * so "Your revision schedule updated" showed with nothing changed.
 */
export function compareFocus(
  seen: SeenFocus | null,
  course: string,
  bands: PacingBand[] | null,
): { seen: SeenFocus; added: Set<string> } | null {
  if (!bands) return null;
  const keys = new Set(bands.filter((b) => !isTeachBand(b)).map(focusKey));
  return {
    seen: { course, keys },
    added:
      seen && seen.course === course
        ? new Set([...keys].filter((k) => !seen.keys.has(k)))
        : new Set(),
  };
}
