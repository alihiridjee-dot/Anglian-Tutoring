export const SUBJECTS = [
  { value: "biology", label: "Biology" },
  { value: "chemistry", label: "Chemistry" },
  { value: "physics", label: "Physics" },
] as const;

/**
 * Cambridge (CAIE) and OxfordAQA are international boards: they sit alongside
 * Pearson Edexcel at iGCSE. OxfordAQA is its own board rather than AQA at a
 * different level, because that is the name on the student's paper and the
 * awarding body is a different one.
 *
 * Listing a board here does not offer it to anyone. Student-facing pickers
 * filter this list through curriculum coverage, so a board appears only at the
 * levels and subjects it has spec points for.
 */
export const BOARDS = [
  { value: "edexcel", label: "Edexcel" },
  { value: "aqa", label: "AQA" },
  { value: "ocr", label: "OCR" },
  { value: "cambridge", label: "Cambridge" },
  { value: "oxford_aqa", label: "OxfordAQA" },
] as const;

/**
 * International GCSE is a *level*, not a board: every board runs one, and its
 * specification is a different qualification from the domestic GCSE — different
 * spec points, different content, sat by different students. Modelling it as a
 * level is what keeps the two apart, because topics, resources, weekly focus and
 * plans are all keyed by (level, board, subject). An iGCSE student therefore
 * never sees GCSE material, even on the same board and subject.
 */
export const LEVELS = [
  { value: "gcse", label: "GCSE" },
  { value: "gcse_trilogy", label: "GCSE Combined Science (Trilogy)" },
  { value: "igcse", label: "International GCSE" },
  { value: "alevel", label: "A-Level" },
] as const;

export type SubjectV = (typeof SUBJECTS)[number]["value"];
export type BoardV = (typeof BOARDS)[number]["value"];
export type LevelV = (typeof LEVELS)[number]["value"];

/**
 * Type guards for values that arrive as plain strings — a URL, a profile row,
 * a pricing slider — so they can be narrowed without a cast.
 */
const valueIn =
  <T extends string>(list: readonly { value: T }[]) =>
  (v: unknown): v is T =>
    list.some((x) => x.value === v);

export const isSubject = valueIn(SUBJECTS);
export const isBoard = valueIn(BOARDS);
export const isLevel = valueIn(LEVELS);
