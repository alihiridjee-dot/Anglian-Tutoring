/**
 * A ray diagram, in one of the four setups an exam paper draws: a ray
 * reflected by a plane mirror; a ray passing through a rectangular glass
 * block; and an object in front of a converging or a diverging lens, with the
 * construction rays that find its image. Every ray follows from the brief by
 * the law of reflection, the brief's own angle of refraction, or 1/f = 1/u +
 * 1/v, so the writer never places anything. The checker holds the drawing to
 * the layout, then measures what an answer hangs on as drawn: each ray's
 * angle to its normal and which way its arrow points, which angle each label
 * sits in, and where the image is.
 */
import { ARROW_DEFS } from "../figure";
import type { Arrow, CheckTools, Drawing } from "../figureCheck";
import { label, num, svgOf } from "../figureSvg";
import type { FigureKind } from "./kind";
import {
  centred,
  dashes,
  heldToLayout,
  markSvg,
  wordSvg,
  type Mark,
  type Pt,
  type Word,
} from "./marks";

const MIRROR_ANGLES = ["incidence", "reflection", "incident-mirror", "reflected-mirror"] as const;
const BLOCK_ANGLES = ["incidence", "refraction", "emergence"] as const;
type AngleAt = (typeof MIRROR_ANGLES)[number] | (typeof BLOCK_ANGLES)[number];
/** An angle the figure marks with an arc: a letter, or its size in degrees ("40°"). */
type Angle = { at: AngleAt; label: string };

type MirrorBrief = {
  kind: "ray-diagram";
  setup: "plane-mirror";
  /** The angle of incidence, from the normal, in degrees. */
  incidence: number;
  angles: Angle[];
  /** Writes "mirror" and "normal". */
  names: boolean;
};
type BlockBrief = {
  kind: "ray-diagram";
  setup: "glass-block";
  incidence: number;
  /** The angle of refraction inside the block, in degrees. */
  refraction: number;
  /** The glass's refractive index, when the question gives it. */
  index: number | null;
  angles: Angle[];
  /** Writes "glass" and "normal". */
  names: boolean;
};
type LensBrief = {
  kind: "ray-diagram";
  setup: "converging-lens" | "diverging-lens";
  /** In one unit, any: cm. */
  focalLength: number;
  objectDistance: number;
  objectHeight: number;
  /** Marks 2F on each side as well as F. */
  twoF: boolean;
  /** Writes "object" and "image". */
  names: boolean;
};
export type RayBrief = MirrorBrief | BlockBrief | LensBrief;

const SETUPS = ["plane-mirror", "glass-block", "converging-lens", "diverging-lens"] as const;

// ── Geometry ────────────────────────────────────────────────────────────────

const rad = (deg: number) => (deg * Math.PI) / 180;
const degrees = (r: number) => (r * 180) / Math.PI;
const plus = (p: Pt, v: Pt, k = 1): Pt => [p[0] + v[0] * k, p[1] + v[1] * k];
const minus = (p: Pt, q: Pt): Pt => [p[0] - q[0], p[1] - q[1]];
const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
const cross = (u: Pt, v: Pt) => u[0] * v[1] - u[1] * v[0];
const dot = (u: Pt, v: Pt) => u[0] * v[0] + u[1] * v[1];
const length = (v: Pt) => Math.hypot(v[0], v[1]);
const unit = (v: Pt): Pt => [v[0] / length(v), v[1] / length(v)];
/** The angle between two directions, in degrees. */
const between = (u: Pt, v: Pt) =>
  degrees(Math.acos(Math.max(-1, Math.min(1, dot(unit(u), unit(v))))));
/** How far a point is from the infinite line through a and b. */
const offLine = (p: Pt, a: Pt, b: Pt) =>
  Math.abs(cross(minus(b, a), minus(p, a))) / length(minus(b, a));
/** Where the lines through a, b and through c, e cross. */
function meet(a: Pt, b: Pt, c: Pt, e: Pt): Pt {
  const r = minus(b, a);
  const s = minus(e, c);
  const k = cross(minus(c, a), s) / cross(r, s);
  return plus(a, r, k);
}

/** A ray from a to b: up to its arrowhead half way, then on to b. */
const ray = (name: string, a: Pt, b: Pt, at = 0.5): Mark[] => {
  const m = plus(a, minus(b, a), at);
  return [
    {
      name: `${name} (up to its arrowhead)`,
      tag: "line",
      cls: "qf-line",
      pts: [a, m],
      head: "end",
    },
    { name: `${name} (after its arrowhead)`, tag: "line", cls: "qf-line", pts: [m, b] },
  ];
};

// ── Angles ──────────────────────────────────────────────────────────────────

/**
 * Radius of an angle's arc: 28 for an angle to a normal, 20 for an angle to
 * the mirror, so two arcs side by side never run on as one.
 */
const ARC = { normal: 28, mirror: 20 } as const;
/**
 * A line from the vertex: its direction, how long it is drawn, and how far a
 * label keeps from it (6 from a ray, clear of its arrowhead).
 */
type Side = { dir: Pt; length: number; gap: number };
/** Any other line a label stays on the vertex's side of, and clear of: a face of the block. */
type Clear = { through: Pt; dir: Pt; gap: number };
type AngleSpec = {
  at: AngleAt;
  vertex: Pt;
  sides: [Side, Side];
  clear: Clear[];
  size: number;
  arc: number;
};
/** The bisector of an angle, as a unit direction from its vertex. */
const bisector = (s: AngleSpec) => unit(plus(unit(s.sides[0].dir), unit(s.sides[1].dir)));
/** How far out the angle's label may reach: inside its shorter side. */
const room = (s: AngleSpec) => Math.min(s.sides[0].length, s.sides[1].length) - 4;
/** How far a point is past a line, on the side the angle opens to: negative across it. */
const pastLine = (s: AngleSpec, l: Clear, p: Pt) => {
  const n: Pt = [-l.dir[1], l.dir[0]];
  const inward = Math.sign(dot(minus(plus(s.vertex, bisector(s)), l.through), n));
  return inward * dot(minus(p, l.through), n);
};

