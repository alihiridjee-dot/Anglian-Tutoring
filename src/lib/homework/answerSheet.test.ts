import { describe, expect, it } from "bun:test";
import { answerSheet, blankAnswer, readAnswer, writeAnswer } from "./answerSheet";

const NEON = `Neon has isotopes including neon-20 and neon-22. The atomic number of neon is 10.

Complete the table for a neutral atom of neon-20 and a neutral atom of neon-22.

isotope | number of protons | number of neutrons | number of electrons
neon-20 | | |
neon-22 | | |`;

const GALLIUM = `Gallium has two naturally occurring isotopes, ⁶⁹Ga and ⁷¹Ga.
(a) Complete the table to show the numbers of protons, neutrons and electrons in a ⁶⁹Ga atom and in a ⁷¹Ga³⁺ ion. The atomic number of gallium is 31.
Species | Protons | Neutrons | Electrons
⁶⁹Ga atom | | |
⁷¹Ga³⁺ ion | | |
(b) Explain why the two isotopes of gallium have the same chemical properties.`;

const STATES = `The table lists some physical changes.

Complete the table using words from the box. Each word may be used once, more than once or not at all.

Physical change | Change of state
molten candle wax to solid wax | ______
water vapour on a cold mirror to liquid water | ______`;

describe("answerSheet", () => {
  it("answers a table to complete in its cells, with no lined box", () => {
    const sheet = answerSheet(NEON);
    expect(sheet.boxed).toBe(false);
    expect(sheet.tables).toHaveLength(1);
    expect(sheet.tables[0].gaps).toEqual([
      [false, true, true, true],
      [false, true, true, true],
    ]);
  });

  it("reads a ruled blank as a cell to fill", () => {
    const sheet = answerSheet(STATES);
    expect(sheet.boxed).toBe(false);
    expect(sheet.tables[0].gaps).toEqual([
      [false, true],
      [false, true],
    ]);
  });

  it("keeps the box when another part asks for writing", () => {
    const sheet = answerSheet(GALLIUM);
    expect(sheet.tables).toHaveLength(1);
    expect(sheet.boxed).toBe(true);
  });

  it("keeps the box when the question asks for more than the table", () => {
    const more = `${NEON}\n\nExplain why the two isotopes have the same chemical properties.`;
    expect(answerSheet(more).boxed).toBe(true);
    const data = `${NEON}\n\nUse the table to explain why neon-22 is heavier.`;
    expect(answerSheet(data).boxed).toBe(true);
  });

  it("does not count a note on how to answer as something more", () => {
    const guided = `${NEON}\nUse the periodic table where necessary.\nWrite your answer as two lines.`;
    expect(answerSheet(guided).boxed).toBe(false);
  });

  it("leaves alone a table nobody is asked to complete", () => {
    const results =
      "A student recorded these results.\n\ntime | mass\n0 | 2.0\n10 |\n\nSuggest why one reading is missing.";
    expect(answerSheet(results)).toEqual({ tables: [], boxed: true });
    expect(answerSheet("State the charge on a proton.")).toEqual({ tables: [], boxed: true });
  });
});

describe("writeAnswer and readAnswer", () => {
  const sheet = answerSheet(NEON);
  const filled = {
    cells: [
      [
        ["", "10", "10 ", "10"],
        ["", "10", "12", ""],
      ],
    ],
    text: "",
  };

  it("writes the table as the question writes it, filled in", () => {
    expect(writeAnswer(sheet, filled)).toBe(
      "| isotope | number of protons | number of neutrons | number of electrons |\n" +
        "| neon-20 | 10 | 10 | 10 |\n" +
        "| neon-22 | 10 | 12 |  |",
    );
  });

  it("is blank until a cell is filled", () => {
    expect(writeAnswer(sheet, blankAnswer(sheet))).toBe("");
    expect(writeAnswer(sheet, { ...blankAnswer(sheet), text: "in the box" })).toBe("in the box");
  });

  it("reads back what was written, and where each cell is", () => {
    const text = writeAnswer(sheet, filled);
    const read = readAnswer(sheet, text);
    expect(read.tabled).toBe(true);
    expect(read.cells).toEqual([
      [
        ["", "10", "10", "10"],
        ["", "10", "12", ""],
      ],
    ]);
    expect(read.text).toBe("");
    const at = read.at[0][1][2];
    expect(text.slice(at.from, at.to)).toBe("12");
  });

  it("keeps the box's text after the tables", () => {
    const boxed = answerSheet(GALLIUM);
    const answer = blankAnswer(boxed);
    answer.cells[0][0][1] = "31";
    answer.text = "They have the same electrons.\n\nSo they react alike.";
    const text = writeAnswer(boxed, answer);
    const read = readAnswer(boxed, text);
    expect(read.cells[0][0][1]).toBe("31");
    expect(read.text).toBe(answer.text);
    expect(text.slice(read.textAt.from, read.textAt.to)).toBe(answer.text);
  });

  it("never lets a typed pipe split a cell", () => {
    const answer = blankAnswer(sheet);
    answer.cells[0][0][1] = "10 | 11";
    expect(readAnswer(sheet, writeAnswer(sheet, answer)).cells[0][0][1]).toBe("10 / 11");
  });

  it("reads an answer typed before the cells existed as all box", () => {
    const old = "neon-20: protons 10, neutrons 10, electrons 10";
    const read = readAnswer(sheet, old);
    expect(read.tabled).toBe(false);
    expect(read.text).toBe(old);
    expect(readAnswer(sheet, "").tabled).toBe(false);
  });
});
