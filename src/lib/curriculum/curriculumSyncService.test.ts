import { describe, expect, test } from "bun:test";
import { CurriculumSyncService } from "./curriculumSyncService";

const parse = (text: string, board: "aqa" | "cambridge" | "ocr" = "aqa") =>
  CurriculumSyncService.parseCurriculumText(text, "biology", board, "gcse");
const codes = (text: string, board?: "aqa" | "cambridge" | "ocr") =>
  parse(text, board).specPoints.map((p) => p.code);

describe("parseCurriculumText", () => {
  test("AQA's four-level codes are the points; the levels above are headings", () => {
    const parsed = parse(`4.1 Cell biology
4.1.1 Cell structure
4.1.1.1 Eukaryotes and prokaryotes
4.1.1.2 Animal and plant cells
4.1.2 Cell division
4.1.2.1 Chromosomes`);
    expect(parsed.specPoints).toEqual([
      { code: "4.1.1.1", title: "Eukaryotes and prokaryotes", description: undefined },
      { code: "4.1.1.2", title: "Animal and plant cells", description: undefined },
      { code: "4.1.2.1", title: "Chromosomes", description: undefined },
    ]);
  });

  test("Cambridge's three-level codes are read, supplement points included", () => {
    expect(
      codes(
        `2.1 Diffusion
2.1.1 Describe diffusion as the net movement of particles
2.1.2 State that the energy for diffusion comes from kinetic energy
2.1.2S Investigate the factors that influence diffusion`,
        "cambridge",
      ),
    ).toEqual(["2.1.1", "2.1.2", "2.1.2S"]);
  });

  test("OCR's lettered points under a heading, and the topic line", () => {
    const parsed = parse(
      `Topic B1: Cell level systems
B1.1 Cell structures
B1.1a describe how light microscopes and staining can be used to view cells
B1.1b explain how electron microscopy has increased our understanding`,
      "ocr",
    );
    expect(parsed.topicCode).toBe("Topic B1");
    expect(parsed.topicTitle).toBe("Cell level systems");
    expect(parsed.specPoints.map((p) => p.code)).toEqual(["B1.1a", "B1.1b"]);
  });

  test("a flat list stays flat: 4.1 isn't 4.10's heading", () => {
    expect(codes("4.1 Eukaryotic cells\n4.2 Prokaryotic cells\n4.10 Stem cells")).toEqual([
      "4.1",
      "4.2",
      "4.10",
    ]);
  });

  test("a code a contents page repeats is imported once, without the dot leaders", () => {
    const parsed = parse(`Contents
4.1.1.1 Eukaryotes and prokaryotes ........ 12
4.1.1.2 Animal and plant cells . . . . . 13
4.1.1.1 Eukaryotes and prokaryotes
4.1.1.2 Animal and plant cells`);
    expect(parsed.specPoints).toEqual([
      { code: "4.1.1.1", title: "Eukaryotes and prokaryotes", description: undefined },
      { code: "4.1.1.2", title: "Animal and plant cells", description: undefined },
    ]);
  });

  test("a measured quantity in the prose isn't a point", () => {
    expect(
      codes(`4.1.1.1 Specific heat capacity
1.5 kg of water is heated by 10 °C.
2.5 m/s is the speed of the trolley.
0.1 mol/dm³ hydrochloric acid
3.0 × 10⁸ is the speed of light
1.5 times as much energy`),
    ).toEqual(["4.1.1.1"]);
  });

  test("a point whose title starts with 'A' is still a point", () => {
    expect(codes("1.1 A cell is the basic unit of life")).toEqual(["1.1"]);
  });
});
