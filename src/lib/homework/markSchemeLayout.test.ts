import { describe, expect, test } from "bun:test";
import { layoutMarkScheme, type MarkSchemeRow } from "@/lib/homework/markSchemeLayout";
import { MARK_SCHEME_LAYOUT, buildGenerationPrompt } from "@/lib/homework/examGeneration";
import { toSciNotation } from "@/lib/platform/sciNotation";

/**
 * Mark schemes were stored in every shape there is. These are real ones from
 * the library, one per shape, and each must come out as a mark scheme reads:
 * bold parts and sections, one bullet per point, guidance on its own lines.
 */

/** Every word of a layout, in order: what the student reads. */
const words = (rows: MarkSchemeRow[]) =>
  rows
    .flatMap((r) => [
      r.label ?? "",
      r.text,
      ...r.items.flatMap((i) => [i.label ?? "", i.text]),
      ...(r.kind === "point" ? r.notes : []),
    ])
    .join(" ")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const original = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");

/** A compact picture of the rows: "label|text" per row, "•" for points, "  -" for their bullets. */
const picture = (rows: MarkSchemeRow[]) =>
  rows.flatMap((r) => {
    const head = `${r.kind === "point" ? "• " : ""}${[r.label, r.text].filter(Boolean).join(" ")}`;
    return [
      head,
      ...r.items.map((i) => `  - ${[i.label, i.text].filter(Boolean).join(" ")}`),
      ...(r.kind === "point" ? r.notes.map((n) => `  > ${n}`) : []),
    ];
  });

const SHAPES: Record<string, string> = {
  semicolonLines:
    "The cloudy lens is surgically removed;\nIt is replaced with an artificial (plastic) lens.",
  leadThenLines:
    "Any two from, 1 mark each:\nInherited/genetic condition (allow: a faulty allele on the X chromosome)\nOne type of cone cell in the retina is missing or does not work properly\nDamage to the retina or optic nerve, e.g. by eye disease or injury",
  creditedParagraph:
    "Award up to 4 marks for a logically linked explanation. Indicative content: with fewer T-helper cells, the immune response to other pathogens is weaker / slower (1); fewer antibodies are produced (1); white blood cells are less able to destroy pathogens (1); so other pathogens can multiply and cause disease (1). Do not award a mark just for repeating that HIV infects and destroys T-helper cells, as the question states this.",
  semicolonList:
    "1 mark each for: physical well-being; mental well-being; social well-being. Accept 'psychological' for mental. Do not credit 'absence of disease' as one of the three components.",
  inlineBullets:
    "Award 1 mark for any one of the following (or equivalent wording): • it does not show the real 3D shape of the atoms • it does not show the relative sizes of the atoms • it does not show the bond angles. Ignore vague statements such as 'it is not accurate' with no further detail.",
  middleDots:
    "Any three from: all the offspring were tall, not a blend (1) · some of the next generation were dwarf (1) · the ratio was about 3 : 1 (1). Guidance: accept 'traits' for characteristics. Maximum 3 marks.",
  romanAfterCredits:
    "1 mark for each correct formula with correct charge shown. (i) NO₃⁻ (1) (ii) CO₃²⁻ (1) (iii) NH₄⁺ (1). Allow numbers and charges typed on the line.",
  partsOnePointEach:
    "(a) 19 (1)\n(b) 38 (1). Error carried forward: accept 2 × the student's answer to (a).\n(c) So that the full chromosome number (38) is restored (1). Accept: so the chromosome number does not double.\nGuidance: for (c) do not accept 'because it is a sex cell'.",
  partsWithLists:
    "(a) Mᵣ of MgCl₂ = 24 + 2 × 35.5 = 95 (1); moles = 4.75 ÷ 95 = 0.0500 mol (1). Correct answer scores 2 with or without working.\n(b) number of Cl⁻ ions = 2 × 3.01 × 10²² = 6.02 × 10²² (1). Allow ECF from an incorrect answer to (a).",
  levelsInOneLine:
    "Level 3 (5–6 marks): A detailed evaluation of at least two models. Level 2 (3–4 marks): Identifies limitations of two models. Level 1 (1–2 marks): Identifies one limitation. 0 marks: No relevant content. Indicative content (not exhaustive): • dot and cross diagrams do not show shape • ball and stick models show bonds as rigid sticks",
  levelWithItsOwnList:
    "Level 3 (7-8 marks): Links at least three of the following factors, with clear explanation of mechanism: (i) the virus damages the cilia of the airways; (ii) immune resources are diverted to the viral infection; (iii) poor nutrition weakens the immune response.\nLevel 2 (4-6 marks): Explains two of the above factors.",
  levelExamples:
    "Level 1 (1–2 marks): identifies one or two substances. Examples: X is iron (1); Z is calcium carbonate (2).\nLevel 2 (3–4 marks): identifies at least two substances with reasons.",
  guidanceBySemicolons:
    "RNA polymerase (1)\nGuidance: do not accept DNA polymerase; do not accept helicase; do not accept 'polymerase' on its own.",
  labelledLines:
    "Cornea: refracts/bends light (as it enters the eye)\nLens: focuses light (onto the retina) / fine-tunes focusing by changing shape",
  perItemLabels:
    "(a) 0.20 g: hydrochloric acid is in excess (1); 0.50 g: magnesium is in excess (1).",
  bulletedSchemeWithNotes:
    "Award up to 2 marks:\n• two Cl⁻ ions are needed to balance the 2+ charge on one Mg²⁺ ion (1 mark)\n• correct final formula MgCl₂ (1 mark)\nThe correct formula MgCl₂ with no working scores 1 mark only. Do not accept Mg₂Cl.",
  valueNotCredit:
    "Award 1 mark for each of the following points (max 3):\n• identifies the lowest common multiple of the charges (6), e.g. 2 Al³⁺ give 6+ (1 mark)\n• states the correct final formula Al₂(SO₄)₃ (1 mark)",
  semicolonInsideAPoint:
    "(b) The male could be Bb and by chance passed on only B (1). Cross him with the brown female again and look for brown offspring; if any are brown the male is Bb (1).",
  showcase: "Interphase (1), mitosis (1), cytokinesis (1). Correct order required.",
};

