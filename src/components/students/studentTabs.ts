/** The sections of a student's record, in the order the side navigation lists them. */
export const STUDENT_TABS = [
  "overview",
  "performance",
  "homework",
  "quizzes",
  "billing",
  "messages",
  "notes",
] as const;

export type StudentTab = (typeof STUDENT_TABS)[number];

export const isStudentTab = (v: unknown): v is StudentTab => STUDENT_TABS.includes(v as StudentTab);
