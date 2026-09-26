import { useEffect } from "react";

/**
 * Holds the page still while something is drawn over it.
 *
 * A drawer or dialog on a phone otherwise scrolls the page underneath as the
 * thumb moves over it, and the sheet drifts away from what it was opened on.
 * Restores whatever `overflow` the body had before, so nested locks unwind in
 * order.
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}
