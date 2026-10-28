import { describe, expect, test } from "bun:test";
import { flipSign, parseAnswer } from "./practiceAnswer";

describe("parseAnswer", () => {
  test.each([
    ["-180", -180],
    ["−180", -180],
    ["–180", -180],
    [" 4.5 ", 4.5],
    ["4,2", 4.2],
    ["-0,5", -0.5],
    ["4,200", 4200],
    ["0,500", 0.5],
    ["1,234,567", 1234567],
    ["1,234.5", 1234.5],
    ["4 200", 4200],
    ["+3", 3],
    ["2.5e3", 2500],
  ])("%p reads as %p", (text, value) => {
    expect(parseAnswer(text)).toBe(value);
  });

  test.each(["", "  ", "abc", "-", "4.2.1", "1,2,3.4.5"])("%p is not a number", (text) => {
    expect(Number.isNaN(parseAnswer(text))).toBe(true);
  });
});

describe("flipSign", () => {
  test("adds a minus, and takes it off again", () => {
    expect(flipSign("180")).toBe("-180");
    expect(flipSign("-180")).toBe("180");
    expect(flipSign("−180")).toBe("180");
    expect(flipSign("")).toBe("-");
  });
});
