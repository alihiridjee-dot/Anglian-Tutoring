import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { agarPlate } from "./agarPlate";

const brief = agarPlate.samples[0].brief;
const svg = drawWithCode(brief)!.svg;
const swap = (from: string, to: string, s = svg) => {
  expect(s).toContain(from);
  return s.replace(from, to);
};
const problemsOf = (s: string) => checkFigure(s, brief).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("an agar plate is held to its zones and labels", () => {
  test("a zone the wrong size: D would no longer look the most effective", () => {
    const smaller = swap('cx="142.66" cy="173.34" r="36"', 'cx="142.66" cy="173.34" r="24"');
    expect(problemsOf(smaller)).toContain(
      "The clear zone round disc D is 20 mm across; the brief gives 30 mm",
    );
  });

  test("labels swapped between discs", () => {
    const swapped = swap(
      'y="226.35" text-anchor="end">D<',
      'y="226.35" text-anchor="end">A<',
      swap('y="56.65" text-anchor="end">A<', 'y="56.65" text-anchor="end">D<'),
    );
    expect(problemsOf(swapped)).toContain(
      "The label A is not written beside the dish in line with its disc",
    );
    expect(problemsOf(swapped)).toContain(
      "The label D is not written beside the dish in line with its disc",
    );
  });

  test("a zone round the disc that has none, or one off its disc", () => {
    const added = swap("</svg>", '<circle class="qf-line" cx="217.34" cy="173.34" r="12"/></svg>');
    expect(problemsOf(added)).toContain(
      "Disc C has a clear zone drawn round it; the brief has none",
    );
    const off = swap('cx="217.34" cy="98.66" r="14.4"', 'cx="224" cy="98.66" r="14.4"');
    expect(problemsOf(off)).toContain(
      "Disc B has no clear zone drawn round it; the brief gives one 12 mm across",
    );
    expect(problemsOf(off)).toContain("The circle at (224, 98.66) is not centred on a disc");
  });

  test("a scale bar the wrong length, or a caption", () => {
    const short = swap(
      'x1="310" y1="270" x2="334" y2="270"',
      'x1="310" y1="270" x2="322" y2="270"',
    );
    expect(problemsOf(short)).toContain(
      "The scale bar is not drawn 10 mm (24 units) long from (310, 270)",
    );
    const caption = swap(
      "</svg>",
      '<text class="qf-text" x="60" y="290" text-anchor="middle">best</text></svg>',
    );
    expect(problemsOf(caption)).toContain("Text \"best\" is not a disc's label or the scale bar's");
  });
});

describe("an agar plate brief must fit its dish", () => {
  test("zones that would touch, or reach the rim", () => {
    expect(
      problem({
        ...brief,
        discs: [
          { label: "A", zone: 36 },
          { label: "B", zone: 30 },
          { label: "C", zone: 0 },
          { label: "D", zone: 10 },
        ],
      }),
    ).toBe("has the zones round A and B touching");
    expect(
      problem({
        ...brief,
        discs: [
          { label: "A", zone: 42 },
          { label: "B", zone: 10 },
        ],
      }),
    ).toBe("has a zone that is not 0 or from 8 to 40 mm");
  });

  test("a label too long for its place, or too many discs", () => {
    expect(
      problem({
        ...brief,
        discs: [
          { label: "A", zone: 10 },
          { label: "streptomycin", zone: 10 },
          { label: "C", zone: 10 },
        ],
      }),
    ).toBe('has a label "streptomycin" too long to fit beside the dish');
    expect(
      problem({
        kind: "agar-plate",
        discs: "ABCDEF".split("").map((label) => ({ label, zone: 10 })),
      }),
    ).toBe("needs 2 to 5 discs");
  });
});
