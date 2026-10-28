/**
 * The header bell reads its notifications on mount and when it is opened, and
 * keeps them in its own state rather than in React Query, so invalidating
 * queries never reaches it. Something that changes what it should show (a
 * conversation read or deleted in Messages) fires this on the window instead.
 */
export const BELL_REFRESH = "notifications:refresh";

/** Ask the bell to read its notifications again. */
export function refreshBell() {
  window.dispatchEvent(new Event(BELL_REFRESH));
}
