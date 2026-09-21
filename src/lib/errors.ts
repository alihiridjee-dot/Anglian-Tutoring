/**
 * One sentence a person can read, from whatever was thrown.
 *
 * Two things reach the UI that `error instanceof Error ? error.message : …`
 * gets wrong. A failed Supabase query hands back a *plain object* — `{ message,
 * details, hint, code }` — not an `Error`, so code that throws it on and then
 * stringifies it prints the literal text "[object Object]". And a dropped
 * connection surfaces as the browser's own `TypeError: Failed to fetch` (Chrome),
 * `Load failed` (Safari) or `NetworkError when attempting…` (Firefox), none of
 * which tells a twelve-year-old that the Wi-Fi went.
 */

const OFFLINE = "We couldn't reach the server. Check your connection and try again.";

const NETWORK_FAILURE = /failed to fetch|load failed|networkerror|network request failed/i;

function rawMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

/** True when the failure was the network, not the request. Worth a retry as-is. */
export function isNetworkError(error: unknown): boolean {
  const message = rawMessage(error);
  return message !== null && NETWORK_FAILURE.test(message);
}

export function describeError(error: unknown, fallback = "Something went wrong."): string {
  if (isNetworkError(error)) return OFFLINE;
  const message = rawMessage(error)?.trim();
  return message ? message : fallback;
}
