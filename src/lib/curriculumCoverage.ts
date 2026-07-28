import { SUBJECTS, BOARDS, LEVELS, type SubjectV, type BoardV, type LevelV } from "@/lib/taxonomy";

/**
 * Which level/board/subject combinations actually have curriculum.
 *
 * The taxonomy lists are flat, so on their own they offer every level × board ×
 * subject combination — but content only exists for some, and picking a gap
 * lands the student in an app with nothing in it. This is what lets the
 * pickers offer only what we can actually teach.
 *
 * Kept free of any data-fetching so the gating rules can be tested directly;
 * useCurriculumCoverage supplies the rows.
 */

/** One combination that has curriculum, and how much. */
export interface CoverageRow {
  level: LevelV;
  board: BoardV;
  subject: SubjectV;
  topicCount: number;
  specPointCount: number;
}

export class Coverage {
  constructor(private readonly rows: CoverageRow[]) {}

  /**
   * A combination counts as covered only if it has spec points, not merely a
   * topic. Topics are just headings; spec points are what the curriculum page,
   * the planner, and FSRS all key off, so a topic-only combination is still an
   * empty app.
   */
  has(level: LevelV, board: BoardV, subject: SubjectV): boolean {
    return this.rows.some(
      (r) =>
        r.level === level && r.board === board && r.subject === subject && r.specPointCount > 0,
    );
  }

  /** Levels with curriculum under at least one board and subject. */
  levels(): LevelV[] {
    return LEVELS.map((l) => l.value).filter((level) =>
      BOARDS.some((b) => SUBJECTS.some((s) => this.has(level, b.value, s.value))),
    );
  }

  /** Boards teachable at this level, in at least one subject. */
  boardsFor(level: LevelV): BoardV[] {
    return BOARDS.map((b) => b.value).filter((board) =>
      SUBJECTS.some((s) => this.has(level, board, s.value)),
    );
  }

  /** Subjects teachable at this level and board. */
  subjectsFor(level: LevelV, board: BoardV): SubjectV[] {
    return SUBJECTS.map((s) => s.value).filter((subject) => this.has(level, board, subject));
  }

  /** Boards that can teach this one subject at this level. */
  boardsForSubject(level: LevelV, subject: SubjectV): BoardV[] {
    return BOARDS.map((b) => b.value).filter((board) => this.has(level, board, subject));
  }

  /**
   * True when we know nothing at all. Callers treat this as "don't gate yet":
   * an RPC failure should not lock every student out of onboarding.
   */
  get isEmpty(): boolean {
    return this.rows.length === 0;
  }
}
