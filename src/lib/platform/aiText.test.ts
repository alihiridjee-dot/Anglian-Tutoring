import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { completeText } from "./aiText";

/** A reply as the API returns it, with only the fields completeText reads. */
function reply(stop_reason: Anthropic.Message["stop_reason"], ...texts: string[]) {
  return {
    stop_reason,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      ...texts.map((text) => ({ type: "text", text, citations: null })),
    ],
  } as unknown as Anthropic.Message;
}

describe("completeText", () => {
  test("returns the text of a reply that finished", () => {
    expect(completeText(reply("end_turn", "This week ", "you covered cells."))).toBe(
      "This week you covered cells.",
    );
  });

  test("a reply cut off at the token ceiling is an error, not a shorter summary", () => {
    expect(() => completeText(reply("max_tokens", "This week you cov"))).toThrow(
      "The AI's answer was incomplete. Try again.",
    );
  });

  test("a refusal is an error too", () => {
    expect(() => completeText(reply("refusal"))).toThrow("incomplete");
  });
});
