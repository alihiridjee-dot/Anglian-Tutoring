import { describe, expect, test } from "bun:test";
import type { Note } from "@/lib/notes/noteFormat";
import { MAX_ANSWER_CHARS, MAX_NOTE_CHARS, noteText, parseExplainReply } from "./helpExplain";

const note = {
  title: "Osmosis",
  key_idea: "Water moves from a **dilute** solution to a concentrated one.",
  sections: [
    {
      heading: "What it is",
      blocks: [
        { type: "paragraph", text: "Osmosis is the diffusion of **water**." },
        { type: "list", items: ["Needs a partially permeable membrane"] },
        { type: "definitions", items: [{ term: "Dilute", meaning: "lots of water" }] },
        { type: "equation", label: "Rate", formula: "rate = 1 / time", where: ["time is in s"] },
        { type: "steps", items: [{ lead: "Cut", text: "the potato." }] },
        { type: "table", columns: ["Solution", "Change"], rows: [["Dilute", "Gains mass"]] },
        { type: "diagram", diagram: { kind: "figure" } },
      ],
    },
  ],
} as unknown as Note;

describe("noteText", () => {
  test("every kind of block becomes plain lines, pictures left out", () => {
    expect(noteText(note)).toBe(
      [
        "Osmosis",
        "Water moves from a dilute solution to a concentrated one.",
        "",
        "## What it is",
        "Osmosis is the diffusion of water.",
        "- Needs a partially permeable membrane",
        "- Dilute: lots of water",
        "Rate: rate = 1 / time",
        "  where time is in s",
        "1. Cut the potato.",
        "Solution | Change",
        "Dilute | Gains mass",
      ].join("\n"),
    );
  });

  test("a very long note is cut", () => {
    const long = { ...note, key_idea: "x".repeat(MAX_NOTE_CHARS * 2) } as Note;
    expect(noteText(long).length).toBe(MAX_NOTE_CHARS);
  });
});

describe("parseExplainReply", () => {
  test("a short answer comes through, tidied", () => {
    expect(
      parseExplainReply(
        '{"answer": "Water moves into the cell\\nbecause **H2O** is more dilute outside."}',
      ),
    ).toBe("Water moves into the cell because H₂O is more dilute outside.");
  });

  test.each([
    '{"answer": null}',
    '{"answer": "No."}',
    '{"answer": 4}',
    "Water moves by osmosis.",
    "",
    JSON.stringify({ answer: "x".repeat(MAX_ANSWER_CHARS + 1) }),
  ])("no answer worth showing: %s", (reply) => {
    expect(parseExplainReply(reply)).toBeNull();
  });
});
