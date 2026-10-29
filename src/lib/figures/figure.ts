/**
 * Question figures: the one picture a question needs (a graph, a circuit, a
 * reaction profile, a food web, a chromatogram, a wave, the forces on an
 * object), drawn as SVG by code or a model from a brief that holds every
 * value, and checked by `figureCheck` before any student sees it.
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
/** No line or shape is drawn closer than this to the canvas edge. */
export const CANVAS_MARGIN = 8;
/**
 * Text may come this close: its box is its letters' full width, wider than
 * their ink, and a graph's last tick number sits 16 units from the edge.
 */
export const TEXT_MARGIN = 2;

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

/**
 * How wide each character is drawn, as a share of the font size: the widest of
 * the three text styles in the site's face, Plus Jakarta Sans (measured in the
 * browser, 17 Oct 2026). A character not listed counts as 0.75.
 */
const CHAR_WIDTHS: [number, string][] = [
  [0.18, " "],
  [0.26, "ijl"],
  [0.29, "I"],
  [0.33, "'"],
  [0.36, "⁺⁻"],
  [0.38, "₂"],
  [0.39, "r,"],
  [0.4, "J₃"],
  [0.41, "1f.:₄()"],
  [0.42, "t²"],
  [0.43, ";³"],
  [0.49, "z"],
  [0.52, "s"],
  [0.53, "/"],
  [0.55, "LT°"],
  [0.56, "7"],
  [0.58, "avxZ"],
  [0.59, "kF"],
  [0.6, "269hnuy"],
  [0.61, "3ceE"],
  [0.62, "5"],
  [0.63, "8-"],
  [0.65, "oPS"],
  [0.66, "4g"],
  [0.67, "bdpqRY"],
  [0.68, "X+−–=×"],
  [0.69, "BK"],
  [0.71, "V"],
  [0.72, "0U"],
  [0.73, "AΔ"],
  [0.74, "DHN"],
  [0.78, "C"],
  [0.82, "G"],
  [0.88, "OQ"],
  [0.91, "wM"],
  [0.93, "m"],
  [0.94, "→"],
  [1.03, "W"],
  [1.07, "%"],
];
const CHAR_WIDTH = new Map(CHAR_WIDTHS.flatMap(([w, cs]) => [...cs].map((c) => [c, w] as const)));

/** The width of a line of text at a font size, in units. */
export const textWidth = (text: string, size: number) =>
  [...text].reduce((sum, c) => sum + (CHAR_WIDTH.get(c) ?? 0.75), 0) * size;

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

/**
 * A reaction profile's fixed drawing, 300 units high: the reactants (R) and
 * products (P) levels, the top of the curve, and the catalysed curve's top
 * (T). The two activation energy arrows stand on the reactants line, left of
 * the curve, where no curve or label can crowd their letters; the overall
 * energy change stands right of the curve, over the products line.
 */
export const PROFILE = {
  height: 300,
  levels: {
    exothermic: { R: 160, P: 212, T: 120 },
    endothermic: { R: 212, P: 136, T: 104 },
  },
  top: 72,
  arrowX: {
    "activation energy": 76,
    "activation energy with a catalyst": 100,
    "overall energy change": 300,
  },
} as const;

/**
 * A chromatogram's fixed drawing, 320 units high: the paper, with the scale
 * up its left edge from the start line (value 0) to the scale's top, the
 * sample names under the start line, and "solvent front" and "start line"
 * written beyond the paper's right edge, level with their lines.
 */
export const CHROMATOGRAM = {
  height: 320,
  left: 64,
  right: 262,
  paperTop: 32,
  /** y of the scale's top value. */
  top: 48,
  /** y of the start line: the scale's 0. */
  start: 248,
  paperBottom: 284,
  /** x of the two line labels, beyond the paper. */
  labelX: 268,
} as const;

/** x of a chromatogram's lane: `n` lanes share the paper's width evenly. */
export const laneX = (i: number, n: number) =>
  CHROMATOGRAM.left + ((CHROMATOGRAM.right - CHROMATOGRAM.left) * (i + 0.5)) / n;

/** y of a distance up a chromatogram, on a scale from 0 to `max`. */
export const chromaY = (v: number, max: number) =>
  CHROMATOGRAM.start - (v / max) * (CHROMATOGRAM.start - CHROMATOGRAM.top);

/**
 * A wave drawn with lettered arrows and no scale, 260 units high: two whole
 * waves from `left` to `right` across a rest line, `amp` high. The two
 * vertical arrows stand left of the wave, joined to its first crest and
 * trough by guide lines; the wavelength arrow runs above the crests, the half
 * wavelength arrow below the second half's troughs.
 */
export const WAVE = {
  height: 260,
  left: 96,
  right: 336,
  rest: 130,
  amp: 56,
  restFrom: 66,
  restTo: 344,
} as const;
/** One wavelength of the lettered wave, in units. */
export const WAVE_LENGTH = (WAVE.right - WAVE.left) / 2;

/** What a lettered wave's arrow may show. */
export const WAVE_SPANS = [
  "amplitude",
  "wavelength",
  "crest to trough",
  "half a wavelength",
] as const;
export type WaveSpan = (typeof WAVE_SPANS)[number];

/** Each lettered wave arrow: its two ends, and where its letter is written. */
export const WAVE_ARROWS: Record<
  WaveSpan,
  {
    from: [number, number];
    to: [number, number];
    letter: [number, number, "start" | "end" | "middle"];
  }