const LETTER = /^[A-Za-zα-ωΑ-Ω][A-Za-z′'₁₂₃]?$/u;
const DEGREES = /^(\d{1,2}(?:\.\d)?)°$/;
const isLetter = (l: string) => LETTER.test(l);
const degreesOf = (l: string) => {
  const m = DEGREES.exec(l);
  return m ? Number(m[1]) : null;
};
/** A letter is bold, as an exam paper marks what it asks about; a size is plain. */
const angleCls = (l: string) => (isLetter(l) ? "qf-strong" : "qf-text");

/** The arc between two directions from a vertex, a point at least every 6°. */
function arcPoints(P: Pt, a: Pt, b: Pt, radius: number): Pt[] {
  const fa = Math.atan2(a[1], a[0]);
  let turn = Math.atan2(b[1], b[0]) - fa;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  const n = Math.max(2, Math.ceil(Math.abs(turn) / rad(6)));
  return Array.from({ length: n + 1 }, (_, k) => {
    const f = fa + (turn * k) / n;
    return [P[0] + radius * Math.cos(f), P[1] + radius * Math.sin(f)] as Pt;
  });
}

/**
 * Where an angle's label goes: on the line halving the angle, at the nearest
 * distance from the vertex where its box keeps its gap from both sides, stays
 * on the vertex's side of every other line given, and stands outside the
 * arc. Inside the angle and clear of both its sides, a label can't reach a
 * neighbouring angle's. Null when that is beyond the shorter side's end.
 */
function angleSpot(s: AngleSpec, word: string): { x: number; y: number } | null {
  const cls = angleCls(word);
  const { halfW, halfH, drop } = centred(word, cls);
  const along = bisector(s);
  const lines: Clear[] = [
    ...s.sides.map((side) => ({ through: s.vertex, dir: unit(side.dir), gap: side.gap })),
    ...s.clear.map((l) => ({ ...l, dir: unit(l.dir) })),
  ];
  for (let d = s.arc + 4; d + Math.hypot(halfW, halfH) <= room(s); d += 0.5) {
    const c = plus(s.vertex, along, d);
    const clear = lines.every((l) => {
      const n: Pt = [-l.dir[1], l.dir[0]];
      const reach = halfW * Math.abs(n[0]) + halfH * Math.abs(n[1]);
      return pastLine(s, l, c) - reach >= l.gap;
    });
    const fromVertex = Math.hypot(
      Math.max(Math.abs(c[0] - s.vertex[0]) - halfW, 0),
      Math.max(Math.abs(c[1] - s.vertex[1]) - halfH, 0),
    );
    if (clear && fromVertex >= s.arc + 4) return { x: c[0], y: c[1] + drop };
  }
  return null;
}

/** What the alt text calls each angle: what it is drawn between, never its name. */
const ANGLE_WORDS: Record<AngleAt, string> = {
  incidence: "the incoming ray and the normal",
  reflection: "the reflected ray and the normal",
  "incident-mirror": "the incoming ray and the mirror",
  "reflected-mirror": "the reflected ray and the mirror",
  refraction: "the ray inside the block and the normal",
  emergence: "the ray leaving the block and the normal",
};
/** What a problem calls each angle. */
const ANGLE_NAMES: Record<AngleAt, string> = {
  incidence: "angle of incidence",
  reflection: "angle of reflection",
  "incident-mirror": "angle between the incident ray and the mirror",
  "reflected-mirror": "angle between the reflected ray and the mirror",
  refraction: "angle of refraction",
  emergence: "angle the ray leaves the block at",
};

/** Each brief angle's arc and label, or the first that has no room. */
function angleMarks(specs: AngleSpec[], angles: Angle[]) {
  const marks: Mark[] = [];
  const words: Word[] = [];
  for (const a of angles) {
    const s = specs.find((x) => x.at === a.at)!;
    const spot = angleSpot(s, a.label);
    if (!spot) return { problem: a.label };
    marks.push({
      name: `arc of the ${ANGLE_NAMES[a.at]}`,
      tag: "polyline",
      cls: "qf-line",
      pts: arcPoints(s.vertex, s.sides[0].dir, s.sides[1].dir, s.arc),
    });
    words.push({
      text: a.label,
      cls: angleCls(a.label),
      x: spot.x,
      y: spot.y,
      anchor: "middle",
      name: `label "${a.label}" of the ${ANGLE_NAMES[a.at]}`,
    });
  }
  return { marks, words };
}

// ── Plane mirror ────────────────────────────────────────────────────────────

/**
 * A plane mirror across the bottom, shaded behind, the ray striking it in
 * the middle where the dashed normal rises, coming in from the left and
 * leaving to the right, each ray 160 long.
 */
const MIRROR = { height: 260, y: 216, at: 180, from: 40, to: 320, normal: 176, ray: 160 } as const;

function mirrorLayout(b: MirrorBrief) {
  const P: Pt = [MIRROR.at, MIRROR.y];
  const [s, c] = [Math.sin(rad(b.incidence)), Math.cos(rad(b.incidence))];
  const start: Pt = [P[0] - MIRROR.ray * s, P[1] - MIRROR.ray * c];
  const end: Pt = [P[0] + MIRROR.ray * s, P[1] - MIRROR.ray * c];
  const top: Pt = [P[0], P[1] - MIRROR.normal];
  const marks: Mark[] = [
    {
      name: "mirror",
      tag: "line",
      cls: "qf-line",
      pts: [
        [MIRROR.from, MIRROR.y],
        [MIRROR.to, MIRROR.y],
      ],
    },
  ];
  for (let x = MIRROR.from + 10; x <= MIRROR.to; x += 16)
    marks.push({
      name: `mirror's shading at x = ${x}`,
      tag: "line",
      cls: "qf-line",
      pts: [
        [x, MIRROR.y],
        [x - 10, MIRROR.y + 10],
      ],
    });
  marks.push({ name: "normal", tag: "path", cls: "qf-line", pts: dashes(P, top) });
  marks.push(...ray("incident ray", start, P), ...ray("reflected ray", P, end));
  const side = {
    normal: { dir: [0, -1] as Pt, length: MIRROR.normal, gap: 4 },
    incident: { dir: minus(start, P), length: MIRROR.ray, gap: 6 },
    reflected: { dir: minus(end, P), length: MIRROR.ray, gap: 6 },
    left: { dir: [-1, 0] as Pt, length: P[0] - MIRROR.from, gap: 4 },
    right: { dir: [1, 0] as Pt, length: MIRROR.to - P[0], gap: 4 },
  };
  const at = (a: AngleAt, x: Side, y: Side, size: number): AngleSpec => ({
    at: a,
    vertex: P,
    sides: [x, y],
    clear: [],
    size,
    arc: a.endsWith("mirror") ? ARC.mirror : ARC.normal,
  });
  const specs = [
    at("incidence", side.normal, side.incident, b.incidence),
    at("reflection", side.normal, side.reflected, b.incidence),
    at("incident-mirror", side.left, side.incident, 90 - b.incidence),
    at("reflected-mirror", side.right, side.reflected, 90 - b.incidence),
  ];
  const words: Word[] = b.names
    ? [
        { text: "normal", cls: "qf-text", x: P[0], y: top[1] - 8, anchor: "middle" },
        { text: "mirror", cls: "qf-text", x: MIRROR.to, y: MIRROR.y + 34, anchor: "end" },
      ]
    : [];
  return { H: MIRROR.height, marks, words, specs, P, start, end };
}

// ── Glass block ─────────────────────────────────────────────────────────────

/**
 * A rectangular block across the middle, 140 thick so a narrow angle of
 * refraction has room for its label. The ray comes in from the upper left
 * onto its top face, crosses it and leaves through its bottom face, each ray
 * outside the block 96 long, the whole path centred across the canvas: with
 * sin i ÷ sin r at least 1.3 it fits for any angle of incidence up to 70°.
 * A dashed normal crosses each face where the ray does, 90 outside the block
 * and right across it, as an exam paper draws it.
 */
const BLOCK = {
  height: 360,
  left: 24,
  right: 336,
  top: 112,
  bottom: 252,
  ray: 96,
  out: 90,
  in: 140,
} as const;
/** The least and most sin i ÷ sin r a block may have. */
const INDEX = { least: 1.3, most: 2.5 } as const;

function blockLayout(b: BlockBrief) {
  const [si, ci] = [Math.sin(rad(b.incidence)), Math.cos(rad(b.incidence))];
  const [sr, cr] = [Math.sin(rad(b.refraction)), Math.cos(rad(b.refraction))];
  const across = ((BLOCK.bottom - BLOCK.top) * sr) / cr;
  // Centred: the ray crosses the block's middle at x = 180.
  const P1: Pt = [180 - across / 2, BLOCK.top];
  const P2: Pt = [180 + across / 2, BLOCK.bottom];
  const start: Pt = [P1[0] - BLOCK.ray * si, P1[1] - BLOCK.ray * ci];
  const end: Pt = [P2[0] + BLOCK.ray * si, P2[1] + BLOCK.ray * ci];
  const { left, right, top, bottom } = BLOCK;
  const marks: Mark[] = [
    {
      name: "glass block",
      tag: "polygon",
      cls: "qf-box",
      pts: [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ],
    },
    {
      name: "normal at the top face",
      tag: "path",
      cls: "qf-line",
      pts: dashes([P1[0], top - BLOCK.out], [P1[0], top + BLOCK.in]),
    },
    {
      name: "normal at the bottom face",
      tag: "path",
      cls: "qf-line",
      pts: dashes([P2[0], bottom - BLOCK.in], [P2[0], bottom + BLOCK.out]),
    },
    ...ray("ray going in", start, P1),
    ...ray("ray inside the block", P1, P2),
    ...ray("ray coming out", P2, end),
  ];
  const face = (y: number): Clear => ({ through: [0, y], dir: [1, 0], gap: 4 });
  const specs: AngleSpec[] = [
    {
      at: "incidence",
      vertex: P1,
      sides: [
        { dir: [0, -1], length: BLOCK.out, gap: 4 },
        { dir: minus(start, P1), length: BLOCK.ray, gap: 6 },
      ],
      clear: [face(top)],
      size: b.incidence,
      arc: ARC.normal,
    },
    {
      at: "refraction",
      vertex: P1,
      sides: [
        { dir: [0, 1], length: BLOCK.in, gap: 4 },
        { dir: minus(P2, P1), length: length(minus(P2, P1)), gap: 6 },
      ],
      clear: [face(top), face(bottom)],
      size: b.refraction,
      arc: ARC.normal,
    },
    {
      at: "emergence",
      vertex: P2,
      sides: [
        { dir: [0, 1], length: BLOCK.out, gap: 4 },
        { dir: minus(end, P2), length: BLOCK.ray, gap: 6 },
      ],
      clear: [face(bottom)],
      size: b.incidence,
      arc: ARC.normal,
    },
  ];
  const words: Word[] = b.names
    ? [
        { text: "glass", cls: "qf-text", x: left + 10, y: bottom - 12, anchor: "start" },
        {
          text: "normal",
          cls: "qf-text",
          x: P1[0] + 8,
          y: top - BLOCK.out + 12,
          anchor: "start",
        },
      ]
    : [];
  return { H: BLOCK.height, marks, words, specs, P1, P2, start, end };
}

// ── Lenses ──────────────────────────────────────────────────────────────────

/**
 * A lens on its principal axis, F marked on each side (and 2F), the object
 * an arrow standing on the axis to the left. Distances along the axis are to
 * one scale, set so the drawing fills the canvas between x = 30 and 330;
 * heights are in proportion to each other, the taller arrow 90 high, so a
 * small object far away still shows. A uniform stretch keeps every ray
 * straight and every meeting point where it was, so the construction stays
 * true. The image is where the rays meet, or where they appear to come from.
 */
const LENS = { left: 30, right: 330, tallest: 90 } as const;

/** The image distance from 1/f = 1/u + 1/v (a diverging lens's f is negative); negative for a virtual image. */
function imageDistance(b: LensBrief) {
  const f = b.setup === "converging-lens" ? b.focalLength : -b.focalLength;
  return 1 / (1 / f - 1 / b.objectDistance);
}

function lensLayout(b: LensBrief) {
  const converging = b.setup === "converging-lens";
  const f = b.focalLength;
  const u = b.objectDistance;
  const v = imageDistance(b);
  const real = v > 0;
  /** How much taller the image is than the object. */
  const m = Math.abs(v) / u;
  // Along the axis, in the brief's unit, the lens at 0.
  const from = -Math.max(u, f, real ? 0 : -v, b.twoF ? 2 * f : 0);
  const to = Math.max(1.4 * f, real ? v : 0, b.twoF ? 2 * f : 0);
  const s = (LENS.right - LENS.left) / (to - from);
  const X = LENS.left - from * s;
  const hO = LENS.tallest / Math.max(1, m);
  const hI = LENS.tallest / Math.max(1, 1 / m);
  /** The lens's half height: past every ray that meets it. */
  const LH = Math.max(hO, real ? hI : 0) + 14;
  // Rays that go on past the lens (to a virtual image) stop this far from the axis.
  const reach = LH + 30;
  const nameAbove = real || !converging;
  const up = Math.max(
    real ? LH : reach,
    hO + (b.names && nameAbove ? 24 : 0),
    real ? 0 : hI + (b.names && converging ? 24 : 0),
    20,
  );
  const down = Math.max(
    real ? LH : reach,
    real ? hI + (b.names ? 28 : 0) : 0,
    b.names && !real ? 46 : 20,
  );
  const H = Math.min(480, Math.max(200, Math.ceil((up + down + 20) / 20) * 20));
  const AY = (H - up - down) / 2 + up;

  const x = (p: number) => X + p * s;
  const C: Pt = [X, AY];
  const F: Pt = [x(-f), AY];
  const F2: Pt = [x(f), AY];
  const O: Pt = [x(-u), AY];
  const T: Pt = [O[0], AY - hO];
  const I: Pt = [x(v), AY];
  const B: Pt = [I[0], real ? AY + hI : AY - hI];
  const L1: Pt = [X, T[1]];
  /** On along a direction from p until it is `reach` from the axis or at the right edge. */
  const onward = (p: Pt, dir: Pt): Pt => {
    const ks = [(LENS.right - p[0]) / dir[0]];
    if (dir[1] > 0) ks.push((AY + reach - p[1]) / dir[1]);
    if (dir[1] < 0) ks.push((AY - reach - p[1]) / dir[1]);
    return plus(p, dir, Math.min(...ks));
  };

  const marks: Mark[] = [
    {
      name: "principal axis",
      tag: "line",
      cls: "qf-line",
      pts: [
        [12, AY],
        [348, AY],
      ],
    },
    {
      name: "lens",
      tag: "polygon",
      cls: "qf-box",
      pts: converging ? convexLens(X, AY, LH) : concaveLens(X, AY, LH),
    },
  ];
  const words: Word[] = [];
  const marksAt = b.twoF ? [1, 2] : [1];
  for (const k of marksAt)
    for (const side of [-1, 1]) {
      const fx = x(side * k * f);
      const name = k === 1 ? "F" : "2F";
      marks.push({
        name: `mark for ${name} on the ${side < 0 ? "left" : "right"}`,
        tag: "line",
        cls: "qf-line",
        pts: [
          [fx, AY - 6],
          [fx, AY + 6],
        ],
      });
      // Below the axis on the left, above it on the right: the corners no ray crosses.
      words.push(
        side < 0
          ? { text: name, cls: "qf-text", x: fx - 4, y: AY + 19, anchor: "end" }
          : { text: name, cls: "qf-text", x: fx + 4, y: AY - 7, anchor: "start" },
      );
    }
  marks.push({ name: "object", tag: "line", cls: "qf-line", pts: [O, T], head: "end" });

  /** Each ray's straight pieces, for the checks: the ray's name and its points in order. */
  const rays: { name: string; pts: Pt[] }[] = [];
  const backs: [Pt, Pt][] = [];
  if (real) {
    rays.push(
      { name: "ray parallel to the axis", pts: [T, L1, B] },
      { name: "ray through the centre of the lens", pts: [T, C, B] },
      { name: "ray through F", pts: [T, [X, B[1]], B] },
    );
    marks.push({ name: "image", tag: "line", cls: "qf-line", pts: [I, B], head: "end" });
  } else {
    const away = converging ? minus(F2, L1) : minus(L1, F);
    rays.push(
      { name: "ray parallel to the axis", pts: [T, L1, onward(L1, away)] },
      { name: "ray through the centre of the lens", pts: [T, C, onward(C, minus(C, T))] },
    );
    backs.push(converging ? [L1, B] : [L1, F]);
    if (converging) backs.push([T, B]);
    marks.push({ name: "image", tag: "path", cls: "qf-line", pts: dashes(I, B), head: "end" });
  }
  for (const r of rays) {
    // The ray through F has its arrowhead half way from F to the lens, clear of the object's tip.
    // The ray through F has its arrowhead half way from F to the lens, clear of
    // the object's tip; through a diverging lens, the ray through the centre
    // has its arrowhead half way from the image's tip to the lens, clear of it.
    const share =
      r.name === "ray through F"
        ? ((F[0] + X) / 2 - T[0]) / (X - T[0])
        : r.name === "ray through the centre of the lens" && !converging
          ? ((B[0] + X) / 2 - T[0]) / (X - T[0])
          : 0.5;
    marks.push(...ray(r.name, r.pts[0], r.pts[1], share));
    marks.push({
      name: `${r.name} after the lens`,
      tag: "line",
      cls: "qf-line",
      pts: [r.pts[1], r.pts[2]],
    });
  }
  backs.forEach(([p, q], i) =>
    marks.push({
      name: `dashed line ${i + 1} traced back from the lens`,
      tag: "path",
      cls: "qf-line",
      pts: dashes(p, q),
    }),
  );
  if (b.names) {
    const object = centred("object", "qf-text").halfW;
    const image = centred("image", "qf-text").halfW;
    // Clear of the lens when the object stands close to it.
    const ox = Math.min(O[0], X - 16 - object);
    words.push(
      nameAbove
        ? { text: "object", cls: "qf-text", x: ox, y: T[1] - 10, anchor: "middle" }
        : { text: "object", cls: "qf-text", x: ox, y: AY + 40, anchor: "middle" },
      real
        ? { text: "image", cls: "qf-text", x: I[0], y: B[1] + 22, anchor: "middle" }
        : converging
          ? { text: "image", cls: "qf-text", x: I[0], y: B[1] - 10, anchor: "middle" }
          : {
              text: "image",
              cls: "qf-text",
              x: Math.min(I[0], X - 16 - image),
              y: AY + 40,
              anchor: "middle",
            },
    );
  }
  return { H, marks, words, X, AY, s, C, F, F2, O, T, I, B, L1, rays, backs, real, v };
}

/** A converging lens's outline: two arcs meeting at its top and bottom, 8 either side of its middle. */
const convexLens = (X: number, AY: number, LH: number): Pt[] => {
  const ys = Array.from({ length: 13 }, (_, k) => -LH + (2 * LH * k) / 12);
  const side = (dir: number) => ys.map((y) => [X + dir * 8 * (1 - (y / LH) ** 2), AY + y] as Pt);
  return [...side(1), ...side(-1).reverse().slice(1, -1)];
};
/** A diverging lens's outline: 20 wide at its ends, 6 at its middle. */
const concaveLens = (X: number, AY: number, LH: number): Pt[] => {
  const ys = Array.from({ length: 13 }, (_, k) => -LH + (2 * LH * k) / 12);
  const side = (dir: number) => ys.map((y) => [X + dir * (3 + 7 * (y / LH) ** 2), AY + y] as Pt);
  return [...side(1), ...side(-1).reverse()];
};

// ── The kind ────────────────────────────────────────────────────────────────

/** The angles a mirror or block may mark, where each is and how big. */
const specsOf = (b: MirrorBrief | BlockBrief) =>
  b.setup === "plane-mirror" ? mirrorLayout(b).specs : blockLayout(b).specs;

function layout(b: RayBrief) {
  return b.setup === "plane-mirror"
    ? mirrorLayout(b)
    : b.setup === "glass-block"
      ? blockLayout(b)
      : lensLayout(b);
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** At most `places` decimal places. */
const placed = (v: number, places: number) =>
  Math.abs(v * 10 ** places - Math.round(v * 10 ** places)) < 1e-6;

/** The brief's angles checked against the angles its setup has: each once, each a letter or its true size. */
function readAngles(raw: unknown, specs: AngleSpec[]): { angles: Angle[] } | { problem: string } {
  const allowed = specs.map((s) => s.at);
  if (!Array.isArray(raw) || raw.length > allowed.length)
    return { problem: `needs angles: a list of at most ${allowed.length}` };
  const angles: Angle[] = [];
  for (const a of raw as { at: unknown; label: unknown }[]) {
    if (!allowed.includes(a?.at as AngleAt))
      return { problem: `has an angle that is not one of ${allowed.join(", ")}` };
    const l = typeof a.label === "string" ? a.label.trim() : "";
    const value = degreesOf(l);
    if (!isLetter(l) && value === null)
      return { problem: 'has an angle label that is not a letter or a size such as "40°"' };
    const at = a.at as AngleAt;
    const size = specs.find((s) => s.at === at)!.size;
    if (value !== null && Math.abs(value - size) > 0.05)
      return { problem: `labels the ${ANGLE_NAMES[at]} ${l}, but it is ${label(size)}°` };
    angles.push({ at, label: l });
  }
  if (new Set(angles.map((a) => a.at)).size !== angles.length)
    return { problem: "marks the same angle twice" };
  const letters = angles.filter((a) => isLetter(a.label)).map((a) => a.label);
  if (new Set(letters).size !== letters.length) return { problem: "uses a letter twice" };
  return { angles };
}

/** Where the object stands, as the alt text says it. */
const objectIs = (b: LensBrief) =>
  b.objectDistance > 2 * b.focalLength
    ? "beyond 2F"
    : b.objectDistance === 2 * b.focalLength
      ? "at 2F"
      : b.objectDistance > b.focalLength
        ? "between F and 2F"
        : "between F and the lens";

export const rayDiagram: FigureKind<RayBrief> = {
  kind: "ray-diagram",
  name: "a ray diagram",
  guide:
    'setup: "plane-mirror", "glass-block", "converging-lens" or "diverging-lens"; names: true to write "mirror" and "normal" (a block: "glass" and "normal"; a lens: "object" and "image"), false when the question asks what a part is. A mirror: incidence, the angle of incidence from the normal, 20 to 70 degrees; the website reflects it at the same angle. A block: the ray enters the top face and leaves the bottom face; incidence 20 to 70 degrees, refraction the angle inside the block, smaller than incidence, with sin(incidence) ÷ sin(refraction) from 1.3 to 2.5; index: the refractive index if the question gives one (it must equal that ratio to within 0.02), else null. For both, angles: those the question needs, each {at: "incidence", "reflection", "incident-mirror" or "reflected-mirror" (a mirror) or "incidence", "refraction" or "emergence" (a block), label: a letter such as "i" or "x", or the angle\'s true size such as "40°"}, each angle once, each letter once; a small angle needs a short label. A lens: focalLength, objectDistance and objectHeight in one unit (cm); for a converging lens objectDistance from 1.4 to 4 times focalLength (a real image) or 0.4 to 0.7 times it (a magnifying glass); for a diverging lens 0.5 to 3 times it; twoF: true to mark 2F as well as F. The website works out the image from 1/f = 1/u + 1/v and draws the construction rays; distances are to scale, heights in proportion.',
  read(b) {
    if (!SETUPS.includes(b.setup as (typeof SETUPS)[number]))
      return { problem: `setup must be one of ${SETUPS.join(", ")}` };
    if (typeof b.names !== "boolean") return { problem: "names must be true or false" };
    const names = b.names;
    if (b.setup === "plane-mirror" || b.setup === "glass-block") {
      const i = b.incidence;
      if (!isNum(i) || i < 20 || i > 70 || !placed(i, 1))
        return { problem: "incidence must be 20 to 70 degrees, to at most one decimal place" };
      let brief: MirrorBrief | BlockBrief;
      if (b.setup === "plane-mirror")
        brief = { kind: "ray-diagram", setup: "plane-mirror", incidence: i, angles: [], names };
      else {
        const r = b.refraction;
        if (!isNum(r) || r <= 0 || !placed(r, 1))
          return {
            problem: "refraction must be an angle in degrees, to at most one decimal place",
          };
        // Into glass a ray slows down and bends towards the normal.
        if (r >= i)
          return {
            problem:
              "has refraction no smaller than incidence: entering glass, a ray bends towards the normal",
          };
        const ratio = Math.sin(rad(i)) / Math.sin(rad(r));
        if (ratio < INDEX.least || ratio > INDEX.most)
          return {
            problem: `bends the ray as no glass does: sin i ÷ sin r is ${num(ratio)}, not from ${INDEX.least} to ${INDEX.most}`,
          };
        const n = b.index ?? null;
        if (n !== null && (!isNum(n) || Math.abs(ratio - n) > 0.02))
          return {
            problem: `has angles that don't fit its refractive index: sin i ÷ sin r is ${num(ratio)}`,
          };
        brief = {
          kind: "ray-diagram",
          setup: "glass-block",
          incidence: i,
          refraction: r,
          index: n,
          angles: [],
          names,
        };
      }
      const specs = specsOf(brief);
      const read = readAngles(b.angles, specs);
      if ("problem" in read) return read;
      brief.angles = read.angles;
      const placedAngles = angleMarks(specs, brief.angles);
      if ("problem" in placedAngles)
        return {
          problem: `has an angle too narrow for its label "${placedAngles.problem}": use a shorter label`,
        };
      return { brief };
    }
    const [f, u, h] = [b.focalLength, b.objectDistance, b.objectHeight];
    if (![f, u, h].every((v) => isNum(v) && v > 0 && placed(v, 2)))
      return { problem: "needs focalLength, objectDistance and objectHeight above 0" };
    if (typeof b.twoF !== "boolean") return { problem: "twoF must be true or false" };
    const a = (u as number) / (f as number);
    if (b.setup === "converging-lens" && !((a >= 1.4 && a <= 4) || (a >= 0.4 && a <= 0.7)))
      return {
        problem:
          "puts the object where its image won't fit: for a converging lens objectDistance must be 1.4 to 4 times focalLength, or 0.4 to 0.7 times it",
      };
    if (b.setup === "diverging-lens" && (a < 0.5 || a > 3))
      return { problem: "objectDistance must be 0.5 to 3 times focalLength for a diverging lens" };
    return {
      brief: {
        kind: "ray-diagram",
        setup: b.setup as LensBrief["setup"],
        focalLength: f as number,
        objectDistance: u as number,
        objectHeight: h as number,
        twoF: b.twoF,
        names,
      },
    };
  },
  draw(b) {
    const L = layout(b);
    const marks = [...L.marks];
    const words = [...L.words];
    if (b.setup === "plane-mirror" || b.setup === "glass-block") {
      const angles = angleMarks(specsOf(b), b.angles);
      if (!("problem" in angles)) {
        marks.push(...angles.marks);
        words.push(...angles.words);
      }
    }
    return {
      svg: svgOf(L.H, [ARROW_DEFS, ...marks.map(markSvg), ...words.map(wordSvg)]),
      alt: altOf(b),
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const marks = [...L.marks];
    const words = [...L.words];
    const out: string[] = [];
    if (d.H !== L.H) out.push(`The canvas is not ${L.H} high`);
    if (b.setup === "plane-mirror" || b.setup === "glass-block") {
      const specs = specsOf(b);
      const angles = angleMarks(specs, b.angles);
      if ("problem" in angles) return [`The angle labelled "${angles.problem}" has no room`];
      marks.push(...angles.marks);
      words.push(...angles.words);
      out.push(...heldToLayout(marks, words, d, t, "ray diagram"));
      out.push(...anglesInPlace(b.angles, specs, t));
      out.push(
        ...(b.setup === "plane-mirror"
          ? mirrorRays(b, L as ReturnType<typeof mirrorLayout>, d, t)
          : blockRays(b, L as ReturnType<typeof blockLayout>, d, t)),
      );
      return out;
    }
    out.push(...heldToLayout(marks, words, d, t, "ray diagram"));
    out.push(...lensRays(b, L as ReturnType<typeof lensLayout>, d, t));
    return out;
  },
  samples: [
    {
      subject: "physics",
      question:
        "The diagram shows a ray of light reflected by a plane mirror. What is the size of angle r?",
      options: ["40°", "50°", "90°", "130°"],
      brief: {
        kind: "ray-diagram",
        setup: "plane-mirror",
        incidence: 40,
        angles: [
          { at: "incident-mirror", label: "50°" },
          { at: "reflection", label: "r" },
        ],
        names: true,
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows a ray of light passing through a rectangular glass block. Use the angles on the diagram to calculate the refractive index of the glass. Give your answer to 2 significant figures.",
      brief: {
        kind: "ray-diagram",
        setup: "glass-block",
        incidence: 40,
        refraction: 25,
        index: null,
        angles: [
          { at: "incidence", label: "40°" },
          { at: "refraction", label: "25°" },
        ],
        names: true,
      },
    },
    {
      subject: "physics",
      question:
        "The ray diagram shows how a converging lens forms an image of an object. Which words describe the image?",
      options: [
        "diminished, inverted, real",
        "magnified, inverted, real",
        "magnified, upright, virtual",
        "diminished, upright, virtual",
      ],
      brief: {
        kind: "ray-diagram",
        setup: "converging-lens",
        focalLength: 10,
        objectDistance: 15,
        objectHeight: 2,
        twoF: true,
        names: true,
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const setup = pick(SETUPS);
    const names = r() < 0.5;
    if (setup === "plane-mirror" || setup === "glass-block") {
      const incidence = 15 + Math.floor(r() * 60);
      const refraction = Math.round(
        degrees(Math.asin(Math.sin(rad(incidence)) / (1.1 + r() * 1.5))),
      );
      const all = setup === "plane-mirror" ? MIRROR_ANGLES : BLOCK_ANGLES;
      const sizes: Record<string, number> = {
        incidence,
        reflection: incidence,
        "incident-mirror": 90 - incidence,
        "reflected-mirror": 90 - incidence,
        refraction,
        emergence: incidence,
      };
      const angles = all
        .filter(() => r() < 0.5)
        .map((at, k) => ({
          at,
          label: r() < 0.4 ? `${sizes[at]}°` : ["i", "r", "x", "θ"][(k + Math.floor(r() * 4)) % 4],
        }));
      return {
        kind: "ray-diagram",
        setup,
        incidence,
        refraction,
        index: r() < 0.3 ? 1.5 : null,
        angles,
        names,
      };
    }
    const focalLength = pick([5, 8, 10, 12, 15, 20]);
    const ratio =
      setup === "converging-lens"
        ? pick([0.3, 0.4, 0.5, 0.6, 0.7, 1, 1.4, 1.5, 2, 2.5, 3, 4, 5])
        : pick([0.4, 0.5, 1, 1.5, 2, 3, 4]);
    return {
      kind: "ray-diagram",
      setup,
      focalLength,
      objectDistance: Number((focalLength * ratio).toFixed(2)),
      objectHeight: pick([1, 2, 3, 5]),
      twoF: r() < 0.5,
      names,
    };
  },
};

/** The alt text: what is drawn, in plain sentences, never what it shows. */
function altOf(b: RayBrief): string {
  const marked = (angles: Angle[]) =>
    angles.length
      ? ` ${angles.map((a) => `The angle between ${ANGLE_WORDS[a.at]} is marked ${a.label}.`).join(" ")}`
      : "";
  if (b.setup === "plane-mirror")
    return `A ray of light reflected by a plane mirror, with the normal drawn dashed where the ray meets the mirror.${marked(b.angles)}`;
  if (b.setup === "glass-block")
    return `A ray of light going into a rectangular glass block through its top face and out through its bottom face, with the normal drawn dashed at each face.${marked(b.angles)}`;
  const lens = b.setup === "converging-lens" ? "converging" : "diverging";
  return `A ${lens} lens on its principal axis, with ${b.twoF ? "F and 2F" : "F"} marked on each side. An object arrow stands on the axis on the left, ${objectIs(b)}. Rays from the top of the object pass through the lens, and the image is drawn where the rays show it.`;
}

// ── Checks read off the drawing ─────────────────────────────────────────────

/** Each angle's label inside its own angle: between its two sides, nearer the vertex than any ray's end. */
function anglesInPlace(angles: Angle[], specs: AngleSpec[], t: CheckTools): string[] {
  const out: string[] = [];
  for (const a of angles) {
    const s = specs.find((x) => x.at === a.at)!;
    const [u, w] = s.sides.map((x) => unit(x.dir));
    const turn = cross(u, w);
    const inside = t.pieces().some((p) => {
      if (p.text !== a.label) return false;
      const c: Pt = [(p.box.x0 + p.box.x1) / 2, (p.box.y0 + p.box.y1) / 2];
      const q = minus(c, s.vertex);
      return (
        cross(u, q) * turn > 0 &&
        cross(q, w) * turn > 0 &&
        length(q) <= room(s) &&
        s.clear.every((l) => pastLine(s, l, c) > 0)
      );
    });
    if (!inside) out.push(`The label "${a.label}" is not inside the ${ANGLE_NAMES[a.at]}`);
  }
  return out;
}

/** The drawn arrows on the line through a point: those pointing at it, and those pointing away. */
function arrowsThrough(d: Drawing, P: Pt) {
  const on = d.arrows.filter((a) => a.end && !a.start && offLine(P, a.from, a.to) < 1);
  const toward = (a: Arrow) => length(minus(P, a.to)) < length(minus(P, a.from));
  return { in: on.filter(toward), out: on.filter((a) => !toward(a)) };
}
/** An arrow's angle to a vertical normal, in degrees, and which side of it the arrow's line lies (−1 left, 1 right). */
const toNormal = (a: Arrow) => between(minus(a.to, a.from), [0, a.to[1] > a.from[1] ? 1 : -1]);
const sideOf = (a: Arrow, P: Pt) => Math.sign(mid(a.from, a.to)[0] - P[0]);

/**
 * The law of reflection, measured: one ray arrowed into the point on the
 * mirror at the angle of incidence, and one arrowed out of it on the other
 * side of the normal at the same angle.
 */
function mirrorRays(
  b: MirrorBrief,
  L: ReturnType<typeof mirrorLayout>,
  d: Drawing,
  t: CheckTools,
): string[] {
  const out: string[] = [];
  const { in: going, out: leaving } = arrowsThrough(d, L.P);
  if (going.length !== 1)
    return [
      `There must be one ray arrowed towards the mirror at ${t.at(L.P)}; there are ${going.length}`,
    ];
  if (leaving.length !== 1)
    return [
      `There must be one ray arrowed away from the mirror at ${t.at(L.P)}; there are ${leaving.length}`,
    ];
  const i = toNormal(going[0]);
  const r = toNormal(leaving[0]);
  if (Math.abs(i - b.incidence) > 0.5)
    out.push(
      `The incident ray is at ${t.fmt(i)}° to the normal; the brief's angle of incidence is ${b.incidence}°`,
    );
  if (Math.abs(r - b.incidence) > 0.5)
    out.push(
      `The reflected ray leaves at ${t.fmt(r)}° to the normal; it must leave at ${b.incidence}°, the angle of incidence`,
    );
  if (sideOf(going[0], L.P) === sideOf(leaving[0], L.P))
    out.push("The reflected ray is on the same side of the normal as the incident ray");
  return out;
}

/**
 * Refraction, measured: the ray arrowed onto the top face at the angle of
 * incidence, the one inside arrowed on at the angle of refraction, bent
 * towards the normal, and the one leaving the bottom face arrowed away at
 * the angle of incidence again, parallel to the ray going in.
 */
function blockRays(
  b: BlockBrief,
  L: ReturnType<typeof blockLayout>,
  d: Drawing,
  t: CheckTools,
): string[] {
  const out: string[] = [];
  const at1 = arrowsThrough(d, L.P1);
  const at2 = arrowsThrough(d, L.P2);
  const going = at1.in.filter((a) => a.from[1] < BLOCK.top);
  const inside = at1.out.filter((a) => a.to[1] > BLOCK.top && a.to[1] < BLOCK.bottom);
  const leaving = at2.out.filter((a) => a.to[1] > BLOCK.bottom);
  if (going.length !== 1 || inside.length !== 1 || leaving.length !== 1)
    return [
      `The ray must be arrowed onto the top face at ${t.at(L.P1)}, on through the block and out of the bottom face at ${t.at(L.P2)}`,
    ];
  const i = toNormal(going[0]);
  const r = toNormal(inside[0]);
  const e = toNormal(leaving[0]);
  if (Math.abs(i - b.incidence) > 0.5)
    out.push(
      `The ray going in is at ${t.fmt(i)}° to the normal; the brief's angle of incidence is ${b.incidence}°`,
    );
  if (Math.abs(r - b.refraction) > 0.5)
    out.push(
      `The ray inside the block is at ${t.fmt(r)}° to the normal; the brief's angle of refraction is ${b.refraction}°`,
    );
  if (r >= i)
    out.push(
      "The ray inside the block bends away from the normal: entering glass, it bends towards it",
    );
  if (sideOf(inside[0], L.P1) !== sideOf(leaving[0], L.P2) || sideOf(inside[0], L.P1) <= 0)
    out.push("The ray must carry on across the block, to the right of each normal");
  if (
    Math.abs(e - i) > 0.5 ||
    between(minus(leaving[0].to, leaving[0].from), minus(going[0].to, going[0].from)) > 0.5
  )
    out.push(
      `The ray coming out is at ${t.fmt(e)}° to the normal: it must leave parallel to the ray going in`,
    );
  return out;
}

/**
 * The image, measured: the rays as drawn are the construction rays (the one
 * parallel to the axis bends through F, or away as if from F; the one
 * through the centre goes straight on; the one through F comes out
 * parallel), they meet where the image's tip is drawn, and that is where
 * 1/f = 1/u + 1/v puts it.
 */
function lensRays(
  b: LensBrief,
  L: ReturnType<typeof lensLayout>,
  d: Drawing,
  t: CheckTools,
): string[] {
  const out: string[] = [];
  const converging = b.setup === "converging-lens";
  const { T, C, F, F2, L1, B, I, X, s, AY } = L;
  // Where 1/f = 1/u + 1/v puts the image, worked out afresh.
  const f = converging ? b.focalLength : -b.focalLength;
  const v = (f * b.objectDistance) / (b.objectDistance - f);
  const wantX = X + v * s;
  const tip = d.arrows.find(
    (a) =>
      a.end &&
      !a.start &&
      t.near(a.from[1], AY) &&
      t.near(a.from[0], a.to[0]) &&
      !t.near(a.from[0], L.O[0]),
  );
  if (!tip) out.push("The image is not drawn as an arrow standing on the axis");
  else if (!t.near(tip.from[0], wantX))
    out.push(
      `The image is drawn at x = ${t.fmt(tip.from[0])}; 1/f = 1/u + 1/v puts it ${t.fmt(Math.abs(v))} from the lens, at x = ${t.fmt(wantX)}`,
    );
  else if (v > 0 !== tip.to[1] > AY)
    out.push(
      `The image points the wrong way: a ${v > 0 ? "real image is upside down" : "virtual image is upright"}`,
    );
  // The construction rays cross where the image's tip is.
  const bend = converging ? F2 : F;
  const crossing = meet(T, C, L1, bend);
  if (!t.near(crossing[0], B[0]) || !t.near(crossing[1], B[1]))
    out.push(`The image's tip ${t.at(B)} is not where the rays meet, ${t.at(crossing)}`);
  for (const r of L.rays) {
    const [p, q, e] = r.pts;
    if (r.name === "ray parallel to the axis") {
      if (!t.near(p[1], q[1])) out.push("The ray parallel to the axis is not parallel to it");
      if (offLine(bend, q, converging ? e : plus(q, minus(q, F))) > 0.6)
        out.push(
          `The ray parallel to the axis does not ${converging ? "pass through F" : "head away from F"} after the lens`,
        );
    } else if (r.name === "ray through the centre of the lens") {
      if (offLine(C, p, e) > 0.6 || offLine(q, p, e) > 0.6)
        out.push("The ray through the centre of the lens does not go straight on");
    } else {
      if (offLine(F, p, q) > 0.6) out.push("The ray through F does not pass through F");
      if (!t.near(q[1], e[1])) out.push("The ray through F does not come out parallel to the axis");
    }
    if (L.real && (!t.near(e[0], B[0]) || !t.near(e[1], B[1])))
      out.push(`The ${r.name} does not end at the image's tip`);
  }
  for (const [p, q] of L.backs)
    if (offLine(B, p, q) > 0.6)
      out.push("A dashed line traced back from the lens misses the image's tip");
  if (!t.near(I[0], B[0])) out.push("The image does not stand straight up from the axis");
  return out;
}
