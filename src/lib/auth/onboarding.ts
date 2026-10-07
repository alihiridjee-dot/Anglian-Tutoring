import { supabase } from "@/integrations/supabase/client";
import { isBoard, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";
import { examMondayFor } from "@/lib/planner/pacing";
import { toDateKey } from "@/lib/planner/week";

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
  { path: "/onboarding/school", label: "School & grades" },
  { path: "/onboarding/plan", label: "Choose a plan" },
] as const;

/**
 * The student's main exam board, as far as we know it: the board of a subject
 * they've saved, else the one they picked on the pricing page. Null when
 * neither exists — the caller picks its own default rather than inheriting a
 * silent "edexcel" for an AQA student who came back a step.
 */
export function knownMainBoard(
  enrolments: { board: string }[] | null | undefined,
  intendedBoard: unknown,
): BoardV | null {
  const saved = enrolments?.[0]?.board;
  if (isBoard(saved)) return saved;
  return isBoard(intendedBoard) ? intendedBoard : null;
}

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

/** A-Level sits A*–E; every GCSE level, Trilogy included, sits 9–1. Grades are
 *  free of a "not sure" option because every grade field in setup is already
 *  optional. */
export function gradeOptions(level: LevelV | null): string[] {
  return level === "alevel"
    ? ["A*", "A", "B", "C", "D", "E", "U"]
    : ["9", "8", "7", "6", "5", "4", "3", "2", "1", "U"];
}

/**
 * The summers a student can be sitting, nearest first, each named by the
 * school year that sits it. A-Level is a two-year course, so two summers. A
 * GCSE can start in Year 9, so three: offered only Years 11 and 10, a Year 9
 * had no right answer and was planned a year short. The planner's exam date
 * box covers anyone off that track.
 *
 * From the exam Monday to the end of August the nearest series is next
 * summer's and the student is between years. "Going into Year 11" says which
 * to pick there, where "Year 11" would send a Year 10 in July a year late.
 */
export function examYearOptions(
  level: LevelV | null,
  today: Date = new Date(),
): { year: number; label: string }[] {
  const nearest = Number(toDateKey(examMondayFor(today)).slice(0, 4));
  const [calendarYear, month] = toDateKey(today).split("-").map(Number);
  const between = nearest > calendarYear && month <= 8;
  const finalYear = level === "alevel" ? 13 : 11;
  const summers = level === "alevel" ? [0, 1] : [0, 1, 2];
  return summers.map((ahead) => ({
    year: nearest + ahead,
    label: `${between ? "Going into Year" : "Year"} ${finalYear - ahead} · Exams in summer ${nearest + ahead}`,
  }));
}

/** Setup was finished with no subject saved. */
export class NoSubjectsError extends Error {
  constructor() {
    super("Pick at least one subject first.");
    this.name = "NoSubjectsError";
  }
}

/**
 * Marks setup finished. This is the flag the route guard reads, so it is set
 * only once the required answers exist — never optimistically on step one.
 *
 * A subject is one of them: it prices the plan and scopes the curriculum. A
 * deep link to the school step followed by Skip used to finish setup with
 * none, and lead to a plan for an empty account. Throws NoSubjectsError then.
 */
export async function completeOnboarding(
  userId: string,
  db: Pick<typeof supabase, "from"> = supabase,
) {
  const { count, error: countError } = await db
    .from("student_enrolments")
    .select("subject", { count: "exact", head: true })
    .eq("student_id", userId);
  if (countError) throw countError;
  if (!count) throw new NoSubjectsError();

  const { error } = await db
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}
