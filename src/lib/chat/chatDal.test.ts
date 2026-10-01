import { describe, expect, test } from "bun:test";
import { memberLabel } from "./chatDal";

const names = new Map([
  ["mum", "Mum"],
  ["bea", "Bea"],
]);

describe("memberLabel", () => {
  test("a student's own thread is labelled with the student", () => {
    expect(memberLabel({ student_id: "bea", about_student_id: null }, names)).toBe("Bea");
  });

  test("a linked parent is named with the child the thread is about", () => {
    expect(memberLabel({ student_id: "mum", about_student_id: "bea" }, names)).toBe(
      "Mum · parent of Bea",
    );
  });

  test("an unlinked parent is not called the child's parent any more", () => {
    expect(memberLabel({ student_id: "mum", about_student_id: "bea" }, names, false)).toBe(
      "Mum · no longer linked to Bea",
    );
  });

  test("missing names fall back to the role", () => {
    const none = new Map<string, string>();
    expect(memberLabel({ student_id: "x", about_student_id: null }, none)).toBe("Student");
    expect(memberLabel({ student_id: "x", about_student_id: "y" }, none, false)).toBe(
      "Parent · no longer linked to a student",
    );
  });
});
