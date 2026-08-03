import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

/**
 * The curriculum page's URL state, so a specification point can be *addressed*.
 *
 * The global search palette, a bookmark, and a link a tutor sends a student all
 * resolve to the same page in the same state through these. `q` carries a
 * specification search too, which is what lets the browser back button undo a
 * search instead of leaving the page.
 *
 * This lives in lib rather than beside the route because both mounts of the
 * curriculum page — the guarded `/curriculum` and the showcase
 * `/demo/student/curriculum` — must parse the URL identically.
 */
export type CurriculumSearchParams = {
  subject?: SubjectV;
  board?: BoardV;
  level?: LevelV;
  /** A spec point to open straight into. */
  point?: string;
  /** A topic to expand. */
  topic?: string;
  /** The specification search query. */
  q?: string;
};

/** Accepts a value only when it is one of the taxonomy's own options. */
const oneOf = <T extends string>(opts: readonly { value: T }[], v: unknown): T | undefined =>
  opts.some((o) => o.value === v) ? (v as T) : undefined;

export function validateCurriculumSearch(search: Record<string, unknown>): CurriculumSearchParams {
  return {
    subject: oneOf(SUBJECTS, search.subject),
    board: oneOf(BOARDS, search.board),
    level: oneOf(LEVELS, search.level),
    point: typeof search.point === "string" ? search.point : undefined,
    topic: typeof search.topic === "string" ? search.topic : undefined,
    // A blank query is the same as no query — it would otherwise leave "?q=" on
    // the URL after clearing the box.
    q: typeof search.q === "string" && search.q.trim() ? search.q : undefined,
  };
}
