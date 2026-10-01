import { describe, expect, test } from "bun:test";
import { fillTemplate, stepsOf, validateNote, type NoteDiagram } from "./noteFormat";

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
