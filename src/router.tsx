import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

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

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
