/**
 * A shape with its sizes, for area, volume, density and pressure questions:
 * a rectangle, a cuboid (in oblique projection, its depth drawn back at 45°
 * and halved, so a cube looks like one) or a cylinder (its ends ellipses
 * three tenths as deep as wide). Drawn in proportion to its sizes, as big as its
 * room allows, each size written beside its own edge on a dimension line
 * with guide lines out to the edge's ends. The checker holds the outline to
 * the proportions and each label to its own edge.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { and } from "../figureSvg";
import type { FigureKind } from "./kind";
import { drawParts, partProblems, type Part } from "./parts";

export const SHAPES = ["rectangle", "cuboid", "cylinder"] as const;
type Shape = (typeof SHAPES)[number];
type Edge = "width" | "height" | "depth" | "diameter" | "radius";
const UNITS = ["mm", "cm", "m"] as const;

export type ShapeBrief = {
  kind: "shape-sizes";
  shape: Shape;
  unit: (typeof UNITS)[number];
  /** Decimal places every size is written with: 1 writes 2 as "2.0 cm". */
  decimals: number;
  /** The shape's sizes: a rectangle's width and height, a cuboid's width, height and depth, a cylinder's height and its diameter or radius. */
  sizes: Partial<Record<Edge, number>>;
  /** Sizes written as a letter, for the one the question asks for. */
  letters: Partial<Record<Edge, string>>;
};

const H = 260;
/** The room the shape may fill: its drawn width and height at most. */
const ROOM = { rectangle: [200, 140], cuboid: [180, 140], cylinder: [180, 150] } as const;
/** How far a receding edge runs per unit of depth: halved, at 45°. */
const RECEDE = 0.5 / Math.SQRT2;
/** How deep a cylinder's end ellipse is, for its radius. */
const SQUASH = 0.3;
/** A Bézier quarter-circle's control distance, as a share of the radius. */
const KAPPA = 0.5523;
/**
 * Every drawn edge is at least this long (a cuboid's receding depth 24), so
 * its dimension line holds its two heads clear of its label.
 */
const SHORTEST = 32;
const TEXT = TEXT_SIZE["qf-text"]!;

/** The sizes a shape needs, in the order the alt text gives them. */
const edgesOf = (shape: Shape, sizes: object): Edge[] =>
  shape === "rectangle"
    ? ["width", "height"]
    : shape === "cuboid"
      ? ["width", "height", "depth"]
      : ["height", "radius" in sizes ? "radius" : "diameter"];
/** A size as written: its letter, or its value with the brief's decimal places and unit. */
const written = (b: ShapeBrief, e: Edge) =>
  b.letters[e] ?? `${b.sizes[e]!.toFixed(b.decimals)} ${b.unit}`;
const widthOf = (b: ShapeBrief, e: Edge) => textWidth(written(b, e), TEXT);
const styleOf = (b: ShapeBrief, e: Edge) => (b.letters[e] ? "qf-strong" : "qf-text");

/**
 * A dimension line beside an edge: the double arrow `gap` out from the edge,
 * a guide line out to it from each of the edge's ends, and its label.
 */
function dimension(
  b: ShapeBrief,
  e: Edge,
  ends: [Pt, Pt],
  /** Outwards from the edge, a unit step. */
  out: Pt,
  label: { at: Pt; anchor: "start" | "middle" | "end" },
  gap = 14,
): Part[] {
  const along = (p: Pt, by: number): Pt => [p[0] + out[0] * by, p[1] + out[1] * by];
  return [
    {
      what: `${e} dimension line`,
      el: "line",
      cls: "qf-line",
      pts: [along(ends[0], gap), along(ends[1], gap)],
      heads: "both",
    },
    ...ends.map((p, i): Part => ({
      what: `${e} guide line at its ${i ? "second" : "first"} end`,
      el: "line",
      cls: "qf-thin",
      pts: [along(p, 4), along(p, gap + 6)],
    })),
    {
      what: `${e} label`,
      el: "text",
      cls: styleOf(b, e),
      pts: [label.at],
      anchor: label.anchor,
      lines: [written(b, e)],
    },
  ];
}

/**
 * The shape's scale and its every point, placed so the shape and its labels
 * together sit in the middle of the canvas, and the bounds they take up.
 */
