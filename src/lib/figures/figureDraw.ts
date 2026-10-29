/**
 * Figures drawn by code: line and scatter graphs, bar charts, reaction
 * profiles, chromatograms, waves and the forces on an object. Every position
 * in these follows from the brief by the contract's formulas (figure.ts), so
 * code draws them exactly, free and the same every time. DeepSeek is left the
 * figures whose layout needs deciding: circuits and food webs
 * (`figurePrompt`). Whatever is drawn here still goes through `checkFigure`
 * before it is saved, and the tests hold every drawing to it.
 */
import {
  ARROW_DEFS,
  CANVAS_WIDTH,
  CHROMATOGRAM,
  FORCES,
  FORCE_STEP,
  PLOT,
  PROFILE,
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
  type Axis,
  type BarBrief,
  type ChromatogramBrief,
  type FigureBrief,
  type ForceBrief,
  type GraphBrief,
  type ProfileBrief,
  type WaveBrief,
} from "./figure";

import {
  GRAPH_HEIGHT,
  and,
  every,
  frame,
  label,
  line,
  num,
  polyline,
  svgOf,
  text,
  ticks,
  wrap,
} from "./figureSvg";

export { ticks, wrap } from "./figureSvg";
import { figureKind } from "./kinds";

/** The kinds drawn here; every other kind goes to DeepSeek. */
export const CODE_DRAWN = [
  "line-graph",
  "scatter",
  "bar-chart",
  "energy-profile",
  "chromatogram",
  "wave",
  "forces",
] as const;
export const drawnByCode = (brief: FigureBrief) =>
  (CODE_DRAWN as readonly string[]).includes(brief.kind) || !!figureKind(brief.kind);

/** A drawing and what it shows, for a screen reader, without the answer. */
export type DrawnFigure = { svg: string; alt: string };

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * A key for two series, in the first corner of the plot area that no data
 * crosses: a box with each series' sample and name. When every corner is
 * taken (two curves that fill the plot), a row above the plot instead,
 * beside the y axis's title. Null when that row has no room either.
 */
function keyFor(
  names: [string, string],
  samples: [(x: number, y: number) => string, (x: number, y: number) => string],
  H: number,
  taken: Box[],
  yTitle: string,
): string | null {
  const size = TEXT_SIZE["qf-text"]!;
  const w = 12 + 24 + 8 + Math.max(...names.map((n) => textWidth(n, size))) + 10;
  const h = 52;
  const bottom = H - PLOT.bottomGap;
  const corners: [number, number][] = [
    [PLOT.left + 8, PLOT.top + 4],
    [PLOT.right - 8 - w, PLOT.top + 4],
    [PLOT.right - 8 - w, bottom - 8 - h],
    [PLOT.left + 8, bottom - 8 - h],
  ];
  for (const [x, y] of corners) {
    const box = { x0: x - 4, y0: y - 4, x1: x + w + 4, y1: y + h + 4 };
    if (taken.some((t) => t.x0 < box.x1 && box.x0 < t.x1 && t.y0 < box.y1 && box.y0 < t.y1))
      continue;
    return [
      `<rect class="qf-box" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${h}" rx="6"/>`,
      samples[0](x + 12, y + 16),
      text("qf-text", x + 44, y + 21, "start", [names[0]]),
      samples[1](x + 12, y + 38),
      text("qf-text", x + 44, y + 43, "start", [names[1]]),
    ].join("");
  }
  const entry = (i: 0 | 1) => 24 + 6 + textWidth(names[i], size);
  // Out to the canvas's edge, 10 units clear of the title.
  const first = CANVAS_WIDTH - 8 - entry(0) - 12 - entry(1);
  if (first < 16 + textWidth(yTitle, size) + 10) return null;
  const second = first + entry(0) + 12;
  return [
    samples[0](first, 17),
    text("qf-text", first + 30, 22, "start", [names[0]]),
    samples[1](second, 17),
    text("qf-text", second + 30, 22, "start", [names[1]]),
  ].join("");
}

