/** Shared subject labels/colours for the parent dashboard cards and chart. */

export const SUBJECT_LABEL: Record<string, string> = {
  biology: "Biology",
  chemistry: "Chemistry",
  physics: "Physics",
};

export const SUBJECT_BADGE: Record<string, string> = {
  biology: "text-rose-600 bg-rose-50 border-rose-100",
  chemistry: "text-emerald-600 bg-emerald-50 border-emerald-100",
  physics: "text-blue-600 bg-blue-50 border-blue-100",
};

export const SUBJECT_STROKE: Record<string, string> = {
  biology: "#f43f5e",
  chemistry: "#10b981",
  physics: "#3b82f6",
};

export const SUBJECT_TEXT: Record<string, string> = {
  biology: "text-rose-600",
  chemistry: "text-emerald-600",
  physics: "text-blue-600",
};

export function subjectLabel(subject: string): string {
  return SUBJECT_LABEL[subject] ?? subject;
}
