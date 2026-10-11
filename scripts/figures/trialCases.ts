/**
 * Questions for the DeepSeek figure trial: one of each kind the prompt has
 * rules for, and one (a key) that should come back not_needed. Written by
 * hand for the trial; the question writer will write briefs like these
 * alongside its questions once figures are switched on.
 */
import type { FigureRequest } from "@/lib/figures/figurePrompt";

export const TRIAL_CASES: { name: string; request: FigureRequest }[] = [
  {
    name: "velocity-time",
    request: {
      subject: "physics",
      question:
        "The graph shows the velocity of a car as it moves between two sets of traffic lights. Calculate the distance the car travels in the first 4 s.",
      brief: {
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
      },
    },
  },
  {
    name: "germination-bars",
    request: {
      subject: "biology",
      question:
        "A student counted how many of 20 cress seeds germinated at each temperature. At which temperature did the most seeds germinate?",
      options: ["5 °C", "15 °C", "25 °C", "35 °C"],
      brief: {
        kind: "bar-chart",
        x: { title: "temperature in °C", categories: ["5", "15", "25", "35"] },
        y: { title: "seeds germinated", min: 0, max: 20, step: 5 },
        series: [{ name: "seeds", values: [3, 12, 18, 6] }],
      },
    },
  },
  {
    name: "parallel-circuit",
    request: {
      subject: "physics",
      question:
        "The switch is closed and both lamps light. The ammeter reads 0.6 A. What is the current through each lamp if the lamps are identical?",
      options: ["0.3 A", "0.6 A", "1.2 A", "0 A"],
      brief: {
        kind: "circuit",
        components: [
          { type: "cell" },
          { type: "switch-open" },
          { type: "ammeter" },
          { type: "lamp" },
          { type: "lamp" },
        ],
        layout:
          "Main loop: the cell and the switch on the top wire, the ammeter on the left wire. The two lamps are in parallel with each other, each on its own branch on the right of the loop.",
      },
    },
  },
  {
    name: "peroxide-profile",
    request: {
      subject: "chemistry",
      question:
        "The reaction profile shows the decomposition of hydrogen peroxide with and without a catalyst. Which arrow shows the activation energy with a catalyst?",
      options: ["A", "B", "C", "none of them"],
      brief: {
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
      },
    },
  },
  {
    name: "woodland-web",
    request: {
      subject: "biology",
      question:
        "The diagram shows part of a woodland food web. Which organism is both a secondary and a tertiary consumer?",
      options: ["fox", "owl", "blue tit", "mouse"],
      brief: {
        kind: "food-web",
        organisms: [
          { name: "grass", level: 1 },
          { name: "oak tree", level: 1 },
          { name: "rabbit", level: 2 },
          { name: "mouse", level: 2 },
          { name: "caterpillar", level: 2 },
          { name: "fox", level: 3 },
          { name: "blue tit", level: 3 },
          { name: "owl", level: 4 },
        ],
        eaten: [
          ["grass", "rabbit"],
          ["grass", "mouse"],
          ["oak tree", "caterpillar"],
          ["rabbit", "fox"],
          ["mouse", "fox"],
          ["caterpillar", "blue tit"],
          ["mouse", "owl"],
          ["blue tit", "owl"],
        ],
      },
    },
  },
  {
    name: "key-not-needed",
    request: {
      subject: "biology",
      question:
        "A dichotomous key is shown below. An organism has six legs and no wings. Which organism is it?",
      options: ["bee", "ant", "spider", "earthworm"],
      brief: {
        kind: "dichotomous-key",
        statements: [
          "1a Has legs - go to 2",
          "1b No legs - earthworm",
          "2a Six legs - go to 3",
          "2b Eight legs - spider",
          "3a Has wings - bee",
          "3b No wings - ant",
        ],
      },
    },
  },
];
