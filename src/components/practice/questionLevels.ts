import type { QuestionLoad } from "@/lib/practice/questionLoad";

/**
 * How each level is named and drawn, wherever it is shown: the student's
 * picker, and the read-only word a tutor and a parent see. One list, so a
 * level has the same name, emoji and colour on every screen.
 */
export const QUESTION_LEVELS: Record<QuestionLoad, { name: string; emoji: string; tint: string }> =
  {
    reduced: { name: "Reduced", emoji: "🪶", tint: "tint-accent" },
    normal: { name: "Normal", emoji: "🎯", tint: "tint-primary" },
    enhanced: { name: "Enhanced", emoji: "🚀", tint: "tint-amber" },
  };
