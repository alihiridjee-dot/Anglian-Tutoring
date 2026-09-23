import { describe, expect, test } from "bun:test";
import {
  facetsFor,
  markStatusOf,
  segmentOf,
  matchesName,
  matchesSheetFilters,
  sheetFlags,
  sortForReview,
  timeLeft,
  toggleInCsv,
  validateGradesSearch,
  type Sheet,
} from "./homeworkReview";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const sheet = (over: Partial<Sheet>): Sheet => ({
  id: over.title ?? "s",
  title: "Sheet",
  subject: "physics",
  board: "aqa",
  level: "gcse",
  tier: null,
  specCode: "4.1",
  topicTitle: "Energy",
  specPointId: "p",
  status: "to_review",
  publishAt: "2026-09-21T06:00:00Z",
  reviewedAt: null,
  createdAt: "2026-09-19T00:00:00Z",
  questionCount: 5,
  totalMarks: 20,
  submissionCount: 0,
  ...over,
});

describe("filters", () => {
  const sheets = [
    sheet({ title: "a", subject: "physics", board: "aqa" }),
    sheet({ title: "b", subject: "physics", board: "edexcel", tier: "H" }),
    sheet({ title: "c", subject: "biology", board: "aqa" }),
  ];

  test("toggling builds and clears a sorted csv", () => {
    expect(toggleInCsv(undefined, "physics")).toBe("physics");
    expect(toggleInCsv("physics", "biology")).toBe("biology,physics");
    expect(toggleInCsv("physics", "physics")).toBeUndefined();
  });

  test("values within a facet are OR, facets are AND", () => {
    const f = { subject: "physics,biology", board: "aqa" };
    expect(sheets.filter((s) => matchesSheetFilters(s, f)).map((s) => s.title)).toEqual(["a", "c"]);
  });

  test("a facet counts against the other filters, not its own", () => {
    const f = { subject: "physics" };
    expect(facetsFor(sheets, f, "subject").map((x) => [x.value, x.count])).toEqual([
      ["biology", 1],
      ["chemistry", 0],
      ["physics", 2],
    ]);
    expect(facetsFor(sheets, f, "board").map((x) => [x.value, x.count])).toEqual([
      ["edexcel", 1],
      ["aqa", 1],
      ["ocr", 0],
      ["cambridge", 0],
      ["oxford_aqa", 0],
    ]);
  });

  test("level lists the whole taxonomy, so a one-level queue still says which", () => {
    expect(facetsFor(sheets, {}, "level").map((x) => x.label)).toEqual([
      "GCSE",
      "Trilogy",
      "iGCSE",
      "A-Level",
    ]);
  });

  test("untiered sheets are selectable, and sort last", () => {
    expect(facetsFor(sheets, {}, "tier").map((x) => x.value)).toEqual(["H", "none"]);
    expect(sheets.filter((s) => matchesSheetFilters(s, { tier: "none" })).length).toBe(2);
  });
});

describe("review order", () => {
  test("live and unread comes first, then soonest to publish", () => {
    const sorted = sortForReview(
      [
        sheet({ title: "later", publishAt: "2026-09-28T06:00:00Z" }),
        sheet({ title: "soon" }),
        sheet({ title: "live", publishAt: "2026-09-19T00:00:00Z" }),
      ],
      NOW,
    );
    expect(sorted.map((s) => s.title)).toEqual(["live", "soon", "later"]);
  });

  test("an unread sheet is upcoming until its publish time, then live", () => {
    const at = (over: Partial<Sheet>) => segmentOf(sheet(over), NOW);
    expect(at({})).toBe("upcoming");
    expect(at({ publishAt: "2026-09-19T00:00:00Z" })).toBe("live");
    expect(at({ publishAt: null })).toBe("live");
    expect(at({ status: "held", publishAt: null })).toBe("held");
    expect(at({ status: "approved" })).toBe("approved");
  });

  test("flags are facts about the row", () => {
    expect(sheetFlags(sheet({}), NOW)).toEqual([]);
    expect(
      sheetFlags(sheet({ publishAt: null, questionCount: 2, submissionCount: 4 }), NOW),
    ).toEqual(["live", "thin", "answered"]);
    // Held is never live, whatever its date says.
    expect(sheetFlags(sheet({ status: "held", publishAt: null }), NOW)).toEqual([]);
  });

  test("time left reads in the largest sensible unit", () => {
    expect(timeLeft("2026-09-20T12:30:00Z", NOW)).toBe("30 min");
    expect(timeLeft("2026-09-21T06:00:00Z", NOW)).toBe("18h");
    expect(timeLeft("2026-09-23T16:00:00Z", NOW)).toBe("3d 4h");
    expect(timeLeft("2026-09-20T11:00:00Z", NOW)).toBeNull();
  });
});

describe("incoming", () => {
  test("status follows the two timestamps", () => {
    expect(markStatusOf({ graded_at: null, tutor_reviewed_at: null })).toBe("pending");
    expect(markStatusOf({ graded_at: null, tutor_reviewed_at: "x" })).toBe("edited");
    expect(markStatusOf({ graded_at: "x", tutor_reviewed_at: "x" })).toBe("finalized");
  });

  test("name search matches word starts in any order", () => {
    expect(matchesName("Aisha Khan", "ai k")).toBe(true);
    expect(matchesName("Aisha Khan", "khan a")).toBe(true);
    expect(matchesName("Aisha Khan", "sha")).toBe(true);
    expect(matchesName("Aisha Khan", "ben")).toBe(false);
  });
});

test("search params drop anything unrecognised", () => {
  expect(
    validateGradesSearch({ view: "sideways", status: "edited", subject: 7, sub: "abc" }),
  ).toEqual({
    view: undefined,
    subject: undefined,
    level: undefined,
    tier: undefined,
    board: undefined,
    sheets: undefined,
    sheet: undefined,
    group: undefined,
    status: "edited",
    student: undefined,
    sub: "abc",
  });
});
