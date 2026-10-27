import { describe, expect, test } from "bun:test";
import { creditRuns, creditsToShow, parseCredited } from "@/lib/homework/creditedQuotes";

/**
 * A marked answer draws the words that earned each mark under the highlighter.
 * The words are the marker's quotes, found again in what the student typed.
 */

const c = (quote: string, marks = 1, point = "") => ({ quote, point, marks });

describe("finding the quotes in the answer", () => {
  test("each quote marks its own words, the rest stays plain", () => {
    const runs = creditRuns("magnesium + oxygen -> magnesium oxide", [
      c("magnesium + oxygen"),
      c("magnesium oxide"),
    ]);
    expect(runs).toEqual([
      { text: "magnesium + oxygen", credit: 0 },
      { text: " -> " },
      { text: "magnesium oxide", credit: 1 },
    ]);
  });

  test("forgives case, spacing and punctuation, as the marker's check does", () => {
    const runs = creditRuns("The Cell-Wall is made of cellulose.", [
      c("cell wall is made of cellulose"),
    ]);
    expect(runs).toEqual([
      { text: "The " },
      { text: "Cell-Wall is made of cellulose", credit: 0 },
      { text: "." },
    ]);
  });

  test("the same phrase credited twice lands on its two uses", () => {
    const runs = creditRuns("heat it. then heat it again", [c("heat it"), c("heat it")]);
    expect(runs.filter((r) => r.credit != null).map((r) => r.credit)).toEqual([0, 1]);
    expect(runs[0]).toEqual({ text: "heat it", credit: 0 });
  });

  test("a quote that is not there is left out, not guessed at", () => {
    expect(creditRuns("osmosis", [c("diffusion")])).toEqual([{ text: "osmosis" }]);
  });

  test("notation typed flat still matches its own quote", () => {
    const runs = creditRuns("It forms H2O and CO2", [c("H2O")]);
    expect(runs[1]).toEqual({ text: "H2O", credit: 0 });
  });
});

describe("whether to draw the ticks at all", () => {
  test("drawn while they add up to the mark awarded", () => {
    expect(creditsToShow([c("a"), c("b", 2)], 3)).toHaveLength(2);
  });

  test("hidden once a tutor changed the mark", () => {
    expect(creditsToShow([c("a"), c("b")], 1)).toEqual([]);
    expect(creditsToShow([c("a")], 2)).toEqual([]);
  });

  test("nothing for an unmarked or zero answer, or no quotes", () => {
    expect(creditsToShow([c("a")], null)).toEqual([]);
    expect(creditsToShow([], 0)).toEqual([]);
    expect(creditsToShow(null, 2)).toEqual([]);
  });

  test("malformed entries are dropped", () => {
    expect(
      parseCredited([{ quote: "", marks: 1 }, { quote: "x", marks: 0 }, "junk", c("ok")]),
    ).toEqual([c("ok")]);
  });
});
