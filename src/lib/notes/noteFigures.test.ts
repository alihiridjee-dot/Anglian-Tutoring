import { describe, expect, test } from "bun:test";
import { KINDS } from "../figures/kinds";
import { drawNoteFigure, noteFigureProblems } from "./noteFigures";
import { validateNote, type Note } from "./noteFormat";

const graph = {
  kind: "line-graph",
  x: { title: "time in s", min: 0, max: 10, step: 2 },
  y: { title: "distance in m", min: 0, max: 50, step: 10 },
  series: [
    {
      name: "car",
      points: [
        [0, 0],
        [10, 50],
      ],
    },
  ],
};

const noteWith = (brief: unknown, where: "section" | "layer" = "section"): Note => {
  const figure = { type: "diagram", diagram: { kind: "figure", alt: "A graph", brief } };
  const para = { type: "paragraph", text: "Text." };
  return {
    format: 1,
    concept_id: "phys-001",
    subject: "physics",
    title: "T",
    key_idea: "K",
    sections: [{ heading: "H", blocks: where === "section" ? [para, figure] : [para] }],
    checks: [
      { q: "a", a: "b" },
      { q: "c", a: "d" },
    ],
    boards: {
      aqa: {
        spec_codes: ["AQA 1"],
        ...(where === "layer" ? { extra: [{ heading: "E", blocks: [figure] }] } : {}),
      },
    },
    meta: {
      status: "draft",
      written_by: "test",
      written_at: "",
      spec_point_ids: ["x"],
      exemplar_ids: [],
    },
  } as unknown as Note;
};

describe("a note's figure is drawn and checked as a question's is", () => {
  test("a good brief draws a checked figure", () => {
    const r = drawNoteFigure(graph);
    expect("svg" in r && r.svg.startsWith("<svg")).toBe(true);
    expect(validateNote(noteWith(graph))).toEqual([]);
    expect(noteFigureProblems(noteWith(graph))).toEqual([]);
  });

  test("every built kind's samples draw for a note", () => {
    for (const k of KINDS)
      for (const s of k.samples)
        expect([k.kind, drawNoteFigure(s.brief)]).not.toHaveProperty("1.problem");
  });

  test("a bad brief is refused, in a section or a board layer", () => {
    const bad = {
      ...graph,
      series: [
        {
          name: "car",
          points: [
            [0, 0],
            [20, 90],
          ],
        },
      ],
    };
    expect(noteFigureProblems(noteWith(bad)).join()).toContain("sections[0].blocks[1]");
    expect(noteFigureProblems(noteWith(bad, "layer")).join()).toContain("boards.aqa.extra[0]");
  });

  test("a model-drawn kind is refused", () => {
    const circuit = {
      kind: "circuit",
      components: [
        { type: "cell", label: null },
        { type: "lamp", label: null },
      ],
      loop: [0, 1],
      layout: "the cell on the top wire, the lamp on the bottom wire",
    };
    const r = drawNoteFigure(circuit);
    expect("problem" in r && r.problem).toContain("drawn by a model");
  });

  test("a figure with no brief fails the note's shape check", () => {
    expect(validateNote(noteWith(undefined)).join()).toContain("figure needs a brief");
  });
});
