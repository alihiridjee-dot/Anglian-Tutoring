import type { BoardV, LevelV, SubjectV } from "@/lib/curriculum/taxonomy";

/**
 * What a tutor narrows a content library to: the task library and the quiz
 * list share it (`LibraryFilters` draws it).
 *
 * Both lists hold a task and a quiz for every spec point on every course, so
 * they run to thousands of rows. Each part is applied by the database, never by
 * hiding rows already fetched, and the counts beside them follow it too.
 */
export type LibraryFilter = {
  /** Title or spec code, as typed. */
  q: string;
  subject: SubjectV | null;
  /** `board:level`, e.g. `edexcel:gcse`. */
  course: string | null;
  topicId: string | null;
};

export const NO_FILTER: LibraryFilter = { q: "", subject: null, course: null, topicId: null };

export const isFiltered = (f: LibraryFilter) =>
  f.q.trim() !== "" || f.subject !== null || f.course !== null || f.topicId !== null;

export function courseParts(course: string | null): { board: BoardV; level: LevelV } | null {
  if (!course) return null;
  const [board, level] = course.split(":") as [BoardV, LevelV];
  return { board, level };
}
