import { describe, expect, test } from "bun:test";
import {
  MARKING_STALLED_MS,
  RESTART_WINDOW_MS,
  isAlreadySubmitted,
  markingStalled,
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

  test("marked but held for a tutor (no clock): leave it", () => {
    const held = {
      submitted_at: minutesAgo(1),
      graded_at: null,
      release_at: null,
      ai_marked_at: minutesAgo(0),
    };
    expect(needsMarkingStart(held, NOW)).toBe(false);
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

describe("the notice on an unmarked paper", () => {
  test("just handed in: marks are still on their way", () => {
    expect(markingStalled(minutesAgo(1), NOW)).toBe(false);
  });

  test("half an hour on with no marks: it's the tutor's now, not 'shortly'", () => {
    expect(markingStalled(new Date(NOW - MARKING_STALLED_MS).toISOString(), NOW)).toBe(true);
    expect(markingStalled(minutesAgo(60 * 24), NOW)).toBe(true);
  });

  test("it says so before the page stops asking for marks itself", () => {
    expect(MARKING_STALLED_MS).toBeLessThanOrEqual(RESTART_WINDOW_MS);
  });
});
