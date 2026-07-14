import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthSession } from "@/lib/auth/session";

/**
 * Auth guard for every /_authenticated/* route.
 *
 * Requires a valid, server-validated Supabase session before any protected
 * component renders. This is environment-aware but uniform: both "live" and
 * "demo" users hold a real session, so both pass; an anonymous visitor — or a
 * stale demo flag with no session — is redirected to /auth. The resolved,
 * typed AuthSession is placed on the route context for children to consume.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await getAuthSession();
    if (!session.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }
    return { session };
  },
  component: () => <Outlet />,
});
