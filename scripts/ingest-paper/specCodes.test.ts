import { describe, expect, test } from "bun:test";
import { bareCode, indexSpecPoints, PAPER_STEM } from "./specCodes";

describe("bareCode", () => {
  test("drops each curriculum's prefix, however many words it is", () => {
    expect(bareCode("AQA 4.1.1.1")).toBe("4.1.1.1");
    expect(bareCode("AQA T 4.1.1.1")).toBe("4.1.1.1");
    expect(bareCode("EDEX 1.1")).toBe("1.1");
    expect(bareCode("IGCSE 1.2P")).toBe("1.2P");
    expect(bareCode("CAIE 1.1.1S")).toBe("1.1.1S");
    expect(bareCode("OXAQA 3.10.3.3aC")).toBe("3.10.3.3aC");
  });

  test("keeps a letter that belongs to the code, not the board", () => {
    expect(bareCode("OCR C1.1a")).toBe("C1.1a");
    expect(bareCode("OCR P1.1a")).toBe("P1.1a");
  });
});

describe("indexSpecPoints", () => {
  test("finds a point by the code a tag writes", () => {
    const byCode = indexSpecPoints([
      { id: "a", code: "CAIE 1.1.1" },
      { id: "b", code: "CAIE 1.1.1S" },
    ]);
    expect(byCode.get("1.1.1")).toBe("a");
    expect(byCode.get("1.1.1S")).toBe("b");
    expect(byCode.get("CAIE 1.1.1")).toBeUndefined();
  });

  test("refuses to guess between two points with the same bare code", () => {
    expect(() =>
      indexSpecPoints([
        { id: "a", code: "AQA 1.6" },
        { id: "b", code: "AQA T 1.6" },
      ]),
    ).toThrow('"1.6"');
  });
});

describe("PAPER_STEM", () => {
  const parse = (stem: string) => stem.match(PAPER_STEM)?.slice(1);

  test("reads the names the renamer gives", () => {
    expect(parse("aqa-biology-gcse-2018-p1F")).toEqual([
      "aqa",
      "biology",
      "gcse",
      "2018",
      "1",
      "F",
    ]);
    expect(parse("ocr-physics-gcse-2018-p1")).toEqual(["ocr", "physics", "gcse", "2018", "1", ""]);
  });

  test("reads a board with an underscore", () => {
    expect(parse("oxford_aqa-physics-igcse-2024-p1")?.[0]).toBe("oxford_aqa");
  });

  test("keeps an Edexcel iGCSE R paper apart from its partner", () => {
    expect(parse("edexcel-biology-igcse-2019-p1B")?.[5]).toBe("B");
    expect(parse("edexcel-biology-igcse-2019-p1BR")?.[5]).toBe("BR");
  });
});
