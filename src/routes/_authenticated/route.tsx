import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthSession } from "@/lib/auth/session";
import { supabase } from "@/integrations/supabase/client";

/**
 * Auth guard for every /_authenticated/* route.
 *
 * Three questions, in order, and the order matters:
 *
 *   1. Is there a valid, server-validated session? No → /auth.
 *   2. Has this student finished profile setup? No → /onboarding.
 *   3. Does this student have a live subscription? No → /onboarding/plan.
 *
 * Steps 2 and 3 are asked of STUDENTS ONLY. Parents and tutors have no board,
 * no subjects and nothing to buy for themselves, and my_access_state() answers
 * `false` for them for exactly that reason — applying it to everyone would lock
 * every tutor out of their own app.
 *
 * This is a UI gate, not a hard paywall: it stops an unpaid student reaching the
 * dashboard, but a determined user with their own JWT could still query the
 * curriculum tables directly. Closing that means putting
 * private.student_has_access() into the RLS policies on the content tables —
 * tracked as follow-up work, deliberately not done here.
 */
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const session = await getAuthSession();
    if (!session.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } as never });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profile?.role === "student") {
      const { data: access } = await supabase.rpc("my_access_state").single();

      // A failed read must not hand out access. If we can't answer the
      // question, we don't open the door.
      if (!access?.onboarding_complete) {
        throw redirect({ to: "/onboarding/board" });
      }
      // /billing stays reachable without access: a student who paused or
      // cancelled their own plan must be able to get back in to resume it —
      // bouncing them to the paywall would push them into buying a second
      // subscription on top of the paused one.
      if (!access?.has_access && !location.pathname.startsWith("/billing")) {
        throw redirect({ to: "/onboarding/plan" });
      }
    }

    return { session };
  },
  component: () => <Outlet />,
});
