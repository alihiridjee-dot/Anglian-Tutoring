import { describe, expect, test } from "bun:test";
import { parseFormula, plainFormula } from "@/lib/examKit/formula";

/** The booklets are written in this notation, so a typo in one must fail loudly. */
describe("parseFormula", () => {
  test("plain text stays as it is", () => {
    expect(parseFormula("p = m v")).toEqual([{ kind: "text", text: "p = m v" }]);
  });

  test("a GCSE fraction reads as before", () => {
    expect(parseFormula("a = {(v − u)|t}")).toEqual([
      { kind: "text", text: "a = " },
      {
        kind: "frac",
        top: [{ kind: "text", text: "(v − u)" }],
        bottom: [{ kind: "text", text: "t" }],
      },
    ]);
  });

  test("fractions nest, under a root", () => {
    const [, frac, root] = parseFormula("f = {1|2l}√[{T|μ}]");
    expect(frac.kind).toBe("frac");
    expect(root).toEqual({
      kind: "root",
      body: [
        {
          kind: "frac",
          top: [{ kind: "text", text: "T" }],
          bottom: [{ kind: "text", text: "μ" }],
        },
      ],
    });
  });

  test("powers and subscripts hold brackets of their own", () => {
    expect(parseFormula("e^(−(t/RC))")).toEqual([
      { kind: "text", text: "e" },
      { kind: "sup", body: [{ kind: "text", text: "−(t/RC)" }] },
    ]);
    expect(parseFormula("E_(k (max))")[1]).toEqual({
      kind: "sub",
      body: [{ kind: "text", text: "k (max)" }],
    });
  });

  test("bars and bold", () => {
    expect(parseFormula("‾(ν)_(e)")[0]).toEqual({ kind: "bar", body: [{ kind: "text", text: "ν" }] });
    expect(parseFormula("RC**H**_(3)")[1]).toEqual({
      kind: "bold",
      body: [{ kind: "text", text: "H" }],
    });
  });

  test("unbalanced notation throws", () => {
    for (const bad of ["{a|b", "{ab}", "a|b", "√[x", "10^(−19", "**H"])
      expect(() => parseFormula(bad)).toThrow();
  });
});

describe("plainFormula", () => {
  test("takes the notation out, for the find box", () => {
    expect(plainFormula("Planck constant h = 6.63 × 10^(−34) J s")).toBe(
      "Planck constant h = 6.63 × 10−34 J s",
    );
    expect(plainFormula("{useful output power|input power}").trim()).toBe(
      "useful output power input power",
    );
  });
});
