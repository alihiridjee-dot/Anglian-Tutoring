/**
 * The DeepSeek prompt that draws a question's figure, and the request it is
 * sent with. Written from the contract in figure.ts, so the prompt, the
 * checker (figureCheck) and the stylesheet's .qf rules say the same thing.
 * docs/prompts/deepseek-figure-prompt.md is printed from this file
 * (`bun scripts/figure-trial.ts doc`), and a test keeps the two equal.
 */
import {
  ARROW_DEFS,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  CIRCUIT_SYMBOLS,
  FIGURE_CLASSES,
  MAX_LINE,
  PLOT,
  type FigureBrief,
  type FigureReply,
} from "./figure";

export const FIGURE_ENDPOINT = "https://api.deepseek.com/chat/completions";

/**
 * The request settings. Thinking on at high effort: coordinates are worked
 * out, not guessed. Temperature has no effect in thinking mode, so none is
 * sent. JSON mode needs the prompt to ask for JSON, which it does.
 */
export const FIGURE_REQUEST = {
  model: "deepseek-flash",
  thinking: { type: "enabled" },
  reasoning_effort: "high",
  response_format: { type: "json_object" },
  max_tokens: 32_000,
  stream: false,
} as const;

/** Off-peak and peak price per million tokens, US dollars (checked 11 Oct 2026). */
export const FIGURE_PRICE = {
  offPeak: { input: 0.15, cachedInput: 0.003, output: 0.6 },
  peak: { input: 0.3, cachedInput: 0.006, output: 1.2 },
};

const classes = Object.entries(FIGURE_CLASSES)
  .map(([name, look]) => `${name.padEnd(9)} ${look}`)
  .join("\n");

const symbols = Object.entries(CIRCUIT_SYMBOLS)
  .map(([name, svg]) => `${name}:\n${svg}`)
  .join("\n\n");

const bottom = `H − ${PLOT.bottomGap}`;
const plotWidth = PLOT.right - PLOT.left;

