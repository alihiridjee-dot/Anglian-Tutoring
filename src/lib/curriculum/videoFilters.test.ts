import { describe, expect, test } from "bun:test";
import { ownCourseFilters, validateVideoSearch, withOwnBoard } from "./videoFilters";

const boards = { biology: "edexcel", chemistry: "aqa" } as const;

describe("ownCourseFilters", () => {
  test("opens on the header subject, its board and the student's level", () => {
    expect(
      ownCourseFilters({ subject: "chemistry", boardBySubject: boards, level: "gcse" }),
    ).toEqual({ subject: "chemistry", board: "aqa", level: "gcse" });
  });

  test("a student with no subject yet still keeps to their level", () => {
    expect(ownCourseFilters({ subject: null, boardBySubject: {}, level: "alevel" })).toEqual({
      subject: undefined,
      board: undefined,
      level: "alevel",
    });
  });

  test("ignores a subject that isn't one", () => {
    expect(ownCourseFilters({ subject: "music", boardBySubject: boards, level: null })).toEqual({
      subject: undefined,
      board: undefined,
      level: undefined,
    });
  });
});

describe("withOwnBoard", () => {
  const start = { subject: "biology", board: "edexcel", level: "gcse" } as const;

  test("a new subject brings the board it is sat with", () => {
    expect(withOwnBoard(start, { ...start, subject: "chemistry" }, boards)).toEqual({
      subject: "chemistry",
      board: "aqa",
      level: "gcse",
    });
  });

  test("All subjects clears the board", () => {
    expect(withOwnBoard(start, { ...start, subject: undefined }, boards)).toEqual({
      subject: undefined,
      board: undefined,
      level: "gcse",
    });
  });

  test("a board or level change is kept as picked", () => {
    expect(withOwnBoard(start, { ...start, board: "ocr" }, boards)).toEqual({
      ...start,
      board: "ocr",
    });
    expect(withOwnBoard(start, { ...start, level: undefined }, boards)).toEqual({
      ...start,
      level: undefined,
    });
  });
});

describe("validateVideoSearch", () => {
  test("keeps a video id and drops anything else", () => {
    expect(validateVideoSearch({ video: "abc" })).toEqual({ video: "abc" });
    expect(validateVideoSearch({ video: "" })).toEqual({ video: undefined });
    expect(validateVideoSearch({ video: 4 })).toEqual({ video: undefined });
  });
});
