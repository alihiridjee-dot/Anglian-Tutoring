import { describe, expect, test } from "bun:test";
import { readBrief } from "@/lib/figures/figureBrief";
import { layOutStructures } from "./layout.server";

describe("a writer's skeletal formulae are laid out before the questions are checked", () => {
  test("a question's figure and its answer pictures", () => {
    const reply = {
      questions: [
        { prompt: "one", figure: JSON.stringify({ kind: "skeletal-formula", smiles: "CCC(C)=O" }) },
        {
          prompt: "two",
          figure: "",
          option_figures: JSON.stringify(
            ["CCO", "CC=O", "CC(=O)O", "COC"].map((smiles) => ({
              kind: "skeletal-formula",
              smiles,
            })),
          ),
        },
        { prompt: "three", figure: JSON.stringify({ kind: "pie-chart", slices: [] }) },
      ],
    };
    const untouched = reply.questions[2].figure;
    layOutStructures(reply);
    const one = readBrief(JSON.parse(reply.questions[0].figure));
    expect("brief" in one).toBe(true);
    const four = JSON.parse(reply.questions[1].option_figures!) as unknown[];
    expect(four.length).toBe(4);
    for (const brief of four) expect("brief" in readBrief(brief)).toBe(true);
    expect(reply.questions[1].figure).toBe("");
    expect(reply.questions[2].figure).toBe(untouched);
  });

  test("SMILES that does not read is left for the kind to refuse", () => {
    const reply = {
      questions: [{ figure: JSON.stringify({ kind: "skeletal-formula", smiles: "C1CC" }) }],
    };
    layOutStructures(reply);
    const read = readBrief(JSON.parse(reply.questions[0].figure));
    expect(read).toEqual({ problem: "could not be laid out from its SMILES" });
  });
});
