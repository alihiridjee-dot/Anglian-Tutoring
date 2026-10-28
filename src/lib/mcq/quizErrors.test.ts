import { describe, expect, it } from "bun:test";
import { describeQuizError, isQuizChanged } from "./quizErrors";

const refusal = (message: string) => ({ message, code: "P0001", details: null, hint: null });

describe("describeQuizError", () => {
  it("turns the marking function's refusals into sentences", () => {
    expect(describeQuizError(refusal("quiz not available"), "x")).toBe(
      "This quiz isn't open to you any more.",
    );
    expect(describeQuizError(refusal("quiz not found"), "x")).toBe(
      "This quiz has been taken down.",
    );
    expect(describeQuizError(refusal("quiz has changed"), "x")).toBe(
      "This quiz has just been updated — answer any new questions and submit again.",
    );
  });

  it("asks for a fresh sign-in when the session has run out", () => {
    expect(describeQuizError({ message: "JWT expired", code: "PGRST301" }, "x")).toBe(
      "Your session has ended — sign in again to submit.",
    );
    expect(describeQuizError(refusal("not signed in"), "x")).toBe(
      "Your session has ended — sign in again to submit.",
    );
    // No session at all: the request goes as nobody, who may not run it.
    expect(
      describeQuizError(
        { message: "permission denied for function grade_mcq_attempt", code: "42501" },
        "x",
      ),
    ).toBe("Your session has ended — sign in again to submit.");
  });

  it("leaves a dropped connection and the fallback as they were", () => {
    expect(describeQuizError(new TypeError("Failed to fetch"), "x")).toMatch(/connection/);
    expect(describeQuizError(null, "Couldn't submit — try again.")).toBe(
      "Couldn't submit — try again.",
    );
  });

  it("knows a rewritten quiz from any other refusal", () => {
    expect(isQuizChanged(refusal("quiz has changed"))).toBe(true);
    expect(isQuizChanged(refusal("quiz not available"))).toBe(false);
    expect(isQuizChanged(null)).toBe(false);
  });
});
