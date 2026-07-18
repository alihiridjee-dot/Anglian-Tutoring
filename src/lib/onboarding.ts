import { supabase } from "@/integrations/supabase/client";

/**
 * Profile setup — the steps between verifying an email and reaching payment.
 *
 * Each step commits to the database as the student leaves it, rather than
 * accumulating in memory and saving at the end. Setup is a five-page flow with
 * a payment wall at the far side, so abandonment part-way through is normal;
 * committing per step means coming back tomorrow resumes rather than restarts.
 *
 * Board and subjects are required — they scope the curriculum and drive RLS, so
 * a student without them has an app with nothing in it. Everything after is
 * optional and skippable.
 */

export const ONBOARDING_STEPS = [
  { path: "/onboarding/board", label: "Exam board" },
  { path: "/onboarding/subjects", label: "Subjects" },
  { path: "/onboarding/learning", label: "How you learn" },
  { path: "/onboarding/confidence", label: "Your topics" },
  { path: "/onboarding/school", label: "School & grades" },
  { path: "/onboarding/plan", label: "Choose a plan" },
] as const;

export function stepIndex(pathname: string): number {
  const i = ONBOARDING_STEPS.findIndex((s) => pathname.startsWith(s.path));
  return i === -1 ? 0 : i;
}

/**
 * The slider questions.
 *
 * Deliberately phrased as statements the student rates 1–5, all in the same
 * direction (5 = strength), so a low score always means "needs support" and the
 * tutor can read a row of answers without decoding which ones are reversed.
 */
export const LEARNING_QUESTIONS = [
  {
    id: "recall",
    prompt: "I can recall facts and definitions when I need them",
    low: "I forget them",
    high: "They stick",
  },
  {
    id: "understanding",
    prompt: "I understand new concepts the first time they're explained",
    low: "I need it repeated",
    high: "First time",
  },
  {
    id: "application",
    prompt: "I can apply what I know to unfamiliar exam questions",
    low: "I get stuck",
    high: "I adapt easily",
  },
  {
    id: "exam_technique",
    prompt: "I know how to structure answers to earn every mark",
    low: "I lose marks",
    high: "I know the format",
  },
  {
    id: "maths",
    prompt: "I'm comfortable with the maths in science questions",
    low: "It throws me",
    high: "No problem",
  },
  {
    id: "practicals",
    prompt: "I'm confident on required practicals and how they're examined",
    low: "Not confident",
    high: "Confident",
  },
  {
    id: "independence",
    prompt: "I can plan my own revision and keep to it",
    low: "I need structure",
    high: "I self-manage",
  },
] as const;

export type LearningResponses = Record<string, number>;

export const DEFAULT_LEARNING_RESPONSES: LearningResponses = Object.fromEntries(
  LEARNING_QUESTIONS.map((q) => [q.id, 3]),
);

/** GCSE sits 9–1; A-Level sits A*–E. Grades are free of a "not sure" option
 *  because every grade field in setup is already optional. */
export function gradeOptions(level: "gcse" | "alevel" | null): string[] {
  return level === "alevel"
    ? ["A*", "A", "B", "C", "D", "E", "U"]
    : ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
}

/**
 * Marks setup finished. This is the flag the route guard reads, so it is set
 * only once the required answers exist — never optimistically on step one.
 */
export async function completeOnboarding(userId: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}
