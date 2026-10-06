import { describe, expect, test } from "bun:test";
import { pinnedSelection } from "./threadSelection";

describe("pinnedSelection", () => {
  test("opens the first thread on arrival", () => {
    expect(pinnedSelection(["a", "b"], null, new Set())).toBe("a");
  });

  test("stays on the open thread when a reply elsewhere re-sorts the list", () => {
    const seen = new Set<string>();
    const first = pinnedSelection(["a", "b"], null, seen)!;
    expect(pinnedSelection(["a", "b"], first, seen)).toBe("a");
    // A tutor replies in "b": it jumps to the top.
    expect(pinnedSelection(["b", "a"], "a", seen)).toBe("a");
  });

  test("keeps a thread just created, before the list has caught up", () => {
    const seen = new Set(["a"]);
    expect(pinnedSelection(["a"], "new", seen)).toBe("new");
  });

  test("moves on when the open thread has left the list", () => {
    const seen = new Set<string>();
    pinnedSelection(["a", "b"], "a", seen);
    expect(pinnedSelection(["b"], "a", seen)).toBe("b");
  });

  test("an empty list keeps the selection rather than inventing one", () => {
    expect(pinnedSelection([], null, new Set())).toBeNull();
  });
});
