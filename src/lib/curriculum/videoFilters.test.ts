import { describe, expect, test } from "bun:test";
import { onOwnBoard, ownBoardsOr, ownCourseFilters, validateVideoSearch } from "./videoFilters";

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

describe("onOwnBoard", () => {
  test("keeps a video on the board its subject is sat with", () => {
    expect(onOwnBoard({ subject: "biology", board: "edexcel" }, boards)).toBe(true);
    expect(onOwnBoard({ subject: "chemistry", board: "aqa" }, boards)).toBe(true);
  });

  test("turns away another board's video, and one with no board", () => {
    expect(onOwnBoard({ subject: "biology", board: "cambridge" }, boards)).toBe(false);
    expect(onOwnBoard({ subject: "biology", board: null }, boards)).toBe(false);
  });

  test("a subject with no board on record is left alone", () => {
    expect(onOwnBoard({ subject: "physics", board: "ocr" }, boards)).toBe(true);
  });
});

describe("ownBoardsOr", () => {
  test("pairs each subject with its board, and lets the rest through", () => {
    expect(ownBoardsOr(boards)).toBe(
      "and(subject.eq.biology,board.eq.edexcel),and(subject.eq.chemistry,board.eq.aqa),subject.not.in.(biology,chemistry)",
    );
  });

  test("is nothing when no board is on record", () => {
    expect(ownBoardsOr({})).toBeNull();
    expect(ownBoardsOr({ biology: undefined })).toBeNull();
  });
});

describe("validateVideoSearch", () => {
  test("keeps a video id and drops anything else", () => {
    expect(validateVideoSearch({ video: "abc" })).toEqual({ video: "abc" });
    expect(validateVideoSearch({ video: "" })).toEqual({ video: undefined });
    expect(validateVideoSearch({ video: 4 })).toEqual({ video: undefined });
  });
});
