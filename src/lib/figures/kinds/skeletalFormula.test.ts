import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { skeletalFormula, type SkeletalBrief } from "./skeletalFormula";

const [painkiller, ketone, haloalkane] = skeletalFormula.samples.map(
  (s) => s.brief as unknown as SkeletalBrief,
);
const drawn = (brief: unknown) => drawWithCode(brief as never)!.svg;
const problemsOf = (svg: string, brief: unknown) => checkFigure(svg, brief as never).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("a skeletal formula is held to its atoms, bonds and rings", () => {
  test("a double bond drawn as a single bond", () => {
    // The ketone's C=O is two lines; with one gone it reads as an alcohol's C–O.
    const svg = drawn(ketone);
    const lines = svg.match(/<line [^>]*\/>/g)!;
    expect(lines.length).toBe(5);
    const problems = problemsOf(svg.replace(lines[4], ""), ketone);
    expect(problems.some((p) => p.includes("is not drawn"))).toBe(true);
    expect(problems).toContain("The formula has 4 lines; the brief's bonds need 5");
  });

  test("an atom written as another element", () => {
    const svg = drawn(ketone).replace(">O<", ">S<");
    const problems = problemsOf(svg, ketone);
    expect(problems.some((p) => p.startsWith("O is not written at"))).toBe(true);
    expect(problems.some((p) => p.startsWith('Text "S"'))).toBe(true);
  });

  test("a benzene ring without its circle", () => {
    const svg = drawn(painkiller).replace(/<circle [^>]*\/>/, "");
    expect(problemsOf(svg, painkiller)).toContain(
      "The formula has 0 circles; the brief has 1 rings",
    );
  });

  test("a wedge drawn as a plain bond", () => {
    const svg = drawn(haloalkane);
    expect(svg).toContain('<polygon class="qf-ink"');
    const problems = problemsOf(svg.replace(/<polygon [^>]*\/>/, ""), haloalkane);
    expect(problems.some((p) => p.startsWith("A wedge's edge"))).toBe(true);
  });
});

describe("a brief no chemist would draw is refused", () => {
  test("SMILES alone has not been laid out", () => {
    expect(problem({ kind: "skeletal-formula", smiles: "CCO" })).toBe(
      "could not be laid out from its SMILES",
    );
  });

  test("a carbon with a hydrogen too many", () => {
    const brief = copy(ketone);
    brief.atoms[1].h = 3;
    expect(problem(brief)).toBe("has a C making 5 bonds, counting its hydrogens, not 4");
  });

  test("an atom adrift from the rest", () => {
    const brief = copy(ketone);
    brief.bonds.pop();
    brief.atoms[4].h = 2;
    brief.atoms[2].h = 2;
    expect(problem(brief)).toBe("has atoms that aren't joined to the rest");
  });

  test("a ring that is not six bonded carbons", () => {
    const brief = copy(painkiller);
    brief.rings = [[0, 1, 2, 3, 4, 5]];
    expect(problem(brief)).toBe("has a ring that is not six carbons bonded in a circle");
  });

  test("an element the kind does not draw", () => {
    const brief = copy(ketone);
    brief.atoms[4].symbol = "Na";
    expect(problem(brief)).toBe('has an atom "Na" that is not C, N, O, S, P, F, Cl, Br or I');
  });
});
