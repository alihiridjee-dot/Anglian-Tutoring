export const SUBJECTS = [
  { value: "biology", label: "Biology" },
  { value: "chemistry", label: "Chemistry" },
  { value: "physics", label: "Physics" },
] as const;

export const BOARDS = [
  { value: "edexcel", label: "Edexcel" },
  { value: "aqa", label: "AQA" },
  { value: "ocr", label: "OCR" },
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
