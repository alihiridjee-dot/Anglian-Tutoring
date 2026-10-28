import { isSubject, type SubjectV, type BoardV, type LevelV } from "@/lib/curriculum/taxonomy";

/** The Videos page's filters; the same shape as `Filters` in FilterBar. */
export interface VideoFilters {
  subject?: SubjectV;
  board?: BoardV;
  level?: LevelV;
}

/** The Videos page's URL state: a video to open straight into, from a search hit. */
export type VideoSearchParams = { video?: string };

export function validateVideoSearch(search: Record<string, unknown>): VideoSearchParams {
  return { video: typeof search.video === "string" && search.video ? search.video : undefined };
}

/**
 * Where a student's Videos page opens: the subject they are on in the header,
 * the board they sit it with, and their level.
 *
 * The page used to open on every video they could read, newest first. That is
 * every board and level of each subject they pay for, thousands of rows, and
 * the first thousand (the most a read returns) were all A-level, so a GCSE
 * student never saw one of their own.
 */
export function ownCourseFilters(course: {
  subject: string | null;
  boardBySubject: Record<string, BoardV | undefined>;
  level: LevelV | null;
}): VideoFilters {
  const subject = isSubject(course.subject) ? course.subject : undefined;
  return {
    subject,
    board: subject ? course.boardBySubject[subject] : undefined,
    level: course.level ?? undefined,
  };
}

/**
 * A student who picks another subject moves to the board they sit that one
 * with; every other change is taken as it is. "All" subjects clears the board,
 * since their subjects can be on different boards.
 */
export function withOwnBoard(
  prev: VideoFilters,
  next: VideoFilters,
  boardBySubject: Record<string, BoardV | undefined>,
): VideoFilters {
  if (next.subject === prev.subject) return next;
  return { ...next, board: next.subject ? boardBySubject[next.subject] : undefined };
}
