import { describe, expect, test } from "bun:test";
import { flattenedLayout, rowOptions, textBlocks } from "./textBlocks";

const lines = (...l: string[]) => l.join("\n");

describe("question text as paragraphs and tables", () => {
  test("a key keeps its lines, between the paragraphs around it", () => {
    const q = lines(
      "A dichotomous key is shown below.",
      "",
      "1a Has legs - go to 2",
      "1b No legs - earthworm",
      "",
      "Which organism has no legs?",
    );
    expect(textBlocks(q)).toEqual([
      { kind: "text", text: "A dichotomous key is shown below." },
      { kind: "text", text: "1a Has legs - go to 2\n1b No legs - earthworm" },
      { kind: "text", text: "Which organism has no legs?" },
    ]);
  });

  test("rows of cells become a table, the first row its header", () => {
    const q = lines(
      "The results are shown.",
      "atom | protons | neutrons",
      "P | 3 | 4",
      "Q | 11 | 12",
    );
    expect(textBlocks(q)).toEqual([
      { kind: "text", text: "The results are shown." },
      {
        kind: "table",
        columns: ["atom", "protons", "neutrons"],
        rows: [
          ["P", "3", "4"],
          ["Q", "11", "12"],
        ],
      },
    ]);
  });

  test("blank cells stay blank: a table to complete", () => {
    const q = lines("particle | relative charge | relative mass", "proton | |", "electron | | ");
    expect(textBlocks(q)).toEqual([
      {
        kind: "table",
        columns: ["particle", "relative charge", "relative mass"],
        rows: [
          ["proton", "", ""],
          ["electron", "", ""],
        ],
      },
    ]);
  });

  test("fenced rows and a Markdown rule row are read the same way", () => {
    const q = lines(
      "| | Trial 1 | Trial 2 |",
      "| --- | --- | --- |",
      "| Temperature in °C | 37.6 | 37.2 |",
    );
    expect(textBlocks(q)).toEqual([
      {
        kind: "table",
        columns: ["", "Trial 1", "Trial 2"],
        rows: [["Temperature in °C", "37.6", "37.2"]],
      },
    ]);
  });

  test("a short row is padded to the header; a row with more cells keeps its lines", () => {
    expect(textBlocks(lines("a | b | c", "1 | 2"))).toEqual([
      { kind: "table", columns: ["a", "b", "c"], rows: [["1", "2", ""]] },
    ]);
    const ragged = lines("a | b", "1 | 2 | 3");
    expect(textBlocks(ragged)).toEqual([{ kind: "text", text: ragged }]);
  });

  test("rows that each name themselves stay lines rather than a muddled table", () => {
    const q = lines("Age in years: 37–39 | 48–72", "mean number of sperm in millions: 202 | 142");
    expect(textBlocks(q)).toEqual([{ kind: "text", text: q }]);
  });

  test("a lone row of headings, or a pipe in a formula, is ordinary text", () => {
    expect(textBlocks("arrangement | separation | motion")).toEqual([
      { kind: "text", text: "arrangement | separation | motion" },
    ]);
    expect(textBlocks("The magnitude |F| is 5 N.")).toEqual([
      { kind: "text", text: "The magnitude |F| is 5 N." },
    ]);
  });

  test("Windows line endings read the same", () => {
    expect(textBlocks("one\r\ntwo\r\n\r\nthree")).toEqual([
      { kind: "text", text: "one\ntwo" },
      { kind: "text", text: "three" },
    ]);
  });
});

describe("layout a generated question must keep", () => {
  test("a key run into one line is caught; a key one statement per line is fine", () => {
    expect(flattenedLayout("Key: 1a Has legs - go to 2 1b No legs - earthworm")).toMatch(
      "runs its key into one line",
    );
    expect(flattenedLayout(lines("1a Has legs - go to 2", "1b No legs - earthworm"))).toBeNull();
    // Statements named in a sentence are not a key.
    expect(flattenedLayout("Which pair of statements, 1a or 1b, is wrong?")).toBeNull();
  });

  test("rows that can't be drawn as a table are caught; a heading row alone is not", () => {
    expect(flattenedLayout(lines("a | b", "1 | 2 | 3"))).toMatch("has a table that can't be drawn");
    expect(flattenedLayout(lines("a | b", "1 | 2"))).toBeNull();
    expect(flattenedLayout(lines("Which row is correct?", "", "P | Q | R"))).toBeNull();
  });
});

describe("Which row…? questions", () => {
  const options = [
    "gas | liquid | solid",
    "liquid | gas | solid",
    "gas | solid | liquid",
    "solid | liquid | gas",
  ];

  test("headings ending the question, with every option a row, make a table of options", () => {
    expect(rowOptions(lines("Which row identifies P, Q and R?", "", "P | Q | R"), options)).toEqual(
      {
        question: "Which row identifies P, Q and R?",
        columns: ["P", "Q", "R"],
        rows: options.map((o) => o.split(" | ")),
      },
    );
  });

  test("any other question keeps its options as they are", () => {
    expect(rowOptions("Which state is P?", ["gas", "liquid", "solid", "plasma"])).toBeNull();
    // An option that isn't a row of this table.
    expect(
      rowOptions(lines("Which row?", "P | Q | R"), [...options.slice(0, 3), "gas"]),
    ).toBeNull();
    // A question whose last lines are a whole table.
    expect(rowOptions(lines("Results:", "P | Q | R", "1 | 2 | 3"), options)).toBeNull();
  });
});
