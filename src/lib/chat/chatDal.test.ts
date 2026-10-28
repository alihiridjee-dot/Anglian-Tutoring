import { describe, expect, test } from "bun:test";
import { lastLine, memberLabel, sendRefusal } from "./chatDal";

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

describe("sendRefusal", () => {
  test("a send to a thread the other side deleted says so in plain words", () => {
    const rls = {
      code: "42501",
      message: 'new row violates row-level security policy for table "chat_messages"',
    };
    expect(sendRefusal(rls)).toBe(
      "This conversation is no longer available, so your message wasn't sent.",
    );
  });

  test("any other refusal keeps the database's own words", () => {
    expect(sendRefusal({ code: "23514", message: "Too long" })).toBe("Too long");
    expect(sendRefusal({ code: "42501", message: "Slow down a little" })).toBe(
      "Slow down a little",
    );
    expect(sendRefusal({ message: "Failed to fetch" })).toBe("Failed to fetch");
  });
});

describe("lastLine", () => {
  test("a thread's row gets the start of a long message, not all of it", () => {
    const long = "x".repeat(50_000);
    expect(lastLine(long)).toHaveLength(200);
    expect(lastLine("Thanks!")).toBe("Thanks!");
    expect(lastLine(null)).toBeNull();
    expect(lastLine("")).toBeNull();
  });
});