/** Boxes round a polyline's segments, and round its points, for placing a key clear of them. */
function segmentBoxes(pts: [number, number][]): Box[] {
  const boxes = pts.map(([x, y]) => ({ x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 }));
  for (let i = 1; i < pts.length; i++) {
    // A slanted segment is boxed in short steps, so its bounding box doesn't claim the whole corner.
    const [[ax, ay], [bx, by]] = [pts[i - 1], pts[i]];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8));
    for (let s = 0; s <= steps; s++) {
      const [x, y] = [ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps];
      boxes.push({ x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 });
    }
  }
  return boxes;
}

/**
 * A smooth curve through points in drawing units, left to right, sampled at
 * least every 2 units: monotone cubic (Fritsch–Carlson), so between two
 * points it only ever runs from one to the other. It invents no peak, dip or
 * overshoot a student could read, and the checker holds it to exactly that.
 */
export function smoothCurve(p: [number, number][]): [number, number][] {
  const n = p.length;
  const m = p.slice(1).map(([x, y], i) => (y - p[i][1]) / (x - p[i][0]));
  const t = p.map((_, i) =>
    i === 0 ? m[0] : i === n - 1 ? m[n - 2] : m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2,
  );
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const [a, c] = [t[i] / m[i], t[i + 1] / m[i]];
    const s = a * a + c * c;
    if (s > 9) {
      t[i] = (3 / Math.sqrt(s)) * a * m[i];
      t[i + 1] = (3 / Math.sqrt(s)) * c * m[i];
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const [[x0, y0], [x1, y1]] = [p[i], p[i + 1]];
    const h = x1 - x0;
    const steps = Math.max(1, Math.ceil(h / 2));
    for (let k = 0; k < steps; k++) {
      const u = k / steps;
      const y =
        (2 * u ** 3 - 3 * u ** 2 + 1) * y0 +
        (u ** 3 - 2 * u ** 2 + u) * h * t[i] +
        (-2 * u ** 3 + 3 * u ** 2) * y1 +
        (u ** 3 - u ** 2) * h * t[i + 1];
      out.push([x0 + u * h, y]);
    }
  }
  out.push(p[n - 1]);
  return out;
}

function drawGraph(b: GraphBrief): DrawnFigure | null {
  const H = GRAPH_HEIGHT;
  const body = frame(H, b.x, b.y, b.x.title);
  const taken: Box[] = [];
  b.series.forEach((s, i) => {
    const pts = s.points.map(([x, y]) => [plotX(x, b.x), plotY(y, b.y, H)] as [number, number]);
    const drawn = b.curve ? smoothCurve(pts) : pts;
    taken.push(...segmentBoxes(b.kind === "line-graph" ? drawn : []));
    taken.push(...pts.map(([x, y]) => ({ x0: x - 5, y0: y - 5, x1: x + 5, y1: y + 5 })));
    if (b.kind === "line-graph") body.push(polyline(i ? "qf-data2" : "qf-data", drawn));
    s.points.forEach(([x, y], j) =>
      body.push(
        `<circle class="qf-dot" cx="${num(pts[j][0])}" cy="${num(pts[j][1])}" r="3.5" data-x="${num(x)}" data-y="${num(y)}"/>`,
      ),
    );
  });
  for (const l of b.lines ?? []) {
    const ends: [number, number][] = [l.from, l.to].map(([x, y]) => [
      plotX(x, b.x),
      plotY(y, b.y, H),
    ]);
    body.push(line("qf-line", ...ends[0], ...ends[1]));
    taken.push(...segmentBoxes(ends));
  }
  if (b.series.length === 2) {
    const sample = (cls: string) => (x: number, y: number) =>
      b.kind === "line-graph"
        ? line(cls, x, y, x + 24, y)
        : `<circle class="qf-dot" cx="${num(x + 12)}" cy="${num(y)}" r="3.5"/>`;
    const key = keyFor(
      [b.series[0].name, b.series[1].name],
      [sample("qf-data"), sample("qf-data2")],
      H,
      taken,
      b.y.title,
    );
    if (!key) return null;
    body.push(key);
  }
  const describe = (s: GraphBrief["series"][number]) =>
    `${b.series.length > 1 ? `${s.name}: ` : ""}${s.points.map(([x, y]) => `(${label(x)}, ${label(y)})`).join(", ")}`;
  const lines = (b.lines ?? []).map(
    (l) =>
      ` A straight line is drawn from (${label(l.from[0])}, ${label(l.from[1])}) to (${label(l.to[0])}, ${label(l.to[1])}).`,
  );
  return {
    svg: svgOf(H, body),
    alt: `A ${b.kind === "scatter" ? "scatter graph" : "line graph"} of ${b.y.title} from ${label(b.y.min)} to ${label(b.y.max)} against ${b.x.title} from ${label(b.x.min)} to ${label(b.x.max)}. Points${b.curve ? ", joined by a smooth curve" : ""}: ${b.series.map(describe).join("; ")}.${lines.join("")}`,
  };
}

