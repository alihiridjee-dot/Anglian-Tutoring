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

  test("the alt text says what is drawn, never what it means", () => {
    // "Exothermic" may be the answer, and the alt is in the page for anyone to read.
    expect(drawWithCode(peroxide)!.alt).toBe(
      "A reaction profile from hydrogen peroxide to water + oxygen. The products line is below the reactants line, and a dashed second curve rises to a lower peak. 3 double-headed arrows are labelled A, B and C.",
    );
    expect(drawWithCode(limestone)!.alt).not.toMatch(/thermic/);
    expect(drawWithCode(velocity)!.alt).toContain("(4, 8), (12, 8)");
  });

  test("circuits and food webs are left to DeepSeek", () => {
    expect(drawnByCode({ kind: "circuit" })).toBe(false);
    expect(drawWithCode({ kind: "food-web" })).toBeNull();
  });
});

describe("a brief is checked before anything draws it", () => {
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

  test("a bar chart stands on zero; a food web's food sits below what eats it", () => {
    // Bars up from −10 or from 50 misstate every value.
    expect(problem({ ...bars, y: { title: "change in °C", min: -10, max: 10, step: 5 } })).toBe(
      "y axis must start at 0, where the bars stand",
    );
    // The brief's own levels say which way an arrow must point.
    expect(
      problem({
        kind: "food-web",
        organisms: [
          { name: "grass", level: 1 },
          { name: "rabbit", level: 2 },
          { name: "fox", level: 3 },
        ],
        eaten: [
          ["grass", "rabbit"],
          ["fox", "rabbit"],
        ],
      }),
    ).toBe("has fox eaten by rabbit, which is not on a higher level");
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

const pens: FigureBrief = {
  kind: "chromatogram",
  y: { title: "distance moved in cm", min: 0, max: 10, step: 1 },
  front: 10,
  samples: [
    { name: "note", spots: [2.4, 5.2] },
    { name: "P", spots: [2.4, 5.2, 7.9] },
    { name: "Q", spots: [2.4, 5.2] },
    { name: "R", spots: [3, 6.1] },
  ],
};
const lettered: FigureBrief = {
  kind: "wave",
  arrows: [
    { shows: "crest to trough", letter: "A" },
    { shows: "amplitude", letter: "B" },
    { shows: "wavelength", letter: "C" },
    { shows: "half a wavelength", letter: "D" },
  ],
};
const rope: FigureBrief = {
  kind: "wave",
  x: { title: "distance in cm", min: 0, max: 40, step: 5 },
  y: { title: "displacement in cm", min: -4, max: 4, step: 1 },
  amplitude: 3,
  wavelength: 20,
};
const van: FigureBrief = {
  kind: "forces",
  object: "van",
  toScale: false,
  forces: [
    { direction: "right", name: "driving force", size: 2500 },
    { direction: "left", name: "X", size: null },
    { direction: "up", name: "normal contact force", size: 18000 },
    { direction: "down", name: "weight", size: 18000 },
  ],
};
const skydiver: FigureBrief = {
  kind: "forces",
  object: "skydiver",
  toScale: true,
  forces: [
    { direction: "up", name: "air resistance", size: 400 },
    { direction: "down", name: "weight", size: 700 },
  ],
};

describe("code draws chromatograms, waves and force diagrams that pass the checker", () => {
  test("each drawn by code", () => {
    for (const brief of [pens, lettered, rope, van, skydiver]) {
      expect(drawnByCode(brief)).toBe(true);
      expect(problem(brief)).toBeNull();
      expect(drawn(brief).problems).toEqual([]);
    }
  });

  test("a spot that stayed on the start line, and one lettered arrow alone", () => {
    const insoluble = {
      ...pens,
      samples: [
        { name: "A", spots: [0, 3] },
        { name: "B", spots: [4] },
      ],
    } as FigureBrief;
    expect(drawn(insoluble).problems).toEqual([]);
    expect(
      drawn({ kind: "wave", arrows: [{ shows: "wavelength", letter: "W" }] }).problems,
    ).toEqual([]);
  });

  test("drawn to scale, an arrow's length is in proportion to its force", () => {
    const svg = drawWithCode(skydiver)!.svg;
    // 96 for the 700 N weight; 400 ÷ 700 of that for the air resistance.
    expect(svg).toContain('x1="180" y1="144" x2="180" y2="240"');
    expect(svg).toContain('x1="180" y1="104" x2="180" y2="49.14"');
    expect(drawWithCode(van)!.svg).toContain(">18 000 N<");
  });

  test("the alt text says what is drawn, never what it means", () => {
    // Which arrow is the amplitude, or how long one wave is, may be the answer.
    expect(drawWithCode(lettered)!.alt).toBe(
      "A wave drawn over two whole waves, crossing a straight line through its middle. 4 double-headed arrows are labelled A, B, C and D.",
    );
    expect(drawWithCode(rope)!.alt).not.toMatch(/20|3 cm|wavelength|amplitude/);
    expect(drawWithCode(pens)!.alt).toContain("P at 2.4, 5.2 and 7.9");
    expect(drawWithCode(van)!.alt).not.toMatch(/resultant|balanced/);
  });
});

const problem = (value: unknown) => {
  const read = readBrief(value);
  return "problem" in read ? read.problem : null;
};

describe("a chromatogram, wave or force brief is checked before anything draws it", () => {
  test("a chromatogram measures from its start line, below its solvent front", () => {
    expect(problem({ ...pens, y: { title: "distance in cm", min: 1, max: 10, step: 1 } })).toBe(
      "y axis must start at 0, at the start line",
    );
    expect(problem({ ...pens, front: 4 })).toBe("front must be from half of y.max to y.max");
    expect(
      problem({
        ...pens,
        samples: [
          { name: "A", spots: [10] },
          { name: "B", spots: [2] },
        ],
      }),
    ).toBe("has a spot that is not from 0 to below the solvent front");
    // A tenth of the scale apart would be drawn as one spot.
    expect(
      problem({
        ...pens,
        samples: [
          { name: "A", spots: [3, 3.3] },
          { name: "B", spots: [2] },
        ],
      }),
    ).toBe("has two spots in one lane closer than y.max ÷ 16");
    expect(
      problem({
        ...pens,
        samples: ["ink", "pen 1", "pen 2", "pen 3", "pen 4", "pen 5"].map((name) => ({
          name,
          spots: [2],
        })),
      }),
    ).toBe("has a sample name too long for its lane");
  });

  test("a wave has letters or a scale, and a scale holds whole waves it can draw", () => {
    expect(problem({ ...rope, arrows: [{ shows: "amplitude", letter: "A" }] })).toBe(
      "has both axes and arrows: a wave has one or the other",
    );
    expect(problem({ ...rope, y: { title: "displacement in cm", min: -2, max: 4, step: 1 } })).toBe(
      "y axis must run from −y.max to y.max, with the wave's middle at 0",
    );
    expect(problem({ ...rope, amplitude: 0.5 })).toBe(
      "amplitude must be from a quarter of y.max to y.max",
    );
    expect(problem({ ...rope, wavelength: 5 })).toBe("x axis must hold 1 to 6 whole waves");
    expect(problem({ kind: "wave", arrows: [{ shows: "frequency", letter: "F" }] })).toBe(
      "has an arrow that is not one a wave diagram has, or has no letter",
    );
  });

  test("forces act one each way, and to scale only with every size given", () => {
    expect(
      problem({
        ...van,
        forces: [
          { direction: "left", name: "friction", size: 200 },
          { direction: "left", name: "air resistance", size: 300 },
        ],
      }),
    ).toBe("has two forces the same way");
    expect(problem({ ...van, toScale: true })).toBe(
      "is drawn to scale, so every force needs its size",
    );
    expect(
      problem({
        ...skydiver,
        forces: [
          { direction: "up", name: "air resistance", size: 100 },
          { direction: "down", name: "weight", size: 700 },
        ],
      }),
    ).toBe("is drawn to scale, so the smallest force must be at least a quarter of the largest");
    expect(problem({ ...van, object: "delivery van" })).toBe(
      "has an object name too long for its box",
    );
    expect(
      problem({
        ...van,
        forces: [{ direction: "up", name: "upward force from the table", size: 5 }],
      }),
    ).toBeNull();
    expect(
      problem({
        ...van,
        forces: [{ direction: "up", name: "electrostaticattractionforce", size: 5 }],
      }),
    ).toBe("has a force name too long for its label");
  });
});

describe("any chromatogram, wave or force brief that passes its check, code draws so the checker passes it", () => {
  test("600 random ones", () => {
    const r = seeded(11);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const between = (lo: number, hi: number) => Number((lo + r() * (hi - lo)).toFixed(2));
    let drawnCount = 0;
    for (let i = 0; i < 600; i++) {
      let brief: unknown;
      const kind = pick(["chromatogram", "wave", "scaled wave", "forces"] as const);
      if (kind === "chromatogram") {
        const step = pick([0.5, 1, 2, 5, 10]);
        const max = step * (2 + Math.floor(r() * 11));
        const front = between(max / 2, max);
        const n = 2 + Math.floor(r() * 5);
        brief = {
          kind,
          y: { title: pick(["distance in cm", "distance moved in mm"]), min: 0, max, step },
          front,
          samples: Array.from({ length: n }, (_, j) => ({
            name: pick(["A", "B", "ink", "P", "E1", "dye"]) + j,
            spots: Array.from({ length: 1 + Math.floor(r() * 4) }, () =>
              r() < 0.1 ? 0 : between(0, front - 0.01),
            ),
          })),
        };
      } else if (kind === "wave") {
        const spans = ["amplitude", "wavelength", "crest to trough", "half a wavelength"];
        const shown = spans.filter(() => r() < 0.6);
        brief = { kind, arrows: shown.map((shows, j) => ({ shows, letter: "PQRS"[j] })) };
      } else if (kind === "scaled wave") {
        const xs = pick([1, 2, 5, 10, 0.5]);
        const ys = pick([0.5, 1, 2, 5]);
        const xn = 2 + Math.floor(r() * 11);
        const yn = 1 + Math.floor(r() * 6);
        brief = {
          kind: "wave",
          x: { title: pick(["time in ms", "distance in cm"]), min: 0, max: xs * xn, step: xs },
          y: { title: "displacement in cm", min: -ys * yn, max: ys * yn, step: ys },
          amplitude: between((ys * yn) / 4, ys * yn),
          wavelength: between((xs * xn) / 6, xs * xn),
        };
      } else {
        const directions = ["up", "down", "left", "right"].filter(() => r() < 0.7);
        const toScale = r() < 0.4;
        const largest = pick([10, 700, 2500, 18000, 1.5]);
        brief = {
          kind,
          object: pick(["", "van", "box", "skydiver", "ball"]),
          toScale,
          forces: directions.map((direction, j) => ({
            direction,
            name:
              pick([
                "weight",
                "air resistance",
                "X",
                "driving force",
                "normal contact force",
                "friction",
              ]) + (j ? ` ${j}` : ""),
            size: !toScale && r() < 0.3 ? null : between(largest / 4, largest),
          })),
        };
      }
      const read = readBrief(brief);
      if ("problem" in read) continue;
      const figure = drawWithCode(read.brief);
      expect(figure).not.toBeNull();
      drawnCount++;
      const problems = checkFigure(figure!.svg, read.brief).problems;
      if (problems.length) throw new Error(`${JSON.stringify(brief)}\n${problems.join("\n")}`);
    }
    expect(drawnCount).toBeGreaterThan(300);
  });
});

const gas: FigureBrief = {
  kind: "line-graph",
  x: { title: "time in s", min: 0, max: 60, step: 10 },
  y: { title: "volume of gas in cm³", min: 0, max: 50, step: 10 },
  curve: true,
  series: [
    {
      name: "gas",
      points: [
        [0, 0],
        [10, 18],
        [20, 30],
        [30, 38],
        [40, 43],
        [50, 45],
        [60, 45],
      ],
    },
  ],
  lines: [{ from: [0, 6], to: [40, 46] }],
};
const springs: FigureBrief = {
  kind: "scatter",
  x: { title: "force in N", min: 0, max: 6, step: 1 },
  y: { title: "extension in cm", min: 0, max: 12, step: 2 },
  series: [
    {
      name: "spring",
      points: [
        [1, 2.1],
        [2, 3.9],
        [3, 6.2],
        [4, 7.9],
        [5, 10.1],
      ],
    },
  ],
  lines: [{ from: [0, 0], to: [6, 12] }],
};

describe("graphs with a smooth curve, a line of best fit or a tangent", () => {
  test("each draws and passes", () => {
    for (const brief of [gas, springs]) {
      expect(problem(brief)).toBeNull();
      expect(drawn(brief).problems).toEqual([]);
    }
    expect(drawWithCode(gas)!.alt).toContain("joined by a smooth curve");
    expect(drawWithCode(springs)!.alt).toContain(
      "A straight line is drawn from (0, 0) to (6, 12).",
    );
  });

  test("a curve's points must run left to right; only a line graph curves; lines stay on the axes", () => {
    expect(
      problem({
        ...gas,
        series: [
          {
            name: "gas",
            points: [
              [0, 0],
              [20, 30],
              [10, 18],
            ],
          },
        ],
      }),
    ).toBe("has a curve whose points' x values don't increase");
    expect(problem({ ...springs, curve: true })).toBe("only a line graph has a curve");
    expect(problem({ ...springs, lines: [{ from: [0, 0], to: [8, 12] }] })).toBe(
      "has a straight line whose ends are not [x, y] within both axes",
    );
    expect(problem({ ...springs, lines: [{ from: [1, 1], to: [1.1, 1.2] }] })).toBe(
      "has a straight line too short to see",
    );
  });

  test("400 random smooth curves never go beyond their points", () => {
    const r = seeded(23);
    let count = 0;
    for (let i = 0; i < 400; i++) {
      const n = 2 + Math.floor(r() * 10);
      let at = 0;
      const xs = Array.from({ length: n }, (_, j) => (j ? (at += 1 + Math.floor(r() * 2)) : 0));
      const max = xs[n - 1] || 1;
      const step = max <= 12 ? 1 : 2;
      const brief = {
        kind: "line-graph",
        x: { title: "time in s", min: 0, max: Math.ceil(max / step) * step, step },
        y: { title: "mass in g", min: 0, max: 100, step: 10 },
        curve: true,
        series: Array.from({ length: r() < 0.3 ? 2 : 1 }, (_, s) => ({
          name: ["A", "B"][s],
          points: xs.map((x) => [x, Math.round(r() * 100)] as [number, number]),
        })),
      };
      if (problem(brief)) continue;
      const figure = drawWithCode(brief as FigureBrief);
      if (!figure) continue;
      count++;
      const problems = checkFigure(figure.svg, brief as FigureBrief).problems;
      if (problems.length) throw new Error(`${JSON.stringify(brief)}\n${problems.join("\n")}`);
    }
    expect(count).toBeGreaterThan(250);
  });
});
