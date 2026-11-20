import { describe, expect, test } from "bun:test";
import {
  answerChunks,
  chunkContext,
  cutByMarks,
  marksOver,
  paintTutorMark,
  parseTutorMarks,
  snapToChunks,
  type TutorMark,
} from "@/lib/homework/tutorMarks";
import { toSciNotation } from "@/lib/platform/sciNotation";

/**
 * A tutor draws over a student's answer with two pens. The marks are kept as
 * places in the answer as stored, and a selection is rounded out to whole
 * words, because the page shows notation the answer does not hold.
 */

const ANSWER = "The cell wall is made of chitin and has no nucleus";
const mark = (quote: string, kind: TutorMark["kind"] = "highlight"): TutorMark => {
  const from = ANSWER.indexOf(quote);
  return { from, to: from + quote.length, kind, quote };
};

describe("reading the stored marks", () => {
  test("keeps the marks that fit the answer, in order", () => {
    const stored = [mark("no nucleus", "underline"), mark("cell wall")];
    expect(parseTutorMarks(stored, ANSWER)).toEqual([
      mark("cell wall"),
      mark("no nucleus", "underline"),
    ]);
  });

  test("drops a mark whose words are not where it says", () => {
    const moved = { ...mark("cell wall"), from: 5, to: 14 };
    expect(parseTutorMarks([moved, mark("chitin")], ANSWER)).toEqual([mark("chitin")]);
  });

  test("drops anything malformed, and a mark lying over an earlier one", () => {
    const stored = [
      null,
      "cell wall",
      { ...mark("chitin"), kind: "circle" },
      { from: 4.5, to: 9, kind: "highlight", quote: "cell" },
      mark("cell wall is"),
      mark("wall is made", "underline"),
    ];
    expect(parseTutorMarks(stored, ANSWER)).toEqual([mark("cell wall is")]);
  });

  test("nothing stored, or no answer, is no marks", () => {
    expect(parseTutorMarks(null, ANSWER)).toEqual([]);
    expect(parseTutorMarks({ from: 0 }, ANSWER)).toEqual([]);
    expect(parseTutorMarks([mark("chitin")], null)).toEqual([]);
  });
});

describe("drawing with a pen", () => {
  const span = (quote: string) => ({ from: mark(quote).from, to: mark(quote).to });

  test("a pen marks the words picked", () => {
    expect(paintTutorMark([], span("chitin"), "underline", ANSWER)).toEqual([
      mark("chitin", "underline"),
    ]);
  });

  test("a new mark replaces what it covers and leaves the rest", () => {
    const before = [mark("cell wall is made")];
    expect(paintTutorMark(before, span("wall is"), "underline", ANSWER)).toEqual([
      mark("cell "),
      mark("wall is", "underline"),
      mark(" made"),
    ]);
  });

  test("the rubber takes out only the words picked", () => {
    const before = [mark("cell wall"), mark("no nucleus", "underline")];
    expect(paintTutorMark(before, span("wall"), null, ANSWER)).toEqual([
      mark("cell "),
      mark("no nucleus", "underline"),
    ]);
    expect(paintTutorMark(before, span("The cell wall is"), null, ANSWER)).toEqual([
      mark("no nucleus", "underline"),
    ]);
  });

  test("two runs of the same pen that touch become one", () => {
    const before = [mark("cell ")];
    expect(paintTutorMark(before, span("wall"), "highlight", ANSWER)).toEqual([mark("cell wall")]);
    // A different pen stays its own mark.
    expect(paintTutorMark(before, span("wall"), "underline", ANSWER)).toEqual([
      mark("cell "),
      mark("wall", "underline"),
    ]);
  });
});

