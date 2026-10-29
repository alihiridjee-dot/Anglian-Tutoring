/**
 * The check a question figure passes before any student sees it, and the
 * clean copy that is put on the page.
 *
 * The model's SVG is read by a strict parser that accepts only the small SVG
 * the contract allows (figure.ts): known elements and attributes, style
 * classes, plain numbers. Then the drawing is checked: everything on the
 * canvas, no text over text or over a line, every plotted point and bar where
 * its value puts it, every tick number where its value is, every label the
 * brief names, and what decides an answer: a circuit's wiring, a food web's
 * arrows, a reaction profile's levels and which letter labels which arrow.
 * A circuit or food web holds nothing else: an extra line or caption could
 * change or give away an answer. A figure with any problem is never shown.
 * A figure that passes reaches the page only as `svg`, rebuilt from the
 * parsed tree, so nothing the contract doesn't name can get through; a saved
 * one is rebuilt the same way by `cleanFigure`, without the drawing checks.
 */
import {
  ARROW_DEFS,
  CANVAS_HEIGHTS,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  CHROMATOGRAM,
  CIRCUIT_SYMBOLS,
  FIGURE_CLASSES,
  FORCES,
  FORCE_STEP,
  MAX_LINE,
  PLOT,
  PROFILE,
  TEXT_MARGIN,
  TEXT_SIZE,
  WAVE,
  WAVE_ARROWS,
  WAVE_LENGTH,
  chromaY,
  forceLabelAt,
  forceStart,
  laneX,
  plotX,
  plotY,
  textWidth,
  type ChromatogramBrief,
  type CircuitBrief,
  type CircuitStep,
  type FigureBrief,
  type FigureClass,
  type ForceBrief,
  type KnownBrief,
  type ProfileBrief,
  type WaveBrief,
  type WebBrief,
  type FigureReply,
} from "./figure";
import { forceLabel, forceLength, labelWidth } from "./figureDraw";
import { figureKind } from "./kinds";

type Node = { name: string; attrs: Record<string, string>; children: Node[]; text: string };

/** Each element the contract allows, with the attributes it may carry, in the order they are written. */
const ELEMENTS: Record<string, string[]> = {
  svg: ["xmlns", "viewBox", "class", "role"],
  defs: [],
  marker: ["id", "viewBox", "refX", "refY", "markerUnits", "markerWidth", "markerHeight", "orient"],
  g: ["transform", "data-symbol"],
  line: ["class", "x1", "y1", "x2", "y2", "marker-start", "marker-end"],
  polyline: ["class", "points", "marker-start", "marker-end"],
  polygon: ["class", "points"],
  rect: ["class", "x", "y", "width", "height", "rx", "data-y"],
  circle: ["class", "cx", "cy", "r", "data-x", "data-y"],
  ellipse: ["class", "cx", "cy", "rx", "ry"],
  path: ["class", "d", "marker-start", "marker-end"],
  text: ["class", "x", "y", "text-anchor", "transform"],
  tspan: ["x", "dy"],
};
const DRAWN = ["line", "polyline", "polygon", "rect", "circle", "ellipse", "path", "text"];
const NUMERIC = [
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "dy",
  "data-x",
  "data-y",
];
const NUMBER = /^-?\d+(\.\d{1,2})?$/;
const SVG_NS = "http://www.w3.org/2000/svg";
const HEAD = "url(#qf-head)";
/**
 * The value a table lists under a name the model wrote, never one every
 * object inherits: `<valueOf/>` or class="constructor" is just not listed.
 */
const listed = <T>(table: Partial<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]);
const encode = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Reading ─────────────────────────────────────────────────────────────────

function parse(svg: string): { root: Node | null; problems: string[] } {
  const problems: string[] = [];
  const s = svg.trim();
  if (s.length > 24_000) problems.push("The SVG is longer than 24 000 characters");
  if (/<!|<\?/.test(s)) problems.push("The SVG has a comment, doctype or CDATA section");
  if (/&(?!(amp|lt|gt|quot|apos);)/.test(s))
    problems.push("The SVG has an entity other than &amp; &lt; &gt; &quot; &apos;");
  if (problems.length) return { root: null, problems };
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[a-zA-Z][\w:-]*\s*=\s*"[^"<>]*")*)\s*(\/?)>/y;
  const stack: Node[] = [];
  let root: Node | null = null;
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "<") {
      const end = s.indexOf("<", i);
      const text = s.slice(i, end < 0 ? s.length : end);
      if (stack.length) stack[stack.length - 1].text += decode(text);
      else if (text.trim()) return { root: null, problems: ["The SVG has text outside its root"] };
      i = end < 0 ? s.length : end;
      continue;
    }
    tag.lastIndex = i;
    const m = tag.exec(s);
    if (!m) return { root: null, problems: [`The SVG has an unreadable tag at character ${i}`] };
    const [whole, closing, name, rawAttrs, selfClosing] = m;
    i += whole.length;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name)
        return { root: null, problems: [`The SVG closes <${name}> where it isn't open`] };
      continue;
    }
    // No prototype, so an attribute named like an object's own is only an attribute.
    const attrs: Record<string, string> = Object.create(null);
    for (const a of rawAttrs.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) {
      if (Object.hasOwn(attrs, a[1])) problems.push(`<${name}> has ${a[1]} twice`);
      attrs[a[1]] = decode(a[2]);
    }
    const node: Node = { name, attrs, children: [], text: "" };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (root) return { root: null, problems: ["The SVG has more than one root element"] };
    else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (stack.length) problems.push(`The SVG leaves <${stack[stack.length - 1].name}> open`);
  if (!root) problems.push("The SVG is empty");
  return { root: problems.length ? null : root, problems };
}

/**
 * A tree written out whole, every attribute in name order, leaving out the
 * top element's `skip`: two trees that write out alike are the same drawing.
 */
const exact = (n: Node, skip: string[] = []): string =>
  `<${n.name}${Object.keys(n.attrs)
    .filter((a) => !skip.includes(a))
    .sort()
    .map((a) => ` ${a}="${n.attrs[a]}"`)
    .join("")}>${n.text.trim()}${n.children.map((c) => exact(c)).join("")}</${n.name}>`;
/** The arrowhead block and each circuit symbol, as `exact` writes them. */
const DEFS = exact(parse(ARROW_DEFS).root!);
const SYMBOLS = new Map(
  Object.entries(CIRCUIT_SYMBOLS).map(([name, svg]) => [name, exact(parse(svg).root!)]),
);

/** What each attribute may hold on the page; one holding anything else is left out. */
const SAFE: Record<string, (v: string) => boolean> = {
  class: (v) => Object.hasOwn(FIGURE_CLASSES, v),
  transform: (v) => parseTransform(v) !== null,
  "data-symbol": (v) => SYMBOLS.has(v),
  points: (v) => pointsOf(v) !== null,
  d: (v) => pathPolylines(v) !== null,
  "marker-start": (v) => v === HEAD,
  "marker-end": (v) => v === HEAD,
  "text-anchor": (v) => ["start", "middle", "end"].includes(v),
  ...Object.fromEntries(NUMERIC.map((a) => [a, (v: string) => NUMBER.test(v)])),
};

/**
 * The tree written back out: only the contract's elements, each only where
 * it may stand, with only its own attributes holding allowed values, in the
 * contract's order. The arrowhead block is written only exactly as it is.
 */
function serialize(n: Node, parent: string): string {
  if (n.name === "defs") return parent === "svg" && exact(n) === DEFS ? ARROW_DEFS : "";
  if (n.name === "svg" || n.name === "marker" || !Object.hasOwn(ELEMENTS, n.name)) return "";
  // A tspan stands in a text, and a text holds only tspans.
  if ((n.name === "tspan") !== (parent === "text")) return "";
  const attrs = ELEMENTS[n.name]
    .filter((a) => Object.hasOwn(n.attrs, a) && listed(SAFE, a)?.(n.attrs[a]))
    .map((a) => ` ${a}="${encode(n.attrs[a])}"`)
    .join("");
  const inner =
    (n.name === "text" || n.name === "tspan" ? encode(n.text) : "") +
    n.children.map((c) => serialize(c, n.name)).join("");
  return inner ? `<${n.name}${attrs}>${inner}</${n.name}>` : `<${n.name}${attrs}/>`;
}

/**
 * The figure for the page, under the contract's own root: null when the root
 * isn't a figure's. Any canvas height a figure could sensibly have is kept,
 * so a figure saved under today's heights still shows if they change.
 */
function rebuild(root: Node): string | null {
  const vb = /^0 0 360 (\d+)$/.exec(root.attrs.viewBox ?? "");
  const H = vb ? Number(vb[1]) : NaN;
  if (root.name !== "svg" || root.attrs.xmlns !== SVG_NS || !(H >= 100 && H <= 960)) return null;
  const inner = root.children.map((c) => serialize(c, "svg")).join("");
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${CANVAS_WIDTH} ${H}" class="qf" role="img">${inner}</svg>`;
}

/**
 * A saved figure made safe for a page: read by the same strict parser and
 * rebuilt the same way, but with none of the drawing's checks. It was checked
 * against its brief when it was drawn, so a figure saved under today's rules
 * still shows if a layout rule tightens later. Null when it can't be read.
 */
