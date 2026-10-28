import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import {
  loadDraft,
  saveDraft,
  clearDraft,
  clearAllDrafts,
  draftsClearedCount,
  editStamp,
  localDraftIds,
  mergeDrafts,
  pushLocalDrafts,
  type TimestampedDraft,
} from "@/lib/homework/homeworkDrafts";

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
    // `savedAt` comes back too: drafts now live in two places, and the
    // timestamp is what decides which copy wins when they disagree.
    expect(loadDraft(STUDENT_A, HOMEWORK)).toEqual({
      answers: { q1: "mitochondria" },
      notes: "unsure on q3",
      savedAt: expect.any(Number),
      stamps: {},
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
    const before = draftsClearedCount();
    clearAllDrafts();
    expect(loadDraft(STUDENT_A, "hw-1")).toBeNull();
    expect(loadDraft(STUDENT_B, "hw-2")).toBeNull();
    // How a sheet still open across the sign-out knows not to write back.
    expect(draftsClearedCount()).toBe(before + 1);
  });

  test("before sign-out, this student's edited drafts are sent, and no one else's", async () => {
    saveDraft(STUDENT_A, "hw-1", { answers: { q1: "a" }, notes: "", stamps: { q1: 1_000 } });
    saveDraft(STUDENT_A, "hw-2", { answers: { q1: "a2" }, notes: "", stamps: { q1: 2_000 } });
    // Saved before per-question times: nothing in it the server would take.
    saveDraft(STUDENT_A, "hw-3", { answers: { q1: "old" }, notes: "" });
    saveDraft(STUDENT_B, "hw-4", { answers: { q1: "b" }, notes: "", stamps: { q1: 3_000 } });
    expect(localDraftIds(STUDENT_A).sort()).toEqual(["hw-1", "hw-2", "hw-3"]);

    const sent: [string, string][] = [];
    await pushLocalDrafts(STUDENT_A, async (id, d) => {
      sent.push([id, d!.answers.q1]);
      return null;
    });
    expect(sent.sort()).toEqual([
      ["hw-1", "a"],
      ["hw-2", "a2"],
    ]);
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

/**
 * Reconciling two copies of a draft. Whole drafts used to win or lose
 * together, by the writing device's clock, so a stale or offline device wiped
 * answers typed elsewhere. Now each answer's newest edit wins on its own.
 */
describe("merging drafts per question", () => {
  const draft = (
    answers: Record<string, string>,
    stamps: Record<string, number>,
    notes = "",
  ): TimestampedDraft => ({
    answers,
    notes,
    stamps,
    savedAt: Math.max(0, ...Object.values(stamps)),
  });

  test("an old tab's next keystroke doesn't wipe answers typed on the phone", () => {
    // The laptop tab loaded yesterday's q1, then the student rewrote q1 on
    // the phone, and now types q2 on the laptop. The laptop's copy is newer as
    // a whole, which is what used to make it win outright.
    const laptop = draft({ q1: "yesterday", q2: "laptop" }, { q1: 1_000, q2: 5_000 });
    const server = draft({ q1: "phone" }, { q1: 3_000 });
    expect(mergeDrafts(laptop, server)!.answers).toEqual({ q1: "phone", q2: "laptop" });
  });

  test("an offline device's later save keeps the newer answer to each question", () => {
    // The laptop typed q1 and q2 offline; the phone then rewrote q2. When the
    // laptop reconnects, its q1 is newest, the phone's q2 is newest.
    const laptop = draft({ q1: "laptop q1", q2: "laptop q2" }, { q1: 1_000, q2: 1_000 });
    const server = draft({ q1: "old q1", q2: "phone q2" }, { q1: 500, q2: 2_000 });
    expect(mergeDrafts(laptop, server)!.answers).toEqual({ q1: "laptop q1", q2: "phone q2" });
    expect(mergeDrafts(server, laptop)!.answers).toEqual({ q1: "laptop q1", q2: "phone q2" });
  });

  test("a deliberately cleared answer stays cleared if the clear is newer", () => {
    const here = draft({ q1: "" }, { q1: 2_000 });
    const server = draft({ q1: "old text" }, { q1: 1_000 });
    expect(mergeDrafts(here, server)!.answers.q1).toBe("");
  });

  test("the note merges the same way", () => {
    const here = draft({}, { notes: 1_000 }, "old note");
    const server = draft({}, { notes: 2_000 }, "newer note");
    expect(mergeDrafts(here, server)!.notes).toBe("newer note");
  });

  test("typing done while the saved draft loads is kept", () => {
    // M-22: what was typed before the load finished is newer than either copy.
    const typedMeanwhile = draft({ q1: "typed while loading" }, { q1: 9_000 });
    const saved = draft({ q1: "saved yesterday", q2: "also saved" }, { q1: 1_000, q2: 1_000 });
    expect(mergeDrafts(typedMeanwhile, saved)!.answers).toEqual({
      q1: "typed while loading",
      q2: "also saved",
    });
  });

  test("a copy with nothing newer leaves the draft as it was, the same object", () => {
    const here = draft({ q1: "a" }, { q1: 2_000 });
    expect(mergeDrafts(here, draft({ q1: "b" }, { q1: 1_000 }))).toBe(here);
    expect(mergeDrafts(here, draft({ q1: "a" }, { q1: 3_000 }))).toBe(here);
  });

  test("an edit is stamped later than the one before it, even after the clock is put back", () => {
    // The server orders one page's own edits by these stamps alone. A clock
    // put back while the sheet is open must not make the next words older.
    let now = Date.now() + 10 * 60 * 60 * 1000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      const first = editStamp();
      expect(first).toBe(now);
      now -= 60 * 60 * 1000; // an hour back
      const second = editStamp(first);
      expect(second).toBeGreaterThan(first);
      expect(editStamp()).toBeGreaterThan(second);
      // A field last stamped ahead of this clock (another copy) is passed too.
      expect(editStamp(first + 5_000)).toBe(first + 5_001);
      // Once the clock is past every stamp given out, edits take its time again.
      now = first + 60_000;
      expect(editStamp()).toBe(now);
    } finally {
      clock.mockRestore();
    }
  });

  test("a draft saved before per-question times dates every answer from its save", () => {
    const legacy: TimestampedDraft = {
      answers: { q1: "legacy" },
      notes: "",
      stamps: {},
      savedAt: 1_500,
    };
    expect(mergeDrafts(legacy, draft({ q1: "newer" }, { q1: 2_000 }))!.answers.q1).toBe("newer");
    expect(mergeDrafts(legacy, draft({ q1: "older" }, { q1: 1_000 }))!.answers.q1).toBe("legacy");
  });
});
