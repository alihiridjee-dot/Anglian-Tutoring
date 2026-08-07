import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthSession } from "@/lib/auth/session";
import { loadGuardState } from "@/lib/auth/guardState";
import { PaywallOverlay } from "@/components/billing/PaywallOverlay";

/**
 * Auth guard for every /_authenticated/* route.
 *
 * Three questions, in order, and the order matters:
 *
 *   1. Is there a valid, server-validated session? No → /auth.
 *   2. Has this student finished profile setup? No → /onboarding.
 *   3. Does this student have a live subscription? No → frosted paywall overlay.
 *
 * Steps 2 and 3 are asked of STUDENTS ONLY. Parents and tutors have no board,
 * no subjects and nothing to buy for themselves, and my_access_state() answers
 * `false` for them for exactly that reason — applying it to everyone would lock
 * every tutor out of their own app.
 *
 * An unpaid student is NOT redirected: the dashboard still renders and a
 * frosted-glass PaywallOverlay is drawn over it, so they see what they're
 * missing with a single "resubscribe" call to action.
 *
 * This overlay is presentation only, and is no longer the thing enforcing the
 * paywall. Curriculum content (topics, spec_points, resources, mcq_*,
 * weekly_focus) is gated in RLS by private.viewer_has_content_access(), so a
 * lapsed student with their own JWT reads nothing from those tables directly
 * either. Expect content queries to come back EMPTY rather than error when
 * `locked` is true — that is the database refusing, not a bug.
 *
 * A lapsed student keeps read access to their OWN records (submissions,
 * confidence, reviews, plans) plus billing and profile, by design.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const session = await getAuthSession();
    if (!session.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }

    const guard = await loadGuardState(context.queryClient, session.user.id);

    let locked = false;
    if (guard.role === "student") {
      // "Not onboarded" and "couldn't tell" are different answers, and they must
      // not be treated alike. A failed access read used to fall through to the
      // redirect below, which threw a fully onboarded, paying student back to
      // step one of setup — and that failure shows up precisely under load,
      // because that is when reads start timing out. Only a definite `false`
      // relocates anybody.
      if (guard.onboardingComplete === false) {
        throw redirect({ to: "/onboarding/board" });
      }
      // The overlay is presentation, not enforcement (see above), so an
      // unanswerable access check must not accuse a paying student of having
      // lapsed. RLS is still refusing content either way, so the worst case
      // here is a page that renders empty rather than one that renders a false
      // demand for money.
      //
      // /billing stays exempt regardless: a student who paused or cancelled
      // their own plan must be able to get back in to resume it — covering it
      // would push them into buying a second subscription on top of the paused
      // one.
      locked = guard.hasAccess === false && !location.pathname.startsWith("/billing");
    }

    return { session, locked };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { locked } = Route.useRouteContext();
  return (
    <>
      <Outlet />
      {locked && <PaywallOverlay />}
    </>
  );
}