export function cleanFigure(svg: string): string | null {
  const { root } = parse(svg);
  return root ? rebuild(root) : null;
}

// ── Geometry ────────────────────────────────────────────────────────────────

export type Pt = [number, number];
export type Box = { x0: number; y0: number; x1: number; y1: number };
/** An affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, [x, y]: Pt): Pt => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/** translate(x y) and rotate(a [cx cy]) only; null for anything else. */
function parseTransform(t: string): Matrix | null {
  let m = IDENTITY;
  const rest = t.replace(/(translate|rotate)\(([^)]*)\)/g, (_, fn: string, args: string) => {
    const v = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (v.some((n) => !Number.isFinite(n))) return "!";
    if (fn === "translate" && (v.length === 1 || v.length === 2))
      m = multiply(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === "rotate" && (v.length === 1 || v.length === 3)) {
      const r = (v[0] * Math.PI) / 180;
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = multiply(m, [1, 0, 0, 1, cx, cy]);
      m = multiply(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
      m = multiply(m, [1, 0, 0, 1, -cx, -cy]);
    } else return "!";
    return "";
  });
  return rest.trim() ? null : m;
}

const pointsOf = (s: string): Pt[] | null => {
  const v = s
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (v.length < 4 || v.length % 2 || v.some((n) => !Number.isFinite(n))) return null;
  return Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i], v[2 * i + 1]]);
};

/** A path as straight segments (curves sampled), absolute commands M L H V C S Q Z only. */
function pathPolylines(d: string): Pt[][] | null {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Pt[][] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let lastControl: Pt | null = null;
  let line: Pt[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  const bezier = (p: Pt[], steps = 16) => {
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const pt =
        p.length === 4
          ? ([0, 1].map(
              (j) =>
                (1 - t) ** 3 * p[0][j] +
                3 * (1 - t) ** 2 * t * p[1][j] +
                3 * (1 - t) * t ** 2 * p[2][j] +
                t ** 3 * p[3][j],
            ) as Pt)
          : ([0, 1].map(
              (j) => (1 - t) ** 2 * p[0][j] + 2 * (1 - t) * t * p[1][j] + t ** 2 * p[2][j],
            ) as Pt);
      line.push(pt);
    }
  };
  while (i < tokens.length) {
    const c = tokens[i++];
    if (!/^[MLHVCSQZ]$/.test(c)) return null;
    if (c === "Z") {
      line.push(start);
      cur = start;
      lastControl = null;
      continue;
    }
    do {
      if (c === "M") {
        if (line.length > 1) out.push(line);
        cur = start = [num(), num()];
        line = [cur];
        lastControl = null;
      } else if (c === "L") {
        cur = [num(), num()];
        line.push(cur);
        lastControl = null;
      } else if (c === "H") {
        cur = [num(), cur[1]];
        line.push(cur);
        lastControl = null;
      } else if (c === "V") {
        cur = [cur[0], num()];
        line.push(cur);
        lastControl = null;
      } else if (c === "C") {
        const p: Pt[] = [cur, [num(), num()], [num(), num()], [num(), num()]];
        bezier(p);
        lastControl = p[2];
        cur = p[3];
      } else if (c === "S") {
        const c1: Pt = lastControl
          ? [2 * cur[0] - lastControl[0], 2 * cur[1] - lastControl[1]]
          : cur;
        const p: Pt[] = [cur, c1, [num(), num()], [num(), num()]];
        bezier(p);
        lastControl = p[2];
        cur = p[3];
      } else if (c === "Q") {
        const p: Pt[] = [cur, [num(), num()], [num(), num()]];
        bezier(p);
        lastControl = null;
        cur = p[2];
      }
      if (line.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return null;
    } while (i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]));
  }
  if (line.length > 1) out.push(line);
  return out;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const grow = (b: Box, by: number): Box => ({
  x0: b.x0 - by,
  y0: b.y0 - by,
  x1: b.x1 + by,
  y1: b.y1 + by,
});
const boxOf = (pts: Pt[]): Box => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
/** How far a point is from a box: 0 inside it. */
const distanceTo = ([x, y]: Pt, b: Box) =>
  Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
