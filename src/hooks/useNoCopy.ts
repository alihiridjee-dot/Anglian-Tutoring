import { useEffect, useRef } from "react";

/**
 * Keeps a task's questions on the page. Inside the element this returns a ref
 * for, nothing can be copied, cut, dragged out or right-clicked for "Copy" or
 * "Save image", except in its answer boxes, where the student's own words stay
 * theirs to move about.
 *
 * Give the element `select-none` (and its answer boxes `select-text`) so the
 * questions can't be selected in the first place. This catches what that
 * doesn't, like ⌘A then ⌘C, which starts from the page rather than the sheet:
 * hence listening on the document.
 */
export function useNoCopy<T extends HTMLElement>(on: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!on) return;
    const answering = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("textarea, input, [contenteditable]");
    const inside = (t: EventTarget | null) => t instanceof Node && !!ref.current?.contains(t);

    const copy = (e: ClipboardEvent) => {
      const sheet = ref.current;
      if (!sheet || answering(e.target)) return;
      const selected = document.getSelection();
      const reachesSheet =
        !!selected && !selected.isCollapsed && selected.containsNode(sheet, true);
      if (inside(e.target) || reachesSheet) e.preventDefault();
    };
    const hold = (e: Event) => {
      if (inside(e.target) && !answering(e.target)) e.preventDefault();
    };

    document.addEventListener("copy", copy);
    document.addEventListener("cut", copy);
    document.addEventListener("contextmenu", hold);
    document.addEventListener("dragstart", hold);
    return () => {
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", copy);
      document.removeEventListener("contextmenu", hold);
      document.removeEventListener("dragstart", hold);
    };
  }, [on]);

  return ref;
}
