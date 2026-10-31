import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { particleDiagram } from "./particleDiagram";

const [mixtures, states] = particleDiagram.samples.map((s) => s.brief);
const drawn = (brief: unknown) => drawWithCode(brief as never)!.svg;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problemsOf = (svg: string, brief: unknown) => checkFigure(svg, brief as never).problems;
const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};
const box = (arrangement: string, atoms: string[], count: number) => ({
  arrangement,
  particles: [{ atoms, count }],
});

describe("particle diagrams are held to each box's particles and arrangement", () => {
  test("a particle missing from the solid", () => {
    const svg = swap(drawn(states), '<circle class="qf-dot" cx="208" cy="91" r="7"/>', "");
    expect(problemsOf(svg, states)).toEqual([
      "Box B has 19 particles of a single shaded atom; the brief has 20",
      "Box B has 19 atoms; its particles have 20",
    ]);
  });

  test("a gas particle moved to touch another, or a liquid's left floating", () => {
    const svg = drawn(states);
    // Two gas particles touching would read as a liquid's.
    expect(
      problemsOf(
        swap(
          svg,
          '<circle class="qf-dot" cx="35" cy="83" r="7"/>',
          '<circle class="qf-dot" cx="35" cy="61" r="7"/>',
        ),
        states,
      ),
    ).toEqual([
      "Box A's particles are not far apart, as a gas's are: keep 8 units between them",
      "Box A has atoms not where its layout puts them, the first at (35, 61)",
    ]);
    expect(
      problemsOf(
        swap(
          svg,
          '<circle class="qf-dot" cx="328.86" cy="98.27" r="7"/>',
          '<circle class="qf-dot" cx="328.86" cy="50" r="7"/>',
        ),
        states,
      ),
    ).toEqual([
      "In box C, the particle at (328.86, 50) touches no other, as a liquid's do",
      "Box C has atoms not where its layout puts them, the first at (328.86, 50)",
    ]);
  });

  test("an element's molecule turned into a compound's", () => {
    // One black atom of box B's black–black molecules drawn white: B becomes a mixture
    // of an element and a compound, which is the answer the question asks for.
    const svg = drawn(mixtures);
    const black = /<circle class="qf-ink" cx="(\d+(\.\d+)?)" cy="(\d+(\.\d+)?)" r="7"\/>/.exec(
      svg.slice(svg.indexOf('x="188" y="16"')),
    )!;
    const changed = swap(svg, black[0], black[0].replace("qf-ink", "qf-line"));
    expect(problemsOf(changed, mixtures)).toEqual([
      "Box B has 2 particles of two black atoms joined; the brief has 3",
      "Box B has 1 particle of black–white atoms, which the brief doesn't",
      `Box B has atoms not where its layout puts them, the first at (${black[1]}, ${black[3]})`,
    ]);
  });

  test("letters swapped between boxes, or a caption naming the state", () => {
    const svg = drawn(states);
    const swapped = svg
      .replace('text-anchor="middle">A<', 'text-anchor="middle">X<')
      .replace('text-anchor="middle">B<', 'text-anchor="middle">A<')
      .replace('text-anchor="middle">X<', 'text-anchor="middle">B<');
    expect(problemsOf(swapped, states)).toEqual([
      "The letter A is not written under its box",
      "The letter B is not written under its box",
    ]);
    expect(
      problemsOf(
        swap(
          svg,
          "</svg>",
          '<text class="qf-text" x="180" y="190" text-anchor="middle">solid</text></svg>',
        ),
        states,
      ),
    ).toEqual([
      'Text "solid" is not a box\'s letter',
      "The diagram has 4 texts; it has a letter for each box",
    ]);
  });
});

describe("a particle diagram's brief must fit its boxes", () => {
  test("too many particles for a gas, or for a small box", () => {
    expect(problem({ kind: "particle-diagram", boxes: [box("gas", ["white"], 11)] })).toBe(
      "the box needs 2 to 10 particles as a gas",
    );
    expect(
      problem({
        kind: "particle-diagram",
        boxes: [
          box("gas", ["white"], 4),
          box("solid", ["white", "black", "white"], 30),
          box("gas", ["white"], 4),
        ],
      }),
    ).toBe("box B can't hold its particles as a solid: use fewer");
  });

  test("an atom it doesn't draw, a particle listed twice, or no arrangement", () => {
    expect(problem({ kind: "particle-diagram", boxes: [box("gas", ["red"], 4)] })).toBe(
      'the box has a particle that is not 1 to 3 atoms, each "black", "shaded" or "white"',
    );
    expect(
      problem({
        kind: "particle-diagram",
        boxes: [
          {
            arrangement: "gas",
            particles: [
              { atoms: ["white", "black"], count: 2 },
              { atoms: ["black", "white"], count: 2 },
            ],
          },
        ],
      }),
    ).toBe("the box lists the same particle twice");
    expect(
      problem({
        kind: "particle-diagram",
        boxes: [box("plasma", ["white"], 4), box("gas", ["white"], 4)],
      }),
    ).toBe('box A needs an arrangement: "solid", "liquid" or "gas"');
  });
});
