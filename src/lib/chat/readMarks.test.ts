import { describe, expect, test } from "bun:test";
import { NO_READ_MARKS, readMarkStep, type ReadMarks } from "./readMarks";

/** Runs a thread's looks in order and returns how many writes they made. */
function writes(looks: [threadId: string, unread: number, onScreen: boolean][]): number {
  let state: ReadMarks = NO_READ_MARKS;
  let count = 0;
  for (const [id, unread, onScreen] of looks) {
    const { mark, next } = readMarkStep(state, id, unread, onScreen);
    state = next;
    if (mark) count++;
  }
  return count;
}

describe("readMarkStep", () => {
  test("opening a thread with nothing unread still marks it, for a second tutor's bell", () => {
    expect(writes([["t", 0, true]])).toBe(1);
  });

  test("a pane that is mounted but hidden never marks", () => {
    expect(
      writes([
        ["t", 2, false],
        ["t", 3, false],
      ]),
    ).toBe(0);
  });

  test("staying on screen marks once: refetches and StrictMode's rerun don't write again", () => {
    expect(
      writes([
        ["t", 2, true],
        ["t", 2, true],
        ["t", 0, true],
        ["t", 0, true],
      ]),
    ).toBe(1);
  });

  test("a reply that lands while the thread is on screen is marked once", () => {
    expect(
      writes([
        ["t", 0, true],
        ["t", 1, true],
        ["t", 1, true],
        ["t", 0, true],
      ]),
    ).toBe(2);
  });

  test("coming back on screen after the pane was hidden marks again", () => {
    expect(
      writes([
        ["t", 0, true],
        ["t", 0, false],
        ["t", 0, true],
      ]),
    ).toBe(2);
  });

  test("a different thread is a fresh look", () => {
    expect(
      writes([
        ["a", 0, true],
        ["b", 0, true],
      ]),
    ).toBe(2);
  });
});
