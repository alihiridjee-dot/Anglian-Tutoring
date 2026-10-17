import { describe, expect, test } from "bun:test";
import { isOwnWords, rememberOwnWords } from "@/lib/homework/pasteGuard";

/**
 * An answer box refuses pastes, but a student moving their own sentence from
 * one place to another must still be able to.
 */

describe("text pasted into an answer box", () => {
  test("copied out of an answer box: theirs, so it goes in", () => {
    rememberOwnWords("Both have a cell membrane.");
    expect(isOwnWords("Both have a cell membrane.")).toBe(true);
  });

  test("anything else on the clipboard is refused", () => {
    rememberOwnWords("Both have a cell membrane.");
    expect(isOwnWords("Prokaryotic cells have no nucleus.")).toBe(false);
    expect(isOwnWords("")).toBe(false);
  });

  test("Windows line endings on the clipboard still match", () => {
    rememberOwnWords("Ribosomes.\nCytoplasm.");
    expect(isOwnWords("Ribosomes.\r\nCytoplasm.")).toBe(true);
  });
});
