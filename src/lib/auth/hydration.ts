/**
 * "Has React finished hydrating what the server sent?" — for route guards.
 *
 * On a deep link to a client-only route (`ssr: false`), the server sends the
 * route's loading screen and TanStack Start begins `router.load()` *before*
 * `hydrateRoot` runs. A guard that can answer without the network — nobody is
 * signed in, or the role is already known — throws its redirect within a few
 * milliseconds, the router swaps to the destination's matches, and React then
 * hydrates *that* tree against the server's spinner: "Hydration failed because
 * the server rendered HTML didn't match the client". A signed-out student
 * opening a bookmarked page hit it every time.
 *
 * The router's own `pendingMinMs` hold doesn't cover this. It pins the pending
 * component of the match being loaded; a redirect replaces the matches
 * altogether.
 *
 * So the top-level guards wait here before they do anything that could
 * redirect. After the first load this is already resolved, so an in-app
 * navigation pays nothing.
 */

let hydrated = typeof window === "undefined";
let release: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  release = resolve;
});

/** A backstop only: if neither signal below ever fires, don't hang the guard. */
const GIVE_UP_MS = 1500;

/**
 * Called from an effect, which React only runs once the component's boundary
 * has hydrated. Two callers: `RoutePending` (the server-sent loading screen has
 * hydrated — the precise signal on a deep link) and the root component (the app
 * booted on a server-rendered page, so there was no loading screen to wait for).
 */
export function markHydrated(): void {
  hydrated = true;
  release();
}

/** Resolves once it is safe for a guard to redirect. Immediate on the server. */
export function whenHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  return Promise.race([
    ready,
    new Promise<void>((resolve) => setTimeout(resolve, GIVE_UP_MS)),
  ]).then(() => {
    hydrated = true;
  });
}
