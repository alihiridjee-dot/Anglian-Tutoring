import { describe, expect, test } from "bun:test";
import { BOARDS, LEVELS, SUBJECTS } from "@/lib/curriculum/taxonomy";
import {
  BOARD_LABELS,
  buildNewStudentEmail,
  LEVEL_LABELS,
  SUBJECT_LABELS,
  type NewStudent,
} from "../../../supabase/functions/new-student-alert/email";

const bea: NewStudent = {
  id: "0f8e5b1c-1111-4222-8333-444455556666",
  name: "Bea Jones",
  email: "bea@example.com",
  level: "gcse",
  examYear: 2027,
  school: "Long Road Sixth Form",
  provider: "google",
  subjects: [
    { subject: "biology", board: "aqa", targetGrade: "8" },
    { subject: "chemistry", board: "aqa", targetGrade: null },
  ],
};

describe("buildNewStudentEmail", () => {
  test("names the student in the subject and the first line", () => {
    const e = buildNewStudentEmail(bea, "https://angliaeducate.co.uk");
    expect(e.subject).toBe("New student: Bea Jones");
    expect(e.text.split("\n")[0]).toBe("Bea Jones has just finished setting up their account.");
  });

  test("lists course, subjects, school and how they signed up", () => {
    const { text } = buildNewStudentEmail(bea, "https://angliaeducate.co.uk");
    expect(text).toContain("Email: bea@example.com");
    expect(text).toContain("Course: GCSE, exams in summer 2027");
    expect(text).toContain("Subjects: Biology (AQA), aiming for 8; Chemistry (AQA)");
    expect(text).toContain("School: Long Road Sixth Form");
    expect(text).toContain("Signed up with: Google");
  });

  test("links to their page on the Students screen, without a doubled slash", () => {
    const e = buildNewStudentEmail(bea, "https://angliaeducate.co.uk/");
    const link = `https://angliaeducate.co.uk/students/${bea.id}`;
    expect(e.text).toContain(`Open their page: ${link}`);
    expect(e.html).toContain(`href="${link}"`);
  });

  test("leaves out what the student hasn't given", () => {
    const { text } = buildNewStudentEmail(
      { ...bea, school: null, examYear: null, provider: null, subjects: [] },
      "https://angliaeducate.co.uk",
    );
    expect(text).toContain("Course: GCSE\n");
    expect(text).not.toContain("School:");
    expect(text).not.toContain("Subjects:");
    expect(text).not.toContain("Signed up with:");
  });

  test("a missing name still reads", () => {
    const e = buildNewStudentEmail({ ...bea, name: "  " }, "https://angliaeducate.co.uk");
    expect(e.subject).toBe("New student: A new student");
  });

  test("a name with line breaks stays on one line and is capped", () => {
    const e = buildNewStudentEmail(
      { ...bea, name: `Bea\r\nBcc: x@example.com ${"a".repeat(200)}` },
      "https://angliaeducate.co.uk",
    );
    expect(e.subject).not.toMatch(/[\r\n]/);
    expect(e.subject.length).toBeLessThanOrEqual("New student: ".length + 80);
  });

  test("what the student typed is escaped in the HTML", () => {
    const e = buildNewStudentEmail(
      { ...bea, name: "<b>Bea</b>", school: `"St Mary's" & <School>` },
      "https://angliaeducate.co.uk",
    );
    expect(e.html).not.toContain("<b>Bea</b>");
    expect(e.html).toContain("&lt;b&gt;Bea&lt;/b&gt;");
    expect(e.html).toContain("&quot;St Mary&#39;s&quot; &amp; &lt;School&gt;");
  });
});

describe("label copies", () => {
  // The function can't import the app's taxonomy, so it keeps its own copy.
  const asMap = (list: readonly { value: string; label: string }[]) =>
    Object.fromEntries(list.map((x) => [x.value, x.label]));

  test("match src/lib/curriculum/taxonomy.ts", () => {
    expect(LEVEL_LABELS).toEqual(asMap(LEVELS));
    expect(BOARD_LABELS).toEqual(asMap(BOARDS));
    expect(SUBJECT_LABELS).toEqual(asMap(SUBJECTS));
  });
});
