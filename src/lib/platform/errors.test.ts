import { describe, expect, test } from "bun:test";
import { dbError, describeError, isNetworkError } from "./errors";
import { reconcileAnswers } from "../mcq/mcqAnswers";

describe("describeError", () => {
  test("reads the message off a Supabase error, which is a plain object", () => {
    const postgrest = { message: "permission denied for table topics", code: "42501" };
    expect(describeError(postgrest)).toBe("permission denied for table topics");
    expect(describeError(postgrest)).not.toContain("[object Object]");
  });

  test("reads Error instances and bare strings", () => {
    expect(describeError(new Error("That homework doesn't exist"))).toBe(
      "That homework doesn't exist",
    );
    expect(describeError("nope")).toBe("nope");
  });

  test("turns each browser's dropped-connection error into one plain sentence", () => {
    for (const raw of [
      "Failed to fetch",
      "Load failed",
      "NetworkError when attempting to fetch resource.",
      "TypeError: Failed to fetch",
    ]) {
      expect(isNetworkError(new TypeError(raw))).toBe(true);
      expect(describeError(new TypeError(raw))).toContain("Check your connection");
    }
    expect(isNetworkError(new Error("permission denied"))).toBe(false);
  });

  test("falls back when there is nothing readable", () => {
    expect(describeError(null)).toBe("Something went wrong.");
    expect(describeError({ message: "   " }, "Couldn't submit")).toBe("Couldn't submit");
    expect(describeError({ code: 500 })).toBe("Something went wrong.");
  });
});

describe("dbError", () => {
  test("a refusal from the database becomes an Error in its words, keeping its code", () => {
    const refusal = {
      code: "23514",
      details: null,
      hint: null,
      message: "This is a break week, so nothing new can be planned for it.",
    };
    const thrown = dbError(refusal);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject(refusal);
  });

  test("a request that got no answer is passed on as it was, so the caller's fallback shows", () => {
    const dropped = { code: "", details: "", hint: "", message: "TypeError: Failed to fetch" };
    expect(dbError(dropped)).toBe(dropped);
    // A gateway page instead of the database's JSON: no code, and no words for a student.
    const gateway = { message: "<html><body>502 Bad Gateway</body></html>" };
    expect(dbError(gateway)).toBe(gateway);
  });
});

describe("reconcileAnswers", () => {
  const questions = [
    { id: "q1", options: ["a", "b", "c", "d"] },
    { id: "q2", options: ["a", "b"] },
  ];

  test("keeps answers that still fit the paper", () => {
    expect(reconcileAnswers({ q1: 3, q2: 0 }, questions)).toEqual({ q1: 3, q2: 0 });
  });

  test("drops answers for questions that have gone, and options that no longer exist", () => {
    expect(reconcileAnswers({ q1: 1, q2: 2, removed: 0 }, questions)).toEqual({ q1: 1 });
  });

  test("survives whatever a corrupted store hands back", () => {
    expect(reconcileAnswers(null, questions)).toEqual({});
    expect(reconcileAnswers("oops", questions)).toEqual({});
    expect(reconcileAnswers({ q1: "2", q2: -1 }, questions)).toEqual({});
    expect(reconcileAnswers({ q1: 1.5 }, questions)).toEqual({});
  });
});