describe("every word survives, in order", () => {
  for (const [name, scheme] of Object.entries(SHAPES)) {
    test(name, () => {
      expect(words(layoutMarkScheme(scheme))).toBe(original(scheme));
    });
  }

  test("nothing in, nothing out", () => {
    expect(layoutMarkScheme("")).toEqual([]);
    expect(layoutMarkScheme(null)).toEqual([]);
    expect(layoutMarkScheme("  \n\n ")).toEqual([]);
  });

  test("unclosed brackets and Windows line endings still come back whole", () => {
    const scheme = "Rate decreases (because light falls (1);\r\nAllow 'slower'.\r\n";
    expect(words(layoutMarkScheme(scheme))).toBe(original(scheme));
  });
});

describe("each shape reads as a mark scheme", () => {
  test("a point per line loses the semicolons it was joined with", () => {
    expect(picture(layoutMarkScheme(SHAPES.semicolonLines))).toEqual([
      "• The cloudy lens is surgically removed",
      "• It is replaced with an artificial (plastic) lens.",
    ]);
  });

  test("a lead-in line is bold and its points are bullets", () => {
    const rows = layoutMarkScheme(SHAPES.leadThenLines);
    expect(rows[0]).toMatchObject({ kind: "line", label: "Any two from, 1 mark each:", text: "" });
    expect(rows.slice(1).map((r) => r.kind)).toEqual(["point", "point", "point"]);
  });

  test("a paragraph of credited points becomes its lead-in, its bullets and its guidance", () => {
    expect(picture(layoutMarkScheme(SHAPES.creditedParagraph))).toEqual([
      "Award up to 4 marks for a logically linked explanation.",
      "Indicative content:",
      "  - with fewer T-helper cells, the immune response to other pathogens is weaker / slower (1)",
      "  - fewer antibodies are produced (1)",
      "  - white blood cells are less able to destroy pathogens (1)",
      "  - so other pathogens can multiply and cause disease (1).",
      "Do not award a mark just for repeating that HIV infects and destroys T-helper cells, as the question states this.",
    ]);
  });

  test("three or more clauses after a lead-in are a list", () => {
    expect(picture(layoutMarkScheme(SHAPES.semicolonList))).toEqual([
      "1 mark each for:",
      "  - physical well-being",
      "  - mental well-being",
      "  - social well-being.",
      "Accept 'psychological' for mental.",
      "Do not credit 'absence of disease' as one of the three components.",
    ]);
  });

  test("bullets written inside a line, and the guidance after the last", () => {
    expect(picture(layoutMarkScheme(SHAPES.inlineBullets))).toEqual([
      "Award 1 mark for any one of the following (or equivalent wording):",
      "  - it does not show the real 3D shape of the atoms",
      "  - it does not show the relative sizes of the atoms",
      "  - it does not show the bond angles.",
      "Ignore vague statements such as 'it is not accurate' with no further detail.",
    ]);
  });

  test("points split by middle dots, then a guidance section of their own", () => {
    expect(picture(layoutMarkScheme(SHAPES.middleDots))).toEqual([
      "Any three from:",
      "  - all the offspring were tall, not a blend (1)",
      "  - some of the next generation were dwarf (1)",
      "  - the ratio was about 3 : 1 (1).",
      "Guidance:",
      "  - accept 'traits' for characteristics.",
      "  - Maximum 3 marks.",
    ]);
  });

  test("(i), (ii), (iii) after their credits are one bullet each", () => {
    expect(picture(layoutMarkScheme(SHAPES.romanAfterCredits))).toEqual([
      "1 mark for each correct formula with correct charge shown.",
      "  - (i) NO₃⁻ (1)",
      "  - (ii) CO₃²⁻ (1)",
      "  - (iii) NH₄⁺ (1).",
      "Allow numbers and charges typed on the line.",
    ]);
  });

  test("parts of one point each keep their label on the bullet, with their guidance under it", () => {
    expect(picture(layoutMarkScheme(SHAPES.partsOnePointEach))).toEqual([
      "• (a) 19 (1)",
      "• (b) 38 (1).",
      "  > Error carried forward: accept 2 × the student's answer to (a).",
      "• (c) So that the full chromosome number (38) is restored (1).",
      "  > Accept: so the chromosome number does not double.",
      "Guidance: for (c) do not accept 'because it is a sex cell'.",
    ]);
  });

  test("when one part has more under it, every part gets a line of its own", () => {
    const lines = picture(layoutMarkScheme(SHAPES.partsWithLists));
    expect(lines).toContain("(a)");
    expect(lines).toContain("(b)");
    expect(lines).toContain("• number of Cl⁻ ions = 2 × 3.01 × 10²² = 6.02 × 10²² (1).");
  });

  test("levels written in one line are a bullet each, and the indicative content after them is not a level", () => {
    const rows = layoutMarkScheme(SHAPES.levelsInOneLine);
    expect(rows.filter((r) => r.kind === "point").map((r) => r.label)).toEqual([
      "Level 3 (5–6 marks):",
      "Level 2 (3–4 marks):",
      "Level 1 (1–2 marks):",
      "0 marks:",
    ]);
    expect(picture(rows).slice(-3)).toEqual([
      "Indicative content (not exhaustive):",
      "  - dot and cross diagrams do not show shape",
      "  - ball and stick models show bonds as rigid sticks",
    ]);
  });

  test("a level's own (i), (ii) list sits under that level", () => {
    const [top, next] = layoutMarkScheme(SHAPES.levelWithItsOwnList);
    expect(top).toMatchObject({ kind: "point", label: "Level 3 (7-8 marks):" });
    expect(top.items.map((i) => i.label)).toEqual(["(i)", "(ii)", "(iii)"]);
    expect(next).toMatchObject({ kind: "point", label: "Level 2 (4-6 marks):" });
  });

  test("a level's examples stay with that level", () => {
    const [level1] = layoutMarkScheme(SHAPES.levelExamples);
    expect(level1.kind === "point" && level1.notes).toEqual([
      "Examples: X is iron (1); Z is calcium carbonate (2).",
    ]);
  });

  test("guidance split by semicolons is a bullet per rule", () => {
    expect(picture(layoutMarkScheme(SHAPES.guidanceBySemicolons))).toEqual([
      "• RNA polymerase (1)",
      "Guidance:",
      "  - do not accept DNA polymerase",
      "  - do not accept helicase",
      "  - do not accept 'polymerase' on its own.",
    ]);
  });

  test("a short label before a point is bold", () => {
    expect(layoutMarkScheme(SHAPES.labelledLines).map((r) => r.label)).toEqual([
      "Cornea:",
      "Lens:",
    ]);
  });

  test("labels that belong to each point stay on each point", () => {
    expect(picture(layoutMarkScheme(SHAPES.perItemLabels))).toEqual([
      "(a)",
      "• 0.20 g: hydrochloric acid is in excess (1)",
      "• 0.50 g: magnesium is in excess (1).",
    ]);
  });

  test("in a scheme that bullets its points, an unbulleted line is guidance", () => {
    expect(picture(layoutMarkScheme(SHAPES.bulletedSchemeWithNotes))).toEqual([
      "Award up to 2 marks:",
      "• two Cl⁻ ions are needed to balance the 2+ charge on one Mg²⁺ ion (1 mark)",
      "• correct final formula MgCl₂ (1 mark)",
      "The correct formula MgCl₂ with no working scores 1 mark only.",
      "Do not accept Mg₂Cl.",
    ]);
  });

  test("a value in brackets is not a credit to split at", () => {
    const points = layoutMarkScheme(SHAPES.valueNotCredit).filter((r) => r.kind === "point");
    expect(points).toHaveLength(2);
    expect(points[0].text).toContain("(6), e.g. 2 Al³⁺ give 6+ (1 mark)");
  });

  test("a semicolon before a point's credit is inside the point", () => {
    expect(picture(layoutMarkScheme(SHAPES.semicolonInsideAPoint))).toEqual([
      "(b)",
      "• The male could be Bb and by chance passed on only B (1).",
      "• Cross him with the brown female again and look for brown offspring; if any are brown the male is Bb (1).",
    ]);
  });

  test("credits split by commas, as the showcase writes them", () => {
    expect(picture(layoutMarkScheme(SHAPES.showcase))).toEqual([
      "• Interphase (1)",
      "• mitosis (1)",
      "• cytokinesis (1).",
      "Correct order required.",
    ]);
  });
});

