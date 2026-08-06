import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The guard's view of who the caller is and what they may see.
 *
 * `beforeLoad` runs on every single navigation, and it used to ask the network
 * three separate questions each time: validate the session, read the profile
 * role, then call my_access_state(). Clicking between five pages was fifteen
 * round trips, per student — and none of those answers change from one click to
 * the next. They're cached here instead, so a navigation is normally zero
 * requests, and the answer is refreshed on a timer rather than on every move.
 *
 * The cache also gives the guard something to fall back on. A student's access
 * state is not something we can afford to guess wrong in either direction:
 * guessing "not onboarded" throws a paying student back into setup, and guessing
 * "lapsed" accuses them of not paying. A remembered answer from ninety seconds
 * ago is a far better estimate than either.
 */

export const GUARD_KEY = ["auth", "guard-state"] as const;

/** How long a resolved guard answer is trusted before it's re-asked. */
const FRESH_MS = 60_000;
/** How long a resolved answer stays available as a fallback after going stale. */
const KEEP_MS = 10 * 60_000;

export interface GuardState {
  userId: string;
  role: string | null;
  /** Null when the access RPC could not be answered this time. */
  onboardingComplete: boolean | null;
  hasAccess: boolean | null;
}

async function fetchGuardState(userId: string): Promise<GuardState> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  const role = profile?.role ?? null;
  if (role !== "student") {
    // Parents and tutors have nothing to onboard and nothing to buy.
    return { userId, role, onboardingComplete: true, hasAccess: true };
  }

  const { data: access, error } = await supabase.rpc("my_access_state").single();
  if (error || !access) {
    // Unanswered, not answered "no" — the caller decides what to do with null.
    return { userId, role, onboardingComplete: null, hasAccess: null };
  }
  return {
    userId,
    role,
    onboardingComplete: !!access.onboarding_complete,
    hasAccess: !!access.has_access,
  };
}

/**
 * The guard state for a user, from cache when it's fresh.
 *
 * On a failed access read this returns the last good answer if one is still
 * held, rather than a fresh set of nulls — a blip mid-session shouldn't change
 * what the student sees.
 */
export async function loadGuardState(
  queryClient: QueryClient,
  userId: string,
): Promise<GuardState> {
  const previous = queryClient.getQueryData<GuardState>([...GUARD_KEY, userId]);

  const next = await queryClient.ensureQueryData({
    queryKey: [...GUARD_KEY, userId],
    queryFn: () => fetchGuardState(userId),
    staleTime: FRESH_MS,
    gcTime: KEEP_MS,
    retry: 1,
  });

  if (next.onboardingComplete === null && previous && previous.onboardingComplete !== null) {
    return previous;
  }
  return next;
}

/** Drop the cached answer — after checkout, onboarding, or sign-out. */
export function invalidateGuardState(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: GUARD_KEY });
}
