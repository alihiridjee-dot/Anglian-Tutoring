/**
 * Question figures: the one picture a question needs (a graph, a circuit, a
 * reaction profile, a food web), drawn as SVG by a model from a brief that
 * holds every value, and checked by `figureCheck` before any student sees it.
 *
 * This file is the contract both sides read: the canvas, the style classes
 * (the stylesheet's .qf rules give them their look), the circuit symbols and
 * the shape of a brief. The prompt (`figurePrompt`) is written from it, and
 * the checker holds the drawing to it.
 */

/** Width of every figure, in SVG units. Shown 300–420 px wide, so 1 unit ≈ 1 px. */
export const CANVAS_WIDTH = 360;
/** Heights a figure may be: a multiple of 20 from 200 to 480. */
export const CANVAS_HEIGHTS = Array.from({ length: 15 }, (_, i) => 200 + i * 20);
/** Nothing is drawn closer than this to the canvas edge. */
export const CANVAS_MARGIN = 8;

/** Every style a figure may use. The stylesheet's .qf rules draw each one. */
export const FIGURE_CLASSES = {
  "qf-line": "stroke 2 in the text colour, no fill: axes, wires, outlines, arrows",
  "qf-thin": "stroke 1 in a pale colour: grid lines only",
  "qf-thick": "stroke 4 in the text colour: a cell's short plate",
  "qf-data": "stroke 3 in the subject colour, no fill: the plotted line, the curve asked about",
  "qf-data2":
    "stroke 3 in a second colour, dashed, no fill: a second plotted line, a catalysed path",
  "qf-dot": "filled in the subject colour: a plotted point",
  "qf-ink": "filled in the text colour: an arrowhead, a switch contact, a junction",
  "qf-bar": "filled in the subject colour: a bar",
  "qf-bar2": "filled in a second colour: a second set of bars",
  "qf-box": "pale fill with an outline: a box around a label or a key",
  "qf-text": "text 16 units, normal weight: labels, axis titles",
  "qf-strong": "text 16 units, bold: a meter's letter, the label of the thing asked about",
  "qf-small": "text 14 units: tick numbers and bar names only",
} as const;
export type FigureClass = keyof typeof FIGURE_CLASSES;

/** Font size of each text style, in units. */
export const TEXT_SIZE: Partial<Record<FigureClass, number>> = {
  "qf-text": 16,
  "qf-strong": 16,
  "qf-small": 14,
};

/** Characters per line of text, at most. */
export const MAX_LINE = 28;

/** Graph plot area. y depends on the canvas height H. */
export const PLOT = {
  left: 64,
  right: 344,
  top: 40,
  /** bottom = H − 56 */
  bottomGap: 56,
} as const;

/** The arrowhead every arrow ends with, copied verbatim as the svg's first child. */
export const ARROW_DEFS =
  '<defs><marker id="qf-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path class="qf-ink" d="M0 0 L10 5 L0 10 Z"/></marker></defs>';

/**
 * Circuit symbols as the GCSE specifications draw them. Each lies along x
 * from −20 to 20, terminals at (−20, 0) and (20, 0), and is placed with
 * transform="translate(x y)", plus " rotate(90)" on a vertical wire. A meter
 * or motor's letter is its own text, never rotated.
 */
