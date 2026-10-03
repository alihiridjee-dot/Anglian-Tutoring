import { describe, expect, test } from "bun:test";
import { weekIsForAnotherCourse } from "./weekCut";

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
