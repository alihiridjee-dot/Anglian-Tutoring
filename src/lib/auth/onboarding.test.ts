import { describe, expect, test } from "bun:test";
import { examYearOptions, knownMainBoard } from "./onboarding";

describe("examYearOptions", () => {
  const labels = (level: Parameters<typeof examYearOptions>[0], iso: string) =>
    examYearOptions(level, new Date(iso)).map((o) => [o.year, o.label]);

  test("in term, the final year sits the nearest summer, nearest first", () => {
    expect(labels("gcse", "2026-10-05T12:00:00+01:00")).toEqual([
      [2027, "Year 11 · Exams in summer 2027"],
      [2028, "Year 10 · Exams in summer 2028"],
      [2029, "Year 9 · Exams in summer 2029"],
    ]);
    expect(labels("igcse", "2027-03-01T12:00:00Z")[0]).toEqual([
      2027,
      "Year 11 · Exams in summer 2027",
    ]);
  });

  test("a GCSE can start in Year 9; Combined Science and iGCSE too", () => {
    for (const level of ["gcse_trilogy", "igcse", null] as const)
      expect(labels(level, "2026-10-05T12:00:00+01:00").at(-1)).toEqual([
        2029,
        "Year 9 · Exams in summer 2029",
      ]);
  });

  test("A-Level is Years 12 and 13", () => {
    expect(labels("alevel", "2026-10-05T12:00:00+01:00")).toEqual([
      [2027, "Year 13 · Exams in summer 2027"],
      [2028, "Year 12 · Exams in summer 2028"],
    ]);
  });

  test("over the summer, the student is going into the year that sits it", () => {
    // After the 2026 series began (Monday 1 June), before September.
    expect(labels("gcse", "2026-07-20T12:00:00+01:00")).toEqual([
      [2027, "Going into Year 11 · Exams in summer 2027"],
      [2028, "Going into Year 10 · Exams in summer 2028"],
      [2029, "Going into Year 9 · Exams in summer 2029"],
    ]);
    // Before this year's series, Year 11 is still sitting it.
    expect(labels("gcse", "2027-06-01T12:00:00+01:00")[0]).toEqual([
      2027,
      "Year 11 · Exams in summer 2027",
    ]);
    // From September, the new year has started.
    expect(labels("gcse", "2026-09-01T12:00:00+01:00")[0]).toEqual([
      2027,
      "Year 11 · Exams in summer 2027",
    ]);
  });
});

describe("knownMainBoard", () => {
  test("a saved subject's board wins over the pricing-page pick", () => {
    expect(knownMainBoard([{ board: "aqa" }], "ocr")).toBe("aqa");
  });

  test("with nothing saved, the board picked on the pricing page is used", () => {
    expect(knownMainBoard([], "ocr")).toBe("ocr");
    expect(knownMainBoard(null, "cambridge")).toBe("cambridge");
  });

  test("nothing known is null, never a silent Edexcel", () => {
    expect(knownMainBoard([], undefined)).toBeNull();
    expect(knownMainBoard(undefined, "not-a-board")).toBeNull();
  });
});