export const CIRCUIT_SYMBOLS = {
  cell: '<g data-symbol="cell"><line class="qf-line" x1="-20" y1="0" x2="-4" y2="0"/><line class="qf-line" x1="-4" y1="-14" x2="-4" y2="14"/><line class="qf-thick" x1="4" y1="-7" x2="4" y2="7"/><line class="qf-line" x1="4" y1="0" x2="20" y2="0"/></g>',
  battery:
    '<g data-symbol="battery"><line class="qf-line" x1="-20" y1="0" x2="-12" y2="0"/><line class="qf-line" x1="-12" y1="-14" x2="-12" y2="14"/><line class="qf-thick" x1="-6" y1="-7" x2="-6" y2="7"/><line class="qf-line" x1="-6" y1="0" x2="6" y2="0"/><line class="qf-line" x1="6" y1="-14" x2="6" y2="14"/><line class="qf-thick" x1="12" y1="-7" x2="12" y2="7"/><line class="qf-line" x1="12" y1="0" x2="20" y2="0"/></g>',
  lamp: '<g data-symbol="lamp"><line class="qf-line" x1="-20" y1="0" x2="-10" y2="0"/><circle class="qf-line" cx="0" cy="0" r="10"/><line class="qf-line" x1="-7.1" y1="-7.1" x2="7.1" y2="7.1"/><line class="qf-line" x1="-7.1" y1="7.1" x2="7.1" y2="-7.1"/><line class="qf-line" x1="10" y1="0" x2="20" y2="0"/></g>',
  resistor:
    '<g data-symbol="resistor"><line class="qf-line" x1="-20" y1="0" x2="-14" y2="0"/><rect class="qf-line" x="-14" y="-6" width="28" height="12"/><line class="qf-line" x1="14" y1="0" x2="20" y2="0"/></g>',
  "variable-resistor":
    '<g data-symbol="variable-resistor"><line class="qf-line" x1="-20" y1="0" x2="-14" y2="0"/><rect class="qf-line" x="-14" y="-6" width="28" height="12"/><line class="qf-line" x1="14" y1="0" x2="20" y2="0"/><line class="qf-line" x1="-12" y1="12" x2="12" y2="-12" marker-end="url(#qf-head)"/></g>',
  thermistor:
    '<g data-symbol="thermistor"><line class="qf-line" x1="-20" y1="0" x2="-14" y2="0"/><rect class="qf-line" x="-14" y="-6" width="28" height="12"/><line class="qf-line" x1="14" y1="0" x2="20" y2="0"/><polyline class="qf-line" points="-18,12 -12,12 12,-12"/></g>',
  ldr: '<g data-symbol="ldr"><line class="qf-line" x1="-20" y1="0" x2="-14" y2="0"/><rect class="qf-line" x="-14" y="-6" width="28" height="12"/><line class="qf-line" x1="14" y1="0" x2="20" y2="0"/><circle class="qf-line" cx="0" cy="0" r="17"/><line class="qf-line" x1="-18" y1="-30" x2="-9" y2="-18" marker-end="url(#qf-head)"/><line class="qf-line" x1="-6" y1="-32" x2="3" y2="-20" marker-end="url(#qf-head)"/></g>',
  diode:
    '<g data-symbol="diode"><line class="qf-line" x1="-20" y1="0" x2="-8" y2="0"/><polygon class="qf-line" points="-8,-9 -8,9 8,0"/><line class="qf-line" x1="8" y1="-9" x2="8" y2="9"/><line class="qf-line" x1="8" y1="0" x2="20" y2="0"/></g>',
  led: '<g data-symbol="led"><line class="qf-line" x1="-20" y1="0" x2="-8" y2="0"/><polygon class="qf-line" points="-8,-9 -8,9 8,0"/><line class="qf-line" x1="8" y1="-9" x2="8" y2="9"/><line class="qf-line" x1="8" y1="0" x2="20" y2="0"/><line class="qf-line" x1="0" y1="-12" x2="8" y2="-24" marker-end="url(#qf-head)"/><line class="qf-line" x1="8" y1="-10" x2="16" y2="-22" marker-end="url(#qf-head)"/></g>',
  fuse: '<g data-symbol="fuse"><line class="qf-line" x1="-20" y1="0" x2="20" y2="0"/><rect class="qf-line" x="-14" y="-6" width="28" height="12"/></g>',
  "switch-open":
    '<g data-symbol="switch-open"><line class="qf-line" x1="-20" y1="0" x2="-12" y2="0"/><circle class="qf-ink" cx="-12" cy="0" r="2.5"/><line class="qf-line" x1="-12" y1="0" x2="10" y2="-12"/><circle class="qf-ink" cx="12" cy="0" r="2.5"/><line class="qf-line" x1="12" y1="0" x2="20" y2="0"/></g>',
  "switch-closed":
    '<g data-symbol="switch-closed"><line class="qf-line" x1="-20" y1="0" x2="20" y2="0"/><circle class="qf-ink" cx="-12" cy="0" r="2.5"/><circle class="qf-ink" cx="12" cy="0" r="2.5"/></g>',
  /** Ammeter (A), voltmeter (V) or motor (M): add the letter as its own text. */
  meter:
    '<g data-symbol="meter"><line class="qf-line" x1="-20" y1="0" x2="-11" y2="0"/><circle class="qf-line" cx="0" cy="0" r="11"/><line class="qf-line" x1="11" y1="0" x2="20" y2="0"/></g>',
} as const;
export type CircuitSymbol = keyof typeof CIRCUIT_SYMBOLS;

/** A graph axis: its title (quantity and unit) and its scale. */
export type Axis = { title: string; min: number; max: number; step: number };

/**
 * What a figure must show: every value, label and connection, so the model
 * draws and never decides. Written alongside the question it belongs to.
 */
/** A graph of points: joined by straight lines, or a scatter of points alone. */
export type GraphBrief = {
  kind: "line-graph" | "scatter";
  x: Axis;
  y: Axis;
  series: { name: string; points: [number, number][] }[];
};
export type BarBrief = {
  kind: "bar-chart";
  x: { title: string; categories: string[] };
  y: Axis;
  /** One value per category, in the categories' order. */
  series: { name: string; values: number[] }[];
};
export type CircuitBrief = {
  kind: "circuit";
  components: { type: CircuitSymbol | "ammeter" | "voltmeter" | "motor"; label?: string }[];
  /** Where each part goes, in words: "cell, switch and ammeter in series; two lamps in parallel". */
  layout: string;
};
export type ProfileBrief = {
  kind: "energy-profile";
  reaction: "exothermic" | "endothermic";
  catalyst: boolean;
  /** The names written under the two levels: "hydrogen peroxide", "water + oxygen". */
  reactants: string;
  products: string;
  /** The arrows to draw, each labelled with a letter the question can ask about. */
  arrows: {
    shows: "activation energy" | "activation energy with a catalyst" | "overall energy change";
    letter: string;
  }[];
};
export type WebBrief = {
  kind: "food-web";
  /** level 1 is the producers, 2 what eats them, and so on. */
  organisms: { name: string; level: number }[];
  /** [food, eater]: each arrow points from the food to what eats it. */
  eaten: [string, string][];
};
/** A figure the contract has drawing rules for. */
export type KnownBrief = GraphBrief | BarBrief | CircuitBrief | ProfileBrief | WebBrief;

/**
 * What a figure must show: every value, label and connection, so the model
 * draws and never decides. Any other kind is answered not_needed or
 * cannot_draw.
 */
export type FigureBrief = KnownBrief | { kind: string; [key: string]: unknown };

/** What the model returns. */
export type FigureReply = {
  status: "ok" | "not_needed" | "cannot_draw";
  reason: string;
  alt: string;
  labels: string[];
  svg: string;
};

/** x of a value on a graph's x axis. */
export const plotX = (v: number, a: { min: number; max: number }) =>
  PLOT.left + ((v - a.min) / (a.max - a.min)) * (PLOT.right - PLOT.left);

/** y of a value on a graph's y axis, on a canvas H units high. */
export const plotY = (v: number, a: { min: number; max: number }, H: number) =>
  H - PLOT.bottomGap - ((v - a.min) / (a.max - a.min)) * (H - PLOT.bottomGap - PLOT.top);
