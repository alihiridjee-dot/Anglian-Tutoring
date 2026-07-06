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

export const LEVELS = [
  { value: "gcse", label: "GCSE" },
  { value: "alevel", label: "A-Level" },
] as const;

export type SubjectV = (typeof SUBJECTS)[number]["value"];
export type BoardV = (typeof BOARDS)[number]["value"];
export type LevelV = (typeof LEVELS)[number]["value"];
