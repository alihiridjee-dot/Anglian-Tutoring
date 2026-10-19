import { describe, expect, test } from "bun:test";
import type { FigureBrief, KnownBrief } from "./figure";
import { readBrief } from "./figureBrief";
import { checkFigure } from "./figureCheck";
import { drawWithCode, drawnByCode } from "./figureDraw";

const drawn = (brief: FigureBrief) => {
  const figure = drawWithCode(brief);
  expect(figure).not.toBeNull();
  return { ...figure!, problems: checkFigure(figure!.svg, brief).problems };
};

const velocity: FigureBrief = {
  kind: "line-graph",
  x: { title: "time in s", min: 0, max: 20, step: 4 },
  y: { title: "velocity in m/s", min: 0, max: 12, step: 2 },
  series: [
    {
      name: "car",
      points: [
        [0, 0],
        [4, 8],
        [12, 8],
        [20, 0],
      ],
    },
  ],
};
const bars: FigureBrief = {
  kind: "bar-chart",
  x: { title: "temperature in °C", categories: ["5", "15", "25", "35"] },
  y: { title: "seeds germinated", min: 0, max: 20, step: 5 },
  series: [{ name: "seeds", values: [3, 12, 18, 6] }],
};
const peroxide: FigureBrief = {
  kind: "energy-profile",
  reaction: "exothermic",
  catalyst: true,
  reactants: "hydrogen peroxide",
  products: "water + oxygen",
  arrows: [
    { shows: "activation energy", letter: "A" },
    { shows: "activation energy with a catalyst", letter: "B" },
    { shows: "overall energy change", letter: "C" },
  ],
};
const limestone: FigureBrief = {
  kind: "energy-profile",
  reaction: "endothermic",
  catalyst: false,
  reactants: "CaCO₃",
  products: "CaO + CO₂",
  arrows: [
    { shows: "activation energy", letter: "X" },
    { shows: "overall energy change", letter: "Y" },
  ],
};

describe("code draws graphs, bar charts and reaction profiles that pass the checker", () => {
  test("the trial's questions, drawn by code", () => {
    for (const brief of [velocity, bars, peroxide, limestone]) {
      expect(drawnByCode(brief)).toBe(true);
      expect(drawn(brief).problems).toEqual([]);
    }
  });

  test("two series get a key in a corner the data leaves free", () => {
    const cooling: FigureBrief = {
      kind: "line-graph",
      x: { title: "time in minutes", min: 0, max: 10, step: 2 },
      y: { title: "temperature in °C", min: 0, max: 80, step: 10 },
      series: [
        {
          name: "insulated",
          points: [
            [0, 80],
            [2, 70],
            [4, 62],
            [6, 56],
            [8, 51],
            [10, 47],
          ],
        },
        {
          name: "bare",
          points: [
            [0, 80],
            [2, 60],
            [4, 46],
            [6, 37],
            [8, 31],
            [10, 27],
          ],
        },
      ],
    };
    const f = drawn(cooling);
    expect(f.problems).toEqual([]);
    expect(f.svg).toContain('class="qf-box"');
    expect(f.svg).toContain('class="qf-data2"');
    const twoBars: FigureBrief = {
      kind: "bar-chart",
      x: { title: "year group", categories: ["7", "8", "9"] },
      y: { title: "number of students", min: 0, max: 30, step: 5 },
      series: [
        { name: "walk", values: [12, 18, 25] },
        { name: "bus", values: [20, 9, 4] },
      ],
    };
    expect(drawn(twoBars).problems).toEqual([]);
  });

  test("decimal and negative axes, and crowded ticks numbered every other step", () => {
    const f = drawn({
      kind: "scatter",
      x: { title: "concentration in mol/dm³", min: 0, max: 2, step: 0.25 },
      y: { title: "change in mass in g", min: -1.5, max: 1.5, step: 0.5 },
      series: [
        {
          name: "potato",
          points: [
            [0, 1.2],
            [0.5, 0.4],
            [1, -0.3],
            [1.5, -0.9],
            [2, -1.3],
          ],
        },
      ],
    });
    expect(f.problems).toEqual([]);
    expect(f.svg).toContain(">−1.5<");
  });

  test("the alt text describes the figure without the answer", () => {
    expect(drawWithCode(peroxide)!.alt).toBe(
      "A reaction profile for an exothermic reaction, from hydrogen peroxide to water + oxygen, with and without a catalyst. 3 double-headed arrows are labelled A, B and C.",
    );
    expect(drawWithCode(velocity)!.alt).toContain("(4, 8), (12, 8)");
  });

  test("circuits and food webs are left to DeepSeek", () => {
    expect(drawnByCode({ kind: "circuit" })).toBe(false);
    expect(drawWithCode({ kind: "food-web" })).toBeNull();
  });
});

