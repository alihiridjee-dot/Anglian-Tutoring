import { describe, expect, test } from "bun:test";
import { ARROW_DEFS, CIRCUIT_SYMBOLS, type FigureBrief } from "./figure";
import { checkFigure, checkReply } from "./figureCheck";
import { FIGURE_EXAMPLES } from "./figurePrompt";

const [graph, circuit] = FIGURE_EXAMPLES;
const swap = (svg: string, from: string, to: string) => {
  expect(svg).toContain(from);
  return svg.replace(from, to);
};
const problemsOf = (svg: string, brief = graph.request.brief) => checkFigure(svg, brief).problems;

describe("the worked examples pass, so the prompt shows what passing looks like", () => {
  for (const e of FIGURE_EXAMPLES)
    test(e.name, () => {
      const r = checkReply(e.reply, e.request.brief);
      expect(r.problems).toEqual([]);
      expect(r.figure?.alt).toBe(e.reply.alt);
      expect(r.figure?.svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360');
    });
});

describe("a figure that is wrong is never shown", () => {
  test("a point away from where its values put it", () => {
    const svg = swap(graph.reply.svg, 'cx="232" cy="150.4"', 'cx="232" cy="140.4"');
    expect(problemsOf(svg)).toContain("The point (6, 20) is not where its values put it");
  });

  test("a line that bends where there is no point: smoothing, or a guess", () => {
    const svg = swap(graph.reply.svg, "176,150.4 232,150.4", "176,150.4 204,140 232,150.4");
    expect(problemsOf(svg).join()).toContain("A plotted line bends at (204, 140)");
  });

  test("a tick number away from its value: a stretched or mislabelled axis", () => {
    const svg = swap(
      graph.reply.svg,
      'x="176" y="242" text-anchor="middle">4<',
      'x="176" y="242" text-anchor="middle">5<',
    );
    expect(problemsOf(svg)).toContain('The x tick "5" is not at its value');
  });

  test("a colour, a style or a script of its own", () => {
    const svg = swap(
      graph.reply.svg,
      '<line class="qf-line" x1="64" y1="224"',
      '<line class="qf-line" fill="red" x1="64" y1="224"',
    );
    expect(problemsOf(svg).join()).toContain("has an attribute it may not carry: fill");
    const script = swap(graph.reply.svg, "</svg>", "<script>alert(1)</script></svg>");
    expect(problemsOf(script).join()).toContain("<script> is not allowed");
    // The page gets the parsed tree back, so the script never reaches it either way.
    expect(checkFigure(script).svg).not.toContain("script");
    const handler = swap(graph.reply.svg, 'role="img"', 'role="img" onload="alert(1)"');
    expect(checkFigure(handler).svg).not.toContain("onload");
  });

  test("text over text, and text over a line", () => {
    const over = swap(graph.reply.svg, 'x="204" y="266"', 'x="64" y="246"');
    expect(problemsOf(over).join()).toContain('Text "0" overlaps text "time in s"');
    const onLine = swap(
      graph.reply.svg,
      'x="16" y="22" text-anchor="start">distance',
      'x="60" y="120" text-anchor="start">distance',
    );
    expect(problemsOf(onLine).join()).toContain(
      'Text "distance in m" sits on a line (the qf-line from (64, 40) to (64, 224))',
    );
  });

  test("anything off the canvas, or a canvas of its own size", () => {
    const off = swap(graph.reply.svg, 'x="204" y="266"', 'x="204" y="276"');
    expect(problemsOf(off).join()).toContain("goes outside the canvas");
    const stretched = swap(graph.reply.svg, 'viewBox="0 0 360 280"', 'viewBox="0 0 360 290"');
    expect(problemsOf(stretched).join()).toContain("The viewBox is not");
  });

  test("a missing point, title or component", () => {
    const noPoint = swap(
      graph.reply.svg,
      '<circle class="qf-dot" cx="344" cy="40" r="3.5" data-x="10" data-y="50"/>',
      "",
    );
    expect(problemsOf(noPoint)).toContain("The point (10, 50) is missing or has no data-x/data-y");
    const noTitle = swap(graph.reply.svg, ">time in s<", ">time<");
    expect(problemsOf(noTitle)).toContain('The x-axis title "time in s" is missing');
    const noLamp = circuit.reply.svg.replace(
      /<g transform="translate\(300 115\) rotate\(90\)">.*?<\/g><\/g>/,
      "",
    );
    expect(problemsOf(noLamp, circuit.request.brief)).toContain(
      "The circuit has 0 lamp symbol(s); the brief has 1",
    );
  });

  test("labels that don't list the figure's text", () => {
    const reply = { ...graph.reply, labels: graph.reply.labels.slice(1) };
    expect(checkReply(reply, graph.request.brief).problems).toContain(
      "labels must list every line of text in the svg, exactly as written",
    );
  });

  test("a reply that draws nothing says why, and carries no svg", () => {
    const key = { kind: "dichotomous-key", statements: ["1a Has legs - go to 2"] };
    const none = {
      status: "not_needed",
      reason: "A key is laid out as text.",
      alt: "",
      labels: [],
      svg: "",
    };
    expect(checkReply(none, key)).toEqual({ problems: [], status: "not_needed", figure: null });
    expect(checkReply({ ...none, reason: "" }, key).problems).toContain(
      'A reply with status "not_needed" says why in reason',
    );
    expect(checkReply({ ...none, svg: graph.reply.svg }, key).problems).toContain(
      'A reply with status "not_needed" has no svg',
    );
    expect(checkReply("not json", key).problems).toEqual(["The reply is not a JSON object"]);
  });
});

// Drawings that pass, one per kind whose answer hangs on more than values:
// each test below breaks one thing a student would answer from.
const svgOf = (H: number, body: string[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 ${H}" class="qf" role="img">${body.join("")}</svg>`;
const both = 'marker-start="url(#qf-head)" marker-end="url(#qf-head)"';
const head = 'marker-end="url(#qf-head)"';

const profileBrief: FigureBrief = {
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
const profile = svgOf(300, [
  ARROW_DEFS,
  `<line class="qf-line" x1="40" y1="260" x2="40" y2="28" ${head}/>`,
  `<line class="qf-line" x1="40" y1="260" x2="344" y2="260" ${head}/>`,
  `<text class="qf-text" x="48" y="36" text-anchor="start">energy</text>`,
  `<text class="qf-text" x="192" y="288" text-anchor="middle">progress of reaction</text>`,
  `<line class="qf-line" x1="56" y1="160" x2="112" y2="160"/>`,
  `<line class="qf-line" x1="256" y1="212" x2="336" y2="212"/>`,
  `<path class="qf-data" d="M112 160 C148 160 148 72 184 72 S220 212 256 212"/>`,
  `<path class="qf-data2" d="M112 160 C148 160 148 120 184 120 S220 212 256 212"/>`,
  `<line class="qf-thin" x1="70" y1="72" x2="184" y2="72"/>`,
  `<line class="qf-thin" x1="94" y1="120" x2="184" y2="120"/>`,
  `<line class="qf-thin" x1="112" y1="160" x2="308" y2="160"/>`,
  `<line class="qf-line" x1="76" y1="160" x2="76" y2="72" ${both}/>`,
  `<text class="qf-strong" x="68" y="121.5" text-anchor="end">A</text>`,
  `<line class="qf-line" x1="100" y1="160" x2="100" y2="120" ${both}/>`,
  `<text class="qf-strong" x="108" y="145.5" text-anchor="start">B</text>`,
  `<line class="qf-line" x1="300" y1="160" x2="300" y2="212" ${both}/>`,
  `<text class="qf-strong" x="308" y="191.5" text-anchor="start">C</text>`,
  `<text class="qf-text" x="56" y="182" text-anchor="start">hydrogen<tspan x="56" dy="18">peroxide</tspan></text>`,
  `<text class="qf-text" x="262" y="234" text-anchor="start">water +<tspan x="262" dy="18">oxygen</tspan></text>`,
]);

const webBrief: FigureBrief = {
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
};
const name = (x: number, y: number, text: string) =>
  `<text class="qf-text" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;
const arrow = (x1: number, y1: number, x2: number, y2: number) =>
  `<line class="qf-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${head}/>`;
const web = svgOf(300, [
  ARROW_DEFS,
  arrow(94, 258, 65.33, 204),
  arrow(94, 258, 180, 204),
  arrow(266, 258, 294.67, 204),
  arrow(65.33, 178, 94, 124),
  arrow(180, 178, 94, 124),
  arrow(294.67, 178, 266, 124),
  arrow(180, 178, 180, 44),
  arrow(266, 98, 180, 44),
  name(180, 36, "owl"),
  name(94, 116, "fox"),
  name(266, 116, "blue tit"),
  name(65.33, 196, "rabbit"),
  name(180, 196, "mouse"),
  name(294.67, 196, "caterpillar"),
  name(94, 276, "grass"),
  name(266, 276, "oak tree"),
]);

const circuitBrief: FigureBrief = {
  kind: "circuit",
  components: [
    { type: "cell" },
    { type: "switch-open" },
    { type: "ammeter" },
    { type: "lamp" },
    { type: "lamp" },
  ],
  loop: [0, 1, { parallel: [[3], [4]] }, 2],
  layout:
    "The cell and the switch on the top wire, the ammeter on the left wire, the lamps in parallel on the right.",
};
const wire = (x1: number, y1: number, x2: number, y2: number) =>
  `<line class="qf-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const part = (at: string, symbol: keyof typeof CIRCUIT_SYMBOLS) =>
  `<g transform="${at}">${CIRCUIT_SYMBOLS[symbol]}</g>`;
// The loop is a rectangle; the second lamp is a ladder rung beside the first.
const ladder = svgOf(240, [
  wire(40, 60, 90, 60),
  part("translate(110 60)", "cell"),
  wire(130, 60, 170, 60),
  part("translate(190 60)", "switch-open"),
  wire(210, 60, 260, 60),
  wire(260, 60, 260, 120),
  part("translate(260 140) rotate(90)", "lamp"),
  wire(260, 160, 260, 220),
  wire(260, 220, 40, 220),
  wire(40, 220, 40, 160),
  part("translate(40 140) rotate(90)", "meter"),
  `<text class="qf-strong" x="40" y="145.5" text-anchor="middle">A</text>`,
  wire(40, 120, 40, 60),
  wire(260, 100, 320, 100),
  wire(320, 100, 320, 120),
  part("translate(320 140) rotate(90)", "lamp"),
  wire(320, 160, 320, 180),
  wire(320, 180, 260, 180),
  `<circle class="qf-ink" cx="260" cy="100" r="3"/>`,
  `<circle class="qf-ink" cx="260" cy="180" r="3"/>`,
]);

describe("what an answer hangs on is checked, not just the values", () => {
  test("drawn right, each passes", () => {
    expect(checkFigure(profile, profileBrief).problems).toEqual([]);
    expect(checkFigure(web, webBrief).problems).toEqual([]);
    expect(checkFigure(ladder, circuitBrief).problems).toEqual([]);
  });

  test("a reaction profile's letters on the wrong arrows", () => {
    const swapped = swap(swap(profile, ">A<", ">X<"), ">B<", ">A<").replace(">X<", ">B<");
    expect(checkFigure(swapped, profileBrief).problems).toEqual([
      'The letter beside the activation energy arrow is "B"; the brief gives it "A"',
      'The letter beside the activation energy with a catalyst arrow is "A"; the brief gives it "B"',
    ]);
  });

  test("a letter on the curve: the trial's first profile, whose bold A the old width guess missed", () => {
    const onCurve = swap(
      swap(profile, 'x1="76" y1="160" x2="76" y2="72"', 'x1="190" y1="160" x2="190" y2="72"'),
      'x="68" y="121.5" text-anchor="end">A',
      'x="198" y="116" text-anchor="start">A',
    );
    expect(checkFigure(onCurve, profileBrief).problems.join()).toContain(
      'Text "A" sits on a line (the qf-data',
    );
  });

  test("a reaction profile at the wrong levels, or missing its catalysed curve", () => {
    const endo = swap(profile, 'y1="212" x2="336" y2="212"', 'y1="136" x2="336" y2="136"');
    expect(checkFigure(endo, profileBrief).problems).toContain(
      "The products line is not at its exothermic level: (256, 212) to (336, 212)",
    );
    const noCatalyst = profile.replace(/<path class="qf-data2"[^>]*\/>/, "");
    expect(checkFigure(noCatalyst, profileBrief).problems).toContain(
      "The catalysed profile (qf-data2) must be one path from (112, 160) over its top at y = 120 to (256, 212)",
    );
  });

  test("a food web arrow the wrong way round, missing, or extra", () => {
    const reversed = swap(web, arrow(94, 258, 65.33, 204), arrow(65.33, 204, 94, 258));
    expect(checkFigure(reversed, webBrief).problems).toEqual([
      "The arrow between grass and rabbit points the wrong way: it must point from grass to rabbit, the food to what eats it",
    ]);
    const missing = swap(web, arrow(180, 178, 180, 44), "");
    expect(checkFigure(missing, webBrief).problems).toEqual([
      "There is no arrow from mouse to owl",
    ]);
    const extra = swap(web, name(180, 36, "owl"), name(180, 36, "owl") + arrow(94, 98, 180, 44));
    expect(checkFigure(extra, webBrief).problems).toEqual([
      "The arrow from fox to owl is not in the brief",
    ]);
  });

  test("lamps in series where the brief has them in parallel", () => {
    const series = svgOf(240, [
      ...[
        wire(40, 60, 90, 60),
        part("translate(110 60)", "cell"),
        wire(130, 60, 170, 60),
        part("translate(190 60)", "switch-open"),
        wire(210, 60, 260, 60),
        wire(260, 60, 260, 120),
        part("translate(260 140) rotate(90)", "lamp"),
        wire(260, 160, 260, 220),
        wire(260, 220, 170, 220),
        part("translate(150 220)", "lamp"),
        wire(130, 220, 40, 220),
        wire(40, 220, 40, 160),
        part("translate(40 140) rotate(90)", "meter"),
        `<text class="qf-strong" x="40" y="145.5" text-anchor="middle">A</text>`,
        wire(40, 120, 40, 60),
      ],
    ]);
    expect(checkFigure(series, circuitBrief).problems.join()).toContain(
      "The circuit is not wired as the brief's loop says",
    );
  });

  test("a junction with no dot, a shorted lamp, crossing or slanted wires", () => {
    const noDot = swap(ladder, `<circle class="qf-ink" cx="260" cy="100" r="3"/>`, "");
    expect(checkFigure(noDot, circuitBrief).problems).toEqual([
      'The junction at (260, 100) needs a dot: <circle class="qf-ink" r="3"/>',
    ]);
    const shorted = swap(
      ladder,
      wire(320, 160, 320, 180),
      wire(320, 160, 320, 180) + wire(320, 120, 320, 160),
    );
    expect(checkFigure(shorted, circuitBrief).problems.join()).toContain(
      "The lamp is shorted: a wire joins its two ends",
    );
    const crossing = swap(
      ladder,
      wire(130, 60, 170, 60),
      wire(130, 60, 170, 60) + wire(150, 40, 150, 80),
    );
    expect(checkFigure(crossing, circuitBrief).problems.join()).toContain(
      "The wires from (130, 60) and from (150, 40) cross",
    );
    const slanted = swap(ladder, wire(130, 60, 170, 60), wire(130, 60, 170, 64));
    expect(checkFigure(slanted, circuitBrief).problems.join()).toContain(
      "The wire from (130, 60) to (170, 64) is slanted",
    );
  });

  test("a brief whose loop leaves out a component", () => {
    const brief = { ...circuitBrief, loop: [0, 1, 2] } as FigureBrief;
    expect(checkFigure(ladder, brief).problems).toContain(
      "The brief's loop must name every component once, in at least two steps",
    );
  });
});
