import { useRouteContext } from "@tanstack/react-router";
import type { GuardState } from "@/lib/auth/guardState";

/**
 * The signed-in viewer, as the `/_authenticated` guard resolved them.
 *
 * Available synchronously on first render — the guard has already answered
 * before any page under it mounts — so a page that needs "whose data is this"
 * never has to fetch it, wait on it, or handle it failing. Pages used to ask
 * `AuthService.getEffectiveStudentId()` from an effect: four requests to learn
 * the id the router context was already holding, and a spinner that never
 * cleared if any one of them failed.
 *
 * `strict: false` because the page components are mounted twice — under the
 * guard, and again under `/demo/*` for the signed-out showcase, where there is
 * no viewer and this returns null.
 */
export function useViewer(): GuardState | null {
  const context = useRouteContext({ strict: false }) as { viewer?: GuardState };
  return context.viewer ?? null;
}

/** The viewer's own user id, or null in the showcase. */
export function useViewerId(): string | null {
  return useViewer()?.userId ?? null;
}
