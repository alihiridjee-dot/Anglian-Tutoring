import { describe, expect, test } from "bun:test";
import { groupEnrolmentsByStudent, type StudentEnrolment } from "./studentsDal";

const row = (id: string, student_id: string, subject: StudentEnrolment["subject"]) => ({
  id,
  student_id,
  subject,
  board: "aqa" as const,
  previous_grade: null,
  current_grade: null,
  target_grade: null,
});

describe("groupEnrolmentsByStudent", () => {
  // The paged read returns rows in id order, so subjects arrive shuffled.
  const rows = [
    row("01", "bea", "physics"),
    row("02", "cal", "chemistry"),
    row("03", "bea", "biology"),
    row("04", "cal", "biology"),
    row("05", "bea", "chemistry"),
    row("06", "dee", "physics"),
  ];

  test("each student's subjects come back in course order, whatever the id order", () => {
    const out = groupEnrolmentsByStudent(rows);
    expect(out.bea.map((e) => e.subject)).toEqual(["biology", "chemistry", "physics"]);
    expect(out.cal.map((e) => e.subject)).toEqual(["biology", "chemistry"]);
    expect(out.dee.map((e) => e.subject)).toEqual(["physics"]);
  });

  test("every row lands once, without its student id", () => {
    const out = groupEnrolmentsByStudent(rows);
    const ids = Object.values(out)
      .flat()
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(out.bea[0]).not.toHaveProperty("student_id");
  });

  test("no rows, no students", () => {
    expect(groupEnrolmentsByStudent([])).toEqual({});
  });
});
