import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Render only the rows of a long list that are on screen.
 *
 * Rows here are a fixed height, which makes this arithmetic rather than
 * measurement: the scroll offset says which rows are visible, and two spacers
 * stand in for the rest so the scrollbar still describes the whole list. A
 * thousand-row table costs the same to paint as a thirty-row one.
 *
 * Put `ref` on the scrolling element, render `rows.slice(start, end)`, and pad
 * above and below with `before` and `after` pixels.
 */
export function useWindowedRows<T extends HTMLElement>(
  count: number,
  rowHeight: number,
  overscan = 8,
) {
  const ref = useRef<T>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 40) });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = Math.max(0, Math.floor(el.scrollTop / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight) / rowHeight) + overscan);
    setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [count, rowHeight, overscan]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [measure]);

  /** Bring a row into view — used when the keyboard moves the cursor off screen. */
  const scrollToRow = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el) return;
      const top = index * rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowHeight > el.scrollTop + el.clientHeight)
        el.scrollTop = top + rowHeight - el.clientHeight;
    },
    [rowHeight],
  );

  const end = Math.min(range.end, count);
  const start = Math.min(range.start, end);
  return {
    ref,
    start,
    end,
    before: start * rowHeight,
    after: Math.max(0, count - end) * rowHeight,
    scrollToRow,
  };
}
