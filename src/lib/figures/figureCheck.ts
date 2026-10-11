/**
 * The check a question figure passes before any student sees it, and the
 * clean copy that is put on the page.
 *
 * The model's SVG is read by a strict parser that accepts only the small SVG
 * the contract allows (figure.ts): known elements and attributes, style
 * classes, plain numbers. Then the drawing is checked: everything on the
 * canvas, no text over text or over a line, every plotted point and bar where
 * its value puts it, every tick number where its value is, every label the
 * brief names. A figure with any problem is never shown. A figure that passes
 * reaches the page only as `svg`, rebuilt from the parsed tree, so nothing the
 * contract doesn't name can get through.
 */
import {
  ARROW_DEFS,
  CANVAS_HEIGHTS,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  FIGURE_CLASSES,
  MAX_LINE,
  PLOT,
  TEXT_SIZE,
  plotX,
  plotY,
  type FigureBrief,
  type FigureClass,
  type KnownBrief,
  type FigureReply,
} from "./figure";

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
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g)) {
      if (a[1] in attrs) problems.push(`<${name}> has ${a[1]} twice`);
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

/** The tree written back out: only the contract's elements and attributes, in its order. */
function serialize(n: Node): string {
  if (!ELEMENTS[n.name]) return "";
  const attrs = ELEMENTS[n.name]
    .filter((a) => a in n.attrs)
    .map((a) => ` ${a}="${encode(n.attrs[a])}"`)
    .join("");
  const inner =
    (n.name === "text" || n.name === "tspan" ? encode(n.text) : "") +
    n.children.map(serialize).join("");
  return inner ? `<${n.name}${attrs}>${inner}</${n.name}>` : `<${n.name}${attrs}/>`;
}

// ── Geometry ────────────────────────────────────────────────────────────────

type Pt = [number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };
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
  const bezier = (p: Pt[], steps = 8) => {
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

type Label = {
  text: string;
  box: Box;
  owner: number;
  cls: FigureClass;
  x: number;
  y: number;
  anchor: string;
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
  if (root.attrs.xmlns !== "http://www.w3.org/2000/svg")
    problems.push('The <svg> lacks xmlns="http://www.w3.org/2000/svg"');
  if (!vb || !CANVAS_HEIGHTS.includes(H))
    problems.push(
      `The viewBox is not "0 0 ${CANVAS_WIDTH} H" with H a multiple of 20 from 200 to 480`,
    );
  if (root.attrs.class !== "qf") problems.push('The <svg> lacks class="qf"');
  if (root.attrs.role !== "img") problems.push('The <svg> lacks role="img"');

  const height = Number.isFinite(H) ? H : 480;
  const labels: Label[] = [];
  const segments: { seg: [Pt, Pt]; cls: string }[] = [];
  const dots: { at: Pt; x: number; y: number; cls: string }[] = [];
  const bars: { box: Box; value: number; cls: string }[] = [];
  const dataLines: { pts: Pt[]; cls: string }[] = [];
  const symbols: string[] = [];
  let owner = 0;

  const inCanvas = (p: Pt) =>
    p[0] >= CANVAS_MARGIN - 0.5 &&
    p[0] <= CANVAS_WIDTH - CANVAS_MARGIN + 0.5 &&
    p[1] >= CANVAS_MARGIN - 0.5 &&
    p[1] <= height - CANVAS_MARGIN + 0.5;
  const outside = new Set<string>();

  const visit = (n: Node, m: Matrix, path: string) => {
    const allowed = ELEMENTS[n.name];
    const where = `${path}<${n.name}>`;
    if (!allowed) {
      problems.push(`${where} is not allowed`);
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
      if (a in n.attrs && n.attrs[a] !== "url(#qf-head)")
        problems.push(`${where} ${a} must be url(#qf-head)`);

    if (n.name === "defs") {
      if (path !== "<svg> ") problems.push("<defs> must sit directly in <svg>");
      else if (serialize(n) !== serialize(parse(ARROW_DEFS).root!))
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
      else if (!(cls in FIGURE_CLASSES))
        problems.push(`${where} has a class not in the list: ${cls}`);
    }
    let own = m;
    if (n.attrs.transform) {
      const t = parseTransform(n.attrs.transform);
      if (!t) problems.push(`${where} transform may only translate and rotate`);
      else own = multiply(m, t);
    }
    const num = (a: string) => Number(n.attrs[a] ?? 0);
    const keep = (pts: Pt[]) => {
      const abs = pts.map((p) => apply(own, p));
      if (abs.some((p) => !inCanvas(p))) outside.add(where);
      return abs;
    };

    switch (n.name) {
      case "g":
        if (n.attrs["data-symbol"]) symbols.push(n.attrs["data-symbol"]);
        n.children.forEach((c) => visit(c, own, `${where} `));
        return;
      case "line": {
        const [a, b] = keep([
          [num("x1"), num("y1")],
          [num("x2"), num("y2")],
        ]);
        segments.push({ seg: [a, b], cls: cls ?? "" });
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
        for (let k = 1; k < abs.length; k++)
          segments.push({ seg: [abs[k - 1], abs[k]], cls: cls ?? "" });
        if (cls === "qf-data" || cls === "qf-data2") dataLines.push({ pts: abs, cls });
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
        if (cls === "qf-bar" || cls === "qf-bar2")
          bars.push({ box: boxOf(c), value: Number(n.attrs["data-y"]), cls });
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
        break;
      }
      case "path": {
        const lines = pathPolylines(n.attrs.d ?? "");
        if (!lines) {
          problems.push(`${where} d may use only the absolute commands M L H V C S Q Z`);
          break;
        }
        for (const l of lines) {
          const abs = keep(l);
          for (let k = 1; k < abs.length; k++)
            segments.push({ seg: [abs[k - 1], abs[k]], cls: cls ?? "" });
        }
        break;
      }
      case "text": {
        const size = (cls && TEXT_SIZE[cls]) ?? 0;
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
          const w = 0.55 * size * chars;
          const x0 = anchor === "middle" ? l.x - w / 2 : anchor === "end" ? l.x - w : l.x;
          const corners = keep([
            [x0, l.y - 0.8 * size],
            [x0 + w, l.y + 0.25 * size],
            [x0, l.y + 0.25 * size],
            [x0 + w, l.y - 0.8 * size],
          ]);
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

  for (const w of outside)
    problems.push(`${w} goes outside the canvas (keep ${CANVAS_MARGIN} units clear of every edge)`);

  // Text over text, and text over a line.
  for (let a = 0; a < labels.length; a++)
    for (let b = a + 1; b < labels.length; b++)
      if (
        labels[a].owner !== labels[b].owner &&
        overlaps(grow(labels[a].box, 2), grow(labels[b].box, 2))
      )
        problems.push(`Text "${labels[a].text}" overlaps text "${labels[b].text}"`);
  for (const l of labels) {
    const inner = grow(l.box, -1);
    const hit = segments.find((s) => s.cls !== "qf-thin" && crosses(s.seg, inner));
    if (hit) problems.push(`Text "${l.text}" sits on a line`);
  }

  if (brief)
    problems.push(
      ...briefProblems(brief, height, labels, dots, bars, dataLines, segments, symbols),
    );
  return {
    problems,
    svg: serialize(root),
    height: Number.isFinite(H) ? H : null,
    labels: labels.map((l) => l.text),
  };
}

const near = (a: number, b: number, by = 0.6) => Math.abs(a - b) <= by;
const fmt = (v: number) => String(Number(v.toFixed(2)));

/** What the brief asks for that the drawing doesn't show, or shows in the wrong place. */
function briefProblems(
  brief: FigureBrief,
  H: number,
  labels: Label[],
  dots: { at: Pt; x: number; y: number; cls: string }[],
  bars: { box: Box; value: number; cls: string }[],
  dataLines: { pts: Pt[]; cls: string }[],
  segments: { seg: [Pt, Pt]; cls: string }[],
  symbols: string[],
): string[] {
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
  const k = brief as KnownBrief;

  if (k.kind === "line-graph" || k.kind === "scatter" || k.kind === "bar-chart") {
    const bottom = H - PLOT.bottomGap;
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
        const d = dots.find((p) => p.x === x && p.y === y);
        if (!d) out.push(`The point (${fmt(x)}, ${fmt(y)}) is missing or has no data-x/data-y`);
        else if (!near(d.at[0], plotX(x, k.x)) || !near(d.at[1], plotY(y, k.y, H)))
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
      const count = (t: string) => symbols.filter((s) => s === t).length;
      const wanted = new Map<string, number>();
      for (const c of k.components) {
        const t = ["ammeter", "voltmeter", "motor"].includes(c.type) ? "meter" : c.type;
        wanted.set(t, (wanted.get(t) ?? 0) + 1);
        if (c.label) need(c.label, "label");
      }
      for (const [t, n] of wanted)
        if (count(t) !== n)
          out.push(`The circuit has ${count(t)} ${t} symbol(s); the brief has ${n}`);
      for (const s of new Set(symbols))
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
      break;
    }
    case "energy-profile":
      need(k.reactants, "reactants name");
      need(k.products, "products name");
      k.arrows.forEach((a) => need(a.letter, `letter for the ${a.shows} arrow`));
      break;
    case "food-web":
      k.organisms.forEach((o) => need(o.name, "organism"));
      break;
  }
  return out;
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