export const FIGURE_SYSTEM = `You draw one exam-style figure for a UK GCSE or IGCSE science question, as a single SVG, for a website where 14 to 16 year olds answer questions on their phones. Students answer from your figure, so it must be exactly right, easy to read at phone size, and never cluttered.

You receive the question (with its options when it is multiple choice) and a figure brief: the figure's kind and every value, label and connection it must show. Draw exactly the brief. Add no data, labels, titles or decoration of your own, and nothing that gives the answer away.

OUTPUT
Reply with one JSON object and nothing else:
{"status": "ok" | "not_needed" | "cannot_draw", "reason": string, "alt": string, "labels": string[], "svg": string}
- status "ok": you drew the figure.
- status "not_needed": the brief is text the website lays out itself: a dichotomous key, a list, a table of results, a set of steps.
- status "cannot_draw": the brief needs a realistic picture (a cell, an organ, a leaf, an animal, a microscope image, laboratory apparatus), or a kind with no rules below, or it breaks a rule below.
- reason: one short sentence saying why, when status is not "ok"; otherwise "".
- alt: one plain sentence describing the figure for a screen reader, without giving the answer.
- labels: every line of text in the SVG, exactly as written, in reading order.
- svg: the whole SVG document as one string; "" when status is not "ok".

CANVAS
- The root element is exactly <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} H" class="qf" role="img">. H is a multiple of 20 from 200 to 480: the smallest that fits the figure. Give the root no other attribute.
- The website shows the figure 300 to 420 pixels wide, so one unit is about one pixel on a phone.
- Keep everything at least ${CANVAS_MARGIN} units inside every edge: x from ${CANVAS_MARGIN} to ${CANVAS_WIDTH - CANVAS_MARGIN}, y from ${CANVAS_MARGIN} to H − ${CANVAS_MARGIN}.
- Write every number plainly, with at most two decimal places: 187.2, not 187.20000001 or 1.872e2.

STYLE
Colour, weight and font come only from these classes; the website's stylesheet draws each one:
${classes}
Every line, polyline, polygon, rect, circle, ellipse, path and text carries exactly one of these classes. Never write fill, stroke, font, opacity, style or colour attributes, and never write CSS.

ELEMENTS
- Use only: svg, defs, marker, g, line, polyline, polygon, rect, circle, ellipse, path, text, tspan.
- Never use: script, style, image, foreignObject, a, use, symbol, animate, filter, gradients, patterns, clipPath, mask, href, event attributes, comments, or any entity except &amp; &lt; &gt; &quot; &apos;.
- Attributes: line x1 y1 x2 y2; polyline and polygon points ("x,y x,y"); rect x y width height rx; circle cx cy r; ellipse cx cy rx ry; path d, with the absolute commands M L H V C S Q Z only; text x y text-anchor and, to rotate, transform; tspan x dy; g transform; plus class, and the data- attributes the rules below ask for.
- transform may only translate and rotate: "translate(x y)", "rotate(a cx cy)", or both.
- An arrow is a line ending in marker-end="url(#qf-head)" (a double arrow also has marker-start="url(#qf-head)"). When the figure has an arrow, the first child of <svg> is this block, copied exactly:
${ARROW_DEFS}

TEXT
- Every <text> has x, y and text-anchor ("start", "middle" or "end"); y is the baseline.
- At most ${MAX_LINE} characters on a line. Split a longer label: put its first line in the <text>, then each further line in <tspan x="(the same x)" dy="18">.
- Work out the space a line of text takes: width = 0.55 × font size × number of characters; it reaches 0.8 × font size above its baseline and 0.25 × font size below.
- No two pieces of text may overlap, and no text may sit on a line or a shape's edge: leave at least 4 units clear around every label. Grid lines (qf-thin) may pass behind text.
- Write quantities and units as the brief does ("time in s"), and proper characters: CO₂, cm³, °C, ×, −, Δ.

LINE GRAPHS AND SCATTER GRAPHS (kind "line-graph" or "scatter")
- The plot area runs from x = ${PLOT.left} to x = ${PLOT.right} and from y = ${PLOT.top} down to y = ${bottom}.
- Place every value with these formulas, exactly. Never stretch an axis or round a position:
  x position = ${PLOT.left} + (value − x.min) ÷ (x.max − x.min) × ${plotWidth}
  y position = (${bottom}) − (value − y.min) ÷ (y.max − y.min) × (H − ${PLOT.bottomGap + PLOT.top})
- Axes (qf-line): from (${PLOT.left}, ${bottom}) to (${PLOT.right}, ${bottom}), and from (${PLOT.left}, ${PLOT.top}) to (${PLOT.left}, ${bottom}).
- Grid lines (qf-thin) at every x.step and y.step across the whole plot area.
- Tick numbers (qf-small): x ticks at y = H − 38, text-anchor "middle", at each tick's x position; y ticks at x = ${PLOT.left - 8}, text-anchor "end", baseline 5 below the tick's y position. When neighbouring tick numbers would be closer than 28 units, number every second tick only.
- Axis titles (qf-text): the x title at x = 204, y = H − 14, text-anchor "middle"; the y title at x = 16, y = 22, text-anchor "start", above the axis.
- Every point is <circle class="qf-dot" cx="…" cy="…" r="3.5" data-x="…" data-y="…"/>, data-x and data-y being the point's values from the brief.
- A line graph joins each series' points in order with one polyline (qf-data; a second series qf-data2) whose corners are exactly the points' centres. Never curve, smooth or extend a line beyond its points. A scatter graph has no line.
- With two series, add a key inside the plot area's top left: a qf-box with each series' name beside a short sample of its line.

BAR CHARTS (kind "bar-chart")
- Same plot area, formulas, axes, y grid lines, y tick numbers and titles as a line graph; no x grid lines and no x tick numbers.
- With n categories each takes a slot ${plotWidth} ÷ n wide. A bar is centred in its slot, min(40, 0.6 × slot) wide, and runs from the x axis up to its value's y position: <rect class="qf-bar" … data-y="(the value)"/>.
- With two series, the slot holds two bars side by side (qf-bar, then qf-bar2), each min(24, 0.35 × slot) wide, 4 units apart, and a key as for a line graph.
- Each category name (qf-small) sits under its slot at y = H − 38, text-anchor "middle".

CIRCUITS (kind "circuit")
- Draw the circuit the brief's layout describes, with exactly its components. Wires are straight qf-line segments meeting at right angles. Put the main loop on a rectangle about 240 units wide and 120 to 200 units high; draw a parallel branch as a smaller rectangle joined to the loop; mark every junction where three wires meet with <circle class="qf-ink" r="3"/>.
- Draw each component by copying its symbol below exactly, wrapped in <g transform="translate(x y)"> to put its centre at (x, y), or translate(x y) rotate(90) on an upright wire. Each symbol spans x −20 to 20, with its terminals at (−20, 0) and (20, 0): the wire stops at a terminal and starts again at the other. Keep components at least 50 units apart.
- An ammeter, voltmeter or motor is the meter symbol plus its letter A, V or M: <text class="qf-strong" x="(centre x)" y="(centre y + 5.5)" text-anchor="middle">, never rotated.
- Label a component only where the brief gives it a label: qf-text, at least 12 units clear of the symbol and its wires.
- Symbols:
${symbols}

REACTION PROFILES (kind "energy-profile")
- H = 300. Energy axis: an arrow (qf-line) from (40, 260) up to (40, 28), with "energy" (qf-text) at x = 48, y = 36, text-anchor "start". Progress axis: an arrow from (40, 260) right to (344, 260), with "progress of reaction" (qf-text) at x = 192, y = 288, text-anchor "middle". No numbers on either axis.
- Levels: exothermic: reactants R = 160, products P = 212. Endothermic: reactants R = 212, products P = 136. The reactants line (qf-line) runs from (56, R) to (112, R); the products line from (256, P) to (336, P).
- The profile (qf-data) is <path d="M112 R C148 R 148 72 184 72 S220 P 256 P"/> with R and P filled in. With a catalyst, also draw <path class="qf-data2" d="M112 R C148 R 148 T 184 T S220 P 256 P"/>, where T = 120 for an exothermic reaction and T = 104 for an endothermic one.
- Write the brief's reactants name centred under its line (x = 84) at y = R + 22, and its products name centred under its line (x = 296) at y = P + 22, at most 12 characters on a line: split a longer name over lines.
- Draw each of the brief's arrows, and no other, as a double arrow (qf-line with marker-start and marker-end), labelled with its letter (qf-strong) beside the arrow's middle:
  activation energy: from (190, R) up to (190, 72), its letter 8 units to the right (text-anchor "start"), with a guide (qf-thin) from (112, R) to (196, R);
  activation energy with a catalyst: from (178, R) up to (178, T), its letter 8 units to the left (text-anchor "end");
  overall energy change: from (300, R) to (300, P), its letter 8 units to the right, with a guide (qf-thin) from (196, R) to (308, R).

FOOD WEBS AND FOOD CHAINS (kind "food-web")
- Rows by level: level 1 (producers) on the bottom row with its baseline at y = H − 24, and each level above it 80 units higher. A row's organisms are evenly spaced: the i-th of n (counting from 0) has x = 8 + 344 × (i + 0.5) ÷ n. At most 4 organisms on a row; on a row of 4, at most 9 characters on a line, otherwise at most 14: split a longer name over lines.
- Each name is qf-text, text-anchor "middle".
- Each [food, eater] pair is an arrow (qf-line, marker-end) from 18 units above the food's baseline to 8 units below the eater's baseline: the arrow points from the food to what eats it. An arrow may not cross a name; order each row so that arrows cross as little as possible.

STEPS
1. Read the brief. If it is not a kind with rules above, or it needs a realistic picture, reply with status "not_needed" or "cannot_draw" at once.
2. Choose H. Work out every coordinate from the formulas and rules above, showing the arithmetic in your thinking.
3. Work out every label's space. Check every pair of labels, and every label against every line, for overlap. Move anything that clashes, keeping the rules.
4. Write the SVG.
5. Check it against every rule above, one by one, and fix anything that breaks one.
6. Reply with the JSON object only.

A program checks the SVG before any student sees it: every element, class and attribute; that everything is on the canvas; that no text overlaps text or sits on a line; that every point, bar and tick number is where its value puts it; that every label in the brief is there and "labels" lists every line of text. A figure that fails any check is thrown away.`;

