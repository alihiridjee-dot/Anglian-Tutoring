import type { QueryClient } from "@tanstack/react-query";
import type { AuthChangeEvent } from "@supabase/supabase-js";

/**
 * What the app does when Supabase reports an auth event, as a plain function
 * so it can be tested without a browser. `__root.tsx` subscribes it.
 *
 * Most query keys carry no user id (["profile-details"], ["chat", "threads"],
 * the billing reads…), so the cache holds whoever was signed in last. When that
 * person changes without a page reload — signed out in another tab, a refresh
 * token revoked, someone else signing in elsewhere on a shared computer — every
 * cached answer belongs to the wrong account. Invalidating isn't enough: the old
 * data stays on screen until each refetch lands, and a form seeded from it can
 * save it into the new account. So the cache is reset instead: reads in flight
 * are cancelled, every answer is dropped, and the screens showing them are told
 * at once, before anything renders the old data again.
 */
export function createAuthChangeHandler(targets: {
  router: { invalidate: () => unknown };
  queryClient: QueryClient;
}) {
  const { router, queryClient } = targets;
  // Whose session the app last acted on. `undefined` until the first event.
  let knownUserId: string | null | undefined;

  return (event: AuthChangeEvent, userId: string | null) => {
    if (event === "INITIAL_SESSION") {
      knownUserId = userId;
      return;
    }
    if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;

    // supabase-js re-announces SIGNED_IN every time the tab regains focus (it
    // recovers the session on `visibilitychange`). Treating each of those as a
    // fresh sign-in re-validated the session, re-ran every route guard and
    // refetched every query on screen — on every alt-tab back from a web
    // search mid-homework. Only a change of *who* is signed in, or of their
    // account, is news.
    if (event === "SIGNED_IN" && userId === knownUserId) return;
    const previousUserId = knownUserId;
    knownUserId = userId;

    // Someone was signed in, and now someone else (or no one) is.
    const userChanged = !!previousUserId && previousUserId !== userId;
    if (userChanged) forgetCachedData(queryClient);

    router.invalidate();
    // A reset already refetches what's on screen.
    if (event !== "SIGNED_OUT" && !userChanged) void queryClient.invalidateQueries();
  };
}

/**
 * Drop every cached answer and every queued write.
 *
 * `resetQueries`, not `clear`: removing a query from the cache doesn't tell the
 * components reading it, which go on showing its data, and a query with
 * `placeholderData: (prev) => prev` would carry the old data into its next
 * key. A reset cancels the read in flight, empties the query where it stands
 * and re-renders its readers, then refetches the ones on screen as the new user.
 */
function forgetCachedData(queryClient: QueryClient) {
  queryClient.getMutationCache().clear();
  void queryClient.resetQueries();
}
