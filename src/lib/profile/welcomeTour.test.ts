import { describe, expect, test } from "bun:test";
import { markWelcomeVideoWatched, readWelcomeVideoWatched } from "./welcomeTour";

// Run without a browser, so there is no localStorage at all: the case of a
// browser that blocks it. The payment page marks the video watched and the
// tour reads it straight after, in the same page load.
describe("welcome video watched", () => {
  test("is remembered for the visit even with no storage", () => {
    expect(readWelcomeVideoWatched("student-a")).toBe(false);
    markWelcomeVideoWatched("student-a");
    expect(readWelcomeVideoWatched("student-a")).toBe(true);
  });

  test("is kept per account", () => {
    markWelcomeVideoWatched("student-b");
    expect(readWelcomeVideoWatched("student-c")).toBe(false);
  });
});
