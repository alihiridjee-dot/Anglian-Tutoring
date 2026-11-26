import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isDemoStudent, DEMO_MCQ } from "@/lib/demo/studentDemo";
import type { McqAnswers } from "@/lib/mcq/mcqAnswers";
import { retakeOpensAt } from "@/lib/mcq/retakeLock";

/**
 * The quiz page's reads and writes: the paper, the attempt filed this week,
 * and filing a new one. Kept here so `TakeMcqPage` holds no database calls.
 */

export type Q = {
  id: string;
  position: number;
  question: string;
  options: string[];
  /** The figure the question is answered from, `{ svg, alt }`, or null. */
  figure?: Json | null;
  /** Four answer pictures, `{ svg, alt }` in the options' order, when the answers are pictures. */
  option_figures?: Json | null;
};

export type SetRow = {
  id: string;
  title: string;
  description: string | null;
  published: boolean;
  /** Absent on the showcase fixtures, which have no header slider to move. */
  subject?: string | null;
  /** "generated" for a point's shared quiz, which is cut to the student's level. */
  origin?: string | null;
  /** The course of the spec point it tests: a student opens only their own. */
  spec_points?: { topics: { subject: string; board: string; level: string } | null } | null;
};

export type Paper = { set: SetRow; questions: Q[] };

/** What the server sends back once the paper has been marked. */
export type Marked = {
  score: number;
  total: number;
  byQuestion: Record<string, { correctIndex: number; explanation: string | null }>;
  /** When the quiz opens again (see retakeLock). Null on the showcase, which has no lock. */
  retakeOpensAt: Date | null;
  /**
   * How many of the quiz's first questions the attempt was set and marked on
   * (`mcq_attempts.shown_count`). Null: all of them.
   */
  shownCount: number | null;
};

/** The marked paper, the answers it was marked on, and the attempt it was filed as. */
export type Review = { marked: Marked; answers: McqAnswers; attemptId: string | null };

/**
 * Read `grade_mcq_attempt`'s reply. The answers come from it too: when the
 * server returns an attempt already filed (a retry, or a retake inside the
 * week from a second tab), those are the answers it marked, not the ones on
 * the screen.
 */
export function readGraded(data: unknown): Review {
  const graded = data as {
    attempt_id?: string;
    score: number;
    total: number;
    shown_count?: number | null;
    results: Array<{
      question_id: string;
      correct_index: number;
      explanation: string | null;
      chosen_index: number | null;
    }>;
    retake_opens_at?: string;
  } | null;
  if (!graded || typeof graded.score !== "number") {
    throw new Error("The quiz couldn't be marked — try submitting again.");
  }
  const byQuestion: Marked["byQuestion"] = {};
  const answers: McqAnswers = {};
  for (const r of graded.results ?? []) {
    byQuestion[r.question_id] = { correctIndex: r.correct_index, explanation: r.explanation };
    if (typeof r.chosen_index === "number") answers[r.question_id] = r.chosen_index;
  }
  const opens = graded.retake_opens_at ? new Date(graded.retake_opens_at) : null;
  return {
    marked: {
      score: graded.score,
      total: graded.total,
      byQuestion,
      retakeOpensAt: opens && Number.isFinite(opens.getTime()) ? opens : null,
      shownCount: typeof graded.shown_count === "number" ? graded.shown_count : null,
    },
    answers,
    attemptId: graded.attempt_id ?? null,
  };
}

/**
 * This student's attempt from the last week, marked — or null when the quiz is
 * open to them. The server won't file another attempt inside the week, so the
 * page opens on the one it has rather than a blank paper it would not keep.
 */
export async function fetchLockedAttempt(userId: string, setId: string): Promise<Review | null> {
  const { data: last, error } = await supabase
    .from("mcq_attempts")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("set_id", setId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!last) return null;
  const opensAt = retakeOpensAt(last.created_at);
  if (opensAt.getTime() <= Date.now()) return null;
  // The filed attempt's own id replays it: marked, with explanations, and
  // nothing written.
  const { data, error: gradeError } = await supabase.rpc("grade_mcq_attempt", {
    _set_id: setId,
    _answers: {} as Json,
    _attempt_id: last.id,
  });
  if (gradeError) throw gradeError;
  const review = readGraded(data);
  review.marked.retakeOpensAt = opensAt;
  return review;
}

/**
 * Marks and files these answers under `attemptId` (see `attemptIdFor`). A
 * retry with the same id gets the attempt already filed, not a second.
 */
export async function fileAttempt(
  setId: string,
  answers: McqAnswers,
  attemptId: string | null,
): Promise<Review> {
  const { data, error } = await supabase.rpc("grade_mcq_attempt", {
    _set_id: setId,
    _answers: answers as unknown as Json,
    _attempt_id: attemptId ?? undefined,
  });
  if (error) throw error;
  return readGraded(data);
}

/**
 * The paper: its title and its questions, without the answers.
 *
 * Resolves to null when the set doesn't exist or isn't this student's to open,
 * and throws when it simply couldn't be fetched — those are different screens.
 * The first is final; the second gets a "Try again".
 */
/** Whether this student has ever filed an attempt on this quiz. */
export async function hasAttempted(userId: string, setId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("mcq_attempts")
    .select("id")
    .eq("user_id", userId)
    .eq("set_id", setId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function fetchPaper(setId: string): Promise<Paper | null> {
  // Demo student: render a self-contained fixture quiz, never real content.
  if (isDemoStudent()) {
    const demo = DEMO_MCQ[setId];
    return demo ? { set: demo.set, questions: demo.questions } : null;
  }
  // The answers are deliberately absent from this select — they live
  // server-side now and arrive only once the paper has been marked.
  const [{ data: s, error: sErr }, { data: qs, error: qErr }] = await Promise.all([
    supabase
      .from("mcq_sets")
      .select(
        "id, title, description, published, subject, origin, spec_points(topics(subject, board, level))",
      )
      .eq("id", setId)
      .maybeSingle(),
    supabase
      .from("mcq_questions")
      .select("id, position, question, options, figure, option_figures")
      .eq("set_id", setId)
      // Position isn't unique: the id settles a tie, as it does on the server.
      .order("position")
      .order("id"),
  ]);
  if (sErr) throw sErr;
  if (qErr) throw qErr;
  if (!s) return null;
  return {
    set: s as SetRow,
    questions: ((qs ?? []) as Q[]).map((q) => ({
      ...q,
      options: Array.isArray(q.options) ? (q.options as string[]) : [],
    })),
  };
}
