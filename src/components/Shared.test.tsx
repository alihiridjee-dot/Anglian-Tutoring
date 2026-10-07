import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DataTable, SciBlock, SciText } from "@/components/Shared";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("science text keeps the layout it was written with", () => {
  test("every line break is drawn, whatever the box around it does with white space", () => {
    const key = "1a Has legs - go to 2\n1b No legs - earthworm\n2a Six legs - go to 3";
    expect(html(<SciText text={key} />)).toBe(
      "1a Has legs - go to 2<br/>1b No legs - earthworm<br/>2a Six legs - go to 3",
    );
  });

  test("a break beside a formula keeps both", () => {
    expect(html(<SciText text={"Water is H2O.\nCarbon dioxide is CO2."} />)).toBe(
      'Water is H<sub class="sci-sub">2</sub>O.<br/>Carbon dioxide is CO<sub class="sci-sub">2</sub>.',
    );
  });

  test("a one-line preview joins its lines with spaces", () => {
    expect(html(<SciText text={"See you\n  tomorrow"} oneLine />)).toBe("See you tomorrow");
  });

  test("a question's paragraphs, key lines and table are all drawn", () => {
    const q = [
      "A dichotomous key is shown below.",
      "",
      "1a Has legs - go to 2",
      "1b No legs - earthworm",
      "",
      "atom | protons",
      "P | 3",
      "",
      "Which organism has no legs?",
    ].join("\n");
    const out = html(<SciBlock text={q} />);
    expect(out).toContain("<p>A dichotomous key is shown below.</p>");
    expect(out).toContain("<p>1a Has legs - go to 2<br/>1b No legs - earthworm</p>");
    expect(out).toContain("<table");
    expect(out).toContain(">atom</th>");
    expect(out).toContain(">protons</th>");
    expect(out).toContain('<td class="font-bold">P</td><td>3</td>');
    expect(out).toContain("<p>Which organism has no legs?</p>");
    expect(out).not.toContain(" | ");
  });

  test("a table's cells are written alike: Cl2 beside Cl₂ reads Cl₂", () => {
    const out = html(<SciBlock text={"gas | formula\nchlorine | Cl2"} />);
    expect(out).toContain('Cl<sub class="sci-sub">2</sub>');
  });

  test("a table on a phone is stacked, each cell under its column's name", () => {
    const out = html(<DataTable columns={["atom", "protons"]} rows={[["P", "3"]]} />);
    expect(out).toContain("<b>protons:</b> 3");
  });
});
