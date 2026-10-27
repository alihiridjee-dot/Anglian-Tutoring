import { describe, expect, test } from "bun:test";
import { weekIsForAnotherCourse, weekMayBeWritten } from "./weekCut";

describe("weekIsForAnotherCourse (S-30)", () => {
  const aqaGcse = { board: "aqa", level: "gcse" };

  test("a week cut for the course the student is on is theirs", () => {
    expect(weekIsForAnotherCourse(aqaGcse, aqaGcse)).toBe(false);
  });

  test("a board or level change mid-week makes the saved week another course's", () => {
    expect(weekIsForAnotherCourse(aqaGcse, { board: "edexcel", level: "gcse" })).toBe(true);
    expect(weekIsForAnotherCourse(aqaGcse, { board: "aqa", level: "igcse" })).toBe(true);
  });
});

describe("weekMayBeWritten", () => {
  const own = {
    viewerId: "student",
    studentId: "student",
    hasAccess: true,
    paused: false,
    onBreak: false,
  };

  test("a paying or trial student's own look builds the week", () => {
    expect(weekMayBeWritten(own)).toBe(true);
  });

  test("a student behind the paywall writes nothing, even before a pause is recorded", () => {
    expect(weekMayBeWritten({ ...own, hasAccess: false })).toBe(false);
  });

  test("an access check that couldn't be answered doesn't stop a paying student's week", () => {
    expect(weekMayBeWritten({ ...own, hasAccess: null })).toBe(true);
    expect(weekMayBeWritten({ ...own, hasAccess: undefined })).toBe(true);
  });

  test("a tutor's or parent's look only reads", () => {
    expect(weekMayBeWritten({ ...own, viewerId: "tutor" })).toBe(false);
    expect(weekMayBeWritten({ ...own, viewerId: null })).toBe(false);
  });

  test("a paused subject or a break week is read, never planned", () => {
    expect(weekMayBeWritten({ ...own, paused: true })).toBe(false);
    expect(weekMayBeWritten({ ...own, onBreak: true })).toBe(false);
  });
});
