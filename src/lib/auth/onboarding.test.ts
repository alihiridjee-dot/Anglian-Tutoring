import { describe, expect, test } from "bun:test";
import { knownMainBoard } from "./onboarding";

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
