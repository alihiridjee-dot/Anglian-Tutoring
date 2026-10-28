import { describe, expect, test } from "bun:test";
import { answerReadings, flipSign } from "./practiceAnswer";

describe("answerReadings", () => {
  test.each([
    ["-180", [-180]],
    ["−180", [-180]],
    ["–180", [-180]],
    [" 4.5 ", [4.5]],
    ["4,2", [4.2]],
    ["-0,5", [-0.5]],
    ["0,500", [0.5]],
    ["1,234,567", [1234567]],
    ["1,234.5", [1234.5]],
    ["4 200", [4200]],
    ["+3", [3]],
    ["2.5e3", [2500]],
  ])("%p reads as %p", (text, values) => {
    expect(answerReadings(text)).toEqual(values);
  });

  // A phone that types a decimal comma writes 1.250 as "1,250".
  test.each([
    ["1,250", [1.25, 1250]],
    ["4,200", [4.2, 4200]],
    ["-12,500", [-12.5, -12500]],
  ])("%p could be either, so both readings count", (text, values) => {
    expect(answerReadings(text)).toEqual(values);
  });

  test.each(["", "  ", "abc", "-", "4.2.1", "1,2,3.4.5"])("%p is not a number", (text) => {
    expect(answerReadings(text)).toEqual([]);
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
