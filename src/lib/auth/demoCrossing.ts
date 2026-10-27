import type { QueryClient } from "@tanstack/react-query";
import { isDemoPath } from "@/lib/auth/session";

/**
 * What the app does when a navigation crosses between the showcase and the
 * live app, as a plain object so it can be tested without a browser.
 * `__root.tsx` feeds it the router's navigations.
 *
 * Both sides read through the same hooks and the same query keys: a hook asks
 * `isDemoMode()` inside its fetch and answers with Alex's fixtures or with the
 * signed-in user's rows. So whatever one side cached, the other was served
 * until it went stale. A student who opened /demo from the home page and came
 * back saw the demo's three subjects in their own account for up to ten
 * minutes, and a signed-in visitor saw their own subjects in the demo. So a
 * crossing empties the cache: reads in flight are cancelled, every answer is
 * dropped, and what the next page shows is fetched for its own side.
 *
 * Queued writes are kept. The same person is signed in on both sides, and a
 * save made just before following a link to the demo should still land.
 */
export function createDemoCrossingHandler(queryClient: QueryClient, pathname: string) {
  // Which side the cached answers, and the page on screen, belong to.
  let cachedForDemo = isDemoPath(pathname);
  // The address bar has been on the other side since the cache was last emptied.
  let crossed = false;

  return {
    /**
     * A navigation to `pathname` has begun. The address bar moves with it, so
     * any read from here on is for that side, even when this navigation is
     * overtaken by one back before its page renders.
     */
    navigating(pathname: string) {
      if (isDemoPath(pathname) !== cachedForDemo) crossed = true;
    },
    /**
     * Its page is about to render. Emptying waits for this rather than
     * happening at the start: the page still on screen keeps its answers while
     * the next one loads, and the next one never renders the other side's.
     */
    mounting(pathname: string) {
      if (!crossed) return;
      crossed = false;
      if (isDemoPath(pathname) !== cachedForDemo) {
        // The page on screen is the other side's, and no page component is
        // shared between the demo and the app, so it is about to go. Its
        // answers are dropped without asking again: a reset would re-ask its
        // questions of this side (the demo's made-up ids sent to the live
        // database). The next page asks its own.
        cachedForDemo = !cachedForDemo;
        queryClient.removeQueries();
      } else {
        // A trip to the other side turned back before it rendered. The page on
        // screen may stay, so, as on a change of user (see `authChange.ts`),
        // it is told at once and asks again, for its own side.
        void queryClient.resetQueries();
      }
    },
  };
}