function drawBars(b: BarBrief): DrawnFigure | null {
  const H = GRAPH_HEIGHT;
  const body = frame(H, null, b.y, b.x.title);
  const n = b.x.categories.length;
  const slot = (PLOT.right - PLOT.left) / n;
  const bottom = H - PLOT.bottomGap;
  const two = b.series.length === 2;
  const width = two ? Math.min(24, 0.35 * slot) : Math.min(40, 0.6 * slot);
  const taken: Box[] = [];
  b.x.categories.forEach((c, i) => {
    const centre = PLOT.left + slot * (i + 0.5);
    b.series.forEach((s, j) => {
      const x = two ? (j ? centre + 2 : centre - 2 - width) : centre - width / 2;
      const top = plotY(s.values[i], b.y, H);
      taken.push({ x0: x, y0: top, x1: x + width, y1: bottom });
      body.push(
        `<rect class="${j ? "qf-bar2" : "qf-bar"}" x="${num(x)}" y="${num(top)}" width="${num(width)}" height="${num(bottom - top)}" data-y="${num(s.values[i])}"/>`,
      );
    });
    body.push(text("qf-small", centre, H - 38, "middle", [c]));
  });
  if (two) {
    const sample = (cls: string) => (x: number, y: number) =>
      `<rect class="${cls}" x="${num(x)}" y="${num(y - 6)}" width="24" height="12"/>`;
    const key = keyFor(
      [b.series[0].name, b.series[1].name],
      [sample("qf-bar"), sample("qf-bar2")],
      H,
      taken,
      b.y.title,
    );
    if (!key) return null;
    body.push(key);
  }
  const values = (s: BarBrief["series"][number]) =>
    b.x.categories.map((c, i) => `${c}: ${label(s.values[i])}`).join(", ");
  return {
    svg: svgOf(H, body),
    alt: `A bar chart of ${b.y.title} for each ${b.x.title}. ${b.series.map((s) => `${two ? `${s.name}: ` : ""}${values(s)}`).join("; ")}.`,
  };
}

/** How wide a reactants or products name may run before it wraps. */
export const PROFILE_NAME_WIDTH = { reactants: 160, products: 88 } as const;

