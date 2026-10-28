import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * A stand-in for the two auth calls the guard makes: the session held in the
 * browser, and the server's check of it. Each test sets what they answer, then
 * counts how often the server was asked.
 */
type FakeUser = { id: string; email?: string };
const auth = {
  session: null as { access_token: string; user: FakeUser } | null,
  server: { user: null as FakeUser | null, error: null as Error | null },
  serverCalls: 0,
};

const fakeAuth = {
  getSession: () => Promise.resolve({ data: { session: auth.session }, error: null }),
  getUser: () => {
    auth.serverCalls += 1;
    return Promise.resolve({ data: { user: auth.server.user }, error: auth.server.error });
  },
};

/**
 * Bun's module mocks are process-wide and never undone, so this answers only
 * while this file's tests run, then hands back to the real client (as in
 * guardState.test.ts).
 */
const { supabase: realSupabase } = await import("@/integrations/supabase/client");
let faking = true;
afterAll(() => {
  faking = false;
  setSystemTime();
});

mock.module("@/integrations/supabase/client", () => ({
  supabase: new Proxy(realSupabase, {
    get(real, key) {
      if (faking && key === "auth") return fakeAuth;
      const value = Reflect.get(real, key);
      return typeof value === "function" ? value.bind(real) : value;
    },
  }),
}));

const { getAuthSession } = await import("./session");

const alice = { id: "alice", email: "alice@example.com" };
const bob = { id: "bob", email: "bob@example.com" };

let clock = Date.parse("2026-10-28T09:00:00Z");
const advance = (ms: number) => {
  clock += ms;
  setSystemTime(new Date(clock));
};

beforeEach(() => {
  // A fresh hour each test, so no answer carries over from the last one.
  advance(60 * 60_000);
  auth.session = { access_token: "token-a", user: alice };
  auth.server = { user: alice, error: null };
  auth.serverCalls = 0;
});

describe("getAuthSession", () => {
  test("asks the server once, then trusts the same token for a minute", async () => {
    expect((await getAuthSession()).user?.id).toBe("alice");
    advance(30_000);
    expect((await getAuthSession()).user?.id).toBe("alice");
    expect(auth.serverCalls).toBe(1);
  });

  test("asks again once the minute is up", async () => {
    await getAuthSession();
    advance(61_000);
    await getAuthSession();
    expect(auth.serverCalls).toBe(2);
  });

  test("asks again for a new token, and for someone else", async () => {
    await getAuthSession();
    auth.session = { access_token: "token-a2", user: alice };
    await getAuthSession();
    expect(auth.serverCalls).toBe(2);

    auth.session = { access_token: "token-b", user: bob };
    auth.server = { user: bob, error: null };
    expect((await getAuthSession()).user?.id).toBe("bob");
    expect(auth.serverCalls).toBe(3);
  });

  test("signed out is signed out at once", async () => {
    await getAuthSession();
    auth.session = null;
    auth.server = { user: null, error: new Error("Auth session missing!") };
    const session = await getAuthSession();
    expect(session.mode).toBe("anonymous");
    expect(session.user).toBeNull();
  });

  test("a token the server refuses is not remembered", async () => {
    auth.server = { user: null, error: new AuthApiError("invalid JWT", 403, "bad_jwt") };
    expect((await getAuthSession()).mode).toBe("anonymous");
    expect((await getAuthSession()).mode).toBe("anonymous");
    expect(auth.serverCalls).toBe(2);
  });

  test("an unreachable server falls back to the session held here, and isn't remembered", async () => {
    auth.server = { user: null, error: new AuthRetryableFetchError("Failed to fetch", 0) };
    expect((await getAuthSession()).user?.id).toBe("alice");
    await getAuthSession();
    expect(auth.serverCalls).toBe(2);
  });

  test("hands back the user held here, so a change to the account shows", async () => {
    await getAuthSession();
    auth.session = { access_token: "token-a", user: { ...alice, email: "new@example.com" } };
    expect((await getAuthSession()).user?.email).toBe("new@example.com");
    expect(auth.serverCalls).toBe(1);
  });
});
