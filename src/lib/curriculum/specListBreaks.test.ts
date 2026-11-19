import { describe, expect, test } from "bun:test";
import { breakSpecList } from "./specListBreaks";

describe("breakSpecList", () => {
  test("lettered parts run into one sentence go one per line", () => {
    expect(
      breakSpecList(
        "Explain how pathogens are spread, including: (a) cholera (bacteria) – water (b) tuberculosis (bacteria) – airborne (c) Ebola (virus) – body fluids",
      ),
    ).toBe(
      "Explain how pathogens are spread, including:\n(a) cholera (bacteria) – water\n(b) tuberculosis (bacteria) – airborne\n(c) Ebola (virus) – body fluids",
    );
  });

  test("numbered parts, with the joining 'and' dropped", () => {
    expect(breakSpecList("Calculations of pH for: (i) strong acids; and (ii) strong bases.")).toBe(
      "Calculations of pH for:\n(i) strong acids;\n(ii) strong bases.",
    );
  });

  test("a list inside a part is indented under it", () => {
    expect(breakSpecList("Reactions: (a) addition of (i) hydrogen (ii) steam (b) oxidation")).toBe(
      "Reactions:\n(a) addition of\n    (i) hydrogen\n    (ii) steam\n(b) oxidation",
    );
  });

  test("bullets between spaces split; a formula's dot does not", () => {
    expect(breakSpecList("Understand the terms: • shells • orbitals")).toBe(
      "Understand the terms:\n• shells\n• orbitals",
    );
    const hydrate = "Define water of crystallisation, including CuSO4•5H2O and CoCl2•6H2O";
    expect(breakSpecList(hydrate)).toBe(hydrate);
  });

  test("what isn't a list is left alone", () => {
    for (const text of [
      "Recall the reaction: (a) the condensation reaction between an alcohol and an acid.",
      "Describe iron(ii) and iron(iii) ions",
      "Recall the speed of light (c) and the charge (b) on it",
      "Explain thermoregulation (HT only: b and c)",
      "Already laid out:\n(a) one (b) two",
      "",
    ]) {
      expect(breakSpecList(text)).toBe(text);
    }
    expect(breakSpecList(null)).toBe("");
  });
});