describe("the layout the generator is asked for", () => {
  const canonical = [
    "Indicative content:",
    "- The cornea refracts light entering the eye (1)",
    "- The lens changes shape to focus light on the retina (1)",
    "(a)",
    "- Light is focused in front of the retina (1)",
    "(b)",
    "- A concave lens diverges the light (1)",
    "Levels:",
    "- Level 2 (3–4 marks): explains both defects with their correction.",
    "- Level 1 (1–2 marks): describes one defect.",
    "- 0 marks: no relevant content.",
    "Guidance:",
    "- Accept 'diverging lens' for concave lens.",
    "- Do not accept 'convex lens' for (b).",
  ].join("\n");

  test("reads exactly as written: headings, then their bullets", () => {
    expect(picture(layoutMarkScheme(canonical))).toEqual([
      "Indicative content:",
      "• The cornea refracts light entering the eye (1)",
      "• The lens changes shape to focus light on the retina (1)",
      "(a)",
      "• Light is focused in front of the retina (1)",
      "(b)",
      "• A concave lens diverges the light (1)",
      "Levels:",
      "• Level 2 (3–4 marks): explains both defects with their correction.",
      "• Level 1 (1–2 marks): describes one defect.",
      "• 0 marks: no relevant content.",
      "Guidance:",
      "• Accept 'diverging lens' for concave lens.",
      "• Do not accept 'convex lens' for (b).",
    ]);
  });

  test("its bullets survive the notation pass every generated question goes through", () => {
    const typed = "- Mg2+ and Cl- ions form (1)\n- The formula is MgCl2 (1)";
    expect(toSciNotation(typed)).toBe("- Mg²⁺ and Cl⁻ ions form (1)\n- The formula is MgCl₂ (1)");
  });

  test("written questions are asked for it, and MCQs are not", () => {
    const context = {
      point: { title: "Defects of vision", code: "2.17B" },
      guidance: [],
      examples: [],
    } as unknown as Parameters<typeof buildGenerationPrompt>[0];
    expect(buildGenerationPrompt(context, 5, "written").user).toContain(MARK_SCHEME_LAYOUT);
    expect(buildGenerationPrompt(context, 8, "mcq").user).not.toContain(MARK_SCHEME_LAYOUT);
  });
});