describe("cutting a stretch of the answer by its marks", () => {
  test("each piece carries the pen over it", () => {
    const marks = [mark("cell wall"), mark("chitin", "underline")];
    const pieces = cutByMarks({ from: 0, to: ANSWER.length }, marks).map((p) => [
      ANSWER.slice(p.from, p.to),
      p.pen,
    ]);
    expect(pieces).toEqual([
      ["The ", undefined],
      ["cell wall", "highlight"],
      [" is made of ", undefined],
      ["chitin", "underline"],
      [" and has no nucleus", undefined],
    ]);
  });

  test("a mark that runs past the stretch is cut to it", () => {
    const marks = [mark("cell wall is made")];
    const cell = { from: mark("wall").from, to: mark("wall is").to };
    expect(cutByMarks(cell, marks)).toEqual([{ ...cell, pen: "highlight" }]);
    expect(marksOver(cell, marks)).toBe(true);
    expect(marksOver({ from: 0, to: 3 }, marks)).toBe(false);
  });
});

describe("the pieces a pen picks up", () => {
  const pieces = (text: string, context = "") =>
    answerChunks(text, context).map((c) => text.slice(c.from, c.to));
  /** The pieces drawn one by one, as the marking screen draws them. */
  const drawn = (text: string, context = "") =>
    answerChunks(text, context)
      .map((c) => toSciNotation(text.slice(c.from, c.to), chunkContext(text, context)))
      .join("");

  test("ordinary words, and the gaps between them", () => {
    expect(pieces("Water moves  by osmosis.")).toEqual([
      "Water",
      " ",
      "moves",
      "  ",
      "by",
      " ",
      "osmosis.",
    ]);
  });

  test("a formula is one piece and reads as it does in the whole answer", () => {
    const text = "It makes H2O and CO2";
    expect(pieces(text)).toEqual(["It", " ", "makes", " ", "H2O", " ", "and", " ", "CO2"]);
    expect(drawn(text)).toBe(toSciNotation(text));
  });

  test("pieces that only read right together stay together", () => {
    for (const text of [
      "an area of 5 m2 in total",
      "Mg + O2 -> MgO",
      "a speed of 3.0 x 10-3 m per s",
      "the ion SO4 2- is formed",
      "heated to 25 oC then cooled",
      "density is 2 kg m-3 here",
    ]) {
      expect(drawn(text)).toBe(toSciNotation(text));
    }
    expect(pieces("an area of 5 m2 in total")).toContain("5 m2");
    expect(pieces("Mg + O2 -> MgO")).toContain(" -> ");
  });

  test("only the pieces that belong together are joined, not the sentence around them", () => {
    expect(pieces("a speed of 3.0 x 10-3 m per s")).toEqual([
      "a",
      " ",
      "speed",
      " ",
      "of",
      " ",
      "3.0 x 10-3",
      " ",
      "m",
      " ",
      "per",
      " ",
      "s",
    ]);
    expect(pieces("It is heated to 25 oC then cooled")).toEqual([
      "It",
      " ",
      "is",
      " ",
      "heated",
      " ",
      "to",
      " ",
      "25 oC",
      " ",
      "then",
      " ",
      "cooled",
    ]);
    expect(pieces("2Mg + O2 -> 2MgO. It burns")).toEqual([
      "2Mg",
      " ",
      "+",
      " ",
      "O2",
      " -> ",
      "2MgO.",
      " ",
      "It",
      " ",
      "burns",
    ]);
    expect(pieces("the ion SO4 2- is formed")).toEqual([
      "the",
      " ",
      "ion",
      " ",
      "SO4 2-",
      " ",
      "is",
      " ",
      "formed",
    ]);
  });

  test("read with the question, as the whole answer is", () => {
    const question = "Chlorine, Cl2, reacts with sodium.";
    const text = "The Cl2 gains electrons to form Cl-";
    expect(drawn(text, question)).toBe(toSciNotation(text, question));
  });

  test("an empty answer has no pieces", () => {
    expect(answerChunks("")).toEqual([]);
  });

  test("a selection is rounded to whole words, gaps at the ends left out", () => {
    const chunks = answerChunks("the cell wall");
    expect(snapToChunks(chunks.slice(1, 5))).toEqual({ from: 4, to: 13 });
    expect(snapToChunks(chunks.slice(1, 4))).toEqual({ from: 4, to: 8 });
    expect(snapToChunks(chunks.slice(1, 2))).toBeNull();
    expect(snapToChunks([])).toBeNull();
  });
});
