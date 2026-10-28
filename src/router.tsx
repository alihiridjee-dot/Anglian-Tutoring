import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { routerRestoresScroll } from "@/lib/shell/returnSpot";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Data on this app changes on human timescales (homework, plans,
        // enrolments), so a short shared staleTime stops every remount and
        // window refocus from re-hitting Supabase. Hooks with longer-lived
        // data override this upwards.
        staleTime: 1000 * 60,
        retry: 1,
      },
    },
  });
  // The planner is costly to build and visited again and again in a session,
  // so it is kept for half an hour after its page closes (five minutes by
  // default): coming back shows it at once while it refreshes. Memory only.
  queryClient.setQueryDefaults(["planner"], { gcTime: 30 * 60_000 });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // A push opens at the top. Coming back is left to returnSpot, which waits
    // for the card that was clicked rather than restoring a bare offset.
    scrollRestoration: routerRestoresScroll,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
