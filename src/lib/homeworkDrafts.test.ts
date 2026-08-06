import { describe, expect, test, beforeEach } from "bun:test";
import { loadDraft, saveDraft, clearDraft, clearAllDrafts } from "@/lib/homeworkDrafts";

/**
 * Draft persistence exists so a reload doesn't cost a student twenty minutes of
 * typing. The properties worth pinning are the ones that would make it unsafe
 * rather than merely unhelpful: drafts must not cross between students, and a
 * broken or unavailable store must never throw into the keystroke that
 * triggered the save.
 */

const STUDENT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const STUDENT_B = "bbbbbbbb-0000-0000-0000-000000000002";
const HOMEWORK = "hw-1";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
});

describe("homework drafts", () => {
  test("round-trips answers and notes", () => {
    saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "mitochondria" }, notes: "unsure on q3" });
    expect(loadDraft(STUDENT_A, HOMEWORK)).toEqual({
      answers: { q1: "mitochondria" },
      notes: "unsure on q3",
    });
  });

  test("one student never sees another's draft on a shared device", () => {
    saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "A's answer" }, notes: "" });
    expect(loadDraft(STUDENT_B, HOMEWORK)).toBeNull();
  });

  test("the same student's other homework is a separate draft", () => {
    saveDraft(STUDENT_A, "hw-1", { answers: { q1: "one" }, notes: "" });
    saveDraft(STUDENT_A, "hw-2", { answers: { q1: "two" }, notes: "" });
    expect(loadDraft(STUDENT_A, "hw-1")!.answers.q1).toBe("one");
    expect(loadDraft(STUDENT_A, "hw-2")!.answers.q1).toBe("two");
  });

  test("an all-whitespace draft is not stored", () => {
    saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "   " }, notes: "  " });
    expect(loadDraft(STUDENT_A, HOMEWORK)).toBeNull();
  });

  test("clearing after submission removes it", () => {
    saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "answer" }, notes: "" });
    clearDraft(STUDENT_A, HOMEWORK);
    expect(loadDraft(STUDENT_A, HOMEWORK)).toBeNull();
  });

  test("sign-out clears every student's drafts", () => {
    saveDraft(STUDENT_A, "hw-1", { answers: { q1: "a" }, notes: "" });
    saveDraft(STUDENT_B, "hw-2", { answers: { q1: "b" }, notes: "" });
    clearAllDrafts();
    expect(loadDraft(STUDENT_A, "hw-1")).toBeNull();
    expect(loadDraft(STUDENT_B, "hw-2")).toBeNull();
  });

  test("a draft older than the expiry window is discarded", () => {
    const stale = JSON.stringify({
      savedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      answers: { q1: "old" },
      notes: "",
    });
    window.localStorage.setItem(`anglia.hw-draft.v1:${STUDENT_A}:${HOMEWORK}`, stale);
    expect(loadDraft(STUDENT_A, HOMEWORK)).toBeNull();
  });

  test("corrupt stored JSON reads as no draft rather than throwing", () => {
    window.localStorage.setItem(`anglia.hw-draft.v1:${STUDENT_A}:${HOMEWORK}`, "{not json");
    expect(loadDraft(STUDENT_A, HOMEWORK)).toBeNull();
  });

  test("a storage that throws never propagates into the caller", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error("SecurityError: storage disabled");
      },
    };
    expect(() => saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "x" }, notes: "" })).not.toThrow();
    expect(loadDraft(STUDENT_A, HOMEWORK)).toBeNull();
    expect(() => clearDraft(STUDENT_A, HOMEWORK)).not.toThrow();
    expect(() => clearAllDrafts()).not.toThrow();
  });

  test("a full quota does not throw into the keystroke that triggered the save", () => {
    const full = new MemoryStorage();
    full.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    (globalThis as { window?: unknown }).window = { localStorage: full };
    expect(() =>
      saveDraft(STUDENT_A, HOMEWORK, { answers: { q1: "a long answer" }, notes: "" }),
    ).not.toThrow();
  });
});
