import { describe, expect, test } from "bun:test";
import { examDateBounds, examDateEntry, isReadableExamDate } from "./programDal";

describe("exam date guards", () => {
  test("half-typed years are unreadable, real ones are not", () => {
    // What a date box emits after the first, second and third digit of "2027".
    expect(isReadableExamDate("0002-06-01")).toBe(false);
    expect(isReadableExamDate("0020-06-01")).toBe(false);
    expect(isReadableExamDate("0202-06-01")).toBe(false);
    expect(isReadableExamDate("2027-06-01")).toBe(true);
    expect(isReadableExamDate("not a date")).toBe(false);
  });

  test("a student may choose from today to four years out", () => {
    const { min, max } = examDateBounds(new Date("2026-09-28T12:00:00Z"));
    expect(min).toBe("2026-09-28");
    expect(max).toBe("2030-09-28");
    // Key order is date order, which is what the input's range check relies on.
    expect("0002-06-01" < min).toBe(true);
    expect("2027-06-01" >= min && "2027-06-01" <= max).toBe(true);
  });

  test("the box saves only a new date in range, and puts anything else back", () => {
    const bounds = examDateBounds(new Date("2026-09-28T12:00:00Z"));
    const saved = "2027-06-07";
    expect(examDateEntry(saved, saved, bounds)).toBe("unchanged");
    expect(examDateEntry("2027-05-24", saved, bounds)).toBe("save");
    expect(examDateEntry("", saved, bounds)).toBe("putBack");
    expect(examDateEntry("0002-06-01", saved, bounds)).toBe("refuse");
    expect(examDateEntry("2026-09-27", saved, bounds)).toBe("refuse");
    expect(examDateEntry("2030-09-29", saved, bounds)).toBe("refuse");
    // Once the exams have passed, clicking into the box and out again is no change.
    expect(examDateEntry("2026-06-01", "2026-06-01", bounds)).toBe("unchanged");
  });
});