describe("a brief is checked before anything draws it", () => {
  const problem = (value: unknown) => {
    const read = readBrief(value);
    return "problem" in read ? read.problem : null;
  };

  test("briefs that draw pass", () => {
    for (const brief of [velocity, bars, peroxide, limestone]) expect(problem(brief)).toBeNull();
  });

  test("a value off its axis, an uneven axis, or numbers too long to fit", () => {
    expect(
      problem({
        ...velocity,
        series: [
          {
            name: "car",
            points: [
              [0, 0],
              [24, 8],
            ],
          },
        ],
      }),
    ).toBe("has a point that is not [x, y] within both axes");
    expect(problem({ ...velocity, x: { title: "time in s", min: 0, max: 20, step: 3 } })).toBe(
      "x axis must run from min to max in 2 to 12 whole steps",
    );
    expect(problem({ ...velocity, x: { title: "time in s", min: 0, max: 5000, step: 1000 } })).toBe(
      "x axis numbers are too long to fit",
    );
    expect(
      problem({ ...bars, x: { title: "food", categories: ["bread and butter", "rice", "pasta"] } }),
    ).toBe("needs 2 to 6 category names");
  });

  test("a profile's arrows must be its own, each once", () => {
    expect(
      problem({
        ...limestone,
        arrows: [{ shows: "activation energy with a catalyst", letter: "A" }],
      }),
    ).toBe("has a catalysed arrow but no catalyst");
    expect(
      problem({
        ...peroxide,
        arrows: [
          { shows: "activation energy", letter: "A" },
          { shows: "activation energy", letter: "B" },
        ],
      }),
    ).toBe("has two arrows showing the same thing, or sharing a letter");
  });

  test("a circuit's loop names every part once; a food web's arrows name its organisms", () => {
    const circuit = {
      kind: "circuit",
      components: [
        { type: "cell", label: null },
        { type: "lamp", label: null },
        { type: "ammeter", label: null },
      ],
      loop: [0, 1],
      layout: "One loop.",
    };
    expect(problem(circuit)).toBe(
      "loop must name every component exactly once, in at least two steps",
    );
    const read = readBrief({ ...circuit, loop: [0, { parallel: [[1], [2]] }] });
    expect(read).toEqual({
      brief: {
        kind: "circuit",
        components: [{ type: "cell" }, { type: "lamp" }, { type: "ammeter" }],
        loop: [0, { parallel: [[1], [2]] }],
        layout: "One loop.",
      },
    });
    expect(
      problem({
        kind: "food-web",
        organisms: [
          { name: "grass", level: 1 },
          { name: "rabbit", level: 2 },
        ],
        eaten: [["grass", "fox"]],
      }),
    ).toBe("has a [food, eater] pair that doesn't name two of its organisms");
  });
});