/** How far a point is from a segment. */
function distanceToSegment(p: Pt, [a, b]: [Pt, Pt]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** Half of each line style's stroke: text must clear the stroke, not just its centre line. */
const STROKE_HALF: Partial<Record<string, number>> = {
  "qf-line": 1,
  "qf-thick": 2,
  "qf-data": 1.5,
  "qf-data2": 1.5,
  "qf-box": 0.75,
};
/** Characters that reach below the baseline. */
const DESCENDS = /[gjpqy,;()₂₃₄]/;

/** Whether a segment crosses a box (Liang–Barsky). */
function crosses([a, b]: [Pt, Pt], box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  for (const [p, q] of [
    [-dx, a[0] - box.x0],
    [dx, box.x1 - a[0]],
    [-dy, a[1] - box.y0],
    [dy, box.y1 - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export type Label = {
  text: string;
  box: Box;
  owner: number;
  cls: FigureClass;
  x: number;
  y: number;
  anchor: string;
};
/** A line with an arrowhead: from its first point to its last, with a head at its start, its end or both. */
export type Arrow = { from: Pt; to: Pt; start: boolean; end: boolean };
/** A circuit symbol as placed: its type, its centre and its two terminals. */
type Part = { type: string; centre: Pt; ends: [Pt, Pt] };
/** Everything the drawing holds that a brief is checked against. */
export type Drawing = {
  H: number;
  labels: Label[];
  segments: { seg: [Pt, Pt]; cls: string }[];
  dots: { at: Pt; x: number; y: number; cls: string }[];
  bars: { box: Box; value: number; cls: string }[];
  dataLines: { pts: Pt[]; cls: string }[];
  /** Each qf-data or qf-data2 path, sampled. */
  curves: { pts: Pt[]; cls: string }[];
  arrows: Arrow[];
  parts: Part[];
  /** Circuit wires: qf-line segments outside the symbols. */
  wires: [Pt, Pt][];
  /** Junction dots: qf-ink circles outside the symbols. */
  junctions: Pt[];
  /**
   * Every line, shape and path drawn, but text: what it is, its style, its
   * first point (a circle's centre), whether it lies in a circuit symbol,
   * whether it carries an arrowhead, and its radius.
   */
  shapes: { name: string; cls: string; at: Pt; inSymbol: boolean; marked: boolean; r: number }[];
};

// ── The check ───────────────────────────────────────────────────────────────

export type FigureCheck = {
  /** Plain sentences, each naming what is wrong and where. Empty when the figure can be shown. */
  problems: string[];
  /** The figure rebuilt from the parsed tree, ready for the page; null when it couldn't be read. */
  svg: string | null;
  /** The canvas height, from the viewBox. */
  height: number | null;
  /** Every line of text in the figure, in document order. */
  labels: string[];
};

export function checkFigure(svg: string, brief?: FigureBrief): FigureCheck {
  const { root, problems } = parse(svg);
  if (!root) return { problems, svg: null, height: null, labels: [] };

  // The root: exactly the contract's.
  const vb = /^0 0 360 (\d+)$/.exec(root.attrs.viewBox ?? "");
  const H = vb ? Number(vb[1]) : NaN;
  if (root.name !== "svg") problems.push("The root element is not <svg>");
  if (root.attrs.xmlns !== SVG_NS) problems.push(`The <svg> lacks xmlns="${SVG_NS}"`);
  if (!vb || !CANVAS_HEIGHTS.includes(H))
    problems.push(
      `The viewBox is not "0 0 ${CANVAS_WIDTH} H" with H a multiple of 20 from 200 to 480`,
    );
  if (root.attrs.class !== "qf") problems.push('The <svg> lacks class="qf"');
  if (root.attrs.role !== "img") problems.push('The <svg> lacks role="img"');

  const height = Number.isFinite(H) ? H : 480;
  const drawing: Drawing = {
    H: height,
    labels: [],
    segments: [],
    dots: [],
    bars: [],
    dataLines: [],
    curves: [],
    arrows: [],
    parts: [],
    wires: [],
    junctions: [],
    shapes: [],
  };
  const {
    labels,
    segments,
    dots,
    bars,
    dataLines,
    curves,
    arrows,
    parts,
    wires,
    junctions,
    shapes,
  } = drawing;
  let owner = 0;

  const inCanvas = (p: Pt, margin: number) =>
    p[0] >= margin - 0.5 &&
    p[0] <= CANVAS_WIDTH - margin + 0.5 &&
    p[1] >= margin - 0.5 &&
    p[1] <= height - margin + 0.5;
  /** What goes outside, and the margin it breaks. */
  const outside = new Map<string, number>();

  /** `inSymbol`: inside a circuit symbol, whose lines are its own, not wires. */
  const visit = (n: Node, m: Matrix, path: string, inSymbol = false) => {
    const allowed = listed(ELEMENTS, n.name);
    const where = `${path}<${n.name}>`;
    if (!allowed || n.name === "svg") {
      problems.push(`${where} is not allowed${allowed ? ": an <svg> is only ever the root" : ""}`);
      return;
    }
    for (const a of Object.keys(n.attrs))
      if (!allowed.includes(a)) problems.push(`${where} has an attribute it may not carry: ${a}`);
    if (n.text.trim() && n.name !== "text" && n.name !== "tspan")
      problems.push(`${where} holds text outside a <text>`);
    for (const a of NUMERIC)
      if (a in n.attrs && !NUMBER.test(n.attrs[a]))
        problems.push(`${where} ${a}="${n.attrs[a]}" is not a plain number`);
    for (const a of ["marker-start", "marker-end"])
      if (a in n.attrs && n.attrs[a] !== HEAD) problems.push(`${where} ${a} must be ${HEAD}`);

    if (n.name === "defs") {
      if (path !== "<svg> ") problems.push("<defs> must sit directly in <svg>");
      else if (exact(n) !== DEFS)
        problems.push("<defs> must be the arrowhead block, copied exactly");
      return;
    }
    if (n.name === "marker") {
      problems.push("<marker> may only appear in the arrowhead block");
      return;
    }

    const cls = n.attrs.class as FigureClass | undefined;
    if (DRAWN.includes(n.name)) {
      if (!cls) problems.push(`${where} has no class`);
      else if (!Object.hasOwn(FIGURE_CLASSES, cls))
        problems.push(`${where} has a class not in the list: ${cls}`);
    }
    let own = m;
    if (n.attrs.transform) {
      const t = parseTransform(n.attrs.transform);
      if (!t) problems.push(`${where} transform may only translate and rotate`);
      else own = multiply(m, t);
    }
    const num = (a: string) => Number(n.attrs[a] ?? 0);
    const keep = (pts: Pt[], margin = CANVAS_MARGIN) => {
      const abs = pts.map((p) => apply(own, p));
      if (abs.some((p) => !inCanvas(p, margin))) outside.set(where, margin);
      return abs;
    };
    const arrowOf = (pts: Pt[]) => {
      const [start, end] = ["marker-start", "marker-end"].map((a) => a in n.attrs);
      if (start || end) arrows.push({ from: pts[0], to: pts[pts.length - 1], start, end });
    };
    /** Kept for the circuit and food web checks, which allow only certain shapes. */
    const shape = (at: Pt) =>
      shapes.push({
        name: n.name,
        cls: cls ?? "",
        at,
        inSymbol,
        marked: "marker-start" in n.attrs || "marker-end" in n.attrs,
        r: num("r"),
      });

    switch (n.name) {
      case "g": {
        const symbol = n.attrs["data-symbol"];
        if (symbol !== undefined) {
          const centre = apply(own, [0, 0]);
          // Checked by its tag, a symbol must be drawn as that symbol too: a closed
          // switch tagged open, or an empty group tagged lamp, reads as another circuit.
          if (!SYMBOLS.has(symbol))
            problems.push(`${where} data-symbol="${symbol}" is not one of the circuit symbols`);
          else if (exact(n, ["transform"]) !== SYMBOLS.get(symbol))
            problems.push(
              `The ${symbol} at ${at(centre)} is not the ${symbol} symbol copied exactly: copy each symbol from the list unchanged, placed only by its <g transform>`,
            );
          parts.push({ type: symbol, centre, ends: [apply(own, [-20, 0]), apply(own, [20, 0])] });
        }
        n.children.forEach((c) => visit(c, own, `${where} `, inSymbol || symbol !== undefined));
        return;
      }
      case "line": {
        const [a, b] = keep([
          [num("x1"), num("y1")],
          [num("x2"), num("y2")],
        ]);
        segments.push({ seg: [a, b], cls: cls ?? "" });
        if (cls === "qf-line" && !inSymbol) wires.push([a, b]);
        arrowOf([a, b]);
        shape(a);
        break;
      }
      case "polyline":
      case "polygon": {
        const pts = pointsOf(n.attrs.points ?? "");
        if (!pts) {
          problems.push(`${where} points are not pairs of numbers`);
          break;
        }
        const abs = keep(pts);
        if (n.name === "polygon") abs.push(abs[0]);
        for (let k = 1; k < abs.length; k++) {
          segments.push({ seg: [abs[k - 1], abs[k]], cls: cls ?? "" });
          if (cls === "qf-line" && !inSymbol && n.name === "polyline")
            wires.push([abs[k - 1], abs[k]]);
        }
        if (cls === "qf-data" || cls === "qf-data2") dataLines.push({ pts: abs, cls });
        if (n.name === "polyline") arrowOf(abs);
        shape(abs[0]);
        break;
      }
      case "rect": {
        const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
        const c = keep([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]);
        for (let k = 0; k < 4; k++) segments.push({ seg: [c[k], c[(k + 1) % 4]], cls: cls ?? "" });
        // A bar stands on the x axis and carries its value; a key's small sample doesn't.
        if (cls === "qf-bar" || cls === "qf-bar2") {
          if ("data-y" in n.attrs)
            bars.push({ box: boxOf(c), value: Number(n.attrs["data-y"]), cls });
          else if (Math.abs(boxOf(c).y1 - (height - PLOT.bottomGap)) <= 1)
            problems.push(
              `${where} stands on the x axis without data-y: every bar carries its value`,
            );
        }
        shape(c[0]);
        break;
      }
      case "circle":
      case "ellipse": {
        const [cx, cy] = [num("cx"), num("cy")];
        const [rx, ry] = n.name === "circle" ? [num("r"), num("r")] : [num("rx"), num("ry")];
        keep([
          [cx - rx, cy - ry],
          [cx + rx, cy + ry],
        ]);
        if (cls === "qf-dot" && "data-x" in n.attrs)
          dots.push({ at: apply(own, [cx, cy]), x: num("data-x"), y: num("data-y"), cls });
        if (cls === "qf-ink" && n.name === "circle" && !inSymbol)
          junctions.push(apply(own, [cx, cy]));
        shape(apply(own, [cx, cy]));
        break;
      }
      case "path": {
        const lines = pathPolylines(n.attrs.d ?? "");
        if (!lines) {
          problems.push(`${where} d may use only the absolute commands M L H V C S Q Z`);
          break;
        }
        const all: Pt[] = [];
        for (const l of lines) {
          const abs = keep(l);
          all.push(...abs);
          for (let k = 1; k < abs.length; k++)
            segments.push({ seg: [abs[k - 1], abs[k]], cls: cls ?? "" });
        }
        if ((cls === "qf-data" || cls === "qf-data2") && all.length) curves.push({ pts: all, cls });
        if (all.length) arrowOf(all);
        shape(all[0] ?? apply(own, [0, 0]));
        break;
      }
      case "text": {
        const size = (cls && listed(TEXT_SIZE, cls)) ?? 0;
        if (!size) problems.push(`${where} must be qf-text, qf-strong or qf-small`);
        const anchor = n.attrs["text-anchor"];
        if (!["start", "middle", "end"].includes(anchor))
          problems.push(`${where} needs text-anchor start, middle or end`);
        if (!("x" in n.attrs) || !("y" in n.attrs)) problems.push(`${where} needs x and y`);
        const lines: { text: string; x: number; y: number }[] = [];
        if (n.text.trim()) lines.push({ text: n.text.trim(), x: num("x"), y: num("y") });
        let y = num("y");
        for (const t of n.children) {
          if (t.name !== "tspan") {
            problems.push(`${where} may hold only <tspan>`);
            continue;
          }
          for (const a of Object.keys(t.attrs))
            if (!ELEMENTS.tspan.includes(a)) problems.push(`${where}<tspan> may not carry ${a}`);
            else if (!NUMBER.test(t.attrs[a]))
              problems.push(`${where}<tspan> ${a}="${t.attrs[a]}" is not a plain number`);
          y += Number(t.attrs.dy ?? 0);
          lines.push({ text: t.text.trim(), x: Number(t.attrs.x ?? n.attrs.x ?? 0), y });
        }
        if (!lines.some((l) => l.text)) problems.push(`${where} is empty`);
        owner++;
        for (const l of lines) {
          if (!l.text) continue;
          const chars = [...l.text].length;
          if (chars > MAX_LINE)
            problems.push(`Text "${l.text}" is longer than ${MAX_LINE} characters on one line`);
          // As wide as the site's face draws it; as deep as its letters reach.
          const w = textWidth(l.text, size);
          const below = (DESCENDS.test(l.text) ? 0.25 : 0.05) * size;
          const x0 = anchor === "middle" ? l.x - w / 2 : anchor === "end" ? l.x - w : l.x;
          const corners = keep(
            [
              [x0, l.y - 0.8 * size],
              [x0 + w, l.y + below],
              [x0, l.y + below],
              [x0 + w, l.y - 0.8 * size],
            ],
            TEXT_MARGIN,
          );
          labels.push({
            text: l.text,
            box: boxOf(corners),
            owner,
            cls: cls!,
            x: l.x,
            y: l.y,
            anchor,
          });
        }
        return;
      }
    }
    for (const c of n.children) problems.push(`${where} may not hold <${c.name}>`);
  };
  root.children.forEach((c) => visit(c, IDENTITY, "<svg> "));

  for (const [w, margin] of outside)
    problems.push(
      `${w} goes outside the canvas (keep ${w.endsWith("<text>") ? "text" : "lines and shapes"} ${margin} units clear of every edge)`,
    );

  // Text over text, and text over a line: two labels keep 2 units apart, and a
  // label keeps clear of every stroke but a grid line's.
  for (let a = 0; a < labels.length; a++)
    for (let b = a + 1; b < labels.length; b++)
      if (
        labels[a].owner !== labels[b].owner &&
        overlaps(grow(labels[a].box, 1), grow(labels[b].box, 1))
      )
        problems.push(`Text "${labels[a].text}" overlaps text "${labels[b].text}"`);
  for (const l of labels) {
    const hit = segments.find(
      (s) => s.cls !== "qf-thin" && crosses(s.seg, grow(l.box, listed(STROKE_HALF, s.cls) ?? 0)),
    );
    if (hit)
      problems.push(
        `Text "${l.text}" sits on a line (the ${hit.cls} from (${fmt(hit.seg[0][0])}, ${fmt(hit.seg[0][1])}) to (${fmt(hit.seg[1][0])}, ${fmt(hit.seg[1][1])}))`,
      );
  }

  if (brief) problems.push(...briefProblems(brief, drawing));
  const clean = rebuild(root);
  // Rebuilt, a quote or bracket in text is spelled out: the saved copy must still fit.
  if (clean && clean.length > 24_000) problems.push("The SVG is longer than 24 000 characters");
  return {
    problems,
    svg: clean,
    height: Number.isFinite(H) ? H : null,
    labels: labels.map((l) => l.text),
  };
}

const near = (a: number, b: number, by = 0.6) => Math.abs(a - b) <= by;
const fmt = (v: number) => String(Number(v.toFixed(2)));

/** What the brief asks for that the drawing doesn't show, or shows in the wrong place. */
function briefProblems(brief: FigureBrief, d: Drawing): string[] {
  const { H, labels, dots, bars, dataLines, segments } = d;
  const out: string[] = [];
  const texts = labels.map((l) => l.text);
  // A label split over lines (tspans) counts as written in full.
  const whole = [...new Set(labels.map((l) => l.owner))].map((o) =>
    labels
      .filter((l) => l.owner === o)
      .map((l) => l.text)
      .join(" "),
  );
  const need = (t: string, what: string) => {
    if (!texts.includes(t.trim()) && !whole.includes(t.trim()))
      out.push(`The ${what} "${t}" is missing`);
  };
  const hasLine = (a: Pt, c: Pt) =>
    segments.some(
      (s) =>
        s.cls === "qf-line" &&
        ((near(s.seg[0][0], a[0]) &&
          near(s.seg[0][1], a[1]) &&
          near(s.seg[1][0], c[0]) &&
          near(s.seg[1][1], c[1])) ||
          (near(s.seg[1][0], a[0]) &&
            near(s.seg[1][1], a[1]) &&
            near(s.seg[0][0], c[0]) &&
            near(s.seg[0][1], c[1]))),
    );
  const k = brief as KnownBrief;

  if (
    k.kind === "line-graph" ||
    k.kind === "scatter" ||
    k.kind === "bar-chart" ||
    (k.kind === "wave" && "x" in k)
  ) {
    const bottom = H - PLOT.bottomGap;
    if (!hasLine([PLOT.left, bottom], [PLOT.right, bottom]))
      out.push("The x axis is not drawn where the plot area says");
    if (!hasLine([PLOT.left, PLOT.top], [PLOT.left, bottom]))
      out.push("The y axis is not drawn where the plot area says");
    need(k.x.title, "x-axis title");
    need(k.y.title, "y-axis title");
    // Tick numbers sit where their values are.
    for (const l of labels) {
      if (l.cls !== "qf-small" || !/^-?\d+(\.\d+)?$/.test(l.text)) continue;
      const v = Number(l.text);
      if (k.kind !== "bar-chart" && near(l.y, H - 38, 1) && l.anchor === "middle") {
        if (!near(l.x, plotX(v, k.x), 1)) out.push(`The x tick "${l.text}" is not at its value`);
      } else if (near(l.x, PLOT.left - 8, 1) && l.anchor === "end") {
        if (!near(l.y, plotY(v, k.y, H) + 5, 1))
          out.push(`The y tick "${l.text}" is not at its value`);
      }
    }
  }

  switch (k.kind) {
    case "line-graph":
    case "scatter": {
      const wanted = k.series.flatMap((s) => s.points);
      for (const [x, y] of wanted) {
        const p = dots.find((p) => p.x === x && p.y === y);
        if (!p) out.push(`The point (${fmt(x)}, ${fmt(y)}) is missing or has no data-x/data-y`);
        else if (!near(p.at[0], plotX(x, k.x)) || !near(p.at[1], plotY(y, k.y, H)))
          out.push(`The point (${fmt(x)}, ${fmt(y)}) is not where its values put it`);
      }
      if (dots.length !== wanted.length)
        out.push(`The graph has ${dots.length} points; the brief has ${wanted.length}`);
      for (const l of dataLines)
        for (const p of l.pts)
          if (!dots.some((d) => near(d.at[0], p[0]) && near(d.at[1], p[1])))
            out.push(
              `A plotted line bends at (${fmt(p[0])}, ${fmt(p[1])}), which is not a point: join points with straight lines only`,
            );
      if (k.kind === "scatter" && dataLines.length)
        out.push("A scatter graph has points only, no line");
      break;
    }
    case "bar-chart": {
      const values = k.series.flatMap((s) => s.values);
      k.x.categories.forEach((c) => need(c, "bar name"));
      if (bars.length !== values.length)
        out.push(`The chart has ${bars.length} bars; the brief has ${values.length}`);
      for (const bar of bars) {
        if (!values.includes(bar.value))
          out.push(`A bar's data-y (${fmt(bar.value)}) is not a value in the brief`);
        if (!near(bar.box.y1, H - PLOT.bottomGap) || !near(bar.box.y0, plotY(bar.value, k.y, H)))
          out.push(`The bar for ${fmt(bar.value)} is not the height its value gives`);
      }
      break;
    }
    case "circuit": {
      const types = d.parts.map((p) => p.type);
      const count = (t: string) => types.filter((s) => s === t).length;
      const wanted = new Map<string, number>();
      for (const c of k.components) {
        const t = ["ammeter", "voltmeter", "motor"].includes(c.type) ? "meter" : c.type;
        wanted.set(t, (wanted.get(t) ?? 0) + 1);
        if (c.label) need(c.label, "label");
      }
      for (const [t, n] of wanted)
        if (count(t) !== n)
          out.push(`The circuit has ${count(t)} ${t} symbol(s); the brief has ${n}`);
      for (const s of new Set(types))
        if (!wanted.has(s)) out.push(`The circuit has a ${s} the brief doesn't`);
      for (const [type, letter] of [
        ["ammeter", "A"],
        ["voltmeter", "V"],
        ["motor", "M"],
      ])
        if (
          texts.filter((t) => t === letter).length <
          k.components.filter((c) => c.type === type).length
        )
          out.push(`Every ${type} needs its letter ${letter}`);
      // The wiring is only worth comparing once every part is there.
      const partsThere = !out.length;
      out.push(...circuitExtras(k, d));
      if (partsThere) out.push(...wiringProblems(k, d));
      break;
    }
    case "energy-profile":
      need(k.reactants, "reactants name");
      need(k.products, "products name");
      k.arrows.forEach((a) => need(a.letter, `letter for the ${a.shows} arrow`));
      out.push(...profileProblems(k, d, hasLine));
      break;
    case "food-web":
      k.organisms.forEach((o) => need(o.name, "organism"));
      out.push(...webExtras(k, d));
      out.push(...webProblems(k, d));
      break;
    case "chromatogram":
      need(k.y.title, "scale title");
      out.push(...chromatogramProblems(k, d, hasLine));
      break;
    case "wave":
      out.push(...waveProblems(k, d, hasLine));
      break;
    case "forces":
      out.push(...forceProblems(k, d, hasLine));
      break;
  }
  const kind = figureKind(brief.kind);
  if (kind) {
    const tools: CheckTools = {
      hasLine,
      writtenAt: (t, x, y, anchor, cls) =>
        pieces(d.labels).some(
          (p) =>
            p.text === t &&
            near(p.x, x, 1) &&
            near(p.y, y, 1) &&
            p.anchor === anchor &&
            (!cls || p.cls === cls),
        ),
      pieces: () => pieces(d.labels),
      near,
      at,
      fmt,
      tagOf,
      letterBeside: (p) => letterBeside(p, d),
    };
    out.push(...kind.check(brief, d, tools));
  }
  return out;
}

/** What a figure kind in kinds/ checks its drawing with. */
export type CheckTools = {
  /** A qf-line segment from a to c, either way round, to within 0.6 units. */
  hasLine: (a: Pt, c: Pt) => boolean;
  /** A text, whole (its lines joined by spaces), written with its first baseline at x, y and this anchor (and style). */
  writtenAt: (t: string, x: number, y: number, anchor: string, cls?: FigureClass) => boolean;
  /** Each <text> whole: its lines joined by spaces, its style, and where its first line is. */
  pieces: () => Label[];
  near: (a: number, b: number, by?: number) => boolean;
  /** A point as a problem names it: "(12, 40)". */
  at: (p: Pt) => string;
  /** A number as a problem names it: at most two decimal places. */
  fmt: (v: number) => string;
  /** A shape's tag as written, for a problem to point at. */
  tagOf: (s: Drawing["shapes"][number]) => string;
  /** The bold (qf-strong) text nearest a point, if one is within 20 units. */
  letterBeside: (p: Pt) => Label | undefined;
};

/** A text whole, written exactly where the layout puts it: its first line's x and baseline, and its anchor. */
const writtenAt = (d: Drawing, t: string, x: number, y: number, anchor: string) =>
  pieces(d.labels).some(
    (p) => p.text === t && near(p.x, x, 1) && near(p.y, y, 1) && p.anchor === anchor,
  );

/**
 * A chromatogram: the paper, its scale, the start line and the solvent front
 * where their distances put them, every spot in its own lane at its distance,
 * and each sample's name under its own lane. Which spots share a lane, and
 * which name is under it, decide the answer, so nothing else may be drawn.
 */
function chromatogramProblems(
  k: ChromatogramBrief,
  d: Drawing,
  hasLine: (a: Pt, c: Pt) => boolean,
): string[] {
  const out: string[] = [];
  const C = CHROMATOGRAM;
  const max = k.y.max;
  const n = k.samples.length;
  const frontY = chromaY(k.front, max);
  if (
    !hasLine([C.left, C.paperTop], [C.left, C.paperBottom]) ||
    !hasLine([C.left, C.paperTop], [C.right, C.paperTop])
  )
    out.push(
      `The paper is not drawn from (${C.left}, ${C.paperTop}) to (${C.right}, ${C.paperBottom})`,
    );
  if (!hasLine([C.left, C.start], [C.right, C.start]))
    out.push(`The start line is not drawn across the paper at y = ${C.start}`);
  if (!hasLine([C.left, frontY], [C.right, frontY]))
    out.push(`The solvent front is not drawn across the paper at its distance, y = ${fmt(frontY)}`);
  if (!writtenAt(d, "start line", C.labelX, C.start + 5, "start"))
    out.push('"start line" is not written beside the start line');
  if (!writtenAt(d, "solvent front", C.labelX, frontY + 5, "start"))
    out.push('"solvent front" is not written beside the solvent front');
  const scale = (l: Label) =>
    l.cls === "qf-small" &&
    /^-?\d+(\.\d+)?$/.test(l.text) &&
    near(l.x, C.left - 8, 1) &&
    l.anchor === "end";
  for (const l of d.labels)
    if (scale(l) && !near(l.y, chromaY(Number(l.text), max) + 5, 1))
      out.push(`The scale's number "${l.text}" is not at its value`);

  const wanted = k.samples.flatMap((s, i) => s.spots.map((v) => [i, v] as const));
  for (const [i, v] of wanted) {
    const name = k.samples[i].name;
    const spot = d.dots.find((p) => p.x === i + 1 && p.y === v);
    if (!spot)
      out.push(`The spot at ${fmt(v)} in ${name}'s lane is missing or has no data-x/data-y`);
    else if (!near(spot.at[0], laneX(i, n)) || !near(spot.at[1], chromaY(v, max)))
      out.push(`The spot at ${fmt(v)} in ${name}'s lane is not where its lane and distance put it`);
  }
  const spots = d.shapes.filter((s) => s.cls === "qf-dot");
  if (spots.length !== wanted.length || d.dots.length !== wanted.length)
    out.push(`The chromatogram has ${spots.length} spots; the brief has ${wanted.length}`);
  k.samples.forEach((s, i) => {
    if (!writtenAt(d, s.name, laneX(i, n), C.start + 22, "middle"))
      out.push(`The name "${s.name}" is not under its own lane`);
  });

  for (const s of d.shapes) {
    const paper = s.name === "rect" && s.cls === "qf-line";
    const line = s.name === "line" && (s.cls === "qf-line" || s.cls === "qf-thin") && !s.marked;
    const spot = s.name === "circle" && s.cls === "qf-dot";
    if (!paper && !line && !spot)
      out.push(
        `The ${tagOf(s)} at ${at(s.at)} is not part of the chromatogram: draw only the paper, its grid, the two lines and the spots`,
      );
  }
  const lines = d.segments.filter((s) => s.cls === "qf-line").length - 4;
  if (lines !== 2)
    out.push(
      `The chromatogram has ${lines} lines across it; it has 2: the start line and the solvent front`,
    );
  for (const s of d.segments)
    if (
      s.cls === "qf-thin" &&
      !(near(s.seg[0][0], C.left) && near(s.seg[1][0], C.right) && near(s.seg[0][1], s.seg[1][1]))
    )
      out.push(`A grid line from ${at(s.seg[0])} to ${at(s.seg[1])} does not run across the paper`);
  const allowed = new Set([
    k.y.title,
    "start line",
    "solvent front",
    ...k.samples.map((s) => s.name),
  ]);
  for (const t of pieces(d.labels))
    if (!allowed.has(t.text) && !scale(t))
      out.push(`Text "${t.text}" is not part of the chromatogram`);
  return out;
}

/** The letter nearest a point, if one is within 20 units. */
const letterBeside = (middle: Pt, d: Drawing) =>
  d.labels
    .filter((l) => l.cls === "qf-strong")
    .map((l) => ({ l, gap: distanceTo(middle, l.box) }))
    .filter((x) => x.gap <= 20)
    .sort((a, b) => a.gap - b.gap)[0]?.l;

/**
 * A wave: one smooth curve exactly on its sine, from its start to its end,
 * across its rest line. Lettered, each of the brief's arrows between its two
 * ends with its own letter nearest it, and no other arrow or text. On a
 * scale, no arrows at all.
 */
function waveProblems(k: WaveBrief, d: Drawing, hasLine: (a: Pt, c: Pt) => boolean): string[] {
  const out: string[] = [];
  const scaled = "x" in k;
  const H = d.H;
  const [x0, x1, rest, amp, length] = scaled
    ? [
        PLOT.left,
        PLOT.right,
        plotY(0, k.y, H),
        (k.amplitude / (k.y.max - k.y.min)) * (H - PLOT.bottomGap - PLOT.top),
        (k.wavelength / (k.x.max - k.x.min)) * (PLOT.right - PLOT.left),
      ]
    : [WAVE.left, WAVE.right, WAVE.rest, WAVE.amp, WAVE_LENGTH];
  const [from, to] = scaled ? [PLOT.left, PLOT.right] : [WAVE.restFrom, WAVE.restTo];
  if (!hasLine([from, rest], [to, rest]))
    out.push(`The rest line is not drawn from (${from}, ${fmt(rest)}) to (${to}, ${fmt(rest)})`);
  const sine = (x: number) => rest - amp * Math.sin((2 * Math.PI * (x - x0)) / length);
  const curves = d.dataLines.filter((l) => l.cls === "qf-data");
  if (curves.length !== 1 || d.dataLines.length !== 1 || d.curves.length)
    out.push("The wave must be one qf-data polyline, and the figure's only curve");
  else {
    const pts = curves[0].pts;
    const [first, last] = [pts[0], pts[pts.length - 1]];
    if (
      !near(first[0], x0) ||
      !near(first[1], rest) ||
      !near(last[0], x1) ||
      !near(last[1], sine(x1))
    )
      out.push(`The wave must run from (${x0}, ${fmt(rest)}) to (${x1}, ${fmt(sine(x1))})`);
    const off = pts.find((p) => !near(p[1], sine(p[0])));
    if (off) out.push(`The wave passes ${at(off)}, which is off its sine`);
    // Straight between points far apart, a curve could cut a crest short.
    if (pts.some((p, i) => i > 0 && (p[0] <= pts[i - 1][0] || p[0] - pts[i - 1][0] > 4)))
      out.push("The wave's points must run left to right, at most 4 units apart");
  }
  for (const s of d.shapes) {
    const curve = s.name === "polyline" && s.cls === "qf-data";
    const line = s.name === "line" && (s.cls === "qf-line" || s.cls === "qf-thin");
    if (!curve && !line)
      out.push(
        `The ${tagOf(s)} at ${at(s.at)} is not part of the wave diagram: draw only the wave, its lines and its arrows`,
      );
  }
  if (scaled) {
    if (d.arrows.length) out.push("A wave on a scale has no arrows");
    return out;
  }
  const doubles = d.arrows.filter((a) => a.start && a.end);
  const spans = (a: Arrow, s: { from: Pt; to: Pt }) =>
    (near(a.from[0], s.from[0], 1) &&
      near(a.from[1], s.from[1], 1) &&
      near(a.to[0], s.to[0], 1) &&
      near(a.to[1], s.to[1], 1)) ||
    (near(a.to[0], s.from[0], 1) &&
      near(a.to[1], s.from[1], 1) &&
      near(a.from[0], s.to[0], 1) &&
      near(a.from[1], s.to[1], 1));
  for (const want of k.arrows) {
    const span = WAVE_ARROWS[want.shows];
    const found = doubles.filter((a) => spans(a, span));
    if (found.length !== 1) {
      out.push(
        found.length
          ? `There are ${found.length} ${want.shows} arrows; the brief has one`
          : `The ${want.shows} arrow is missing: a double arrow from ${at(span.from)} to ${at(span.to)}`,
      );
      continue;
    }
    const middle: Pt = [(span.from[0] + span.to[0]) / 2, (span.from[1] + span.to[1]) / 2];
    const letter = letterBeside(middle, d);
    if (!letter) out.push(`The letter "${want.letter}" is not beside the ${want.shows} arrow`);
    else if (letter.text !== want.letter)
      out.push(
        `The letter beside the ${want.shows} arrow is "${letter.text}"; the brief gives it "${want.letter}"`,
      );
  }
  for (const a of d.arrows)
    if (!(a.start && a.end) || !k.arrows.some((w) => spans(a, WAVE_ARROWS[w.shows])))
      out.push(`The arrow from ${at(a.from)} to ${at(a.to)} is not one the brief asks for`);
  const letters = new Set(k.arrows.map((a) => a.letter));
  for (const t of pieces(d.labels))
    if (!letters.has(t.text) || t.cls !== "qf-strong")
      out.push(`Text "${t.text}" is not an arrow's letter: a lettered wave has no other text`);
  return out;
}

/**
 * The forces on an object: its box, and for each force one arrow out from
 * the middle of its side, pointing its way, as long as its size makes it, with
 * its own name and size written in its own corner. Which way each force acts,
 * and how big it is, decide the answer, so no other arrow or text is drawn.
 */
function forceProblems(k: ForceBrief, d: Drawing, hasLine: (a: Pt, c: Pt) => boolean): string[] {
  const out: string[] = [];
  const { x0, y0, x1, y1 } = FORCES.box;
  if (
    !hasLine([x0, y0], [x1, y0]) ||
    !hasLine([x1, y0], [x1, y1]) ||
    !hasLine([x1, y1], [x0, y1]) ||
    !hasLine([x0, y1], [x0, y0])
  )
    out.push(`The object's box is not drawn from (${x0}, ${y0}) to (${x1}, ${y1})`);
  const ends = (f: ForceBrief["forces"][number]): [Pt, Pt] => {
    const s = forceStart(f.direction);
    const [dx, dy] = FORCE_STEP[f.direction];
    const L = forceLength(k, f);
    return [s, [s[0] + dx * L, s[1] + dy * L]];
  };
  const isForce = (a: Arrow, [s, e]: [Pt, Pt]) =>
    a.end &&
    !a.start &&
    near(a.from[0], s[0], 1) &&
    near(a.from[1], s[1], 1) &&
    near(a.to[0], e[0], 1) &&
    near(a.to[1], e[1], 1);
  for (const f of k.forces) {
    const [s, e] = ends(f);
    const found = d.arrows.filter((a) => isForce(a, [s, e]));
    if (found.length !== 1)
      out.push(
        found.length
          ? `There are ${found.length} ${f.name} arrows; the brief has one`
          : `The ${f.name} arrow is missing: one head, from ${at(s)} to ${at(e)}`,
      );
    const lines = forceLabel(f);
    if (!lines) {
      out.push(`The force "${f.name}" has a name too long for its label`);
      continue;
    }
    const [x, y, anchor] = forceLabelAt(
      f.direction,
      lines.length,
      labelWidth(lines),
      forceLength(k, f),
    );
    const cls = f.size === null ? "qf-strong" : "qf-text";
    if (
      !pieces(d.labels).some(
        (p) =>
          p.text === lines.join(" ") &&
          p.cls === cls &&
          near(p.x, x, 1) &&
          near(p.y, y, 1) &&
          p.anchor === anchor,
      )
    )
      out.push(
        `The label "${lines.join(" ")}" is not written in the ${f.direction} arrow's corner`,
      );
  }
  for (const a of d.arrows)
    if (!k.forces.some((f) => isForce(a, ends(f))))
      out.push(`The arrow from ${at(a.from)} to ${at(a.to)} is not a force in the brief`);
  if (k.object && !writtenAt(d, k.object, (x0 + x1) / 2, (y0 + y1) / 2 + 5.5, "middle"))
    out.push(`The object's name "${k.object}" is not written in its box`);
  for (const s of d.shapes) {
    const box = s.name === "rect" && s.cls === "qf-line";
    const arrow = s.name === "line" && s.cls === "qf-line" && s.marked;
    if (!box && !arrow)
      out.push(
        `The ${tagOf(s)} at ${at(s.at)} is not part of the diagram: draw only the object's box and an arrow for each force`,
      );
  }
  const allowed = new Set([
    ...(k.object ? [k.object] : []),
    ...k.forces.map((f) => (forceLabel(f) ?? []).join(" ")),
  ]);
  for (const t of pieces(d.labels))
    if (!allowed.has(t.text))
      out.push(`Text "${t.text}" is not a force's label or the object's name`);
  return out;
}

/** Each <text> whole: its lines joined, with its style and where its first line is written. */
const pieces = (labels: Label[]) =>
  [...new Set(labels.map((l) => l.owner))].map((o) => {
    const lines = labels.filter((l) => l.owner === o);
    return { ...lines[0], text: lines.map((l) => l.text).join(" ") };
  });
/** A shape's tag as the model wrote it, for a problem to point at. */
const tagOf = (s: Drawing["shapes"][number]) => `<${s.name}${s.cls ? ` class="${s.cls}"` : ""}>`;

/** A meter's letter, by what it makes the meter. */
const METERS = new Map([
  ["A", "ammeter"],
  ["V", "voltmeter"],
  ["M", "motor"],
]);
/** Whether a text is a meter's letter on it: bold A, V or M at its centre, as the prompt puts it. */
const onMeter = (l: { cls: string; text: string; x: number; y: number }, p: Part) =>
  p.type === "meter" &&
  l.cls === "qf-strong" &&
  METERS.has(l.text) &&
  near(l.x, p.centre[0], 1.5) &&
  near(l.y, p.centre[1] + 5.5, 1.5);

/**
 * What a circuit holds besides its symbols: wires, junction dots, each
 * meter's letter and the brief's labels, and nothing else. A path or a thick
 * line across a lamp is a short the wiring check can't see, and a caption
 * can give an answer away. Two parts drawn over each other look like one.
 */
function circuitExtras(k: CircuitBrief, d: Drawing): string[] {
  const out: string[] = [];
  for (const s of d.shapes) {
    if (s.inSymbol) continue;
    const wire = (s.name === "line" || s.name === "polyline") && s.cls === "qf-line" && !s.marked;
    const dot = s.name === "circle" && s.cls === "qf-ink" && s.r === 3;
    if (!wire && !dot)
      out.push(
        `The ${tagOf(s)} at ${at(s.at)} is not part of the circuit: outside its symbols a circuit has only wires (qf-line lines and polylines, without arrowheads), junction dots (<circle class="qf-ink" r="3"/>) and the brief's labels`,
      );
  }
  const labels = new Set(k.components.map((c) => c.label).filter(Boolean));
  for (const t of pieces(d.labels))
    if (!d.parts.some((p) => onMeter(t, p)) && !(t.cls === "qf-text" && labels.has(t.text)))
      out.push(
        `Text "${t.text}" is neither a label the brief gives nor a meter's letter: a circuit has no other text`,
      );
  for (let i = 0; i < d.parts.length; i++)
    for (let j = i + 1; j < d.parts.length; j++) {
      const [a, b] = [d.parts[i], d.parts[j]];
      if (Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1]) < 40)
        out.push(
          `The ${a.type} at ${at(a.centre)} and the ${b.type} at ${at(b.centre)} are drawn over each other: keep components at least 50 units apart`,
        );
    }
  return out;
}

/**
 * What a food web holds: its organisms' names, each once, and an arrow for
 * each pair. An extra line, a head drawn as a shape, or a caption such as
 * "producers" could change or give away an answer, so each is refused.
 */
function webExtras(k: WebBrief, d: Drawing): string[] {
  const out: string[] = [];
  for (const s of d.shapes)
    if (!["line", "polyline", "path"].includes(s.name) || s.cls !== "qf-line")
      out.push(
        `The ${tagOf(s)} at ${at(s.at)} is not part of the food web: draw only the organisms' names and an arrow (a qf-line with marker-end) for each pair`,
      );
    else if (!s.marked)
      out.push(
        `The ${tagOf(s)} from ${at(s.at)} has no arrowhead: every line in a food web is an arrow with one head, by what eats the food`,
      );
  const organisms = new Set(k.organisms.map((o) => o.name.trim()));
  const written = new Map<string, number>();
  for (const t of pieces(d.labels))
    if (!organisms.has(t.text))
      out.push(`Text "${t.text}" is not an organism in the brief: a food web has no other text`);
    else written.set(t.text, (written.get(t.text) ?? 0) + 1);
  for (const [name, n] of written)
    if (n > 1) out.push(`The organism "${name}" is written ${n} times: write each name once`);
  return out;
}

const at = (p: Pt) => `(${fmt(p[0])}, ${fmt(p[1])})`;

/**
 * A reaction profile drawn at its fixed levels (figure.ts PROFILE): the two
 * level lines, each curve from reactants to products over its top, and each
 * of the brief's arrows between its levels with its own letter nearest it.
 * These decide answers: which reaction gives out energy, which arrow is which.
 */
function profileProblems(
  k: ProfileBrief,
  d: Drawing,
  hasLine: (a: Pt, c: Pt) => boolean,
): string[] {
  const out: string[] = [];
  const levels = listed(PROFILE.levels, k.reaction);
  if (!levels) return ['The brief\'s reaction must be "exothermic" or "endothermic"'];
  const { R, P, T } = levels;
  const top = PROFILE.top;
  if (!hasLine([56, R], [112, R]))
    out.push(`The reactants line is not at its ${k.reaction} level: (56, ${R}) to (112, ${R})`);
  if (!hasLine([256, P], [336, P]))
    out.push(`The products line is not at its ${k.reaction} level: (256, ${P}) to (336, ${P})`);

  const runs = (c: { pts: Pt[] }, peak: number) => {
    const [first, last] = [c.pts[0], c.pts[c.pts.length - 1]];
    return (
      near(first[0], 112, 1) &&
      near(first[1], R, 1) &&
      near(last[0], 256, 1) &&
      near(last[1], P, 1) &&
      near(Math.min(...c.pts.map((p) => p[1])), peak, 1)
    );
  };
  const solid = d.curves.filter((c) => c.cls === "qf-data");
  if (solid.length !== 1 || !runs(solid[0], top))
    out.push(
      `The profile (qf-data) must be one path from the reactants (112, ${R}) over its top at y = ${top} to the products (256, ${P})`,
    );
  const dashed = d.curves.filter((c) => c.cls === "qf-data2");
  if (k.catalyst && (dashed.length !== 1 || !runs(dashed[0], T)))
    out.push(
      `The catalysed profile (qf-data2) must be one path from (112, ${R}) over its top at y = ${T} to (256, ${P})`,
    );
  if (!k.catalyst && dashed.length)
    out.push("The brief has no catalyst, so there is no second profile");

  const spans: Record<string, [number, number]> = {
    "activation energy": [R, top],
    "activation energy with a catalyst": [R, T],
    "overall energy change": [R, P],
  };
  const isSpan = (a: Arrow, [y1, y2]: [number, number]) =>
    near(a.from[0], a.to[0], 1) &&
    ((near(a.from[1], y1, 1) && near(a.to[1], y2, 1)) ||
      (near(a.from[1], y2, 1) && near(a.to[1], y1, 1)));
  const doubles = d.arrows.filter((a) => a.start && a.end);
  const letters = d.labels.filter((l) => l.cls === "qf-strong");
  for (const want of k.arrows) {
    const span = listed(spans, want.shows);
    if (!span) {
      out.push(`The brief's arrow "${want.shows}" is not one a reaction profile has`);
      continue;
    }
    const found = doubles.filter((a) => isSpan(a, span));
    if (found.length !== 1) {
      out.push(
        found.length
          ? `There are ${found.length} ${want.shows} arrows; the brief has one`
          : `The ${want.shows} arrow is missing: a double arrow from y = ${span[0]} to y = ${span[1]}`,
      );
      continue;
    }
    const middle: Pt = [
      (found[0].from[0] + found[0].to[0]) / 2,
      (found[0].from[1] + found[0].to[1]) / 2,
    ];
    const nearest = letters
      .map((l) => ({ l, gap: distanceTo(middle, l.box) }))
      .sort((a, b) => a.gap - b.gap)[0];
    if (!nearest || nearest.gap > 20)
      out.push(`The letter "${want.letter}" is not beside the ${want.shows} arrow`);
    else if (nearest.l.text !== want.letter)
      out.push(
        `The letter beside the ${want.shows} arrow is "${nearest.l.text}"; the brief gives it "${want.letter}"`,
      );
  }
  for (const a of doubles)
    if (!k.arrows.some((w) => listed(spans, w.shows) && isSpan(a, spans[w.shows])))
      out.push(`The double arrow from ${at(a.from)} to ${at(a.to)} is not one the brief asks for`);
  return out;
}

/**
 * A food web's arrows, each read from its tail to its head and matched to the
 * names nearest its two ends: exactly the brief's [food, eater] pairs, each
 * pointing from the food to what eats it.
 */
function webProblems(k: WebBrief, d: Drawing): string[] {
  const out: string[] = [];
  // Each organism's name as one box, its lines together.
  const names = [...new Set(d.labels.map((l) => l.owner))].map((o) => {
    const lines = d.labels.filter((l) => l.owner === o);
    return {
      name: lines.map((l) => l.text).join(" "),
      box: boxOf(lines.flatMap((l) => [[l.box.x0, l.box.y0] as Pt, [l.box.x1, l.box.y1] as Pt])),
    };
  });
  const nameAt = (p: Pt) =>
    names
      .map((n) => ({ ...n, gap: distanceTo(p, n.box) }))
      .filter((n) => n.gap <= 16)
      .sort((a, b) => a.gap - b.gap)[0]?.name;
  const drawn = new Map<string, number>();
  for (const a of d.arrows) {
    if (a.start === a.end) {
      out.push(
        `The arrow from ${at(a.from)} to ${at(a.to)} needs one head, at the end by what eats the food`,
      );
      continue;
    }
    const [tail, head] = a.end ? [a.from, a.to] : [a.to, a.from];
    const food = nameAt(tail);
    const eater = nameAt(head);
    if (!food || !eater) {
      out.push(
        `The arrow from ${at(tail)} to ${at(head)} ${food ? "ends" : "starts"} away from every name`,
      );
      continue;
    }
    drawn.set(`${food}→${eater}`, (drawn.get(`${food}→${eater}`) ?? 0) + 1);
  }
  const wanted = new Set(k.eaten.map(([food, eater]) => `${food}→${eater}`));
  for (const [food, eater] of k.eaten) {
    const n = drawn.get(`${food}→${eater}`) ?? 0;
    if (n > 1) out.push(`There are ${n} arrows from ${food} to ${eater}`);
    else if (!n)
      out.push(
        drawn.has(`${eater}→${food}`)
          ? `The arrow between ${food} and ${eater} points the wrong way: it must point from ${food} to ${eater}, the food to what eats it`
          : `There is no arrow from ${food} to ${eater}`,
      );
  }
  for (const pair of drawn.keys()) {
    const [food, eater] = pair.split("→");
    if (!wanted.has(pair) && !wanted.has(`${eater}→${food}`))
      out.push(`The arrow from ${food} to ${eater} is not in the brief`);
  }
  return out;
}

/** A part as wiring compares it (its type, and its label when it has one) and the two junctions it joins. */
type Edge = { part: string; a: number; b: number };

/**
 * The circuit's wiring: which component ends each wire joins (a wire's end
 * on another wire's middle joins it; wires that cross don't), compared with
 * the brief's loop. Also: wires straight and square, none crossing, a dot on
 * every junction.
 */
function wiringProblems(k: CircuitBrief, d: Drawing): string[] {
  const out: string[] = [];
  const named = (c: CircuitBrief["components"][number]) =>
    c.label ? `${c.type} "${c.label}"` : c.type;

  // The loop the brief describes, as nets (numbered junctions) and the parts between them.
  const want: Edge[] = [];
  const used: number[] = [];
  let nets = 1;
  let brokenBrief = false;
  const walk = (steps: CircuitStep[], from: number, to: number) => {
    if (!steps.length) brokenBrief = true;
    let here = from;
    steps.forEach((s, i) => {
      const next = i === steps.length - 1 ? to : nets++;
      if (typeof s === "number") {
        used.push(s);
        if (k.components[s]) want.push({ part: named(k.components[s]), a: here, b: next });
        else brokenBrief = true;
      } else for (const branch of s.parallel ?? []) walk(branch, here, next);
      here = next;
    });
  };
  walk(k.loop ?? [], 0, 0);
  if (
    brokenBrief ||
    (k.loop ?? []).length < 2 ||
    used.length !== k.components.length ||
    new Set(used).size !== used.length
  )
    return ["The brief's loop must name every component once, in at least two steps"];

  // The wires as drawn.
  for (const [a, b] of d.wires)
    if (!near(a[0], b[0], 0.5) && !near(a[1], b[1], 0.5))
      out.push(`The wire from ${at(a)} to ${at(b)} is slanted: wires run across or up and down`);
  for (let i = 0; i < d.wires.length; i++)
    for (let j = i + 1; j < d.wires.length; j++) {
      const [s, t] = [d.wires[i], d.wires[j]];
      const ends = [...s, ...t];
      const meet = ends.some(
        (p) => distanceToSegment(p, s) < 0.75 && distanceToSegment(p, t) < 0.75,
      );
      if (!meet && crosses(s, boxOf([t[0], t[1]])) && crosses(t, boxOf([s[0], s[1]])))
        out.push(`The wires from ${at(s[0])} and from ${at(t[0])} cross: route them apart`);
    }

  // Points, joined into nets by the wires.
  const points: Pt[] = [];
  const id = (p: Pt) => {
    const i = points.findIndex((q) => near(q[0], p[0], 0.75) && near(q[1], p[1], 0.75));
    if (i >= 0) return i;
    points.push(p);
    return points.length - 1;
  };
  const parent: number[] = [];
  const root = (i: number): number =>
    parent[i] === undefined || parent[i] === i ? i : (parent[i] = root(parent[i]));
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };
  for (const [a, b] of d.wires) join(id(a), id(b));
  const ends = d.parts.map((p) => p.ends.map(id) as [number, number]);
  // A wire's end, or a terminal, on another wire's middle joins that wire.
  const meets = points.map(() => 0);
  for (const [a, b] of d.wires) {
    meets[id(a)]++;
    meets[id(b)]++;
  }
  for (const [x, y] of ends) {
    meets[x]++;
    meets[y]++;
  }
  points.forEach((p, i) => {
    for (const w of d.wires)
      if (
        distanceToSegment(p, w) < 0.75 &&
        Math.hypot(p[0] - w[0][0], p[1] - w[0][1]) > 0.75 &&
        Math.hypot(p[0] - w[1][0], p[1] - w[1][1]) > 0.75
      ) {
        join(i, id(w[0]));
        meets[i] += 2;
      }
  });
  points.forEach((p, i) => {
    if (meets[i] >= 3 && !d.junctions.some((j) => near(j[0], p[0], 1.5) && near(j[1], p[1], 1.5)))
      out.push(`The junction at ${at(p)} needs a dot: <circle class="qf-ink" r="3"/>`);
  });

  // Each part between its two nets, typed as drawn: a meter by the letter at its centre,
  // a labelled part by the label nearest it.
  const brieflabels = new Set(k.components.map((c) => c.label).filter(Boolean));
  const tags = new Map<number, string>();
  for (const l of d.labels) {
    // A label is plain text (qf-text); a meter's letter is bold (qf-strong), and
    // "A" is both a lamp's label and an ammeter's letter in many a question.
    if (l.cls !== "qf-text" || !brieflabels.has(l.text)) continue;
    const centre: Pt = [(l.box.x0 + l.box.x1) / 2, (l.box.y0 + l.box.y1) / 2];
    const nearest = d.parts
      .map((p, i) => ({ i, gap: Math.hypot(p.centre[0] - centre[0], p.centre[1] - centre[1]) }))
      .sort((a, b) => a.gap - b.gap)[0];
    if (nearest && nearest.gap <= 48) tags.set(nearest.i, l.text);
  }
  const netOf = new Map<number, number>();
  const net = (i: number) => {
    const r = root(i);
    if (!netOf.has(r)) netOf.set(r, netOf.size);
    return netOf.get(r)!;
  };
  const drawn: Edge[] = d.parts.map((p, i) => {
    let type = p.type;
    if (type === "meter") {
      const letter = d.labels.find((l) => onMeter(l, p));
      type = letter ? METERS.get(letter.text)! : "meter";
    }
    const tag = tags.get(i);
    return { part: tag ? `${type} "${tag}"` : type, a: net(ends[i][0]), b: net(ends[i][1]) };
  });

  for (const e of drawn)
    if (e.a === e.b) out.push(`The ${e.part} is shorted: a wire joins its two ends`);
  const loose = new Map<number, number>();
  for (const e of drawn) for (const n of [e.a, e.b]) loose.set(n, (loose.get(n) ?? 0) + 1);
  for (const [n, count] of loose)
    if (count === 1) {
      const e = drawn.find((e) => e.a === n || e.b === n)!;
      out.push(`One end of the ${e.part} is joined to nothing else`);
    }
  const show = (edges: Edge[]) =>
    [...new Set(edges.flatMap((e) => [e.a, e.b]))]
      .map(
        (n) =>
          `[${edges
            .flatMap((e) => [e.a === n ? e.part : null, e.b === n ? e.part : null])
            .filter(Boolean)
            .sort()
            .join(", ")}]`,
      )
      .sort()
      .join(" ");
  const drawnForm = circuitForm(drawn);
  const wantForm = circuitForm(want);
  if (!drawnForm) {
    if (!out.length)
      out.push(
        `The parts don't make one loop of series and parallel sets. Each [ ] is one junction, listing the parts whose ends meet there: ${show(drawn)}`,
      );
  } else if (wantForm && drawnForm.key !== wantForm.key)
    out.push(
      `The circuit is not wired as the brief's loop says: drawn, it is ${drawnForm.shown}; the loop is ${wantForm.shown}`,
    );
  return out;
}

/** A part, or parts in series, or branches in parallel: a circuit as current sees it. */
type Form = { part: string } | { series: Form[] } | { parallel: Form[] };
const written = (f: Form): string =>
  "part" in f
    ? f.part
    : "series" in f
      ? `series(${f.series.map(written).sort().join(", ")})`
      : `parallel(${f.parallel.map(written).sort().join(" | ")})`;
const joined = (kind: "series" | "parallel", items: Form[]): Form => {
  const flat = items.flatMap((f) =>
    kind === "series" && "series" in f
      ? f.series
      : kind === "parallel" && "parallel" in f
        ? f.parallel
        : [f],
  );
  return kind === "series" ? { series: flat } : { parallel: flat };
};

/**
 * The network between two junctions, reduced to series and parallel sets;
 * null when it won't reduce (a loose end, a short, a part off on its own).
 */
function reduced(edges: Edge[], s: number, t: number): Form | null {
  if (s === t) return null;
  let es = edges.map((e) => ({ a: e.a, b: e.b, f: { part: e.part } as Form }));
  for (let changed = true; changed;) {
    changed = false;
    if (es.some((e) => e.a === e.b)) return null;
    // Parts between the same two junctions are in parallel.
    const groups = new Map<string, typeof es>();
    for (const e of es) {
      const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    if ([...groups.values()].some((g) => g.length > 1)) {
      es = [...groups.values()].map((g) =>
        g.length === 1
          ? g[0]
          : {
              a: g[0].a,
              b: g[0].b,
              f: joined(
                "parallel",
                g.map((e) => e.f),
              ),
            },
      );
      changed = true;
      continue;
    }
    // Two parts meeting at a junction nothing else touches are in series.
    const degree = new Map<number, number>();
    for (const e of es) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const n = [...degree].find(([n, k]) => k === 2 && n !== s && n !== t)?.[0];
    if (n !== undefined) {
      const [x, y] = es.filter((e) => e.a === n || e.b === n);
      const far = (e: (typeof es)[number]) => (e.a === n ? e.b : e.a);
      es = [
        ...es.filter((e) => e !== x && e !== y),
        { a: far(x), b: far(y), f: joined("series", [x.f, y.f]) },
      ];
      changed = true;
    }
  }
  const [only] = es;
  return es.length === 1 && ((only.a === s && only.b === t) || (only.a === t && only.b === s))
    ? only.f
    : null;
}

/**
 * A closed circuit written so that order doesn't count: parts in series in
 * any order round the loop, branches in any order. The loop is cut at each
 * part in turn and the rest reduced between the cut's two ends; the smallest
 * result is the key, so two circuits wired alike share it. `shown` is the
 * loop cut at its cell or battery, for reading. Null when no cut reduces.
 */
function circuitForm(edges: Edge[]): { key: string; shown: string } | null {
  const forms: { form: string; source: boolean }[] = [];
  edges.forEach((cut, i) => {
    const rest = reduced(
      edges.filter((_, j) => j !== i),
      cut.a,
      cut.b,
    );
    if (rest)
      forms.push({
        form: written(joined("series", [{ part: cut.part }, rest])),
        source: /^(cell|battery)/.test(cut.part),
      });
  });
  if (!forms.length) return null;
  const key = forms.map((f) => f.form).sort()[0];
  return { key, shown: forms.find((f) => f.source)?.form ?? key };
}

/**
 * The model's whole reply checked: its shape, then the figure. `figure` is
 * set only when there is one to show.
 */
export function checkReply(
  reply: unknown,
  brief?: FigureBrief,
): {
  problems: string[];
  status: FigureReply["status"] | null;
  figure: { svg: string; alt: string } | null;
} {
  const r = reply as Partial<FigureReply> | null;
  const problems: string[] = [];
  if (!r || typeof r !== "object")
    return { problems: ["The reply is not a JSON object"], status: null, figure: null };
  if (!["ok", "not_needed", "cannot_draw"].includes(r.status as string))
    problems.push('status must be "ok", "not_needed" or "cannot_draw"');
  if (typeof r.reason !== "string") problems.push("reason must be a string");
  if (typeof r.alt !== "string") problems.push("alt must be a string");
  if (!Array.isArray(r.labels) || !r.labels.every((l) => typeof l === "string"))
    problems.push("labels must be a list of strings");
  if (typeof r.svg !== "string") problems.push("svg must be a string");
  if (problems.length) return { problems, status: null, figure: null };
  if (r.status !== "ok") {
    if (r.svg) problems.push(`A reply with status "${r.status}" has no svg`);
    if (!r.reason!.trim()) problems.push(`A reply with status "${r.status}" says why in reason`);
    return { problems, status: r.status!, figure: null };
  }
  if (!r.alt!.trim()) problems.push("alt is empty");
  // The database holds 2000 characters: a longer one would fail the whole set's save.
  else if (r.alt!.trim().length > 1000)
    problems.push("alt is longer than 1000 characters: describe the figure more briefly");
  const check = checkFigure(r.svg!, brief);
  problems.push(...check.problems);
  const sort = (l: string[]) => l.map((t) => t.trim()).sort();
  if (check.svg && JSON.stringify(sort(r.labels!)) !== JSON.stringify(sort(check.labels)))
    problems.push("labels must list every line of text in the svg, exactly as written");
  return {
    problems,
    status: "ok",
    figure: problems.length || !check.svg ? null : { svg: check.svg, alt: r.alt!.trim() },
  };
}