function drawProfile(b: ProfileBrief): DrawnFigure | null {
  const levels = PROFILE.levels[b.reaction];
  if (!levels) return null;
  const { R, P, T } = levels;
  const top = PROFILE.top;
  const size = TEXT_SIZE["qf-text"]!;
  const reactants = wrap(b.reactants, PROFILE_NAME_WIDTH.reactants, size);
  const products = wrap(b.products, PROFILE_NAME_WIDTH.products, size);
  if (!reactants || !products) return null;
  const head = ' marker-end="url(#qf-head)"';
  const both = ' marker-start="url(#qf-head)" marker-end="url(#qf-head)"';
  const body = [
    ARROW_DEFS,
    line("qf-line", 40, 260, 40, 28, head),
    line("qf-line", 40, 260, 344, 260, head),
    text("qf-text", 48, 36, "start", ["energy"]),
    text("qf-text", 192, 288, "middle", ["progress of reaction"]),
    line("qf-line", 56, R, 112, R),
    line("qf-line", 256, P, 336, P),
    `<path class="qf-data" d="M112 ${R} C148 ${R} 148 ${top} 184 ${top} S220 ${P} 256 ${P}"/>`,
  ];
  if (b.catalyst)
    body.push(
      `<path class="qf-data2" d="M112 ${R} C148 ${R} 148 ${T} 184 ${T} S220 ${P} 256 ${P}"/>`,
    );
  const ends = {
    "activation energy": top,
    "activation energy with a catalyst": T,
    "overall energy change": P,
  } as const;
  for (const a of b.arrows) {
    const x = PROFILE.arrowX[a.shows];
    const to = ends[a.shows];
    if (x === undefined || to === undefined) return null;
    if (a.shows === "activation energy") body.push(line("qf-thin", x - 6, top, 184, top));
    if (a.shows === "activation energy with a catalyst")
      body.push(line("qf-thin", x - 6, T, 184, T));
    if (a.shows === "overall energy change") body.push(line("qf-thin", 112, R, x + 8, R));
    body.push(line("qf-line", x, R, x, to, both));
    const left = a.shows === "activation energy";
    body.push(
      text("qf-strong", left ? x - 8 : x + 8, (R + to) / 2 + 5.5, left ? "end" : "start", [
        a.letter,
      ]),
    );
  }
  body.push(text("qf-text", 56, R + 22, "start", reactants));
  // Under an exothermic reaction's products line; over an endothermic one's.
  const productsY = b.reaction === "exothermic" ? P + 22 : P - 8 - 18 * (products.length - 1);
  body.push(text("qf-text", 262, productsY, "start", products));
  const letters = b.arrows.map((a) => a.letter);
  const listed =
    letters.length > 1
      ? `${letters.slice(0, -1).join(", ")} and ${letters[letters.length - 1]}`
      : letters[0];
  return {
    svg: svgOf(PROFILE.height, body),
    // What is drawn, never what it means: "exothermic" may be the answer.
    alt: `A reaction profile from ${b.reactants} to ${b.products}. The products line is ${b.reaction === "exothermic" ? "below" : "above"} the reactants line${b.catalyst ? ", and a dashed second curve rises to a lower peak" : ""}.${letters.length ? ` ${letters.length === 1 ? "A double-headed arrow is" : `${letters.length} double-headed arrows are`} labelled ${listed}.` : ""}`,
  };
}

function drawChromatogram(b: ChromatogramBrief): DrawnFigure {
  const C = CHROMATOGRAM;
  const max = b.y.max;
  const n = b.samples.length;
  const body = [
    `<rect class="qf-line" x="${C.left}" y="${C.paperTop}" width="${C.right - C.left}" height="${C.paperBottom - C.paperTop}"/>`,
  ];
  const ys = ticks(b.y);
  for (const v of ys)
    if (v > 0) body.push(line("qf-thin", C.left, chromaY(v, max), C.right, chromaY(v, max)));
  const k = every((C.start - C.top) / (ys.length - 1), 18);
  ys.forEach((v, i) => {
    if (i % k === 0)
      body.push(text("qf-small", C.left - 8, chromaY(v, max) + 5, "end", [label(v)]));
  });
  body.push(text("qf-text", 16, 22, "start", [b.y.title]));
  body.push(line("qf-line", C.left, C.start, C.right, C.start));
  body.push(line("qf-line", C.left, chromaY(b.front, max), C.right, chromaY(b.front, max)));
  body.push(text("qf-small", C.labelX, chromaY(b.front, max) + 5, "start", ["solvent front"]));
  body.push(text("qf-small", C.labelX, C.start + 5, "start", ["start line"]));
  b.samples.forEach((s, i) => {
    for (const v of s.spots)
      body.push(
        `<circle class="qf-dot" cx="${num(laneX(i, n))}" cy="${num(chromaY(v, max))}" r="5" data-x="${i + 1}" data-y="${num(v)}"/>`,
      );
    body.push(text("qf-small", laneX(i, n), C.start + 22, "middle", [s.name]));
  });
  return {
    svg: svgOf(C.height, body),
    alt: `A paper chromatogram of ${n} samples, with a scale of ${b.y.title} from the start line at 0 to ${label(max)}. The solvent front is at ${label(b.front)}. Spots: ${b.samples.map((s) => `${s.name} at ${and(s.spots.map(label))}`).join("; ")}.`,
  };
}

