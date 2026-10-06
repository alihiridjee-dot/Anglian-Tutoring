import { useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { readEntryView, writeEntryView } from "@/lib/shell/returnSpot";

/**
 * `useState` for the part of a page that decides what's on it — a tab, an open
 * topic, the week shown — kept with this visit in the browser's history.
 *
 * Coming back to the page with Back puts it back exactly as it was left, so the
 * card that was clicked is there to land on (see `@/lib/shell/returnSpot`).
 * Arriving fresh — the sidebar, a link — starts from `initial` as before.
 *
 * `name` must be unique on the page. Values go through JSON, so keep them to
 * strings, numbers, booleans and null.
 */
export function useEntryState<T>(
  name: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const router = useRouter();
  const index = useRouterState({ select: (s) => s.location.state.__TSR_index });
  const [value, setValue] = useState<T>(() => {
    const stored = readEntryView(router.state.location, name);
    return stored === undefined ? initial : (stored as T);
  });
  const latest = useRef(value);
  latest.current = value;
  // The page this view belongs to. A page on its way out is still mounted for
  // a moment after the next one's entry begins, and must not write into it.
  const page = useRef(router.state.location.pathname);

  // A page that stays mounted from one entry to the next (the curriculum
  // opening a spec point) takes up each entry's own view, or hands the one on
  // screen to an entry that has none yet.
  const seen = useRef(index);
  useEffect(() => {
    if (seen.current === index || router.state.location.pathname !== page.current) return;
    seen.current = index;
    const stored = readEntryView(router.state.location, name);
    if (stored === undefined) writeEntryView(router.state.location, name, latest.current);
    else setValue(stored as T);
  }, [index, name, router]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const value = next instanceof Function ? next(latest.current) : next;
      latest.current = value;
      setValue(value);
      if (router.state.location.pathname === page.current) {
        writeEntryView(router.state.location, name, value);
      }
    },
    [name, router],
  );

  return [value, set];
}
