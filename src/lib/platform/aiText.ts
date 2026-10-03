import type Anthropic from "@anthropic-ai/sdk";

/**
 * Shared by the short drafting calls (session blurb, weekly summary and
 * feedback, spec-point suggestions, chat drafts).
 *
 * claude-sonnet-5 thinks by default, and its thinking counts against
 * `max_tokens`. These calls ask for a few sentences with a ceiling of 200 to
 * 1,000 tokens, so thinking could use up the room and cut the answer short.
 * They are simple rewording jobs, so thinking is turned off for them.
 */
export const NO_THINKING = { type: "disabled" } as const;

/**
 * The text of a reply that finished on its own.
 *
 * Anything but "end_turn" (the token ceiling, a refusal) means the text is
 * partial or missing, and a partial summary saved to weekly_focus reads to a
 * student as if it were whole. So it is an error, never shown.
 */
export function completeText(res: Anthropic.Message): string {
  if (res.stop_reason !== "end_turn") {
    throw new Error("The AI's answer was incomplete. Try again.");
  }
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