/**
 * A sine wave as a polyline from x0 to x1, a point at least every 2 units, so
 * it reads as a smooth curve and never cuts a crest short.
 */
export const wavePoints = (x0: number, x1: number, rest: number, amp: number, length: number) => {
  const steps = Math.ceil((x1 - x0) / 2);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / steps;
    return [x, rest - amp * Math.sin((2 * Math.PI * (x - x0)) / length)] as [number, number];
  });
};
function drawWave(b: WaveBrief): DrawnFigure {
  if ("x" in b) {
    const H = GRAPH_HEIGHT;
    const rest = plotY(0, b.y, H);
    const amp = (b.amplitude / (b.y.max - b.y.min)) * (H - PLOT.bottomGap - PLOT.top);
    const length = (b.wavelength / (b.x.max - b.x.min)) * (PLOT.right - PLOT.left);
    return {
      svg: svgOf(H, [
        ...frame(H, b.x, b.y, b.x.title),
        line("qf-line", PLOT.left, rest, PLOT.right, rest),
        polyline("qf-data", wavePoints(PLOT.left, PLOT.right, rest, amp, length)),
      ]),
      // Neither its height nor its length: either may be the answer.
      alt: `A graph of ${b.y.title} from ${label(b.y.min)} to ${label(b.y.max)} against ${b.x.title} from ${label(b.x.min)} to ${label(b.x.max)}: a wave that starts at 0 and rises first.`,
    };
  }
  const crest = WAVE.rest - WAVE.amp;
  const trough = WAVE.rest + WAVE.amp;
  const firstCrest = WAVE.left + WAVE_LENGTH / 4;
  const shows = new Set(b.arrows.map((a) => a.shows));
  const head = ' marker-start="url(#qf-head)" marker-end="url(#qf-head)"';
  const body = [
    ARROW_DEFS,
    line("qf-line", WAVE.restFrom, WAVE.rest, WAVE.restTo, WAVE.rest),
    polyline("qf-data", wavePoints(WAVE.left, WAVE.right, WAVE.rest, WAVE.amp, WAVE_LENGTH)),
  ];
  // Guides from the vertical arrows to the first crest and trough; one crest guide serves both.
  const fromX = shows.has("crest to trough") ? 38 : shows.has("amplitude") ? 66 : null;
  if (fromX !== null) body.push(line("qf-thin", fromX, crest, firstCrest, crest));
  if (shows.has("crest to trough"))
    body.push(line("qf-thin", 38, trough, WAVE.left + (WAVE_LENGTH * 3) / 4, trough));
  for (const a of b.arrows) {
    const { from, to, letter } = WAVE_ARROWS[a.shows];
    if (a.shows === "wavelength")
      for (const x of [from[0], to[0]]) body.push(line("qf-thin", x, crest - 6, x, from[1] - 6));
    if (a.shows === "half a wavelength")
      for (const x of [from[0], to[0]]) body.push(line("qf-thin", x, WAVE.rest, x, from[1] + 6));
    body.push(line("qf-line", from[0], from[1], to[0], to[1], head));
    body.push(text("qf-strong", letter[0], letter[1], letter[2], [a.letter]));
  }
  const letters = b.arrows.map((a) => a.letter);
  return {
    svg: svgOf(WAVE.height, body),
    // What is drawn, never what it means: which arrow is the amplitude is the question.
    alt: `A wave drawn over two whole waves, crossing a straight line through its middle. ${letters.length === 1 ? "A double-headed arrow is" : `${letters.length} double-headed arrows are`} labelled ${and(letters)}.`,
  };
}

