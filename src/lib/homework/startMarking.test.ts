import { describe, expect, test } from "bun:test";
import {
  RESTART_WINDOW_MS,
  isAlreadySubmitted,
  needsMarkingStart,
  startMarking,
} from "@/lib/homework/startMarking";

/**
 * A submission whose reply was lost was never marked: the marker was only
 * started after a successful reply. These pin the two routes that now start
 * it anyway, and the limits that stop either from costing repeated AI calls.
 */

const NOW = Date.parse("2026-10-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("a submission found on the page", () => {
  test("handed in a minute ago and never marked: start the marker", () => {
    expect(
      needsMarkingStart({ submitted_at: minutesAgo(1), graded_at: null, release_at: null }, NOW),
    ).toBe(true);
  });

  test("already staged by the marker, or marked: leave it", () => {
    const staged = { submitted_at: minutesAgo(1), graded_at: null, release_at: minutesAgo(-29) };
    const marked = { submitted_at: minutesAgo(1), graded_at: minutesAgo(0), release_at: null };
    expect(needsMarkingStart(staged, NOW)).toBe(false);
    expect(needsMarkingStart(marked, NOW)).toBe(false);
  });

  test("unmarked but older than the window: it waits for a tutor", () => {
    const old = new Date(NOW - RESTART_WINDOW_MS - 1).toISOString();
    expect(needsMarkingStart({ submitted_at: old, graded_at: null, release_at: null }, NOW)).toBe(
      false,
    );
  });
});

describe("a retry after a lost reply", () => {
  test("the 'already submitted' refusal counts as handed in", () => {
    expect(isAlreadySubmitted({ message: "You have already submitted this homework" })).toBe(true);
  });

  test("any other failure is still a failure", () => {
    expect(isAlreadySubmitted({ message: "That homework is not open to you" })).toBe(false);
    expect(isAlreadySubmitted(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("starting the marker", () => {
  test("asks once per submission, however often the page re-renders", () => {
    const calls: string[] = [];
    const invoke = async (id: string) => void calls.push(id);
    startMarking("sub-1", invoke);
    startMarking("sub-1", invoke);
    startMarking("sub-2", invoke);
    expect(calls).toEqual(["sub-1", "sub-2"]);
  });

  test("a failed call never reaches the page", () => {
    expect(() => startMarking("sub-3", () => Promise.reject(new Error("down")))).not.toThrow();
  });
});
