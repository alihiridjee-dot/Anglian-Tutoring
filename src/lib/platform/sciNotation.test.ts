import { describe, expect, test } from "bun:test";
import {
  sciRuns,
  scriptTyped,
  toSciNotation,
  toSciNotationTogether,
  toggleScript,
} from "./sciNotation";

const cases = (pairs: [string, string][]) => {
  for (const [input, want] of pairs) expect(toSciNotation(input)).toBe(want);
};

describe("toSciNotation", () => {
  test("formulas take small counts", () => {
    cases([
      ["Cl2", "Cl₂"],
      ["H2O", "H₂O"],
      ["CaCO3", "CaCO₃"],
      ["Al2(SO4)3", "Al₂(SO₄)₃"],
      ["(NH4)2SO4", "(NH₄)₂SO₄"],
      ["C2H4 and (C2H4)n", "C₂H₄ and (C₂H₄)n"],
      ["CH3CH2OH", "CH₃CH₂OH"],
      ["C60", "C₆₀"],
      ["C10H22", "C₁₀H₂₂"],
      ["Mg2O and MgO2", "Mg₂O and MgO₂"],
    ]);
  });

  test("coefficients and state symbols stay full size", () => {
    cases([
      ["2H2 + O2 -> 2H2O", "2H₂ + O₂ → 2H₂O"],
      ["2Cl", "2Cl"],
      ["NaCl(aq) + AgNO3(aq)", "NaCl(aq) + AgNO₃(aq)"],
      ["CO2(g)", "CO₂(g)"],
      ["CuSO4.xH2O and Na2SO4.7H2O", "CuSO₄.xH₂O and Na₂SO₄.7H₂O"],
      ["Mr [Fe2O3] = 160", "Mr [Fe₂O₃] = 160"],
    ]);
  });

  test("ions take a raised charge", () => {
    cases([
      ["Mg2+ and O2-.", "Mg²⁺ and O²⁻."],
      ["Al3+", "Al³⁺"],
      ["Na+, Cl- and H+", "Na⁺, Cl⁻ and H⁺"],
      ["OH-", "OH⁻"],
      ["NO3-", "NO₃⁻"],
      ["NH4+", "NH₄⁺"],
      ["SO4^2-", "SO₄²⁻"],
      ["SO42- and PO43-", "SO₄²⁻ and PO₄³⁻"],
      ["SO42– and O2– (en dashes)", "SO₄²⁻ and O²⁻ (en dashes)"],
      ["Cr2O72–", "Cr₂O₇²⁻"],
      ["2H+ + 2e– → H2", "2H⁺ + 2e⁻ → H₂"],
      ["Fe^{3+}", "Fe³⁺"],
      ["Cu2+ + 2e- -> Cu", "Cu²⁺ + 2e⁻ → Cu"],
    ]);
  });

  test("brackets around a formula are not part of it", () => {
    cases([
      ["ammonia (NH3) gas", "ammonia (NH₃) gas"],
      ["(NH3, a base)", "(NH₃, a base)"],
      ["methane, CH4.", "methane, CH₄."],
    ]);
  });

  test("units and powers", () => {
    cases([
      ["25 cm3 of acid", "25 cm³ of acid"],
      ["0.1 mol/dm3", "0.1 mol/dm³"],
      ["0.1 mol dm-3", "0.1 mol dm⁻³"],
      ["9.8 m/s2", "9.8 m/s²"],
      ["9.8 m s-2", "9.8 m s⁻²"],
      ["1000 kg m-3", "1000 kg m⁻³"],
      ["4200 J kg-1 K-1", "4200 J kg⁻¹ K⁻¹"],
      ["an area of 5 m2", "an area of 5 m²"],
      ["x^2 + y^2", "x² + y²"],
      ["3.0 x 10^8 m/s", "3.0 × 10⁸ m/s"],
      ["2.5 x 10-3 m", "2.5 × 10⁻³ m"],
      ["heated to 25 oC", "heated to 25 °C"],
    ]);
  });

  test("leaves look-alikes alone", () => {
    cases([
      ["Question 2", "Question 2"],
      ["AO1 and AO2", "AO1 and AO2"],
      ["H1N1 flu", "H1N1 flu"],
      ["forces F1 and F2", "forces F1 and F2"],
      ["V2 = (N2/N1) × V1", "V2 = (N2/N1) × V1"],
      ["[B2] speed decreases", "[B2] speed decreases"],
      ["Year 11 in KS4", "Year 11 in KS4"],
      ["set B2 and vitamin B12", "set B2 and vitamin B12"],
      ["masses m1 and m2", "masses m1 and m2"],
      ["v2 = u2 + 2as", "v2 = u2 + 2as"],
      ["Ar = 12 and Mr = 44", "Ar = 12 and Mr = 44"],
      ["A-level, a B+ grade", "A-level, a B+ grade"],
      ["CO2-rich air", "CO₂-rich air"],
      ["SPF30", "SPF30"],
      ["between 2-3 days", "between 2-3 days"],
    ]);
  });

  test("wrong answers are written like the right one", () => {
    expect(
      toSciNotationTogether(["Which is chlorine gas, Cl2?", "Cl", "Cl2", "Cl3", "2Cl"]),
    ).toEqual(["Which is chlorine gas, Cl₂?", "Cl", "Cl₂", "Cl₃", "2Cl"]);
    expect(toSciNotationTogether(["Fe2", "Fe2+", "2Fe+"])).toEqual(["Fe₂", "Fe²⁺", "2Fe⁺"]);
    expect(toSciNotation("Cl3", "Cl₂ is a gas")).toBe("Cl₃");
    expect(toSciNotation("Cl3")).toBe("Cl3");
  });

  test("is safe to run twice", () => {
    const once = toSciNotation("Al2(SO4)3, Mg2+, 25 cm3, 10^-3, SO4^2-");
    expect(toSciNotation(once)).toBe(once);
  });
});

