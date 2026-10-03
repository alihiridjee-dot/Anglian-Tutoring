import { createFileRoute, Navigate } from "@tanstack/react-router";
import { roleHomePath } from "@/lib/auth/routeGuards";

/**
 * `/dashboard` forwards each role to its own home — from the component, not
 * from `beforeLoad`.
 *
 * It used to throw the redirect in `beforeLoad`. When the parent guard took
 * longer than the router's pending delay (a second — routinely the case on the
 * first navigation after sign-in, when nothing is cached yet), the router had
 * already put this match on screen behind the loading screen; the redirect then
 * marked it `redirected`, and rendering a redirected match in this router
 * version throws `undefined`. No error boundary catches that, so React unmounted
 * the whole document: the blank page after sign-in that a refresh cured.
 *
 * Rendered, the viewer is already resolved on the route context, so this costs
 * nothing extra and can't disagree with the guard.
 */
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardRedirect,
});

function DashboardRedirect() {
  const context = Route.useRouteContext();
  return <Navigate to={roleHomePath({ context })} replace />;
}