> = {
  amplitude: {
    from: [72, WAVE.rest],
    to: [72, WAVE.rest - WAVE.amp],
    letter: [64, WAVE.rest - WAVE.amp / 2 + 5.5, "end"],
  },
  "crest to trough": {
    from: [44, WAVE.rest - WAVE.amp],
    to: [44, WAVE.rest + WAVE.amp],
    letter: [36, WAVE.rest + 5.5, "end"],
  },
  wavelength: {
    from: [WAVE.left + WAVE_LENGTH / 4, WAVE.rest - WAVE.amp - 20],
    to: [WAVE.left + (WAVE_LENGTH * 5) / 4, WAVE.rest - WAVE.amp - 20],
    letter: [WAVE.left + (WAVE_LENGTH * 3) / 4, WAVE.rest - WAVE.amp - 28, "middle"],
  },
  "half a wavelength": {
    from: [WAVE.left + WAVE_LENGTH, WAVE.rest + WAVE.amp + 20],
    to: [WAVE.left + (WAVE_LENGTH * 3) / 2, WAVE.rest + WAVE.amp + 20],
    letter: [WAVE.left + (WAVE_LENGTH * 5) / 4, WAVE.rest + WAVE.amp + 40, "middle"],
  },
};

/**
 * The forces on an object, 260 units high: the object a box in the middle,
 * each force an arrow out from the middle of the side it acts on, and each
 * label beside its own arrow, on its own side of it, so no two labels can
 * meet: up's right of its arrow, right's below, down's left, left's above.
 */
export const FORCES = {
  height: 260,
  box: { x0: 140, y0: 104, x1: 220, y1: 144 },
  /** Every arrow's length when the forces are not drawn to scale. */
  length: 72,
  /** The longest arrow's length when they are. */
  longest: 96,
  /** How wide a force's name may run before it wraps. */
  nameWidth: 128,
} as const;
export const FORCE_DIRECTIONS = ["up", "down", "left", "right"] as const;
export type ForceDirection = (typeof FORCE_DIRECTIONS)[number];

/** Where a force's arrow starts: the middle of the box's side it acts on. */
export const forceStart = (d: ForceDirection): [number, number] => {
  const { x0, y0, x1, y1 } = FORCES.box;
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  return { up: [cx, y0], down: [cx, y1], left: [x0, cy], right: [x1, cy] }[d] as [number, number];
};
/** Which way an arrow pointing in a direction runs, as a unit step. */
export const FORCE_STEP: Record<ForceDirection, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
/**
 * Where a force's label is written: x, the first line's baseline and the
 * anchor, given its number of lines, its widest line and its arrow's length.
 * Each is centred on the middle of its arrow, but no nearer the box than the
 * box's own corner: up's ends 8 above it, down's starts 21 below it, left's
 * and right's end 4 short of it, so no label can touch the box or a line.
 */
export const forceLabelAt = (
  d: ForceDirection,
  lines: number,
  width: number,
  length: number,
): [number, number, string] => {
  const { x0, y0, x1, y1 } = FORCES.box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  // The first baseline that centres the lines on y.
  const centred = (y: number) => y + 5.5 - 9 * (lines - 1);
  return {
    up: [cx + 8, Math.min(centred(y0 - length / 2), y0 - 8 - 18 * (lines - 1)), "start"],
    down: [cx - 8, Math.max(centred(y1 + length / 2), y1 + 21), "end"],
    left: [Math.min(x0 - length / 2, x0 - 4 - width / 2), cy - 10 - 18 * (lines - 1), "middle"],
    right: [Math.max(x1 + length / 2, x1 + 4 + width / 2), cy + 22, "middle"],
  }[d] as [number, number, string];
};

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
/**
 * One step round a circuit's loop: a component (its index in `components`),
 * or branches side by side between the same two junctions, each branch its
 * own steps in series.
 */
export type CircuitStep = number | { parallel: CircuitStep[][] };
export type CircuitBrief = {
  kind: "circuit";
  components: { type: CircuitSymbol | "ammeter" | "voltmeter" | "motor"; label?: string }[];
  /** How the components are joined, once round the main loop. The checker holds the wiring to it. */
  loop: CircuitStep[];
  /** Where each part goes, in words: "the cell on the top wire, the ammeter on the left wire". */
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
export type ChromatogramBrief = {
  kind: "chromatogram";
  /** The scale up the paper's side, from the start line at 0. */
  y: Axis;
  /** How far the solvent front is from the start line. */
  front: number;
  /** Each sample's lane, in order across the paper: its name and each spot's distance from the start line. */
  samples: { name: string; spots: number[] }[];
};
/**
 * A wave: either drawn the same size every time with lettered arrows the
 * question asks about, or on a scale it is read from, with no arrows.
 */
export type WaveBrief =
  | { kind: "wave"; arrows: { shows: WaveSpan; letter: string }[] }
  | {
      kind: "wave";
      /** Distance or time along the wave; displacement, from −max to max. */
      x: Axis;
      y: Axis;
      amplitude: number;
      /** The length of one whole wave along the x axis (its period, when x is time). */
      wavelength: number;
    };
export type ForceBrief = {
  kind: "forces";
  /** The object's name, written in its box, or "" for none. */
  object: string;
  /** At most one force each way. A force the question asks for has size null. */
  forces: { direction: ForceDirection; name: string; size: number | null }[];
  /** Arrows in proportion to their sizes (every size given); otherwise all one length. */
  toScale: boolean;
};
/** A figure the contract has drawing rules for. */
export type KnownBrief =
  | GraphBrief
  | BarBrief
  | CircuitBrief
  | ProfileBrief
  | WebBrief
  | ChromatogramBrief
  | WaveBrief
  | ForceBrief;

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