function layout(b: ShapeBrief): {
  parts: Part[];
  box: { x0: number; x1: number; y0: number; y1: number };
  drawn: Partial<Record<Edge, number>>;
} {
  const s = b.sizes;
  const [roomW, roomH] = ROOM[b.shape];
  const parts: Part[] = [];
  if (b.shape === "rectangle" || b.shape === "cuboid") {
    const k = b.shape === "cuboid" ? s.depth! * RECEDE : 0;
    const scale = Math.min(roomW / (s.width! + k), roomH / (s.height! + k));
    const [W, Hh, K] = [s.width! * scale, s.height! * scale, k * scale];
    // Left to right: the height's label (a cuboid's, on the left), the shape, and its right-hand labels.
    const leftRoom = b.shape === "cuboid" ? 26 + widthOf(b, "height") : 0;
    const rightRoom =
      b.shape === "rectangle"
        ? 26 + widthOf(b, "height")
        : Math.max(K, K / 2 + 21 + widthOf(b, "depth"));
    const x0 = 180 - (leftRoom + W + rightRoom) / 2 + leftRoom;
    const y0 = H / 2 - (Hh + 41 - K) / 2;
    const [x1, y1] = [x0 + W, y0 + Hh];
    parts.push({
      what: `${b.shape === "cuboid" ? "cuboid's front face" : "rectangle"} (${s.width} by ${s.height}, in proportion)`,
      el: "rect",
      cls: "qf-line",
      pts: [
        [x0, y0],
        [x1, y1],
      ],
    });
    parts.push(
      ...dimension(
        b,
        "width",
        [
          [x0, y1],
          [x1, y1],
        ],
        [0, 1],
        { at: [(x0 + x1) / 2, y1 + 35], anchor: "middle" },
      ),
    );
    if (b.shape === "rectangle")
      parts.push(
        ...dimension(
          b,
          "height",
          [
            [x1, y0],
            [x1, y1],
          ],
          [1, 0],
          { at: [x1 + 26, (y0 + y1) / 2 + 5.5], anchor: "start" },
        ),
      );
    else {
      parts.push(
        {
          what: "cuboid's top and right side, set back by its depth",
          el: "polyline",
          cls: "qf-line",
          pts: [
            [x0, y0],
            [x0 + K, y0 - K],
            [x1 + K, y0 - K],
            [x1 + K, y1 - K],
            [x1, y1],
          ],
        },
        {
          what: "cuboid's top right edge",
          el: "line",
          cls: "qf-line",
          pts: [
            [x1, y0],
            [x1 + K, y0 - K],
          ],
        },
        ...dimension(
          b,
          "height",
          [
            [x0, y0],
            [x0, y1],
          ],
          [-1, 0],
          { at: [x0 - 26, (y0 + y1) / 2 + 5.5], anchor: "end" },
        ),
        ...dimension(
          b,
          "depth",
          [
            [x1, y1],
            [x1 + K, y1 - K],
          ],
          [Math.SQRT1_2, Math.SQRT1_2],
          { at: [x1 + K / 2 + 21, y1 - K / 2 + 26], anchor: "start" },
        ),
      );
    }
    return {
      parts,
      box: {
        // A width label wider than its edge runs out past the guide lines' ends, under them.
        x0: Math.min(x0 - leftRoom, (x0 + x1) / 2 - widthOf(b, "width") / 2),
        x1: Math.max(x1 + rightRoom, (x0 + x1) / 2 + widthOf(b, "width") / 2),
        y0: y0 - K,
        y1: Math.max(y1 + 39, y1 - K / 2 + 32),
      },
      drawn: { width: W, height: Hh, depth: K * Math.SQRT2 },
    };
  }
  // A cylinder: its top an ellipse, its sides, and the front half of its bottom.
  const r = s.radius ?? s.diameter! / 2;
  const scale = Math.min(roomW / (2 * r), roomH / s.height!);
  const [R, Hc] = [r * scale, s.height! * scale];
  const ry = R * SQUASH;
  const radius = "radius" in s;
  const rightRoom = 26 + widthOf(b, "height");
  const above = radius ? 21 : 0;
  const below = radius ? 0 : 41;
  const cx = 180 - rightRoom / 2;
  const yt = H / 2 - (Hc + 2 * ry + above + below) / 2 + above + ry;
  const yb = yt + Hc;
  const [kx, ky] = [R * KAPPA, ry * KAPPA];
  parts.push(
    {
      what: "cylinder's top",
      el: "path",
      cls: "qf-line",
      pts: [
        [cx + R, yt],
        [cx + R, yt - ky],
        [cx + kx, yt - ry],
        [cx, yt - ry],
        [cx - kx, yt - ry],
        [cx - R, yt - ky],
        [cx - R, yt],
        [cx - R, yt + ky],
        [cx - kx, yt + ry],
        [cx, yt + ry],
        [cx + kx, yt + ry],
        [cx + R, yt + ky],
        [cx + R, yt],
      ],
    },
    {
      what: "cylinder's bottom",
      el: "path",
      cls: "qf-line",
      pts: [
        [cx - R, yb],
        [cx - R, yb + ky],
        [cx - kx, yb + ry],
        [cx, yb + ry],
        [cx + kx, yb + ry],
        [cx + R, yb + ky],
        [cx + R, yb],
      ],
    },
    {
      what: "cylinder's left side",
      el: "line",
      cls: "qf-line",
      pts: [
        [cx - R, yt],
        [cx - R, yb],
      ],
    },
    {
      what: "cylinder's right side",
      el: "line",
      cls: "qf-line",
      pts: [
        [cx + R, yt],
        [cx + R, yb],
      ],
    },
    ...dimension(
      b,
      "height",
      [
        [cx + R, yt],
        [cx + R, yb],
      ],
      [1, 0],
      { at: [cx + R + 26, (yt + yb) / 2 + 5.5], anchor: "start" },
    ),
  );
  if (radius)
    parts.push(
      { what: "cylinder's centre", el: "circle", cls: "qf-ink", pts: [[cx, yt]], r: 2.5 },
      {
        what: "radius arrow",
        el: "line",
        cls: "qf-line",
        pts: [
          [cx, yt],
          [cx + R, yt],
        ],
        heads: "end",
      },
      {
        what: "radius label",
        el: "text",
        cls: styleOf(b, "radius"),
        pts: [[cx + R / 2, yt - ry - 8]],
        anchor: "middle",
        lines: [written(b, "radius")],
      },
    );
  else
    // Under the bottom's curve, its guide lines running down from the sides.
    parts.push(
      ...dimension(
        b,
        "diameter",
        [
          [cx - R, yb],
          [cx + R, yb],
        ],
        [0, 1],
        { at: [cx, yb + ry + 35], anchor: "middle" },
        ry + 14,
      ),
    );
  // The radius label is centred over the radius, the diameter's under the cylinder.
  const [labelX, labelW] = radius
    ? [cx + R / 2, widthOf(b, "radius") / 2]
    : [cx, widthOf(b, "diameter") / 2];
  return {
    parts,
    box: {
      x0: Math.min(cx - R, labelX - labelW),
      x1: Math.max(cx + R + rightRoom, labelX + labelW),
      y0: yt - ry - above,
      y1: yb + ry + below,
    },
    // How wide the cylinder is drawn, whichever size names it.
    drawn: { height: Hc, [radius ? "radius" : "diameter"]: 2 * R },
  };
}

