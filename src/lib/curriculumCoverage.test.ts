import { describe, expect, test } from "bun:test";
import { Coverage, type CoverageRow } from "./curriculumCoverage";

const row = (
  level: CoverageRow["level"],
  board: CoverageRow["board"],
  subject: CoverageRow["subject"],
  specPointCount = 10,
  topicCount = 5,
): CoverageRow => ({ level, board, subject, topicCount, specPointCount });

/**
 * Mirrors what curriculum_coverage() actually returns in production, gaps and
 * all: iGCSE has no physics, and Trilogy exists only under AQA. Those gaps are
 * the reason the gating exists, so they are the fixture.
 */
const LIVE: CoverageRow[] = [
  row("gcse", "edexcel", "biology", 165),
  row("gcse", "edexcel", "chemistry", 243),
  row("gcse", "edexcel", "physics", 296),
  row("gcse", "aqa", "biology", 92),
  row("gcse", "aqa", "chemistry", 124),
  row("gcse", "aqa", "physics", 81),
  row("gcse", "ocr", "biology", 138),
  row("gcse", "ocr", "chemistry", 147),
  row("gcse", "ocr", "physics", 182),
  row("igcse", "edexcel_intl", "biology", 176),
  row("igcse", "edexcel_intl", "chemistry", 182),
  row("alevel", "aqa", "biology", 10),
  row("alevel", "aqa", "chemistry", 5),
  row("alevel", "aqa", "physics", 6),
  row("gcse_trilogy", "aqa", "biology", 71),
  row("gcse_trilogy", "aqa", "chemistry", 93),
  row("gcse_trilogy", "aqa", "physics", 52),
];

describe("Coverage", () => {
  const c = new Coverage(LIVE);

  test("every level we hold content for is offered", () => {
    expect(c.levels().sort()).toEqual(["alevel", "gcse", "gcse_trilogy", "igcse"]);
  });

  test("iGCSE is a level of its own, carrying only the international board", () => {
    expect(c.boardsFor("igcse")).toEqual(["edexcel_intl"]);
    expect(c.has("igcse", "edexcel_intl", "biology")).toBe(true);
    // The international board moved off GCSE wholesale — it must not linger
    // there, or a student would see it under both levels.
    expect(c.boardsFor("gcse")).toEqual(["edexcel", "aqa", "ocr"]);
    expect(c.has("gcse", "edexcel_intl", "biology")).toBe(false);
  });

  test("Trilogy is AQA-only", () => {
    expect(c.boardsFor("gcse_trilogy")).toEqual(["aqa"]);
    expect(c.has("gcse_trilogy", "edexcel", "biology")).toBe(false);
    expect(c.has("gcse_trilogy", "ocr", "biology")).toBe(false);
    expect(c.has("gcse_trilogy", "aqa", "biology")).toBe(true);
  });

  test("iGCSE offers biology and chemistry but not physics", () => {
    expect(c.subjectsFor("igcse", "edexcel_intl")).toEqual(["biology", "chemistry"]);
    expect(c.has("igcse", "edexcel_intl", "physics")).toBe(false);
    expect(c.boardsForSubject("igcse", "physics")).toEqual([]);
  });

  test("physics is available on every ordinary GCSE board", () => {
    expect(c.boardsForSubject("gcse", "physics")).toEqual(["edexcel", "aqa", "ocr"]);
  });

  test("A-Level is AQA-only across all three subjects", () => {
    expect(c.boardsFor("alevel")).toEqual(["aqa"]);
    expect(c.subjectsFor("alevel", "aqa")).toEqual(["biology", "chemistry", "physics"]);
  });

  test("a topics-only combination does not count as covered", () => {
    // A board with headings but no spec points is still an empty app.
    const thin = new Coverage([row("gcse", "edexcel", "biology", 0, 9)]);
    expect(thin.has("gcse", "edexcel", "biology")).toBe(false);
    expect(thin.levels()).toEqual([]);
    expect(thin.boardsFor("gcse")).toEqual([]);
  });

  test("no rows reports empty so callers can skip gating instead of locking everyone out", () => {
    const none = new Coverage([]);
    expect(none.isEmpty).toBe(true);
    expect(none.levels()).toEqual([]);
  });

  test("results follow taxonomy order, not row order", () => {
    const shuffled = new Coverage([
      row("gcse", "ocr", "physics"),
      row("gcse", "edexcel", "physics"),
      row("gcse", "aqa", "physics"),
    ]);
    expect(shuffled.boardsForSubject("gcse", "physics")).toEqual(["edexcel", "aqa", "ocr"]);
  });
});
