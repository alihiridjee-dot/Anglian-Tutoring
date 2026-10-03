import { beforeEach, describe, expect, test } from "bun:test";
import { attemptIdFor, clearMcqAnswers, saveMcqAnswers } from "@/lib/mcq/mcqAnswers";

/**
 * The attempt id is what makes a retried quiz submission safe: the server
 * returns the attempt already filed under it instead of filing a second. So it
 * must survive a reload until the quiz is marked, and be new after that.
 */

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

const STUDENT = "aaaaaaaa-0000-0000-0000-000000000001";

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { sessionStorage: new MemoryStorage() };
});

describe("a quiz attempt's id", () => {
  test("stays the same across a reload, so a retry repeats it", () => {
    saveMcqAnswers(STUDENT, "set-1", { q1: 2 });
    const first = attemptIdFor(STUDENT, "set-1");
    expect(attemptIdFor(STUDENT, "set-1")).toBe(first);
  });

  test("is new once the attempt has been marked", () => {
    const first = attemptIdFor(STUDENT, "set-1");
    clearMcqAnswers(STUDENT, "set-1");
    expect(attemptIdFor(STUDENT, "set-1")).not.toBe(first);
  });

  test("differs between quizzes and between students", () => {
    const mine = attemptIdFor(STUDENT, "set-1");
    expect(attemptIdFor(STUDENT, "set-2")).not.toBe(mine);
    expect(attemptIdFor("bbbbbbbb-0000-0000-0000-000000000002", "set-1")).not.toBe(mine);
  });

  test("still comes back when storage refuses", () => {
    (globalThis as { window?: unknown }).window = {
      get sessionStorage(): Storage {
        throw new Error("SecurityError");
      },
    };
    expect(attemptIdFor(STUDENT, "set-1")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
