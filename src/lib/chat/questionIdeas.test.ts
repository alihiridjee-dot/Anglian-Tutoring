import { describe, expect, test } from "bun:test";
import { parseIdeasReply, weakestPoints } from "./questionIdeas";

const mark = (specPointId: string, pct: number, at: string) => ({ specPointId, pct, at });

describe("weakestPoints", () => {
  test("worst first, and only below the bar", () => {
    expect(
      weakestPoints([
        mark("osmosis", 40, "2026-10-01T10:00:00Z"),
        mark("enzymes", 90, "2026-10-01T10:00:00Z"),
        mark("cells", 10, "2026-10-02T10:00:00Z"),
        mark("ions", 69, "2026-10-02T10:00:00Z"),
        mark("bonds", 70, "2026-10-02T10:00:00Z"),
      ]),
    ).toEqual(["cells", "osmosis", "ions"]);
  });

  test("a topic put right since drops out; one gone wrong since comes in", () => {
    expect(
      weakestPoints([
        mark("osmosis", 20, "2026-09-01T10:00:00Z"),
        mark("osmosis", 85, "2026-10-01T10:00:00Z"),
        mark("cells", 95, "2026-09-01T10:00:00Z"),
        mark("cells", 30, "2026-10-01T10:00:00Z"),
      ]),
    ).toEqual(["cells"]);
  });

  test("ties go to the more recent mark, and the limit holds", () => {
    expect(
      weakestPoints(
        [
          mark("a", 0, "2026-09-01T10:00:00Z"),
          mark("b", 0, "2026-10-01T10:00:00Z"),
          mark("c", 0, "2026-09-15T10:00:00Z"),
        ],
        2,
      ),
    ).toEqual(["b", "c"]);
  });

  test("marks it can't read are skipped", () => {
    expect(
      weakestPoints([mark("a", Number.NaN, "2026-10-01"), mark("b", 10, "not a date")]),
    ).toEqual([]);
  });
});

describe("parseIdeasReply", () => {
  test("one question per topic, in order, notation tidied", () => {
    expect(
      parseIdeasReply(
        JSON.stringify({
          questions: [
            "Why does water move out of a cell in salty water?",
            "  How do I balance   CH4 + O2 equations? ",
          ],
        }),
        2,
      ),
    ).toEqual([
      "Why does water move out of a cell in salty water?",
      "How do I balance CH₄ + O₂ equations?",
    ]);
  });

  test("a missing, empty or rambling slot leaves just that topic out", () => {
    expect(parseIdeasReply(JSON.stringify({ questions: ["", "x".repeat(400), 7] }), 4)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  test("surrounding quotes go", () => {
    expect(parseIdeasReply(JSON.stringify({ questions: ["“What is a moment?”"] }), 1)).toEqual([
      "What is a moment?",
    ]);
  });

  test("anything but the JSON asked for gives nothing", () => {
    expect(parseIdeasReply("Sure! Here are some questions", 2)).toEqual([null, null]);
    expect(parseIdeasReply("null", 1)).toEqual([null]);
    expect(parseIdeasReply(JSON.stringify({ questions: "one" }), 1)).toEqual([null]);
  });
});
