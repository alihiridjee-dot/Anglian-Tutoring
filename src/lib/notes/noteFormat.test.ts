import { describe, expect, test } from "bun:test";
import {
  fillTemplate,
  headingIds,
  noteLayerFor,
  pickNoteLayer,
  resultDecimals,
  sliderDecimals,
  stepsOf,
  subjectOfNoteId,
  validateNote,
  type NoteDiagram,
} from "./noteFormat";

describe("sliderDecimals", () => {
  test("shows every value a slider can reach", () => {
    expect(sliderDecimals({ min: 0.03, step: 0.01 })).toBe(2);
    expect(sliderDecimals({ min: 0.01, step: 0.005 })).toBe(3);
    expect(sliderDecimals({ min: 0.005, step: 0.01 })).toBe(3);
    expect(sliderDecimals({ min: 1, step: 2.5 })).toBe(1);
  });

  test("keeps what it showed before for whole and tenth steps", () => {
    expect(sliderDecimals({ min: 0, step: 1 })).toBe(0);
    expect(sliderDecimals({ min: 10, step: 5 })).toBe(0);
    expect(sliderDecimals({ min: 0, step: 0.1 })).toBe(1);
    expect(sliderDecimals({ min: 0, step: 0.5 })).toBe(1);
  });
});

describe("resultDecimals", () => {
  test("a small result that isn't zero never reads as zero", () => {
    expect(resultDecimals(0.01, 1)).toBe(3);
    expect(resultDecimals(0.0045, 1)).toBe(4);
    expect(resultDecimals(-0.02, 0)).toBe(3);
  });

  test("leaves everything else at the note's own decimals", () => {
    expect(resultDecimals(0, 1)).toBe(1);
    expect(resultDecimals(0.06, 1)).toBe(1);
    expect(resultDecimals(12.345, 2)).toBe(2);
    expect(resultDecimals(5.5e-17, 1)).toBe(1);
    expect(resultDecimals(Number.NaN, 1)).toBe(1);
  });
});

describe("subjectOfNoteId", () => {
  test("reads the subject from every kind of note id", () => {
    expect(subjectOfNoteId("phys-031")).toBe("physics");
    expect(subjectOfNoteId("achem-008")).toBe("chemistry");
    expect(subjectOfNoteId("ibio-012")).toBe("biology");
  });

  test("anything else is not a note", () => {
    for (const id of ["garbage", "", "xbio-1", "bio-", "bio-12a", "chem-030/x"])
      expect(subjectOfNoteId(id)).toBeNull();
  });
});

describe("headingIds", () => {
  test("a repeated heading gets its own anchor", () => {
    expect(
      headingIds(["Detail this course asks for", "Detail this course asks for", "Worked example"]),
    ).toEqual(["detail-this-course-asks-for", "detail-this-course-asks-for-2", "worked-example"]);
  });

  test("never hands out the same anchor twice", () => {
    expect(headingIds(["Section 2", "Section", "Section", "∆"])).toEqual([
      "section-2",
      "section",
      "section-3",
      "section-4",
    ]);
  });
});

const noteWith = (diagram: NoteDiagram) => ({
  format: 1,
  concept_id: "bio-002",
  subject: "biology",
  title: "Test",
  key_idea: "A short key idea.",
  sections: [{ heading: "A", blocks: [{ type: "diagram", diagram }] }],
  checks: [
    { q: "q1", a: "a1" },
    { q: "q2", a: "a2" },
  ],
  boards: { aqa: { spec_codes: ["AQA 1.2"], exam_phrases: ["one", "two"], mistakes: [] } },
  meta: {
    status: "draft",
    written_by: "test",
    written_at: "2026-10-01",
    spec_point_ids: ["x"],
    exemplar_ids: [],
  },
});
const errorsFor = (d: unknown) => validateNote(noteWith(d as NoteDiagram));

