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
 * What a student's Videos page shows: one subject (the header's until they
 * pick another), the board they sit it with, and their level. The subject is
 * the only part they can change.
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
 * Is this video on the board the student sits its subject with? "All" subjects
 * has no one board to filter by, since their subjects can be on different
 * boards, so each video is checked against its own subject's.
 */
export function onOwnBoard(
  video: { subject: string; board: string | null },
  boardBySubject: Record<string, BoardV | undefined>,
): boolean {
  const sat = boardBySubject[video.subject];
  return !sat || video.board === sat;
}

/**
 * {@link onOwnBoard} as a PostgREST `or` filter, for the read itself. Null
 * when the student has no board on record, and so nothing to keep to.
 */
export function ownBoardsOr(boardBySubject: Record<string, BoardV | undefined>): string | null {
  const sat = Object.entries(boardBySubject).filter(([, board]) => board);
  if (sat.length === 0) return null;
  return [
    ...sat.map(([subject, board]) => `and(subject.eq.${subject},board.eq.${board})`),
    `subject.not.in.(${sat.map(([subject]) => subject).join(",")})`,
  ].join(",");
}