const LETTER = /^[A-Za-z]$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const placesOk = (v: number, dp: number) =>
  Math.abs(v * 10 ** dp - Math.round(v * 10 ** dp)) < 1e-6;

export const shapeSizes: FigureKind<ShapeBrief> = {
  kind: "shape-sizes",
  name: "a shape with its sizes",
  guide:
    'shape: "rectangle" (a flat face, an area, a base pressing on the floor), "cuboid" (a block) or "cylinder"; unit: "mm", "cm" or "m"; decimals: 0, 1 or 2, the decimal places every size is written with (1 writes 2 as "2.0 cm"); sizes: the shape\'s sizes in that unit, each above 0 with no more decimal places than decimals: a rectangle {width, height}, a cuboid {width, height, depth}, a cylinder {height, and diameter or radius}; letters: {} or a letter for each size the question asks for, written in its place ({"height": "h"}). The website draws the shape in proportion, as big as fits, with each size on a dimension line beside its own edge: so keep the largest size at most 3 times the smallest (a cylinder\'s width, twice its radius, counts as a size) and a cuboid\'s depth at least half its height.',
  read(b) {
    if (!SHAPES.includes(b.shape as Shape))
      return { problem: 'needs shape "rectangle", "cuboid" or "cylinder"' };
    if (!UNITS.includes(b.unit as (typeof UNITS)[number]))
      return { problem: 'needs unit "mm", "cm" or "m"' };
    if (b.decimals !== 0 && b.decimals !== 1 && b.decimals !== 2)
      return { problem: "needs decimals 0, 1 or 2" };
    const sizes = (b.sizes ?? null) as Record<string, unknown> | null;
    const letters = (b.letters ?? {}) as Record<string, unknown> | null;
    if (!sizes || typeof sizes !== "object") return { problem: "needs sizes" };
    if (!letters || typeof letters !== "object") return { problem: "needs letters, {} for none" };
    const shape = b.shape as Shape;
    const want = edgesOf(shape, sizes);
    const keys = Object.keys(sizes);
    if (keys.length !== want.length || want.some((e) => !keys.includes(e)))
      return {
        problem:
          shape === "cylinder"
            ? "needs a cylinder's sizes as {height, and diameter or radius}"
            : `needs a ${shape}'s sizes as {${want.join(", ")}}`,
      };
    const read: ShapeBrief = {
      kind: "shape-sizes",
      shape,
      unit: b.unit as ShapeBrief["unit"],
      decimals: b.decimals,
      sizes: {},
      letters: {},
    };
    for (const e of want) {
      const v = sizes[e];
      if (!isNum(v) || v <= 0 || v > 10000) return { problem: `needs a ${e} above 0` };
      if (!placesOk(v, b.decimals))
        return { problem: `has a ${e} with more decimal places than decimals` };
      read.sizes[e] = v;
    }
    for (const [e, l] of Object.entries(letters)) {
      if (!want.includes(e as Edge))
        return { problem: `has a letter for ${e}, which the ${shape} has no size for` };
      if (typeof l !== "string" || !LETTER.test(l.trim()))
        return { problem: "needs one letter for each size written as a letter" };
      read.letters[e as Edge] = l.trim();
    }
    const { box, drawn } = layout(read);
    for (const e of want) {
      if (drawn[e]! < (e === "depth" ? 24 : SHORTEST))
        return { problem: "has sizes too different to draw in proportion" };
    }
    if (box.x0 < 4 || box.x1 > 356 || box.y0 < 4 || box.y1 > H - 4)
      return { problem: "has labels too long to fit beside the shape" };
    return { brief: read };
  },
  draw(b) {
    const edges = edgesOf(b.shape, b.sizes);
    const sizes = and(edges.map((e) => `its ${e} ${written(b, e)}`));
    const what = {
      rectangle: "A rectangle",
      cuboid: "A cuboid drawn in 3D",
      cylinder: "A cylinder standing on one end, drawn in 3D",
    }[b.shape];
    return {
      svg: drawParts(H, layout(b).parts),
      alt: `${what}, in proportion to its sizes, with each size marked beside its edge: ${sizes}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    if (d.H !== H) out.push(`The canvas is ${d.H} high; the shape is ${H}`);
    out.push(...partProblems(layout(b).parts, d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The diagram shows a block of aluminium. The mass of the block is 81 g. Calculate the density of aluminium in g/cm³.",
      brief: {
        kind: "shape-sizes",
        shape: "cuboid",
        unit: "cm",
        decimals: 1,
        sizes: { width: 5, height: 2, depth: 3 },
        letters: {},
      },
    },
    {
      subject: "physics",
      question:
        "A box rests on the floor. The diagram shows the base of the box, which is in contact with the floor. The weight of the box is 600 N. What pressure does the box exert on the floor?",
      options: ["120 Pa", "300 Pa", "1500 Pa", "3000 Pa"],
      brief: {
        kind: "shape-sizes",
        shape: "rectangle",
        unit: "m",
        decimals: 2,
        sizes: { width: 0.5, height: 0.4 },
        letters: {},
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows a solid copper cylinder. The density of copper is 8.96 g/cm³. Calculate the mass of the cylinder. Give your answer to 3 significant figures.",
      brief: {
        kind: "shape-sizes",
        shape: "cylinder",
        unit: "cm",
        decimals: 1,
        sizes: { radius: 2, height: 5 },
        letters: {},
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const shape = pick(SHAPES);
    const decimals = pick([0, 1, 1, 2]);
    // Sizes mostly within 3 times each other; now and then 8 times, which read refuses.
    const base = pick([0.1, 1, 1, 10]);
    const size = () => Number((pick([2, 3, 4, 5, 6, 2.5, 16]) * base).toFixed(2));
    const sizes: Record<string, number> =
      shape === "rectangle"
        ? { width: size(), height: size() }
        : shape === "cuboid"
          ? { width: size(), height: size(), depth: size() }
          : { height: size(), [r() < 0.5 ? "radius" : "diameter"]: size() };
    const asked = r() < 0.3 ? pick(Object.keys(sizes)) : null;
    return {
      kind: "shape-sizes",
      shape,
      unit: pick(UNITS),
      decimals,
      sizes,
      letters: asked ? { [asked]: pick(["x", "h", "d"]) } : {},
    };
  },
};