describe("sciRuns", () => {
  test("splits small figures into their own runs, as ordinary characters", () => {
    expect(sciRuns("SO4^2-")).toEqual([
      { text: "SO", kind: "text" },
      { text: "4", kind: "sub" },
      { text: "2−", kind: "sup" },
    ]);
  });

  test("plain text is one run", () => {
    expect(sciRuns("Left blank")).toEqual([{ text: "Left blank", kind: "text" }]);
    expect(sciRuns("")).toEqual([]);
  });
});

describe("toggleScript", () => {
  test("makes a selection small, and a second press undoes it", () => {
    const once = toggleScript("x 10-3", 4, 6, "sup");
    expect(once.value).toBe("x 10⁻³");
    expect(toggleScript(once.value, once.start, once.end, "sup").value).toBe("x 10-3");
    expect(toggleScript("C6H12O6", 0, 7, "sub").value).toBe("C₆H₁₂O₆");
  });

  test("switches a selection between subscript and superscript", () => {
    expect(toggleScript("Mg₂", 2, 3, "sup").value).toBe("Mg²");
  });

  test("with nothing selected it changes nothing: the button holds on instead", () => {
    expect(toggleScript("H2", 2, 2, "sub")).toEqual({ value: "H2", start: 2, end: 2 });
  });
});

describe("scriptTyped", () => {
  test("what is typed while the button is on comes out small", () => {
    expect(scriptTyped("Mg", "Mg2", 3, "sup")).toEqual({ value: "Mg²", done: false });
    expect(scriptTyped("Mg²", "Mg²+", 4, "sup")).toEqual({ value: "Mg²⁺", done: false });
    expect(scriptTyped("H₂", "H₂2", 3, "sub")).toEqual({ value: "H₂₂", done: false });
  });

  test("letters with no small form stay ordinary, so a whole formula can be typed", () => {
    expect(scriptTyped("", "C6H12O6", 7, "sub").value).toBe("C₆H₁₂O₆");
  });

  test("a space lets go, and stays ordinary itself", () => {
    expect(scriptTyped("10⁻³", "10⁻³ m", 6, "sup")).toEqual({ value: "10⁻³ m", done: true });
    expect(scriptTyped("x 10", "x 10-3 m", 8, "sup")).toEqual({ value: "x 10⁻³ m", done: true });
  });

  test("typing in the middle leaves the rest of the answer alone", () => {
    expect(scriptTyped("H O is water", "H2O is water", 2, "sub")).toEqual({
      value: "H₂O is water",
      done: false,
    });
    expect(scriptTyped("CO and 2 moles", "CO2 and 2 moles", 3, "sub").value).toBe(
      "CO₂ and 2 moles",
    );
  });

  test("deleting changes nothing", () => {
    expect(scriptTyped("H₂O", "H₂", 2, "sub")).toEqual({ value: "H₂", done: false });
  });
});
