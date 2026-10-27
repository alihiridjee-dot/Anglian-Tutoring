import { describe, expect, test } from "bun:test";
import { examKitFor } from "@/lib/examKit/examKit";
import { EQUATION_SHEETS } from "@/lib/examKit/equationSheets";
import { PERIODIC_SHEETS, sheetCells } from "@/lib/examKit/periodicTable";

/**
 * The kit gives what the exam room gives, checked against the boards' own
 * papers, inserts and sheets (October 2026).
 */
describe("examKitFor", () => {
  test("biology papers give a calculator and nothing else", () => {
    for (const [board, level] of [
      ["aqa", "gcse"],
      ["edexcel", "gcse"],
      ["cambridge", "igcse"],
      ["edexcel", "igcse"],
    ] as const)
      expect(examKitFor("biology", board, level).tools).toEqual(["calculator"]);
  });

  test("chemistry papers print the board's own periodic table", () => {
    expect(examKitFor("chemistry", "aqa", "gcse").periodic?.label).toBe("AQA GCSE");
    expect(examKitFor("chemistry", "aqa", "gcse_trilogy").periodic?.label).toBe("AQA GCSE");
    expect(examKitFor("chemistry", "edexcel", "gcse").periodic?.label).toBe("Edexcel GCSE");
    expect(examKitFor("chemistry", "ocr", "gcse").periodic?.label).toBe("OCR GCSE");
    expect(examKitFor("chemistry", "cambridge", "igcse").periodic?.label).toBe("Cambridge IGCSE");
    expect(examKitFor("chemistry", "edexcel", "igcse").periodic?.label).toBe(
      "Edexcel International GCSE",
    );
    expect(examKitFor("chemistry", "edexcel", "gcse").tools).toEqual(["calculator", "periodic"]);
  });

  test("physics papers come with a sheet only where the board prints one", () => {
    expect(examKitFor("physics", "aqa", "gcse").equations).toBe(EQUATION_SHEETS.aqa);
    expect(examKitFor("physics", "aqa", "gcse_trilogy").equations).toBe(
      EQUATION_SHEETS.aqaCombined,
    );
    expect(examKitFor("physics", "edexcel", "gcse").equations).toBe(EQUATION_SHEETS.edexcel);
    expect(examKitFor("physics", "ocr", "gcse").equations).toBe(EQUATION_SHEETS.ocr);
    expect(examKitFor("physics", "edexcel", "igcse").equations).toBe(EQUATION_SHEETS.edexcelIgcse);
    // Cambridge IGCSE students recall every equation.
    expect(examKitFor("physics", "cambridge", "igcse").tools).toEqual(["calculator"]);
  });

  test("nothing is guessed for A-level or a brief with no board", () => {
    expect(examKitFor("chemistry", "aqa", "alevel").tools).toEqual(["calculator"]);
    expect(examKitFor("physics", "ocr", "alevel").tools).toEqual(["calculator"]);
    expect(examKitFor("physics", null, "gcse").tools).toEqual(["calculator"]);
  });
});

describe("equation sheets", () => {
  test("every equation in each board's specification, Higher-only ones marked", () => {
    const count = (k: keyof typeof EQUATION_SHEETS) => EQUATION_SHEETS[k].equations.length;
    const higher = (k: keyof typeof EQUATION_SHEETS) =>
      EQUATION_SHEETS[k].equations.filter((q) => q.only === "Higher").length;
    expect([count("aqa"), higher("aqa")]).toEqual([35, 6]);
    expect([count("aqaCombined"), higher("aqaCombined")]).toEqual([28, 3]);
    expect([count("edexcel"), higher("edexcel")]).toEqual([33, 5]);
    expect([count("ocr"), higher("ocr")]).toEqual([30, 4]);
    const igcse = EQUATION_SHEETS.edexcelIgcse.equations;
    expect([igcse.length, igcse.filter((q) => q.only === "Paper 2").length]).toEqual([32, 7]);
  });

  test("fractions are well formed", () => {
    for (const sheet of Object.values(EQUATION_SHEETS))
      for (const q of sheet.equations)
        for (const text of [q.word, q.symbol]) {
          const opens = (text.match(/\{/g) ?? []).length;
          expect((text.match(/\}/g) ?? []).length).toBe(opens);
          expect((text.match(/\{[^{}|]+\|[^{}]+\}/g) ?? []).length).toBe(opens);
        }
  });
});

describe("periodic tables", () => {
  const mass = (k: keyof typeof PERIODIC_SHEETS, z: number) => PERIODIC_SHEETS[k].masses[z];

  test("chlorine and copper as each board prints them", () => {
    expect([mass("aqa", 17), mass("aqa", 29)]).toEqual(["35.5", "63.5"]);
    expect([mass("edexcel", 17), mass("edexcel", 29)]).toEqual(["35.5", "63.5"]);
    expect([mass("cambridgeIgcse", 17), mass("cambridgeIgcse", 29)]).toEqual(["35.5", "64"]);
    expect([mass("ocr", 17), mass("ocr", 26), mass("ocr", 29)]).toEqual(["35.5", "55.8", "63.5"]);
  });

  test("the elements with no stable isotope", () => {
    expect(mass("aqa", 43)).toBe("[97]");
    expect(mass("edexcel", 43)).toBe("[98]");
    expect(mass("cambridgeIgcse", 43)).toBe("–");
    expect(mass("ocr", 43)).toBe("");
    expect(mass("aqa", 118)).toBe("[294]");
  });

  test("CaCO₃ sums to 100 on whole-number sheets and 100.1 on OCR's", () => {
    const mr = (k: keyof typeof PERIODIC_SHEETS) =>
      Number(mass(k, 20)) + Number(mass(k, 6)) + 3 * Number(mass(k, 8));
    expect(mr("aqa")).toBe(100);
    expect(mr("cambridgeIgcse")).toBe(100);
    expect(Math.round(mr("ocr") * 10) / 10).toBe(100.1);
  });

  test("every printed cell has a mass but OCR's blanks", () => {
    for (const [k, sheet] of Object.entries(PERIODIC_SHEETS))
      for (const c of sheetCells(sheet))
        if (c.element && k !== "ocr") expect(sheet.masses[c.element.z]).toBeTruthy();
  });

  test("each sheet prints the elements its paper prints", () => {
    const zs = (k: keyof typeof PERIODIC_SHEETS) =>
      sheetCells(PERIODIC_SHEETS[k]).flatMap((c) => (c.element ? [c.element.z] : []));
    // Up to oganesson, La and Ac in group 3, the rest of the f-block left out.
    expect(zs("aqa").length).toBe(118 - 28);
    expect(Math.max(...zs("edexcel"))).toBe(86);
    expect(zs("edexcelIgcse").length).toBe(111 - 28);
    // Cambridge prints every element, the f-block in rows underneath.
    expect(zs("cambridgeIgcse").length).toBe(118);
    // OCR stops at livermorium, without 113 or 115, and no f-block at all.
    const ocr = zs("ocr");
    expect(Math.max(...ocr)).toBe(116);
    expect(ocr.includes(113) || ocr.includes(115) || ocr.includes(57)).toBe(false);
  });

  test("no two cells share a place", () => {
    for (const sheet of Object.values(PERIODIC_SHEETS)) {
      const places = sheetCells(sheet).map((c) => `${c.row}:${c.col}`);
      expect(new Set(places).size).toBe(places.length);
    }
  });
});
