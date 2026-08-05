import { LEVELS, BOARDS, SUBJECTS, type BoardV, type LevelV } from "@/lib/taxonomy";
import type { Enrolment } from "@/hooks/data/useEnrolments";

/**
 * "What am I actually signed up to?" — answered once, for the whole app.
 *
 * A student's course is three facts that live in different places: the level on
 * their profile, the board on each enrolment row, and the subjects those rows
 * name. Every surface that wants to state it was deriving that itself, so the
 * phrasing drifted and most pages simply didn't say it at all — which is how a
 * student ends up unsure which spec they're being taught.
 *
 * Kept pure and free of data fetching, the way curriculumCoverage is, so the
 * label rules can be read and tested on their own. `useCourseSummary` supplies
 * the rows.
 */

const labelFrom = (list: readonly { value: string; label: string }[], value: string | null) =>
  list.find((x) => x.value === value)?.label ?? null;

export const levelLabel = (level: string | null | undefined): string | null =>
  labelFrom(LEVELS, level ?? null);

/** Falls back to the raw slug capitalised, so an unknown board still reads. */
export const boardLabel = (board: string | null | undefined): string =>
  labelFrom(BOARDS, board ?? null) ?? (board ? board.toUpperCase() : "—");

export const subjectLabel = (subject: string | null | undefined): string =>
  labelFrom(SUBJECTS, subject ?? null) ??
  (subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : "—");

export interface SubjectBoard {
  subject: string;
  subjectLabel: string;
  board: BoardV;
  boardLabel: string;
}

export interface CourseSummary {
  levelLabel: string | null;
  /** Distinct boards in taxonomy order — usually one, occasionally two. */
  boardLabels: string[];
  /**
   * The boards as one phrase, or null when there are no enrolments. Named
   * individually rather than collapsed to "Mixed": a student sitting Biology
   * with AQA and Physics with OCR needs to see both, and "Mixed" tells them
   * nothing they can check against their exam paper.
   */
  boardSummary: string | null;
  /** Every enrolled subject with the board it is sat with, subject-ordered. */
  perSubject: SubjectBoard[];
  /** True when the student sits more than one board — worth spelling out. */
  mixedBoards: boolean;
  /**
   * The one-line answer, e.g. "GCSE · Edexcel". Null when we don't yet know
   * enough to say anything true, so callers render nothing rather than a
   * half-sentence.
   */
  headline: string | null;
}

export function summariseCourse(
  level: LevelV | null | undefined,
  enrolments: readonly Enrolment[],
): CourseSummary {
  const perSubject: SubjectBoard[] = SUBJECTS.flatMap((s) => {
    const row = enrolments.find((e) => e.subject === s.value);
    return row
      ? [
          {
            subject: s.value,
            subjectLabel: s.label,
            board: row.board,
            boardLabel: boardLabel(row.board),
          },
        ]
      : [];
  });

  const boardLabels = BOARDS.filter((b) => enrolments.some((e) => e.board === b.value)).map(
    (b) => b.label,
  );

  const lvl = levelLabel(level);
  const boardSummary = boardLabels.length ? boardLabels.join(" · ") : null;
  const headline = lvl && boardSummary ? `${lvl} · ${boardSummary}` : (lvl ?? boardSummary);

  return {
    levelLabel: lvl,
    boardLabels,
    boardSummary,
    perSubject,
    mixedBoards: boardLabels.length > 1,
    headline,
  };
}
