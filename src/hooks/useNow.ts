import { useEffect, useState } from "react";

/**
 * The current time, re-read on an interval, for anything drawn relative to it.
 *
 * Pick the interval from what is on screen: a seconds countdown needs 1s, a
 * "12m" chip or a list that only changes when a lesson starts or ends does not.
 * The header button ticked every second on every page to show minutes.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
