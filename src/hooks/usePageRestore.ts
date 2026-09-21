import { useEffect, useRef } from "react";

/**
 * Runs `onRestore` when the browser brings this page back from its
 * back/forward cache.
 *
 * A button that sends the browser to Stripe sets a "redirecting…" state and
 * never clears it, because on success the page is gone. But Back from Stripe
 * doesn't reload the page — the browser restores it exactly as it was left,
 * state and all — so the student returned to a spinner on a disabled button,
 * with no way to try again short of a manual reload. `pageshow` with
 * `persisted` is the one signal that this has happened.
 */
export function usePageRestore(onRestore: () => void): void {
  const handler = useRef(onRestore);
  handler.current = onRestore;

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) handler.current();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
}
