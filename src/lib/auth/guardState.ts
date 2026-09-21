import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { UserRole } from "@/types/user";

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
 *
 * This is also the ONE place the caller's role is resolved. The per-route
 * guards used to re-derive it themselves — a session validation, a user_roles
 * read and a profile read, on every click into a student section — and a failed
 * read there quietly answered "student". They read `appRole` off the route
 * context now (see `@/lib/routeGuards`), which costs nothing and cannot disagree
 * with the answer the parent guard just acted on.
 */

export const GUARD_KEY = ["auth", "guard-state"] as const;

/** How long a resolved guard answer is trusted before it's re-asked. */
const FRESH_MS = 60_000;
/** How long a resolved answer stays available as a fallback after going stale. */
const KEEP_MS = 10 * 60_000;

export interface GuardState {
  userId: string;
  /** `profiles.role` as stored — the self-declared profile role. Null when unread. */
  role: string | null;
  /**
   * The role the app routes on. Staff grants in `user_roles` win over the
   * profile, because that table — not the profile — is what every policy
   * consults, and staff access is granted out of band to accounts whose profile
   * may still say "student".
   */
  appRole: UserRole;
  /** Null when the access RPC could not be answered this time. */
  onboardingComplete: boolean | null;
  hasAccess: boolean | null;
}

/**
 * Staff grants first, then the profile's own role, then "student".
 *
 * The student fallback is the safe one: the student surfaces are the only ones
 * every other check (onboarding, paywall, RLS) is already built to contain.
 */
export function resolveAppRole(
  staffRoles: readonly string[],
  profileRole: string | null | undefined,
): UserRole {
  if (staffRoles.includes("admin")) return UserRole.ADMIN;
  if (staffRoles.includes("tutor")) return UserRole.TUTOR;
  if (profileRole === "parent") return UserRole.PARENT;
  if (profileRole === "tutor") return UserRole.TUTOR;
  return UserRole.STUDENT;
}

/** True for the roles that run the platform rather than study on it. */
export function isStaffRole(role: UserRole): boolean {
  return role === UserRole.TUTOR || role === UserRole.ADMIN;
}

/**
 * Raised when the access RPC went unanswered. It carries what *was* learned, so
 * the caller can still route on the role — but because it is thrown rather than
 * returned, React Query never caches "couldn't tell" as though it were an answer.
 */
class GuardUnanswered extends Error {
  constructor(readonly partial: GuardState) {
    super("Access state could not be read");
    this.name = "GuardUnanswered";
  }
}

async function fetchGuardState(userId: string): Promise<GuardState> {
  const [profileRes, rolesRes] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);
  // A failed read is not "no role". Swallowing these used to cache a tutor as a
  // student — wrong sidebar, wrong home, wrong guards — until the entry expired.
  if (profileRes.error) throw profileRes.error;
  if (rolesRes.error) throw rolesRes.error;

  const role = profileRes.data?.role ?? null;
  const appRole = resolveAppRole(
    (rolesRes.data ?? []).map((r) => r.role as string),
    role,
  );

  if (appRole !== UserRole.STUDENT) {
    // Parents and tutors have nothing to onboard and nothing to buy.
    return { userId, role, appRole, onboardingComplete: true, hasAccess: true };
  }

  const { data: access, error } = await supabase.rpc("my_access_state").single();
  if (error || !access) {
    // Unanswered, not answered "no" — the caller decides what to do with null.
    throw new GuardUnanswered({
      userId,
      role,
      appRole,
      onboardingComplete: null,
      hasAccess: null,
    });
  }
  return {
    userId,
    role,
    appRole,
    onboardingComplete: !!access.onboarding_complete,
    hasAccess: !!access.has_access,
  };
}

/**
 * The guard state for a user, from cache when it's fresh.
 *
 * `fetchQuery`, not `ensureQueryData`: the latter hands back whatever is cached
 * however old it is, so the "fresh for a minute" rule above was never applied —
 * a student whose parent had just paid on another device kept the paywall until
 * the entry was garbage collected ten minutes later.
 *
 * On a failed read this returns the last good answer if one is still held,
 * rather than a fresh set of nulls — a blip mid-session shouldn't change what
 * the student sees. With nothing remembered, it answers "unknown": nobody is
 * relocated and nobody is accused of not paying, and because a failure is never
 * cached the very next navigation asks again.
 */
export async function loadGuardState(
  queryClient: QueryClient,
  userId: string,
): Promise<GuardState> {
  const key = [...GUARD_KEY, userId];
  const previous = queryClient.getQueryData<GuardState>(key);

  try {
    return await queryClient.fetchQuery({
      queryKey: key,
      queryFn: () => fetchGuardState(userId),
      staleTime: FRESH_MS,
      gcTime: KEEP_MS,
      retry: 1,
    });
  } catch (err) {
    if (previous) return previous;
    if (err instanceof GuardUnanswered) return err.partial;
    return {
      userId,
      role: null,
      appRole: UserRole.STUDENT,
      onboardingComplete: null,
      hasAccess: null,
    };
  }
}

/** Drop the cached answer — after checkout, onboarding, or sign-out. */
export function invalidateGuardState(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: GUARD_KEY });
}