/** A size in newtons as an exam paper writes it: 2500 N, 13 800 N. */
const newtons = (v: number) => {
  const [whole, part] = label(v).split(".");
  const grouped =
    whole.replace(/^−/, "").length > 4 ? whole.replace(/\B(?=(\d{3})+$)/g, " ") : whole;
  return `${grouped}${part ? `.${part}` : ""} N`;
};

/** A force's label, line by line: its name, wrapped, then its size; null when the name can't fit. */
export function forceLabel(f: ForceBrief["forces"][number]): string[] | null {
  const name = wrap(f.name, FORCES.nameWidth, TEXT_SIZE["qf-text"]!);
  if (!name) return null;
  return f.size === null ? name : [...name, newtons(f.size)];
}

/** How wide a label's widest line is. */
export const labelWidth = (lines: string[]) =>
  Math.max(...lines.map((l) => textWidth(l, TEXT_SIZE["qf-text"]!)));

/** How long a force's arrow is: all one length, or in proportion to the largest. */
export const forceLength = (b: ForceBrief, f: ForceBrief["forces"][number]) => {
  if (!b.toScale || f.size === null) return FORCES.length;
  const largest = Math.max(...b.forces.map((g) => g.size ?? 0));
  return (FORCES.longest * f.size) / largest;
};

function drawForces(b: ForceBrief): DrawnFigure | null {
  const { x0, y0, x1, y1 } = FORCES.box;
  const body = [
    ARROW_DEFS,
    `<rect class="qf-line" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="4"/>`,
  ];
  if (b.object)
    body.push(text("qf-text", (x0 + x1) / 2, (y0 + y1) / 2 + 5.5, "middle", [b.object]));
  for (const f of b.forces) {
    const [sx, sy] = forceStart(f.direction);
    const [dx, dy] = FORCE_STEP[f.direction];
    const L = forceLength(b, f);
    body.push(line("qf-line", sx, sy, sx + dx * L, sy + dy * L, ' marker-end="url(#qf-head)"'));
    const lines = forceLabel(f);
    if (!lines) return null;
    const [x, y, anchor] = forceLabelAt(f.direction, lines.length, labelWidth(lines), L);
    // The force the question asks for is bold, as an exam paper marks its X.
    body.push(text(f.size === null ? "qf-strong" : "qf-text", x, y, anchor, lines));
  }
  return {
    svg: svgOf(FORCES.height, body),
    alt: `A box${b.object ? ` labelled ${b.object}` : ""} with ${b.forces.length === 1 ? "one force arrow" : `${b.forces.length} force arrows`}${b.forces.length > 1 ? (b.toScale ? ", drawn to scale" : ", all the same length") : ""}: ${b.forces.map((f) => `${f.direction}, ${f.name}${f.size === null ? "" : ` ${newtons(f.size)}`}`).join("; ")}.`,
  };
}

/** The figure for a brief that code draws; null for one it doesn't, or can't fit. */
export function drawWithCode(brief: FigureBrief): DrawnFigure | null {
  switch (brief.kind) {
    case "line-graph":
    case "scatter":
      return drawGraph(brief as GraphBrief);
    case "bar-chart":
      return drawBars(brief as BarBrief);
    case "energy-profile":
      return drawProfile(brief as ProfileBrief);
    case "chromatogram":
      return drawChromatogram(brief as ChromatogramBrief);
    case "wave":
      return drawWave(brief as WaveBrief);
    case "forces":
      return drawForces(brief as ForceBrief);
    default:
      return figureKind(brief.kind)?.draw(brief) ?? null;
  }
}
