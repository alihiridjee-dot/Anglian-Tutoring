import { describe, expect, test } from "bun:test";
import { readBrief } from "../figureBrief";
import { checkFigure } from "../figureCheck";
import { drawWithCode } from "../figureDraw";
import { flowDiagram } from "./flowDiagram";

const brief = flowDiagram.samples[0].brief;
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
const CO2 = "carbon dioxide in the air";

describe("a flow diagram is held to its arrows and letters", () => {
  test("an arrow pointing the wrong way: respiration drawn as if animals took in carbon dioxide", () => {
    const reversed = swap(
      'x1="180" y1="124" x2="180" y2="76"',
      'x1="180" y1="76" x2="180" y2="124"',
    );
    expect(problemsOf(reversed)).toContain(
      `The arrow between animals and ${CO2} points the wrong way: it must point from animals to ${CO2}`,
    );
    expect(problemsOf(reversed)).toContain(`The arrow from ${CO2} to animals is not in the brief`);
  });

  test("two letters swapped: photosynthesis and respiration trade places", () => {
    const swapped = swap(
      'x="102.16" y="94.2" text-anchor="middle">B<',
      'x="102.16" y="94.2" text-anchor="middle">A<',
      swap(
        'x="142.14" y="117.7" text-anchor="middle">A<',
        'x="142.14" y="117.7" text-anchor="middle">B<',
      ),
    );
    expect(problemsOf(swapped)).toContain(
      `The letter beside the arrow from ${CO2} to plants is "B"; the brief gives it A`,
    );
    expect(problemsOf(swapped)).toContain(
      `The letter beside the arrow from plants to ${CO2} is "A"; the brief gives it B`,
    );
  });

  test("an arrow to the wrong box, or one through a box", () => {
    const retargeted = swap('x2="209.81" y2="76"', 'x2="224" y2="150"');
    expect(problemsOf(retargeted)).toContain(`There is no arrow from fossil fuels to ${CO2}`);
    expect(problemsOf(retargeted)).toContain(
      "The arrow from fossil fuels to animals is not in the brief",
    );
    const through = swap(
      "</svg>",
      '<line class="qf-line" x1="103.73" y1="166" x2="258" y2="166" marker-end="url(#qf-head)"/></svg>',
    );
    expect(problemsOf(through)).toContain(
      "The arrow from plants to fossil fuels crosses the box for animals",
    );
  });

  test("a caption naming a process, or a box that isn't in the brief", () => {
    const caption = swap(
      "</svg>",
      '<text class="qf-text" x="300" y="40" text-anchor="middle">respiration</text></svg>',
    );
    expect(problemsOf(caption)).toContain(
      "Text \"respiration\" is not a box's name or an arrow's letter",
    );
    const box = swap(
      "</svg>",
      '<rect class="qf-box" x="290" y="20" width="60" height="44" rx="6"/></svg>',
    );
    expect(problemsOf(box)).toContain(
      'The <rect class="qf-box"> at (290, 20) is not part of the flow diagram',
    );
  });
});

describe("a flow diagram brief must draw cleanly", () => {
  test("an arrow past a box in its row, or a name not among the boxes", () => {
    expect(
      problem({ ...brief, arrows: [{ from: "plants", to: "fossil fuels", letter: "" }] }),
    ).toBe("has an arrow from plants to fossil fuels past the box between them");
    expect(problem({ ...brief, arrows: [{ from: "plants", to: "sun", letter: "A" }] })).toBe(
      "has an arrow that doesn't join two of its boxes by name",
    );
    expect(
      problem({
        ...brief,
        arrows: [
          { from: "plants", to: "animals", letter: "A" },
          { from: "animals", to: CO2, letter: "A" },
        ],
      }),
    ).toBe("gives two arrows one letter");
  });

  test("an arrow that would cross a box on its way", () => {
    const across = {
      kind: "flow-diagram",
      rows: [["sun"], ["grass", "rabbits", "foxes"], ["decomposers"]],
      arrows: [{ from: "sun", to: "decomposers", letter: "" }],
    };
    expect(problem(across)).toStartWith("can't be drawn cleanly: ");
    expect(checkFigure(drawWithCode(across)!.svg, across).problems).toContain(
      "The arrow from sun to decomposers crosses the box for rabbits",
    );
  });

  test("a name too long for its box", () => {
    expect(
      problem({
        kind: "flow-diagram",
        rows: [["photosynthesising", "respiring", "decomposing", "transpiring"]],
        arrows: [{ from: "respiring", to: "decomposing", letter: "" }],
      }),
    ).toBe("has a box name too long for its box");
  });
});
