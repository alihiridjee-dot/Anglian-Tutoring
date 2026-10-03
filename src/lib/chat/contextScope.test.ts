import { describe, expect, test } from "bun:test";
import { courseScopeFilter } from "./contextScope";

const enrolments = [
  { subject: "biology", board: "aqa" },
  { subject: "physics", board: "edexcel" },
];

describe("courseScopeFilter", () => {
  test("each subject is matched on its own board", () => {
    expect(courseScopeFilter(["biology", "physics"], enrolments, { boardless: false })).toBe(
      "and(subject.eq.biology,board.eq.aqa),and(subject.eq.physics,board.eq.edexcel)",
    );
  });

  test("a brief for every board is let through when asked", () => {
    expect(courseScopeFilter(["biology"], enrolments, { boardless: true })).toBe(
      "board.is.null,and(subject.eq.biology,board.eq.aqa)",
    );
  });

  test("a subject with no enrolment row is matched on subject alone", () => {
    expect(courseScopeFilter(["chemistry"], enrolments, { boardless: false })).toBe(
      "subject.eq.chemistry",
    );
  });

  test("no subjects means no read at all, not an unfiltered one", () => {
    expect(courseScopeFilter([], enrolments, { boardless: true })).toBeNull();
  });
});
