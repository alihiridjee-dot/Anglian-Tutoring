import { describe, expect, test } from "bun:test";
import { noteLevelsFor } from "./globalSearch";

describe("noteLevelsFor", () => {
  test("each course searches the notes it reads", () => {
    expect(noteLevelsFor("gcse")).toEqual(["gcse"]);
    expect(noteLevelsFor("gcse_trilogy")).toEqual(["gcse"]);
    expect(noteLevelsFor("igcse")).toEqual(["gcse", "igcse"]);
    expect(noteLevelsFor("alevel")).toEqual(["alevel"]);
  });
});