describe("interactive diagrams are checked before they can render", () => {
  test("practice: unknown placeholder, unknown variable, division by zero", () => {
    const base = {
      kind: "practice",
      alt: "a",
      question: "Image {I} mm",
      variables: [{ id: "I", min: 1, max: 5, step: 1 }],
      answer: { formula: "I * 2", decimals: 0 },
      working: ["{answer}"],
    };
    expect(errorsFor(base)).toEqual([]);
    expect(errorsFor({ ...base, question: "Image {X} mm" }).join()).toContain(
      '"{X}" is not a variable',
    );
    expect(errorsFor({ ...base, answer: { formula: "I * k", decimals: 0 } }).join()).toContain(
      "k, which are not variables",
    );
    expect(
      errorsFor({
        ...base,
        variables: [{ id: "I", min: 0, max: 5, step: 1 }],
        answer: { formula: "10 / I", decimals: 0 },
      }).join(),
    ).toContain("not a finite number");
  });

  test("punnett: genotypes must use the two alleles", () => {
    const base = {
      kind: "punnett",
      alt: "a",
      alleles: { dominant: "B", recessive: "b" },
      phenotypes: { dominant: "Brown", recessive: "Blue" },
      parent_options: [["Bb"], ["bb"]],
    };
    expect(errorsFor(base)).toEqual([]);
    expect(errorsFor({ ...base, parent_options: [["Bc"], ["bb"]] }).join()).toContain(
      "two letters",
    );
  });

  test("sort: every group needs an item, every item a valid group", () => {
    const items = [
      { text: "a", group: 0 },
      { text: "b", group: 1 },
      { text: "c", group: 0 },
      { text: "d", group: 1 },
    ];
    expect(errorsFor({ kind: "sort", alt: "a", prompt: "p", groups: ["X", "Y"], items })).toEqual(
      [],
    );
    expect(
      errorsFor({ kind: "sort", alt: "a", prompt: "p", groups: ["X", "Y", "Z"], items }).join(),
    ).toContain("every sort group");
    expect(
      errorsFor({
        kind: "sort",
        alt: "a",
        prompt: "p",
        groups: ["X", "Y"],
        items: [...items.slice(1), { text: "e", group: 2 }],
      }).join(),
    ).toContain("group index");
  });

  test("sequence and explorer reject duplicates", () => {
    expect(
      errorsFor({ kind: "sequence", alt: "a", prompt: "p", steps: ["a", "b", "a"] }).join(),
    ).toContain("different");
    expect(
      errorsFor({
        kind: "explorer",
        alt: "a",
        prompt: "p",
        parts: [
          { name: "x", detail: "1" },
          { name: "x", detail: "2" },
          { name: "y", detail: "3" },
        ],
      }).join(),
    ).toContain("different");
  });
});

describe("helpers", () => {
  test("fillTemplate leaves unknown names alone", () => {
    expect(fillTemplate("{a} and {b}", { a: "1" })).toBe("1 and {b}");
  });
  test("stepsOf avoids float drift", () => {
    expect(stepsOf({ min: 0.1, max: 0.5, step: 0.1 })).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe("a student reads the layer for their own course", () => {
  test("board and level give the layer key", () => {
    expect(noteLayerFor("edexcel", "gcse")).toBe("edexcel");
    expect(noteLayerFor("edexcel", "igcse")).toBe("edexcel_igcse");
    expect(noteLayerFor("cambridge", "igcse")).toBe("cambridge_igcse");
    expect(noteLayerFor("aqa", "gcse_trilogy")).toBe("aqa");
    expect(noteLayerFor("cambridge", "gcse")).toBeUndefined();
    expect(noteLayerFor("oxford_aqa", "igcse")).toBeUndefined();
    expect(noteLayerFor(undefined, "igcse")).toBeUndefined();
    expect(noteLayerFor("ocr", "alevel")).toBe("ocr_alevel");
    expect(noteLayerFor("cambridge", "alevel")).toBe("cambridge_alevel");
    expect(noteLayerFor("oxford_aqa", "alevel")).toBeUndefined();
  });

  test("a missing layer falls back within the level, never across it", () => {
    expect(pickNoteLayer(["aqa", "edexcel_igcse"], "cambridge_igcse", "igcse")).toBe(
      "edexcel_igcse",
    );
    expect(pickNoteLayer(["aqa", "edexcel_igcse"], undefined, "gcse")).toBe("aqa");
    expect(pickNoteLayer(["aqa"], "cambridge_igcse", "igcse")).toBeUndefined();
    expect(pickNoteLayer(["aqa", "ocr_alevel"], "aqa_alevel", "alevel")).toBe("ocr_alevel");
    expect(pickNoteLayer(["aqa", "ocr_alevel"], undefined, "gcse")).toBe("aqa");
  });

  test("IGCSE layers validate", () => {
    const n = {
      ...noteWith({ kind: "flow", alt: "a", steps: ["a", "b"] }),
      boards: {
        cambridge_igcse: { spec_codes: ["CAIE 1.1.1"] },
        edexcel_igcse: { spec_codes: ["IGCSE 1.1"] },
      },
    };
    expect(validateNote(n)).toEqual([]);
  });

  test("A-level layers validate", () => {
    const n = {
      ...noteWith({ kind: "flow", alt: "a", steps: ["a", "b"] }),
      boards: {
        aqa_alevel: { spec_codes: ["AQA 3.1.1"] },
        cambridge_alevel: { spec_codes: ["CAIE 1.1"] },
      },
    };
    expect(validateNote(n)).toEqual([]);
  });
});
