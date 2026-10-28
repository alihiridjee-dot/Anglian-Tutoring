import { describeError } from "@/lib/platform/errors";

/**
 * `grade_mcq_attempt` refuses in short lowercase phrases ("quiz not
 * available"), and a sign-in that ran out while the laptop slept comes back as
 * "JWT expired". Shown as they were, a student read the database's words in
 * the toast. Each known refusal gets a sentence instead; anything else is
 * described as before.
 */
const REFUSALS: Array<[RegExp, string]> = [
  [/not signed in|jwt expired/i, "Your session has ended — sign in again to submit."],
  [/quiz has changed/i, "This quiz has just been updated. Check your answers and submit again."],
  [/quiz not found/i, "This quiz has been taken down."],
  [/quiz not available/i, "This quiz isn't open to you any more."],
  [/quiz has no questions/i, "This quiz has no questions yet."],
  [/only students can submit/i, "Only a student account can submit a quiz."],
];

/** True when the quiz was rewritten after this paper was opened. */
export function isQuizChanged(error: unknown): boolean {
  return /quiz has changed/i.test(describeError(error, ""));
}

export function describeQuizError(error: unknown, fallback: string): string {
  const message = describeError(error, fallback);
  for (const [pattern, sentence] of REFUSALS) if (pattern.test(message)) return sentence;
  return message;
}