/** A small seeded generator, so the sweep below is the same every run. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("any brief that passes its check, code draws so the checker passes it", () => {
  test("400 random graphs, bar charts and profiles", () => {
    const r = seeded(7);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100];
    const axis = (title: string) => {
      const step = pick(steps);
      const n = 2 + Math.floor(r() * 11);
      const min = r() < 0.2 ? -step * Math.floor(r() * n) : 0;
      return { title, min, max: Number((min + n * step).toFixed(6)), step };
    };
    const within = (a: { min: number; max: number }) =>
      Number((a.min + r() * (a.max - a.min)).toFixed(2));
    let drawnCount = 0;
    for (let i = 0; i < 400; i++) {
      let brief: KnownBrief;
      const kind = pick(["line-graph", "scatter", "bar-chart", "energy-profile"] as const);
      if (kind === "energy-profile") {
        const catalyst = r() < 0.5;
        const shows = [
          "activation energy",
          "overall energy change",
          ...(catalyst ? ["activation energy with a catalyst"] : []),
        ];
        brief = {
          kind,
          reaction: pick(["exothermic", "endothermic"] as const),
          catalyst,
          reactants: pick(["CH₄ + 2O₂", "magnesium + acid", "hydrogen peroxide", "N₂ + 3H₂"]),
          products: pick(["CO₂ + 2H₂O", "salt + H₂", "water + oxygen", "2NH₃"]),
          arrows: shows.slice(0, 1 + Math.floor(r() * shows.length)).map((s, j) => ({
            shows: s as "activation energy",
            letter: "ABC"[j],
          })),
        };
      } else if (kind === "bar-chart") {
        const y = axis("mass in g");
        const n = 2 + Math.floor(r() * 5);
        const categories = Array.from(
          { length: n },
          (_, j) => pick(["A", "B", "pH 4", "20 °C", "oak", "ash"]) + j,
        );
        brief = {
          kind,
          x: { title: "sample", categories },
          y,
          series: Array.from({ length: r() < 0.3 ? 2 : 1 }, (_, j) => ({
            name: ["trial 1", "trial 2"][j],
            values: categories.map(() => within(y)),
          })),
        };
      } else {
        const x = axis("time in s");
        const y = axis("distance in m");
        brief = {
          kind,
          x,
          y,
          series: Array.from({ length: kind === "line-graph" && r() < 0.3 ? 2 : 1 }, (_, j) => ({
            name: ["runner A", "runner B"][j],
            points: Array.from(
              { length: 2 + Math.floor(r() * 8) },
              () => [within(x), within(y)] as [number, number],
            ),
          })),
        };
      }
      if ("problem" in readBrief(brief)) continue;
      const figure = drawWithCode(brief);
      // Only a key with no free corner may stop a drawing.
      if (!figure) {
        expect((brief as { series?: unknown[] }).series?.length).toBe(2);
        continue;
      }
      drawnCount++;
      const problems = checkFigure(figure.svg, brief).problems;
      if (problems.length) throw new Error(`${JSON.stringify(brief)}\n${problems.join("\n")}`);
    }
    expect(drawnCount).toBeGreaterThan(250);
  });
});

describe("what the first real writer trial turned up (17 Oct)", () => {
  test("two curves that fill every corner put their key above the plot", () => {
    // The trial's rabbits and foxes, as the writer gave them.
    const predators: FigureBrief = {
      kind: "line-graph",
      x: { title: "time in years", min: 0, max: 10, step: 1 },
      y: { title: "number of animals", min: 0, max: 700, step: 100 },
      series: [
        {
          name: "Rabbits",
          points: [
            [0, 200],
            [1, 300],
            [2, 450],
            [3, 600],
            [4, 450],
            [5, 300],
            [6, 200],
            [7, 300],
            [8, 450],
            [9, 600],
            [10, 450],
          ],
        },
        {
          name: "Foxes",
          points: [
            [0, 20],
            [1, 20],
            [2, 30],
            [3, 40],
            [4, 55],
            [5, 60],
            [6, 45],
            [7, 30],
            [8, 25],
            [9, 35],
            [10, 50],
          ],
        },
      ],
    };
    const f = drawn(predators);
    expect(f.problems).toEqual([]);
    expect(f.svg).not.toContain('class="qf-box"');
    expect(f.svg).toContain('y="22" text-anchor="start">Foxes<');
  });
});
