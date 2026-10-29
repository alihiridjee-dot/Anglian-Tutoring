import { describe, expect, test } from "bun:test";
import { ARROW_DEFS, CIRCUIT_SYMBOLS, type FigureBrief } from "./figure";
import { checkFigure, checkReply, cleanFigure } from "./figureCheck";
import { drawWithCode } from "./figureDraw";
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

  test("a tick number at the end of an axis may come near the edge, but no further", () => {
    // The trial's velocity–time graph lost its picture when "20" at x = 344 was held to the
    // lines' 8-unit margin: its retry moved the number off its tick.
    const wide = swap(
      graph.reply.svg,
      'x="344" y="242" text-anchor="middle">10<',
      'x="344" y="242" text-anchor="middle">100<',
    );
    expect(checkFigure(wide).problems).toEqual([]);
    const past = swap(
      graph.reply.svg,
      'x="344" y="242" text-anchor="middle">10<',
      'x="344" y="242" text-anchor="middle">1000<',
    );
    expect(checkFigure(past).problems.join()).toContain(
      "goes outside the canvas (keep text 2 units clear",
    );
  });

  test("anything off the canvas, or a canvas of its own size", () => {
    const off = swap(graph.reply.svg, 'x="204" y="266"', 'x="204" y="284"');
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

  test("parts in series in any order round the loop are wired alike; a different parallel set is not", () => {
    // The trial's voltmeter circuit put its ammeter before the lamp, as its layout said,
    // where the loop listed it after: the same current and readings either way.
    const reordered = { ...circuitBrief, loop: [1, 0, 2, { parallel: [[4], [3]] }] } as FigureBrief;
    expect(checkFigure(ladder, reordered).problems).toEqual([]);
    const ammeterAcrossLamp = {
      ...circuitBrief,
      loop: [0, 1, 4, { parallel: [[3], [2]] }],
    } as FigureBrief;
    expect(checkFigure(ladder, ammeterAcrossLamp).problems).toEqual([
      "The circuit is not wired as the brief's loop says: drawn, it is series(ammeter, cell, parallel(lamp | lamp), switch-open); the loop is series(cell, lamp, parallel(ammeter | lamp), switch-open)",
    ]);
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

  test("lamps labelled A and B beside an ammeter: a label is plain text, a meter's letter bold", () => {
    // The trial's first parallel circuit was refused when the ammeter's "A" was
    // taken for lamp A's label.
    const labelled = {
      ...circuitBrief,
      components: [
        { type: "cell" },
        { type: "switch-open" },
        { type: "ammeter" },
        { type: "lamp", label: "A" },
        { type: "lamp", label: "B" },
      ],
    } as FigureBrief;
    const svg = ladder.replace(
      "</svg>",
      '<text class="qf-text" x="244" y="145" text-anchor="end">A</text><text class="qf-text" x="336" y="145" text-anchor="start">B</text></svg>',
    );
    expect(checkFigure(svg, labelled).problems).toEqual([]);
  });

  test("a brief whose loop leaves out a component", () => {
    const brief = { ...circuitBrief, loop: [0, 1, 2] } as FigureBrief;
    expect(checkFigure(ladder, brief).problems).toContain(
      "The brief's loop must name every component once, in at least two steps",
    );
  });
});

// Each of these passed before the checker held a circuit or food web to its
// brief alone (the review, 17 Oct): a picture that reads as something else.
describe("a circuit or food web holds only what its brief names", () => {
  const copied = (symbol: string, at: string) =>
    `The ${symbol} at ${at} is not the ${symbol} symbol copied exactly: copy each symbol from the list unchanged, placed only by its <g transform>`;
  const lamp2 = part("translate(320 140) rotate(90)", "lamp");
  const asLamp2 = (drawing: string) =>
    swap(ladder, lamp2, `<g transform="translate(320 140) rotate(90)">${drawing}</g>`);

  test("a symbol drawn as another under its own tag, or not drawn at all", () => {
    // An open switch drawn closed: the lamps light in the picture, not in the brief.
    const closed = CIRCUIT_SYMBOLS["switch-closed"].replace("switch-closed", "switch-open");
    expect(
      checkFigure(swap(ladder, CIRCUIT_SYMBOLS["switch-open"], closed), circuitBrief).problems,
    ).toEqual([copied("switch-open", "(190, 60)")]);
    // A lamp with nothing drawn: a gap in the wire, where the brief has a lamp.
    expect(checkFigure(asLamp2('<g data-symbol="lamp"></g>'), circuitBrief).problems).toEqual([
      copied("lamp", "(320, 140)"),
    ]);
    // A wire in the lamp's own group, joining its ends: a short the wiring doesn't count.
    const shorted = CIRCUIT_SYMBOLS.lamp.replace("</g>", `${wire(-20, 0, 20, 0)}</g>`);
    expect(checkFigure(asLamp2(shorted), circuitBrief).problems).toEqual([
      copied("lamp", "(320, 140)"),
    ]);
  });

  test("a lamp and a resistor drawn as each other", () => {
    const brief: FigureBrief = {
      kind: "circuit",
      components: [{ type: "cell" }, { type: "lamp" }, { type: "resistor" }],
      loop: [0, 1, 2],
      layout: "One loop: the cell on the top wire, the lamp on the right, the resistor below.",
    };
    const loop = (lamp: string, resistor: string) =>
      svgOf(240, [
        wire(60, 60, 160, 60),
        part("translate(180 60)", "cell"),
        wire(200, 60, 300, 60),
        wire(300, 60, 300, 120),
        `<g transform="translate(300 140) rotate(90)">${lamp}</g>`,
        wire(300, 160, 300, 200),
        wire(300, 200, 200, 200),
        `<g transform="translate(180 200)">${resistor}</g>`,
        wire(160, 200, 60, 200),
        wire(60, 200, 60, 60),
      ]);
    expect(
      checkFigure(loop(CIRCUIT_SYMBOLS.lamp, CIRCUIT_SYMBOLS.resistor), brief).problems,
    ).toEqual([]);
    const swapped = loop(
      CIRCUIT_SYMBOLS.resistor.replace('"resistor"', '"lamp"'),
      CIRCUIT_SYMBOLS.lamp.replace('"lamp"', '"resistor"'),
    );
    expect(checkFigure(swapped, brief).problems).toEqual([
      copied("lamp", "(300, 140)"),
      copied("resistor", "(180, 200)"),
    ]);
  });

  test("a line, path or shape outside the symbols that isn't a wire or a dot", () => {
    // Each runs across lamp 2's two ends: a short anyone can see, and the wiring can't.
    for (const [extra, tag] of [
      ['<path class="qf-line" d="M320 120 L320 160"/>', '<path class="qf-line">'],
      ['<line class="qf-thick" x1="320" y1="120" x2="320" y2="160"/>', '<line class="qf-thick">'],
      ['<polygon class="qf-line" points="320,120 320,160 321,160"/>', '<polygon class="qf-line">'],
    ])
      expect(checkFigure(swap(ladder, "</svg>", `${extra}</svg>`), circuitBrief).problems).toEqual([
        `The ${tag} at (320, 120) is not part of the circuit: outside its symbols a circuit has only wires (qf-line lines and polylines, without arrowheads), junction dots (<circle class="qf-ink" r="3"/>) and the brief's labels`,
      ]);
  });

  test("two parts drawn on one spot, which look like one", () => {
    const stacked = svgOf(240, [
      wire(40, 60, 90, 60),
      part("translate(110 60)", "cell"),
      wire(130, 60, 170, 60),
      part("translate(190 60)", "switch-open"),
      wire(210, 60, 260, 60),
      wire(260, 60, 260, 120),
      part("translate(260 140) rotate(90)", "lamp"),
      part("translate(260 140) rotate(90)", "lamp"),
      wire(260, 160, 260, 220),
      wire(260, 220, 40, 220),
      wire(40, 220, 40, 160),
      part("translate(40 140) rotate(90)", "meter"),
      `<text class="qf-strong" x="40" y="145.5" text-anchor="middle">A</text>`,
      wire(40, 120, 40, 60),
      `<circle class="qf-ink" cx="260" cy="120" r="3"/>`,
      `<circle class="qf-ink" cx="260" cy="160" r="3"/>`,
    ]);
    expect(checkFigure(stacked, circuitBrief).problems).toEqual([
      "The lamp at (260, 140) and the lamp at (260, 140) are drawn over each other: keep components at least 50 units apart",
    ]);
  });

  test("text in a circuit that is neither a label the brief gives nor a meter's letter", () => {
    const caption = swap(
      ladder,
      "</svg>",
      '<text class="qf-text" x="150" y="140" text-anchor="middle">parallel</text></svg>',
    );
    expect(checkFigure(caption, circuitBrief).problems).toEqual([
      'Text "parallel" is neither a label the brief gives nor a meter\'s letter: a circuit has no other text',
    ]);
  });

  test("a food web's caption, a line with no head, a head drawn as a shape, a name twice", () => {
    const caption = swap(
      web,
      "</svg>",
      '<text class="qf-small" x="300" y="36" text-anchor="middle">top predator</text></svg>',
    );
    expect(checkFigure(caption, webBrief).problems).toEqual([
      'Text "top predator" is not an organism in the brief: a food web has no other text',
    ]);
    // An extra feeding link, fox to owl, its head a filled triangle rather than a marker.
    const drawnHead = swap(
      web,
      "</svg>",
      '<line class="qf-line" x1="94" y1="98" x2="178" y2="46"/><polygon class="qf-ink" points="180,44 170,45 175,52"/></svg>',
    );
    expect(checkFigure(drawnHead, webBrief).problems).toEqual([
      'The <line class="qf-line"> from (94, 98) has no arrowhead: every line in a food web is an arrow with one head, by what eats the food',
      'The <polygon class="qf-ink"> at (180, 44) is not part of the food web: draw only the organisms\' names and an arrow (a qf-line with marker-end) for each pair',
    ]);
    const twice = swap(
      web,
      name(94, 276, "grass"),
      name(94, 276, "grass") + name(30, 236, "grass"),
    );
    expect(checkFigure(twice, webBrief).problems).toEqual([
      'The organism "grass" is written 2 times: write each name once',
    ]);
  });
});

describe("a model's SVG can't trip the checker", () => {
  test("a tag or class named like something every object has is only a name", () => {
    for (const odd of ["<valueOf/>", '<toString x="1"/>', "<constructor/>", "<hasOwnProperty/>"]) {
      const svg = swap(graph.reply.svg, "</svg>", `${odd}</svg>`);
      expect(problemsOf(svg)).toContain(`<svg> ${odd.replace(/ .*|\/>/, ">")} is not allowed`);
      expect(cleanFigure(svg)).not.toContain(odd.slice(1, 6));
    }
    const cls = swap(
      graph.reply.svg,
      'class="qf-line" x1="64" y1="224"',
      'class="constructor" x1="64" y1="224"',
    );
    expect(problemsOf(cls)).toContain("<svg> <line> has a class not in the list: constructor");
    const tag = swap(ladder, 'data-symbol="cell"', 'data-symbol="toString"');
    expect(checkFigure(tag, circuitBrief).problems).toContain(
      '<svg> <g> <g> data-symbol="toString" is not one of the circuit symbols',
    );
  });

  test("an <svg> inside the figure, or anything extra in the arrowhead block", () => {
    const nested = swap(
      graph.reply.svg,
      "</svg>",
      '<svg class="fixed inset-0" viewBox="0 0 1 1"/></svg>',
    );
    expect(problemsOf(nested)).toContain(
      "<svg> <svg> is not allowed: an <svg> is only ever the root",
    );
    expect(cleanFigure(nested)).not.toContain("inset-0");
    const defs = swap(
      profile,
      'orient="auto-start-reverse"',
      'orient="auto-start-reverse" onload="x"',
    );
    expect(checkFigure(defs, profileBrief).problems).toContain(
      "<defs> must be the arrowhead block, copied exactly",
    );
  });

  test("an alt too long to save is sent back, not saved", () => {
    const long = { ...graph.reply, alt: "A line graph of distance against time. ".repeat(30) };
    const r = checkReply(long, graph.request.brief);
    expect(r.problems).toEqual([
      "alt is longer than 1000 characters: describe the figure more briefly",
    ]);
    expect(r.figure).toBeNull();
  });
});

describe("a saved figure is made safe for the page, without the drawing's checks", () => {
  test("a figure that passed comes back exactly as it was checked", () => {
    const drawings: [string, FigureBrief][] = [
      ...FIGURE_EXAMPLES.map((e) => [e.reply.svg, e.request.brief] as [string, FigureBrief]),
      [profile, profileBrief],
      [web, webBrief],
      [ladder, circuitBrief],
    ];
    for (const [svg, brief] of drawings) {
      const checked = checkFigure(svg, brief);
      expect(checked.problems).toEqual([]);
      expect(cleanFigure(checked.svg!)).toBe(checked.svg);
    }
  });

  test("a figure that a later layout rule would refuse still shows", () => {
    const over = swap(graph.reply.svg, 'x="204" y="266"', 'x="64" y="246"');
    expect(problemsOf(over).length).toBeGreaterThan(0);
    expect(cleanFigure(over)).toContain('x="64" y="246" text-anchor="middle">time in s</text>');
  });

  test("nothing unsafe gets through, and what can't be read is nothing", () => {
    const bad = swap(
      graph.reply.svg.replace('role="img"', 'role="img" onload="x"'),
      "</svg>",
      '<script>alert(1)</script><line class="fixed inset-0" x1="1" y1="1" x2="2" y2="2" onclick="x" marker-end="url(https://example.com/a.svg#b)"/><g transform="scale(9)"/><tspan x="1">loose</tspan></svg>',
    );
    const clean = cleanFigure(bad)!;
    for (const gone of ["onload", "script", "inset-0", "onclick", "example.com", "scale", "loose"])
      expect(clean).not.toContain(gone);
    expect(clean).toStartWith(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 280" class="qf" role="img">',
    );
    expect(cleanFigure("<svg")).toBeNull();
    expect(cleanFigure("<!-- --><svg/>")).toBeNull();
    expect(cleanFigure('<g xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
  });
});

describe("a chromatogram, wave or force diagram is held to what decides its answer", () => {
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
      { shows: "amplitude", letter: "A" },
      { shows: "crest to trough", letter: "B" },
    ],
  };
  const rope: FigureBrief = {
    kind: "wave",
    x: { title: "distance in cm", min: 0, max: 40, step: 5 },
    y: { title: "displacement in cm", min: -4, max: 4, step: 1 },
    amplitude: 3,
    wavelength: 20,
  };
  const pushes: FigureBrief = {
    kind: "forces",
    object: "van",
    toScale: true,
    forces: [
      { direction: "right", name: "driving force", size: 2500 },
      { direction: "left", name: "air resistance", size: 1000 },
    ],
  };
  const svgOf = (brief: FigureBrief) => drawWithCode(brief)!.svg;

  test("drawn right, each passes", () => {
    for (const brief of [pens, lettered, rope, pushes])
      expect(checkFigure(svgOf(brief), brief).problems).toEqual([]);
  });

  test("a chromatogram's spot in another lane, names swapped, or the front moved", () => {
    // P's third spot drawn in Q's lane: Q would seem to hold a dye the note lacks.
    const moved = swap(svgOf(pens), 'cx="138.25" cy="90"', 'cx="187.75" cy="90"');
    expect(checkFigure(moved, pens).problems).toEqual([
      "The spot at 7.9 in P's lane is not where its lane and distance put it",
    ]);
    const swapped = swap(
      swap(svgOf(pens), 'middle">P<', 'middle">X<'),
      'middle">Q<',
      'middle">P<',
    ).replace('middle">X<', 'middle">Q<');
    expect(checkFigure(swapped, pens).problems).toEqual([
      'The name "P" is not under its own lane',
      'The name "Q" is not under its own lane',
    ]);
    const front = swap(
      svgOf(pens),
      'y1="48" x2="262" y2="48"/><text class="qf-small" x="268"',
      'y1="68" x2="262" y2="68"/><text class="qf-small" x="268"',
    );
    expect(checkFigure(front, pens).problems).toContain(
      "The solvent front is not drawn across the paper at its distance, y = 48",
    );
  });

  test("a chromatogram's extra spot, or a caption that gives the answer", () => {
    const extra = swap(
      svgOf(pens),
      "</svg>",
      '<circle class="qf-dot" cx="187.75" cy="90" r="5"/></svg>',
    );
    expect(checkFigure(extra, pens).problems).toContain(
      "The chromatogram has 10 spots; the brief has 9",
    );
    const caption = swap(
      svgOf(pens),
      "</svg>",
      '<text class="qf-small" x="200" y="300" text-anchor="middle">same as note</text></svg>',
    );
    expect(checkFigure(caption, pens).problems).toContain(
      'Text "same as note" is not part of the chromatogram',
    );
  });

  test("a wave's letters on the wrong arrows, or an arrow across the wrong span", () => {
    const swapped = swap(swap(svgOf(lettered), 'end">A<', 'end">X<'), 'end">B<', 'end">A<').replace(
      'end">X<',
      'end">B<',
    );
    expect(checkFigure(swapped, lettered).problems).toEqual([
      'The letter beside the amplitude arrow is "B"; the brief gives it "A"',
      'The letter beside the crest to trough arrow is "A"; the brief gives it "B"',
    ]);
    // The amplitude arrow drawn from a trough: twice the amplitude.
    const tall = swap(
      svgOf(lettered),
      'x1="72" y1="130" x2="72" y2="74"',
      'x1="72" y1="186" x2="72" y2="74"',
    );
    expect(checkFigure(tall, lettered).problems).toContain(
      "The amplitude arrow is missing: a double arrow from (72, 130) to (72, 74)",
    );
  });

  test("a wave off its sine, or joined so sparsely that a crest is cut short", () => {
    const svg = svgOf(rope);
    const points = /points="([^"]+)"/.exec(svg)![1].split(" ");
    const sparse = svg.replace(
      /points="[^"]+"/,
      `points="${points.filter((_, i) => i % 5 === 0).join(" ")}"`,
    );
    expect(checkFigure(sparse, rope).problems).toContain(
      "The wave's points must run left to right, at most 4 units apart",
    );
    const taller = svg.replace(/points="[^"]+"/, () => {
      const scaled = points.map((p) => {
        const [x, y] = p.split(",").map(Number);
        return `${x},${Number((116 - (116 - y) * 1.2).toFixed(2))}`;
      });
      return `points="${scaled.join(" ")}"`;
    });
    expect(checkFigure(taller, rope).problems.join()).toContain("which is off its sine");
  });

  test("a force pointing the wrong way, out of proportion, or labelled as another", () => {
    const reversed = swap(
      svgOf(pushes),
      'x1="220" y1="124" x2="316" y2="124"',
      'x1="316" y1="124" x2="220" y2="124"',
    );
    expect(checkFigure(reversed, pushes).problems).toContain(
      "The driving force arrow is missing: one head, from (220, 124) to (316, 124)",
    );
    // Drawn as long as the driving force, the air resistance would look balanced.
    const even = swap(svgOf(pushes), 'x2="101.6" y2="124"', 'x2="44" y2="124"');
    expect(checkFigure(even, pushes).problems).toContain(
      "The air resistance arrow is missing: one head, from (140, 124) to (101.6, 124)",
    );
    const relabelled = swap(
      swap(svgOf(pushes), ">driving force<", ">air resistance<"),
      '>air resistance<tspan x="83.76" dy="18">1000 N',
      '>driving force<tspan x="83.76" dy="18">1000 N',
    );
    expect(checkFigure(relabelled, pushes).problems.join()).toContain(
      "is not written in the right arrow's corner",
    );
  });

  test("a resultant drawn in, or a caption, on a force diagram", () => {
    const resultant = swap(
      svgOf(pushes),
      "</svg>",
      '<line class="qf-line" x1="180" y1="144" x2="180" y2="200" marker-end="url(#qf-head)"/></svg>',
    );
    expect(checkFigure(resultant, pushes).problems).toContain(
      "The arrow from (180, 144) to (180, 200) is not a force in the brief",
    );
    const caption = swap(
      svgOf(pushes),
      "</svg>",
      '<text class="qf-text" x="180" y="240" text-anchor="middle">1500 N</text></svg>',
    );
    expect(checkFigure(caption, pushes).problems).toContain(
      "Text \"1500 N\" is not a force's label or the object's name",
    );
  });
});
