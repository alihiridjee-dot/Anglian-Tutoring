import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The "My parent is paying" link waits in the browser while a parent signs up.
 * On a shared phone a link left there is one tap from linking the wrong
 * account to a child, so it must go once it has linked someone, and stay only
 * while it still has work to do.
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

/** What the database answers the redeem with, set per test. */
let answer: { data: unknown; error: { message: string } | null } = { data: null, error: null };
const fakeSupabase = { rpc: () => Promise.resolve(answer) };

/**
 * Bun's module mocks are process-wide and are never undone, so the fake
 * answers only while this file's tests run, then hands back to the real client.
 */
const { supabase: realSupabase } = await import("@/integrations/supabase/client");
let faking = true;
afterAll(() => {
  faking = false;
});

mock.module("@/integrations/supabase/client", () => ({
  supabase: new Proxy(realSupabase, {
    get(real, key) {
      if (faking && key in fakeSupabase) return fakeSupabase[key as keyof typeof fakeSupabase];
      const value = Reflect.get(real, key);
      return typeof value === "function" ? value.bind(real) : value;
    },
  }),
}));

const { forgetParentJoin, readParentJoin, redeemParentJoinLink, rememberParentJoin } =
  await import("./parentJoin");

const PLAN = { student_name: "Sam", level: "gcse", subjects: [], cadence: "monthly" };

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemoryStorage();
  answer = { data: null, error: null };
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("the stored parent join link", () => {
  test("is kept for the sign-up, and gone when the parent leaves without linking", () => {
    rememberParentJoin("tok-1");
    expect(readParentJoin()).toBe("tok-1");
    forgetParentJoin();
    expect(readParentJoin()).toBeNull();
  });

  test("is forgotten once the redeem links the parent", async () => {
    rememberParentJoin("tok-1");
    answer = { data: { status: "linked", student_id: "s1", ...PLAN }, error: null };
    const result = await redeemParentJoinLink("tok-1");
    expect(result.status).toBe("linked");
    expect(readParentJoin()).toBeNull();
  });

  test("is forgotten when the parent was already linked by it", async () => {
    rememberParentJoin("tok-1");
    answer = { data: { status: "already_linked", student_id: "s1", ...PLAN }, error: null };
    await redeemParentJoinLink("tok-1");
    expect(readParentJoin()).toBeNull();
  });

  test("is kept when the account is not a parent's yet, for the role claim", async () => {
    rememberParentJoin("tok-1");
    answer = { data: { status: "not_a_parent" }, error: null };
    await redeemParentJoinLink("tok-1");
    expect(readParentJoin()).toBe("tok-1");
  });

  test("is kept when the redeem fails, so Try again still has it", async () => {
    rememberParentJoin("tok-1");
    answer = { data: null, error: { message: "network down" } };
    await expect(redeemParentJoinLink("tok-1")).rejects.toThrow("network down");
    expect(readParentJoin()).toBe("tok-1");
  });
});
