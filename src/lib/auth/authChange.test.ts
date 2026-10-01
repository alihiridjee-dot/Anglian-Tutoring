import { describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createAuthChangeHandler } from "./authChange";

const ALICE = "11111111-1111-1111-1111-111111111111";
const BOB = "22222222-2222-2222-2222-222222222222";

/** A real cache, a fake router, and a handler that has seen Alice sign in. */
function setup(initialUser: string | null = ALICE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = { invalidate: mock(() => {}) };
  const onAuthChange = createAuthChangeHandler({ router, queryClient });
  onAuthChange("INITIAL_SESSION", initialUser);
  return { queryClient, router, onAuthChange };
}

/** A read that answers only when told to. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("when someone else signs in on this tab", () => {
  test("the last person's cached data is gone at once", () => {
    const { queryClient, onAuthChange } = setup();
    queryClient.setQueryData(["profile-details"], { display_name: "Alice", phone: "07700900001" });
    queryClient.setQueryData(["chat", "threads"], [{ id: "alice-thread" }]);

    onAuthChange("SIGNED_IN", BOB);

    expect(queryClient.getQueryData<unknown>(["profile-details"])).toBeUndefined();
    expect(queryClient.getQueryData<unknown>(["chat", "threads"])).toBeUndefined();
  });

  test("a screen showing that data is told straight away, not after a refetch", () => {
    const { queryClient, onAuthChange } = setup();
    queryClient.setQueryData(["profile-details"], { display_name: "Alice" });
    const observer = new QueryObserver(queryClient, {
      queryKey: ["profile-details"],
      queryFn: () => new Promise(() => {}), // Bob's read never lands in this test
      staleTime: Infinity,
    });
    const shown: unknown[] = [];
    const stop = observer.subscribe((result) => shown.push(result.data));
    expect(observer.getCurrentResult().data).toEqual({ display_name: "Alice" });

    onAuthChange("SIGNED_IN", BOB);

    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(shown.at(-1)).toBeUndefined();
    stop();
  });

  test("a read still in flight for the last person can't land afterwards", async () => {
    const { queryClient, onAuthChange } = setup();
    const aliceRead = deferred<{ display_name: string }>();
    const fetching = queryClient.fetchQuery({
      queryKey: ["profile-details"],
      queryFn: () => aliceRead.promise,
    });

    onAuthChange("SIGNED_IN", BOB);
    aliceRead.resolve({ display_name: "Alice" });
    await fetching.catch(() => {});

    expect(queryClient.getQueryData<unknown>(["profile-details"])).toBeUndefined();
  });

  test("a search that keeps its previous results doesn't carry the last person's", async () => {
    const { queryClient, onAuthChange } = setup();
    const observer = new QueryObserver(queryClient, {
      queryKey: ["search", "photosynthesis"],
      queryFn: async () => ["Alice's result"],
      placeholderData: (prev: string[] | undefined) => prev,
    });
    const stop = observer.subscribe(() => {});
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual(["Alice's result"]);

    onAuthChange("SIGNED_IN", BOB);
    observer.setOptions({
      queryKey: ["search", "respiration"],
      queryFn: () => new Promise<string[]>(() => {}),
      placeholderData: (prev: string[] | undefined) => prev,
    });

    expect(observer.getCurrentResult().data).toBeUndefined();
    stop();
  });

  test("queued writes are dropped and the route guards run again", () => {
    const { queryClient, router, onAuthChange } = setup();
    queryClient.getMutationCache().build(queryClient, { mutationKey: ["save-details"] });

    onAuthChange("SIGNED_IN", BOB);

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("when the session ends without the Sign out button", () => {
  test("a sign-out in another tab drops everything cached", () => {
    const { queryClient, router, onAuthChange } = setup();
    queryClient.setQueryData(["auth-user-email"], { email: "alice@example.com" });

    onAuthChange("SIGNED_OUT", null);

    expect(queryClient.getQueryData<unknown>(["auth-user-email"])).toBeUndefined();
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("when the same person is still signed in", () => {
  test("the tab regaining focus changes nothing", () => {
    const { queryClient, router, onAuthChange } = setup();
    queryClient.setQueryData(["profile-details"], { display_name: "Alice" });

    onAuthChange("SIGNED_IN", ALICE);

    expect(queryClient.getQueryData<unknown>(["profile-details"])).toEqual({
      display_name: "Alice",
    });
    expect(queryClient.getQueryState(["profile-details"])?.isInvalidated).toBe(false);
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  test("an account update refreshes the cache but keeps it on screen", () => {
    const { queryClient, router, onAuthChange } = setup();
    queryClient.setQueryData(["auth-user-email"], { email: "alice@example.com" });

    onAuthChange("USER_UPDATED", ALICE);

    expect(queryClient.getQueryData<unknown>(["auth-user-email"])).toEqual({
      email: "alice@example.com",
    });
    expect(queryClient.getQueryState(["auth-user-email"])?.isInvalidated).toBe(true);
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });

  test("signing in from signed out keeps what was cached and refreshes it", () => {
    const { queryClient, router, onAuthChange } = setup(null);
    queryClient.setQueryData(["packages"], [{ tier: "standard" }]);

    onAuthChange("SIGNED_IN", ALICE);

    expect(queryClient.getQueryData<unknown>(["packages"])).toEqual([{ tier: "standard" }]);
    expect(queryClient.getQueryState(["packages"])?.isInvalidated).toBe(true);
    expect(router.invalidate).toHaveBeenCalledTimes(1);
  });
});
