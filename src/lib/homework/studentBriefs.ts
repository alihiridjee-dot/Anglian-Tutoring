import { selectInHistory } from "@/lib/platform/db/chunked";
import type { Homework } from "@/lib/homework/types";

/** Rows per request when reading a student's task briefs. */
export const BRIEF_PAGE = 500;

/**
 * Every brief a student can see, read in id-ordered pages.
 *
 * One plain select stops at PostgREST's 1,000-row cap, and the practice queue
 * writes a sheet for every spec point on every board, so past that arbitrary
 * sheets vanished from the Tasks page. `page` must order by `id`, apply
 * `id > after` when given, and limit to {@link BRIEF_PAGE}; reading continues
 * until a page comes back empty (the house keyset pattern in `chunked.ts`).
 */
export async function readStudentBriefs(
  page: (after: string | null) => PromiseLike<{
    data: Homework[] | null;
    error: { message: string } | null;
  }>,
): Promise<Homework[]> {
  const rows = await selectInHistory<Homework>(["briefs"], (_batch, after) => page(after));
  return sortBriefs(rows);
}

/** Due date first, undated sheets last, then id so equal dates keep one order. */
export function sortBriefs(rows: Homework[]): Homework[] {
  const due = (h: Homework) => (h.due_at ? Date.parse(h.due_at) : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => {
    const d = due(a) - due(b);
    if (d !== 0 && !Number.isNaN(d)) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
