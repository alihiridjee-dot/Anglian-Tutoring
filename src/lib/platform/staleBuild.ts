/**
 * A page left open across a deploy.
 *
 * Every deploy renames the code files (`/assets/<name>-<hash>.js`), and the
 * production domain then serves only the new ones. A student who opened the
 * site before the deploy asks for a file that is gone on their next click, and
 * the page fails with "This page didn't load". "Try again" asks for the same
 * missing file, so it fails again: only a full reload, which fetches the new
 * build, gets them out. That reload is done for them here, once.
 */
const STALE_BUILD =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;

const KEY = "anglia.stale-build-reload";

/** A reload in this window that didn't fix it means the build isn't the problem. */
const ONCE_PER = 60_000;

export function isStaleBuildError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "";
  return STALE_BUILD.test(message);
}

/**
 * Reloads the page to pick up the new build, at most once a minute. Returns
 * false, and leaves the error on screen, when it reloaded a moment ago or
 * can't remember that it did (storage refused), so it can never loop.
 */
export function reloadForNewBuild(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (now - last < ONCE_PER) return false;
    sessionStorage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