/** A question and the figure it needs, as the model is given them. */
export type FigureRequest = {
  subject: string;
  question: string;
  /** A multiple-choice question's options. */
  options?: string[];
  brief: FigureBrief;
};

/** The two messages that ask for one figure. */
export function figureMessages(r: FigureRequest) {
  const input = {
    subject: r.subject,
    question: r.question,
    options: r.options ?? null,
    brief: r.brief,
  };
  return [
    { role: "system" as const, content: FIGURE_PROMPT },
    {
      role: "user" as const,
      content: `Draw the figure for this question. Reply with the JSON object only.\n\n${JSON.stringify(input, null, 1)}`,
    },
  ];
}

/** The follow-up when the checker rejects a figure: its problems, to fix in one more try. */
export function retryMessage(problems: string[]) {
  return {
    role: "user" as const,
    content: `The checking program rejected that figure:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix every problem, keeping all the rules, and reply with the whole JSON object again.`,
  };
}

/**
 * Worked examples: a brief and the reply that draws it. The checker must
 * pass each one (figureCheck.test.ts), so they show exactly what passing
 * looks like.
 */
export const FIGURE_EXAMPLES: { name: string; request: FigureRequest; reply: FigureReply }[] = [
  {
    name: "distance–time graph",
    request: {
      subject: "physics",
      question:
        "The graph shows how far a cyclist travelled. For how long was the cyclist stationary?",
      options: ["2 s", "4 s", "6 s", "8 s"],
      brief: {
        kind: "line-graph",
        x: { title: "time in s", min: 0, max: 10, step: 2 },
        y: { title: "distance in m", min: 0, max: 50, step: 10 },
        series: [
          {
            name: "cyclist",
            points: [
              [0, 0],
              [2, 10],
              [4, 20],
              [6, 20],
              [8, 35],
              [10, 50],
            ],
          },
        ],
      },
    },
    reply: {
      status: "ok",
      reason: "",
      alt: "A distance–time graph: distance rises from 0 m at 0 s to 20 m at 4 s, stays at 20 m until 6 s, then rises to 50 m at 10 s.",
      labels: [
        "distance in m",
        "50",
        "40",
        "30",
        "20",
        "10",
        "0",
        "0",
        "2",
        "4",
        "6",
        "8",
        "10",
        "time in s",
      ],
      svg: [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 280" class="qf" role="img">`,
        ...[120, 176, 232, 288, 344].map(
          (x) => `<line class="qf-thin" x1="${x}" y1="40" x2="${x}" y2="224"/>`,
        ),
        ...[187.2, 150.4, 113.6, 76.8, 40].map(
          (y) => `<line class="qf-thin" x1="64" y1="${y}" x2="344" y2="${y}"/>`,
        ),
        `<line class="qf-line" x1="64" y1="224" x2="344" y2="224"/>`,
        `<line class="qf-line" x1="64" y1="40" x2="64" y2="224"/>`,
        ...[0, 2, 4, 6, 8, 10].map(
          (v) =>
            `<text class="qf-small" x="${64 + v * 28}" y="242" text-anchor="middle">${v}</text>`,
        ),
        ...[0, 10, 20, 30, 40, 50].map(
          (v) =>
            `<text class="qf-small" x="56" y="${Number((229 - v * 3.68).toFixed(2))}" text-anchor="end">${v}</text>`,
        ),
        `<text class="qf-text" x="204" y="266" text-anchor="middle">time in s</text>`,
        `<text class="qf-text" x="16" y="22" text-anchor="start">distance in m</text>`,
        `<polyline class="qf-data" points="64,224 120,187.2 176,150.4 232,150.4 288,95.2 344,40"/>`,
        ...(
          [
            [0, 0, 64, 224],
            [2, 10, 120, 187.2],
            [4, 20, 176, 150.4],
            [6, 20, 232, 150.4],
            [8, 35, 288, 95.2],
            [10, 50, 344, 40],
          ] as const
        ).map(
          ([x, y, cx, cy]) =>
            `<circle class="qf-dot" cx="${cx}" cy="${cy}" r="3.5" data-x="${x}" data-y="${y}"/>`,
        ),
        `</svg>`,
      ].join(""),
    },
  },
  {
    name: "series circuit",
    request: {
      subject: "physics",
      question: "The switch is closed. Which reading on the ammeter shows the current in the lamp?",
      brief: {
        kind: "circuit",
        components: [
          { type: "cell" },
          { type: "switch-open" },
          { type: "lamp" },
          { type: "ammeter" },
        ],
        layout:
          "One loop: the cell on the top wire, the lamp on the right wire, the ammeter on the bottom wire, the switch on the left wire.",
      },
    },
    reply: {
      status: "ok",
      reason: "",
      alt: "A series circuit: a cell, an open switch, a lamp and an ammeter in one loop.",
      labels: ["A"],
      svg: [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220" class="qf" role="img">`,
        `<line class="qf-line" x1="60" y1="60" x2="160" y2="60"/>`,
        `<line class="qf-line" x1="200" y1="60" x2="300" y2="60"/>`,
        `<line class="qf-line" x1="300" y1="60" x2="300" y2="95"/>`,
        `<line class="qf-line" x1="300" y1="135" x2="300" y2="170"/>`,
        `<line class="qf-line" x1="300" y1="170" x2="200" y2="170"/>`,
        `<line class="qf-line" x1="160" y1="170" x2="60" y2="170"/>`,
        `<line class="qf-line" x1="60" y1="170" x2="60" y2="135"/>`,
        `<line class="qf-line" x1="60" y1="95" x2="60" y2="60"/>`,
        `<g transform="translate(180 60)">${CIRCUIT_SYMBOLS.cell}</g>`,
        `<g transform="translate(300 115) rotate(90)">${CIRCUIT_SYMBOLS.lamp}</g>`,
        `<g transform="translate(180 170)">${CIRCUIT_SYMBOLS.meter}</g>`,
        `<text class="qf-strong" x="180" y="175.5" text-anchor="middle">A</text>`,
        `<g transform="translate(60 115) rotate(90)">${CIRCUIT_SYMBOLS["switch-open"]}</g>`,
        `</svg>`,
      ].join(""),
    },
  },
];

/** The examples, as the prompt shows them to the model. */
export const FIGURE_EXAMPLES_TEXT = FIGURE_EXAMPLES.map(
  (e) =>
    `EXAMPLE: ${e.name}\nInput:\n${JSON.stringify({ ...e.request, options: e.request.options ?? null })}\nReply:\n${JSON.stringify(e.reply)}`,
).join("\n\n");

/** The full system prompt: the rules, then the worked examples. */
export const FIGURE_PROMPT = `${FIGURE_SYSTEM}\n\n${FIGURE_EXAMPLES_TEXT}`;
