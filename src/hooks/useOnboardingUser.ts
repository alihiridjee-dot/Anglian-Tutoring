import { useRef } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";

/**
 * The student working through setup, from the `/onboarding` guard.
 *
 * Every step used to call `supabase.auth.getUser()` twice — once to prefill the
 * form and once more on Continue — which is a network round trip each time, in
 * front of the read or write it was there to scope. It also made a dropped
 * connection on Continue say "You need to be signed in." to someone who was.
 * The guard has already validated this user before any step can render, so the
 * steps read them from the route context instead.
 *
 * The identity is pinned at mount. A step's prefill effect depends on it, and a
 * new object for the same person — the router re-running the guard — must not
 * re-run the prefill over answers the student is halfway through changing.
 */
export function useOnboardingUser(): User {
  const { session } = useRouteContext({ from: "/onboarding" });
  // Non-null past the guard: it redirects to /auth before rendering otherwise.
  const pinned = useRef(session.user as User);
  return pinned.current;
}
