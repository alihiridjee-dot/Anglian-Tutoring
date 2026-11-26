/**
 * A dot-and-cross diagram of a simple covalent molecule, each atom drawn as
 * its outer shell, a circle with its symbol in the middle. Bonded atoms'
 * shells overlap, and each shared pair sits in the overlap as one dot and one
 * cross; lone pairs sit on their atom's shell line, as exam boards draw them.
 * Only outer electrons are drawn, and bonded atoms never share a mark: the
 * first atom's electrons are dots, its neighbours' crosses, theirs dots, and
 * so on.
 *
 * Three layouts. One central atom with up to four atoms bonded to it (or just
 * two atoms): the others sit left, right, below, then above it. Two to four
 * central atoms in a row (ethane, methanol, hydrogen peroxide, butane): each
 * one's other atoms sit above, below and at the row's ends; hydrogen's shell
 * is drawn smaller when full-size shells would touch, and the row is turned on
 * its side, top to bottom, when it is still too wide. One ring of six (benzene): its atoms at the
 * corners of a hexagon, each one's other atom straight out from the ring, with
 * the ring's single and double bonds in turn.
 *
 * The writer gives the molecule as SMILES; the server works out its atoms and
 * bonds (structures/layout.server.ts), so this file needs no chemistry
 * library. The code places every electron, so each atom brings exactly its
 * group's outer electrons and ends with a full shell; a brief that would break
 * either, or that would not fit, is refused.
 */
import { CANVAS_HEIGHTS, CANVAS_WIDTH } from "../figure";
import type { Pt } from "../figureCheck";
import { and, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type DotCrossBond = { atoms: [number, number]; order: number };
export type DotCrossBrief = {
  kind: "dot-and-cross";
  /** The molecule as the writer gave it, or null for a brief written atom by atom. */
  smiles: string | null;
  /** Every atom's element, hydrogens included. */
  atoms: string[];
  /** Each covalent bond: two atoms' places in `atoms`, and its order, 1 to 3. */
  bonds: DotCrossBond[];
  /** A capital letter written in place of the central atom's symbol, or null. */
  letter: string | null;
};

/** Outer electrons by element: its group. */
const OUTER: Record<string, number> = {
  H: 1,
  C: 4,
  Si: 4,
  N: 5,
  P: 5,
  O: 6,
  S: 6,
  F: 7,
  Cl: 7,
  Br: 7,
  I: 7,
};
/** A full outer shell: hydrogen's holds 2. */
const full = (symbol: string) => (symbol === "H" ? 2 : 8);
const ELEMENTS = "H, C, Si, N, P, O, S, F, Cl, Br or I";
const MAX_ATOMS = 16;

/** Each shell's radius, how far apart two bonded atoms' centres are, and where lone pairs sit: on the shell's line, as exam boards draw them. */
const R = 48;
const D = 72;
const LONE = R;
/** Hydrogen's smaller shell, and how far it sits from its atom, in a row too crowded for full-size shells. */
const RH = 32;
const DH = 60;
/**
 * A row's ways of fitting, tried in turn: full size; hydrogen's shell smaller;
 * then the same turned on its side, top to bottom, for a row of four (butane)
 * still too wide for the canvas. Smaller shells would put the hydrogens'
 * symbols on their shared pairs.
 */
type Size = { small: boolean; turned: boolean };
const SIZES: Size[] = [
  { small: false, turned: false },
  { small: true, turned: false },
  { small: true, turned: true },
];
/** Half a dot's or a cross's width; a lone pair's two electrons sit this far either side of its middle. */
const MARK = 3.5;
const PAIR = 6;
/** Shared pairs stack across the overlap this far apart; a pair's dot and cross sit this far either side of its middle. */
const STACK = 11;
const SPLIT = 5;
/** A row's drawing keeps this far from the canvas edges, and shells that share no bond keep this far apart. */
const PAD = 12;
const GAP = 8;

type Dir = "left" | "right" | "down" | "up";
const STEP: Record<Dir, Pt> = { left: [-1, 0], right: [1, 0], down: [0, 1], up: [0, -1] };
const PLACES: Dir[][] = [
  [],
  ["right"],
  ["left", "right"],
  ["left", "right", "down"],
  ["left", "right", "down", "up"],
];
/** The central atom's lone pairs: on its far side, then above and below. */
const CENTRE_LONE: Record<number, Dir[][]> = {
  1: [[], ["left"], ["up", "down"], ["left", "up", "down"]],
  2: [[], ["up"], ["up", "down"]],
  3: [[], ["up"]],
  4: [[]],
};
const PHRASE: Record<Dir, string> = {
  left: "on the left",
  right: "on the right",
  down: "below",
  up: "above",
};
/** Where an atom sits from its central atom in a row, by angle (anticlockwise from the right). */
const WHERE: Record<number, string> = {
  0: "to the right of",
  60: "above and to the right of",
  90: "above",
  120: "above and to the left of",
  180: "to the left of",
  240: "below and to the left of",
  270: "below",
  300: "below and to the right of",
  // A row turned on its side puts an end atom's other atoms a little off these.
  30: "above and to the right of",
  150: "above and to the left of",
  210: "below and to the left of",
  330: "below and to the right of",
};

type Mark = { at: Pt; dot: boolean; region: string };
type Placed = { symbol: string; at: Pt; r: number; dot: boolean; name: string };
type Layout = {
  H: number;
  atoms: Placed[];
  /** Each bond by its atoms' places in `atoms`, the lower first. */
  bonds: { a: number; b: number; order: number }[];
  marks: Mark[];
  /** One central atom: where each other atom sits. Null for a row. */
  dirs: Dir[] | null;
  /** A row: each central atom's place in `atoms`, and the other atoms on it with where they sit. */
  row: { at: number; held: { at: number; angle: number }[] }[] | null;
  /** A row turned on its side, its central atoms top to bottom. */
  turned?: boolean;
  /** A ring: each ring atom's place in `atoms`, anticlockwise from the right, and the atom outside it. */
  ring: { at: number; held: { at: number; angle: number }[] }[] | null;
};

/** Each atom's bonded neighbours, with the bond's order, in the order the bonds come. */
function neighbours(b: DotCrossBrief, i: number): [number, number][] {
  return b.bonds.flatMap(({ atoms: [p, q], order }) =>
    p === i ? [[q, order] as [number, number]] : q === i ? [[p, order] as [number, number]] : [],
  );
}
const used = (b: DotCrossBrief, i: number) => neighbours(b, i).reduce((s, [, o]) => s + o, 0);

/** The one central atom and the atoms bonded to it, or null when the molecule has more than one. */
function starOf(b: DotCrossBrief): { centre: number; around: [number, number][] } | null {
  if (b.atoms.length === 2) return { centre: 0, around: neighbours(b, 0) };
  const inner = b.atoms.flatMap((_, i) => (neighbours(b, i).length > 1 ? [i] : []));
  return inner.length === 1 ? { centre: inner[0], around: neighbours(b, inner[0]) } : null;
}

/** The shells an electron at p sits in (on a shell's line counts), as "0", "0+2" and so on. */
const regionOf = (p: Pt, atoms: { at: Pt; r: number }[]) =>
  atoms
    .flatMap((a, k) => (Math.hypot(p[0] - a.at[0], p[1] - a.at[1]) < a.r + MARK + 1 ? [k] : []))
    .join("+");

/** A lone pair on the shell of the atom at p, radius r, in direction w. */
function lonePair(marks: Mark[], p: Pt, r: number, w: Pt, dot: boolean, region: string) {
  for (const s of [-1, 1])
    marks.push({
      at: [p[0] + w[0] * r - w[1] * PAIR * s, p[1] + w[1] * r + w[0] * PAIR * s],
      dot,
      region,
    });
}

/** One central atom: each other atom left, right, below, then above it. */
function starLayout(b: DotCrossBrief, star: { centre: number; around: [number, number][] }) {
  const around = star.around.map(([i, bonds]) => ({ symbol: b.atoms[i], bonds }));
  const centreSymbol = b.atoms[star.centre];
  const n = around.length;
  const H = n === 4 ? 280 : 200;
  const centre: Pt = n === 1 ? [180 - D / 2, 100] : [180, n === 3 ? (H - D) / 2 : H / 2];
  const dirs = PLACES[n];
  const at: Pt[] = [
    centre,
    ...dirs.map((d) => [centre[0] + STEP[d][0] * D, centre[1] + STEP[d][1] * D] as Pt),
  ];
  const marks: Mark[] = [];
  around.forEach((a, k) => {
    const u = STEP[dirs[k]];
    const mid: Pt = [centre[0] + (u[0] * D) / 2, centre[1] + (u[1] * D) / 2];
    for (let j = 0; j < a.bonds; j++) {
      const off = (j - (a.bonds - 1) / 2) * STACK;
      for (const [dot, side] of [
        [true, -1],
        [false, 1],
      ] as const)
        marks.push({
          at: [
            mid[0] + u[0] * SPLIT * side - u[1] * off,
            mid[1] + u[1] * SPLIT * side + u[0] * off,
          ],
          dot,
          region: `0+${k + 1}`,
        });
    }
    const pairs = (OUTER[a.symbol] - a.bonds) / 2;
    const v: Pt = [-u[1], u[0]];
    const ws = [[], [u], [v, [-v[0], -v[1]]], [u, v, [-v[0], -v[1]]]][pairs] as Pt[];
    for (const w of ws) lonePair(marks, at[k + 1], LONE, w, false, `${k + 1}`);
  });
  const shared = around.reduce((s, a) => s + a.bonds, 0);
  const pairs = (OUTER[centreSymbol] - shared) / 2;
  for (const d of CENTRE_LONE[n][pairs]) lonePair(marks, centre, LONE, STEP[d], true, "0");
  // Each atom as a problem names it: "the central N", "the left H", "the H below".
  const name = (k: number) => {
    if (n === 1) return `the ${k ? "right" : "left"} ${k ? around[0].symbol : centreSymbol}`;
    if (!k) return `the central ${centreSymbol}`;
    const [d, symbol] = [dirs[k - 1], around[k - 1].symbol];
    return d === "left" || d === "right" ? `the ${d} ${symbol}` : `the ${symbol} ${PHRASE[d]}`;
  };
  const layout: Layout = {
    H,
    atoms: at.map((p, k) => ({
      symbol: k ? around[k - 1].symbol : centreSymbol,
      at: p,
      r: R,
      dot: k === 0,
      name: name(k),
    })),
    bonds: around.map((a, k) => ({ a: 0, b: k + 1, order: a.bonds })),
    marks,
    dirs,
    row: null,
    ring: null,
  };
  return layout;
}

/** Where a row's central atom puts its other atoms (T) and its lone pairs (L), by angle; null when they don't fit. */
function slots(end: boolean, t: number, lp: number): { T: number[]; L: number[] } | null {
  const m = t + lp;
  if (!end) {
    if (m > 2) return null;
    return { T: [90, 270].slice(0, t), L: [90, 270].slice(t, m) };
  }
  if (m <= 1) return { T: t ? [180] : [], L: lp ? [180] : [] };
  if (m === 2) return { T: [120, 240].slice(0, t), L: [120, 240].slice(t) };
  if (m === 3)
    return t === 1
      ? { T: [180], L: [90, 270] }
      : t === 2
        ? { T: [90, 270], L: [180] }
        : { T: t ? [90, 180, 270] : [], L: t ? [] : [90, 180, 270] };
  return null;
}
const toward = (angle: number): Pt => {
  const a = (angle * Math.PI) / 180;
  return [Math.round(Math.cos(a) * 1e9) / 1e9, -Math.round(Math.sin(a) * 1e9) / 1e9];
};

/** Where an end atom's lone pairs go: straight on from its bond, then either side of it. */
function endPairs(symbol: string, bonds: number, angle: number): Pt[] {
  const pairs = (OUTER[symbol] - bonds) / 2;
  const u = toward(angle);
  const v: Pt = [-u[1], u[0]];
  return [[], [u], [v, [-v[0], -v[1]]], [u, v, [-v[0], -v[1]]]][pairs] as Pt[];
}

/**
 * The rest of a row's or a ring's layout once its atoms are placed: dots and
 * crosses in turn along the bonds, each shared pair in its overlap, each lone
 * pair on its atom's shell, nothing touching what it isn't bonded to, and the
 * whole centred on the smallest canvas it fits.
 */
function finish(
  b: DotCrossBrief,
  atoms: Placed[],
  place: Map<number, number>,
  lone: { at: number; ws: Pt[] }[],
): Pick<Layout, "H" | "atoms" | "bonds" | "marks"> | string {
  const marks: Mark[] = [];
  const bonds = b.bonds
    .map(({ atoms: [p, q], order }) => {
      const [x, y] = [place.get(p)!, place.get(q)!];
      return { a: Math.min(x, y), b: Math.max(x, y), order };
    })
    .sort((x, y) => x.a - y.a || x.b - y.b);
  // Dots and crosses take turns along every bond, starting from the first atom.
  const seen = new Set([0]);
  atoms[0].dot = true;
  for (let queue = [0]; queue.length;) {
    const k = queue.shift()!;
    for (const { a, b: c } of bonds) {
      const other = a === k ? c : c === k ? a : -1;
      if (other < 0 || seen.has(other)) continue;
      seen.add(other);
      atoms[other].dot = !atoms[k].dot;
      queue.push(other);
    }
  }
  for (const { a, b: c, order } of bonds) {
    const [p, q] = [atoms[a], atoms[c]];
    const d = Math.hypot(q.at[0] - p.at[0], q.at[1] - p.at[1]);
    const u: Pt = [(q.at[0] - p.at[0]) / d, (q.at[1] - p.at[1]) / d];
    const along = (p.r + d - q.r) / 2;
    const mid: Pt = [p.at[0] + u[0] * along, p.at[1] + u[1] * along];
    for (let j = 0; j < order; j++) {
      const off = (j - (order - 1) / 2) * STACK;
      for (const [own, side] of [
        [p, -1],
        [q, 1],
      ] as const)
        marks.push({
          at: [
            mid[0] + u[0] * SPLIT * side - u[1] * off,
            mid[1] + u[1] * SPLIT * side + u[0] * off,
          ],
          dot: own.dot,
          region: `${a}+${c}`,
        });
    }
  }
  for (const { at, ws } of lone)
    for (const w of ws) lonePair(marks, atoms[at].at, atoms[at].r, w, atoms[at].dot, `${at}`);

  // Nothing may touch what it isn't bonded to: shells, or electrons in another shell.
  const bonded = new Set(bonds.map(({ a, b: c }) => `${a}+${c}`));
  for (let x = 0; x < atoms.length; x++)
    for (let y = x + 1; y < atoms.length; y++)
      if (
        !bonded.has(`${x}+${y}`) &&
        Math.hypot(atoms[x].at[0] - atoms[y].at[0], atoms[x].at[1] - atoms[y].at[1]) <
          atoms[x].r + atoms[y].r + GAP
      )
        return "is too crowded to draw";
  if (marks.some((m) => regionOf(m.at, atoms) !== m.region)) return "is too crowded to draw";

  // Centre it on the smallest canvas it fits.
  const xs = [
    ...atoms.flatMap((a) => [a.at[0] - a.r, a.at[0] + a.r]),
    ...marks.flatMap((m) => [m.at[0] - MARK, m.at[0] + MARK]),
  ];
  const ys = [
    ...atoms.flatMap((a) => [a.at[1] - a.r, a.at[1] + a.r]),
    ...marks.flatMap((m) => [m.at[1] - MARK, m.at[1] + MARK]),
  ];
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - x0, Math.max(...ys) - y0];
  if (w > CANVAS_WIDTH - 2 * PAD) return "is too wide to draw";
  const H = CANVAS_HEIGHTS.find((v) => v >= h + 2 * PAD);
  if (!H) return "is too tall to draw";
  const [dx, dy] = [(CANVAS_WIDTH - w) / 2 - x0, (H - h) / 2 - y0];
  const shift = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  for (const a of atoms) a.at = shift(a.at);
  for (const m of marks) m.at = shift(m.at);
  return { H, atoms, bonds, marks };
}

/** Central atoms in a row, left to right (or top to bottom, turned), in one of the row's ways of fitting. */
function rowLayout(b: DotCrossBrief, size: Size): Layout | string {
  const inner = b.atoms.flatMap((_, i) => (neighbours(b, i).length > 1 ? [i] : []));
  const isInner = new Set(inner);
  const innerNext = (i: number) => neighbours(b, i).flatMap(([j]) => (isInner.has(j) ? [j] : []));
  if (inner.some((i) => innerNext(i).length > 2))
    return "branches: its central atoms must be in one row";
  // A tree's central atoms join up, so with no branch they make one row.
  const path = [Math.min(...inner.filter((i) => innerNext(i).length === 1))];
  while (path.length < inner.length) {
    const next = innerNext(path[path.length - 1]).find((j) => !path.includes(j));
    if (next === undefined) break;
    path.push(next);
  }
  if (path.length !== inner.length) return "branches: its central atoms must be in one row";
  if (path.length > 4) return "has more than 4 central atoms in a row";

  const n = path.length;
  const POS = n === 2 ? ["left", "right"] : ["left", "middle", "right"];
  const ORD = ["1st", "2nd", "3rd", "4th"];
  // Turned on its side: the row's right goes down, and every angle turns with it.
  const turn = (a: number) => (size.turned ? (a + 270) % 360 : a);
  const atoms: Placed[] = [];
  /** Each atom's place here, and back: the brief's atom drawn at each place. */
  const place = new Map<number, number>();
  const briefAt: number[] = [];
  path.forEach((i, k) => {
    place.set(i, atoms.length);
    briefAt.push(i);
    atoms.push({
      symbol: b.atoms[i],
      at: size.turned ? [0, k * D] : [k * D, 0],
      r: R,
      dot: false,
      name: size.turned
        ? `the ${b.atoms[i]} ${ORD[k]} from the top`
        : n <= 3
          ? `the ${POS[k]} ${b.atoms[i]}`
          : `the ${b.atoms[i]} ${ORD[k]} from the left`,
    });
  });
  const row: NonNullable<Layout["row"]> = [];
  const centralPairs: { at: number; angles: number[] }[] = [];
  for (const [k, i] of path.entries()) {
    const ends = neighbours(b, i).filter(([j]) => !isInner.has(j));
    const lp = (OUTER[b.atoms[i]] - used(b, i)) / 2;
    const s = slots(k === 0 || k === n - 1, ends.length, lp);
    if (!s) return "has a central atom with too many atoms and lone pairs around it to draw";
    // The left end's other atoms face left; the right end's are the mirror image.
    const mirror = (a: number) => (k === n - 1 && k > 0 ? (540 - a) % 360 : a);
    const held: { at: number; angle: number }[] = [];
    ends.forEach(([j], e) => {
      const angle = turn(mirror(s.T[e]));
      const u = toward(angle);
      const h = size.small && b.atoms[j] === "H";
      const from = atoms[k].at;
      place.set(j, atoms.length);
      briefAt.push(j);
      held.push({ at: atoms.length, angle });
      atoms.push({
        symbol: b.atoms[j],
        at: [from[0] + u[0] * (h ? DH : D), from[1] + u[1] * (h ? DH : D)],
        r: h ? RH : R,
        dot: false,
        name: `the ${b.atoms[j]} ${WHERE[angle]} ${atoms[k].name}`,
      });
    });
    row.push({ at: k, held });
    centralPairs.push({ at: k, angles: s.L.map((a) => turn(mirror(a))) });
  }
  const lone = [
    ...centralPairs.map(({ at, angles }) => ({ at, ws: angles.map(toward) })),
    ...row.flatMap(({ held }) =>
      held.map(({ at, angle }) => ({
        at,
        ws: endPairs(atoms[at].symbol, used(b, briefAt[at]), angle),
      })),
    ),
  ];
  const done = finish(b, atoms, place, lone);
  return typeof done === "string"
    ? done
    : { ...done, dirs: null, row, ring: null, turned: size.turned };
}

/** Where each corner of a ring sits, anticlockwise from the right. */
const CORNER = [
  "on the right",
  "at the top right",
  "at the top left",
  "on the left",
  "at the bottom left",
  "at the bottom right",
];

/**
 * One ring of six (benzene): its atoms at the corners of a hexagon,
 * anticlockwise from the right, each one's other atom straight out from the
 * ring's middle, or its one lone pair (pyridine's N). Hydrogen's shell is
 * drawn smaller, as in a crowded row; the ring is turned a corner at a time
 * until its other atoms fit.
 */
function ringLayout(b: DotCrossBrief): Layout | string {
  // The ring is what is left once every atom on a single bond is taken off, again and again.
  const left = new Set(b.atoms.keys());
  for (let more = true; more;) {
    more = false;
    for (const i of [...left])
      if (neighbours(b, i).filter(([j]) => left.has(j)).length < 2) {
        left.delete(i);
        more = true;
      }
  }
  if (left.size !== 6) return `has a ring of ${left.size} atoms; only a ring of six is drawn`;
  const order = [Math.min(...left)];
  while (order.length < 6) {
    const last = order[order.length - 1];
    order.push(neighbours(b, last).find(([j]) => left.has(j) && !order.includes(j))![0]);
  }
  const outs = order.map((i) =>
    neighbours(b, i)
      .filter(([j]) => !left.has(j))
      .map(([j]) => j),
  );
  const pairs = order.map((i) => (OUTER[b.atoms[i]] - used(b, i)) / 2);
  if (outs.flat().some((j) => neighbours(b, j).length > 1))
    return "has a group of atoms on its ring: only single atoms outside a ring are drawn";
  if (order.some((_, k) => outs[k].length + pairs[k] > 1))
    return "has a ring atom with too many atoms and lone pairs around it to draw";

  let last: string = "is too wide to draw";
  for (let turn = 0; turn < 6; turn++) {
    const atoms: Placed[] = [];
    const place = new Map<number, number>();
    const ring: NonNullable<Layout["ring"]> = [];
    const lone: { at: number; ws: Pt[] }[] = [];
    const corner = (k: number) => (k + turn) % 6;
    order.forEach((i, k) => {
      const u = toward(60 * corner(k));
      place.set(i, k);
      atoms.push({
        symbol: b.atoms[i],
        at: [u[0] * D, u[1] * D],
        r: R,
        dot: false,
        name: `the ${b.atoms[i]} ${CORNER[corner(k)]}`,
      });
    });
    order.forEach((i, k) => {
      const angle = 60 * corner(k);
      const u = toward(angle);
      const held: { at: number; angle: number }[] = [];
      for (const j of outs[k]) {
        const far = D + (b.atoms[j] === "H" ? DH : D);
        place.set(j, atoms.length);
        held.push({ at: atoms.length, angle });
        lone.push({ at: atoms.length, ws: endPairs(b.atoms[j], used(b, j), angle) });
        atoms.push({
          symbol: b.atoms[j],
          at: [u[0] * far, u[1] * far],
          r: b.atoms[j] === "H" ? RH : R,
          dot: false,
          name: `the ${b.atoms[j]} outside ${atoms[k].name}`,
        });
      }
      if (pairs[k]) lone.push({ at: k, ws: [u] });
      ring.push({ at: k, held });
    });
    const done = finish(b, atoms, place, lone);
    if (typeof done !== "string") return { ...done, dirs: null, row: null, ring };
    last = done;
  }
  return last;
}

/** Where every shell and electron goes, or why it can't be drawn. */
function layout(b: DotCrossBrief): Layout | string {
  const star = starOf(b);
  if (star) {
    if (star.around.length > 4) return "needs 1 to 4 atoms around the centre";
    return starLayout(b, star);
  }
  if (b.bonds.length === b.atoms.length) return ringLayout(b);
  let last: Layout | string = "is too wide to draw";
  for (const size of SIZES) {
    last = rowLayout(b, size);
    if (typeof last !== "string" || !/^is too (crowded|wide|tall)/.test(last)) return last;
  }
  return last;
}
/**
 * The brief as atoms and bonds. Briefs saved before SMILES came in, and the
 * samples written the same way, name one central atom and the atoms around it.
 */
function asAtoms(b: DotCrossBrief): DotCrossBrief {
  const old = b as unknown as {
    centre?: string;
    around?: { symbol: string; bonds: number }[];
    letter?: string | null;
  };
  if (Array.isArray(b.atoms) || !old.centre || !Array.isArray(old.around)) return b;
  return {
    kind: "dot-and-cross",
    smiles: null,
    atoms: [old.centre, ...old.around.map((a) => a.symbol)],
    bonds: old.around.map((a, k) => ({ atoms: [0, k + 1], order: a.bonds })),
    letter: old.letter ?? null,
  };
}
const laidOut = (b: DotCrossBrief) => layout(asAtoms(b)) as Layout;

const tally = (dots: number, crosses: number) =>
  `${dots} dot${dots === 1 ? "" : "s"} and ${crosses} cross${crosses === 1 ? "" : "es"}`;
/** The word that comes up most often, the first of those on a tie. */
const mostOf = (words: string[]) =>
  words.reduce((best, w) =>
    words.filter((x) => x === w).length > words.filter((x) => x === best).length ? w : best,
  );
const BONDS = ["", "single", "double", "triple"];

/** The older brief, one central atom and the atoms around it, read as before and turned into atoms and bonds. */
function readCentred(b: Record<string, unknown>): { brief: DotCrossBrief } | { problem: string } {
  const centre = typeof b.centre === "string" ? b.centre.trim() : "";
  if (!Object.hasOwn(OUTER, centre))
    return { problem: "centre must be one of H, C, Si, N, P, O, S, F, Cl, Br, I" };
  const around = b.around as { symbol: unknown; bonds: unknown }[];
  if (!Array.isArray(around) || around.length < 1 || around.length > 4)
    return { problem: "needs 1 to 4 atoms around the centre" };
  const read: DotCrossBrief = {
    kind: "dot-and-cross",
    smiles: null,
    atoms: [centre],
    bonds: [],
    letter: null,
  };
  for (const a of around) {
    const symbol = typeof a?.symbol === "string" ? a.symbol.trim() : "";
    if (!Object.hasOwn(OUTER, symbol))
      return {
        problem: "has an atom around the centre that is not H, C, Si, N, P, O, S, F, Cl, Br or I",
      };
    if (![1, 2, 3].includes(a.bonds as number))
      return { problem: "has an atom whose bonds to the centre are not 1, 2 or 3" };
    read.bonds.push({ atoms: [0, read.atoms.length], order: a.bonds as number });
    read.atoms.push(symbol);
  }
  const letter = readLetter(b.letter);
  if (letter !== null && typeof letter === "object") return letter;
  read.letter = letter;
  // The chemistry: each atom brings its group's outer electrons, and a shared pair counts in
  // both shells, so a shell holds its own electrons plus one more for each bond it makes.
  const shell = OUTER[centre] + used(read, 0);
  if (shell !== full(centre))
    return {
      problem: `gives the ${around.length > 1 ? "central " : ""}${centre} ${shell} outer electrons once bonded, not ${full(centre)}`,
    };
  for (const { atoms, order } of read.bonds) {
    const symbol = read.atoms[atoms[1]];
    if (OUTER[symbol] + order !== full(symbol))
      return {
        problem: `gives a bonded ${symbol} ${OUTER[symbol] + order} outer electrons, not ${full(symbol)}`,
      };
  }
  return { brief: read };
}

function readLetter(value: unknown): string | null | { problem: string } {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[A-Z]$/.test(value.trim()))
    return { problem: "letter must be null or one capital letter" };
  return value.trim();
}

/** A brief of atoms and bonds, as the server lays one out from the writer's SMILES. */
function readAtoms(b: Record<string, unknown>): { brief: DotCrossBrief } | { problem: string } {
  const smiles = typeof b.smiles === "string" && b.smiles.trim() ? b.smiles.trim() : null;
  if (smiles && smiles.length > 300) return { problem: "has a SMILES string that is too long" };
  if (!Array.isArray(b.atoms))
    return {
      problem: smiles ? "could not be laid out from its SMILES" : "needs the molecule as SMILES",
    };
  const atoms = b.atoms as unknown[];
  if (atoms.length < 2 || atoms.length > MAX_ATOMS)
    return { problem: `needs 2 to ${MAX_ATOMS} atoms, hydrogens included` };
  for (const a of atoms)
    if (typeof a !== "string" || !Object.hasOwn(OUTER, a))
      return { problem: `has an atom "${String(a)}" that is not ${ELEMENTS}` };
  const read: DotCrossBrief = {
    kind: "dot-and-cross",
    smiles,
    atoms: atoms as string[],
    bonds: [],
    letter: null,
  };
  const bonds = b.bonds as { atoms: unknown; order: unknown }[];
  if (!Array.isArray(bonds)) return { problem: "needs its bonds" };
  const pairs = new Set<string>();
  for (const x of bonds) {
    const ends = x?.atoms as unknown[];
    const ok =
      Array.isArray(ends) &&
      ends.length === 2 &&
      ends.every(
        (e) => Number.isInteger(e) && (e as number) >= 0 && (e as number) < atoms.length,
      ) &&
      ends[0] !== ends[1] &&
      [1, 2, 3].includes(x.order as number);
    if (!ok) return { problem: "has a bond that is not two of its atoms with order 1, 2 or 3" };
    const [p, q] = ends as number[];
    const key = `${Math.min(p, q)}+${Math.max(p, q)}`;
    if (pairs.has(key)) return { problem: "bonds the same two atoms twice" };
    pairs.add(key);
    read.bonds.push({ atoms: [p, q], order: x.order as number });
  }
  // One molecule with at most one ring: every atom reached from the first, and no more bonds than atoms.
  const reached = new Set([0]);
  for (let grew = true; grew;) {
    grew = false;
    for (const {
      atoms: [p, q],
    } of read.bonds)
      if (reached.has(p) !== reached.has(q)) {
        reached.add(p).add(q);
        grew = true;
      }
  }
  if (reached.size !== atoms.length || read.bonds.length > atoms.length)
    return { problem: "must be one molecule with at most one ring" };
  for (const [i, symbol] of read.atoms.entries())
    if (OUTER[symbol] + used(read, i) !== full(symbol))
      return {
        problem: `gives a bonded ${symbol} ${OUTER[symbol] + used(read, i)} outer electrons, not ${full(symbol)}`,
      };
  const letter = readLetter(b.letter);
  if (letter !== null && typeof letter === "object") return letter;
  read.letter = letter;
  return { brief: read };
}

/** The other atoms on a row's central atom, as the alt text says them: "the H above it and the H below it". */
const heldWords = (L: Layout, held: { at: number; angle: number }[]) =>
  and(held.map(({ at, angle }) => `the ${L.atoms[at].symbol} ${WHERE[angle]} it`));

/** What a row's drawing shows, never what it means. */
function rowAlt(L: Layout): string {
  const row = L.row!;
  const ink = (dot: boolean) => (dot ? "dots" : "crosses");
  const central = and(
    row.map(
      ({ at }) =>
        `${L.atoms[at].name.replace(/^the /, "")} with its electrons drawn as ${ink(L.atoms[at].dot)}`,
    ),
  );
  const held = row
    .filter(({ held }) => held.length)
    .map(
      ({ at, held }) =>
        `${L.atoms[at].name.replace(/^t/, "T")}'s shell also overlaps those of ${heldWords(L, held)}, whose electrons are drawn as ${ink(!L.atoms[at].dot)}.`,
    )
    .join(" ");
  const tallied = L.bonds.map(({ a, b, order }) => ({
    words: `the overlap of ${L.atoms[a].name} and ${L.atoms[b].name}`,
    holds: tally(order, order),
    inner: b < row.length,
  }));
  const rest = tallied.filter((t) => !t.inner);
  const overlaps = [
    ...tallied.filter((t) => t.inner).map((t) => `${t.words} holds ${t.holds}`),
    ...(rest.length && rest.every((t) => t.holds === rest[0].holds)
      ? [`${rest.length > 1 ? "every other overlap" : rest[0].words} holds ${rest[0].holds}`]
      : rest.map((t) => `${t.words} holds ${t.holds}`)),
  ];
  const own = L.atoms.flatMap((a, k) => {
    const n = L.marks.filter((m) => m.region === `${k}`).length;
    return n ? [`${a.name} has ${n} more ${ink(a.dot)}`] : [];
  });
  const beyond = own.length
    ? `Outside the overlaps, ${and(own)}, and no other atom has any.`
    : "There are no other electrons.";
  const shape = `${L.turned ? "a column" : "a row"} of ${row.length} overlapping shells`;
  const words = `A dot-and-cross diagram of the outer electrons in a molecule: ${shape}, ${central}. ${held} ${and(overlaps).replace(/^t/, "T")}. ${beyond}`;
  if (words.length < 1000) return words;
  // A long row (butane) in fewer words: the central atoms take turns, dots first.
  const around = row
    .filter(({ held }) => held.length)
    .map(
      ({ at, held }) =>
        `${L.atoms[at].name} also overlaps ${and(held.map(({ at: h, angle }) => `${L.atoms[h].symbol} ${WHERE[angle].replace(/ of$/, "")}`))}`,
    )
    .join("; ");
  // Only the overlaps that differ from the usual one are named.
  const usual = mostOf(tallied.map((t) => t.holds));
  const odd = tallied.filter((t) => t.holds !== usual);
  return `A dot-and-cross diagram of the outer electrons in a molecule: ${shape}, ${and(
    row.map(({ at }) => L.atoms[at].name.replace(/^the /, "")),
  )}, their electrons drawn as dots and crosses in turn, starting with dots. ${around.replace(/^t/, "T")}, each of those atoms' electrons drawn the other way from its central atom's. ${
    odd.length
      ? `${and(odd.map((t) => `${t.words} holds ${t.holds}`)).replace(/^t/, "T")}, and every other overlap holds ${usual}`
      : `Every overlap holds ${usual}`
  }. ${beyond}`;
}

/** What a one-centre drawing shows, never what it means: the bond's type or the molecule's name may be the question. */
function starAlt(b: DotCrossBrief, L: Layout): string {
  const centre = L.atoms[0].symbol;
  const around = L.bonds.map(({ b: k, order }) => ({ symbol: L.atoms[k].symbol, bonds: order }));
  const dirs = L.dirs!;
  const shown = b.letter ?? centre;
  const more = (k: number, what: string) => {
    const n = L.marks.filter((m) => m.region === `${k}`).length;
    return n ? `${n} more ${what}` : `no more ${what}`;
  };
  const two = around.length === 1;
  const at = (k: number) => `${around[k].symbol} ${PHRASE[dirs[k]]}`;
  const alike = around.every((a) => a.symbol === around[0].symbol && a.bonds === around[0].bonds);
  const overlaps = alike
    ? `${two ? "The" : "Each"} overlap holds ${tally(around[0].bonds, around[0].bonds)}.`
    : `${around.map((a, k) => `the overlap with ${at(k)} holds ${tally(a.bonds, a.bonds)}`).join("; ")}.`.replace(
        /^t/,
        "T",
      );
  const others = alike
    ? `${two ? `the ${around[0].symbol} on the right` : `each ${around[0].symbol}`} has ${more(1, "crosses")}`
    : and(around.map((a, k) => `${at(k)} has ${more(k + 1, "crosses")}`));
  return `A dot-and-cross diagram of the outer electrons in a molecule: ${
    two
      ? `two overlapping shells, ${shown} on the left with its electrons drawn as dots and ${around[0].symbol} on the right with its electrons drawn as crosses.`
      : `${b.letter ? `an atom labelled ${b.letter}` : shown} in the middle with its electrons drawn as dots, its shell overlapping those of ${and(around.map((_, k) => at(k)))}, whose electrons are drawn as crosses.`
  } ${overlaps} Outside the overlaps, ${two ? `the ${shown} on the left` : shown} has ${more(0, "dots")} and ${others}.`;
}

/** What a ring's drawing shows, never what it means. */
function ringAlt(L: Layout): string {
  const ring = L.ring!;
  const ink = (dot: boolean) => (dot ? "dots" : "crosses");
  const holds = (p: number, q: number) => {
    const { order } = L.bonds.find(({ a, b }) => (a === p && b === q) || (a === q && b === p))!;
    return tally(order, order);
  };
  const round = ring.map(({ at }, k) => holds(at, ring[(k + 1) % ring.length].at));
  const held = ring.flatMap(({ at, held }) => held.map((h) => ({ on: at, at: h.at })));
  // The atoms outside the ring, a kind at a time: the commonest kind goes last, as "each other ring atom".
  const kinds = [...new Set(held.map(({ at }) => L.atoms[at].symbol))]
    .map((symbol) => ({ symbol, on: held.filter(({ at }) => L.atoms[at].symbol === symbol) }))
    .sort((x, y) => x.on.length - y.on.length);
  const rest = held.length === ring.length && kinds.length > 1 ? kinds[kinds.length - 1] : null;
  const where = and(
    kinds.map(({ symbol, on }) =>
      on.length === ring.length
        ? `each ring atom also overlaps one ${symbol}`
        : on === rest?.on
          ? `each other ring atom one ${symbol}`
          : `${and(on.map((h) => L.atoms[h.on].name))} ${on.length > 1 ? "each also overlap" : "also overlaps"} one ${symbol}`,
    ),
  );
  const each = kinds.map(({ symbol, on }) => ({ symbol, holds: on.map((h) => holds(h.on, h.at)) }));
  const flat = each.flatMap((e) => e.holds);
  const usual = flat.length ? mostOf(flat) : "";
  const odd = each.filter((e) => e.holds.some((t) => t !== usual));
  const outside = !held.length
    ? ""
    : `Straight out from the ring, ${where}, each of those atoms' electrons drawn the other way from its ring atom's; ${
        !odd.length
          ? `each of those overlaps holds ${usual}`
          : odd.every((e) => e.holds.every((t) => t === e.holds[0]))
            ? `${and(odd.map((e) => `each ${e.symbol}'s overlap holds ${e.holds[0]}`))}, and every other one holds ${usual}`
            : `those overlaps hold ${and(flat)} in turn`
      }.`;
  // An atom that is the only one of its element needs no more than its symbol.
  const named = ({ symbol, name }: Placed) =>
    L.atoms.filter((a) => a.symbol === symbol).length === 1 ? `the ${symbol}` : name;
  const own = L.atoms.flatMap((a, k) => {
    const n = L.marks.filter((m) => m.region === `${k}`).length;
    return n ? [`${named(a)} has ${n} more ${ink(a.dot)}`] : [];
  });
  const ringSymbols = new Set(ring.map(({ at }) => L.atoms[at].symbol));
  const corners =
    ringSymbols.size === 1
      ? `a ${[...ringSymbols][0]} at each corner`
      : and(ring.map(({ at }) => L.atoms[at].name.replace(/^the /, "")));
  // Overlaps that repeat round the ring (benzene's double, single, double…) are said once.
  const period = [1, 2, 3].find((p) => round.every((t, k) => t === round[k % p])) ?? round.length;
  const turns =
    period === 1
      ? `each hold ${round[0]}`
      : period < round.length
        ? `hold ${round.slice(0, period).join(", then ")}, and so on round the ring`
        : `hold ${round.join(", then ")}`;
  return `A dot-and-cross diagram of the outer electrons in a molecule: a ring of ${ring.length} overlapping shells, ${corners}, their electrons drawn as dots and crosses in turn, starting with dots for ${L.atoms[ring[0].at].name}. Going anticlockwise from it, the overlaps round the ring ${turns}. ${outside} ${
    own.length
      ? `Outside the overlaps, ${and(own)}, and no other atom has any.`
      : "There are no other electrons."
  }`;
}

/** A ring of six as the server lays it out from SMILES: the ring's atoms, its bonds in turn, then each ring atom's hydrogens. */
function ringBrief(smiles: string, ring: [string, number][], orders: number[]): DotCrossBrief {
  const atoms = ring.map(([s]) => s);
  const bonds: DotCrossBond[] = orders.map((order, k) => ({
    atoms: [k, (k + 1) % ring.length],
    order,
  }));
  ring.forEach(([, h], k) => {
    for (let j = 0; j < h; j++) {
      bonds.push({ atoms: [k, atoms.length], order: 1 });
      atoms.push("H");
    }
  });
  return { kind: "dot-and-cross", smiles, atoms, bonds, letter: null };
}

/** A molecule as the server lays it out from SMILES: heavy atoms in a row, each with its hydrogens. */
function chainBrief(smiles: string, heavy: [string, number][], links: number[]): DotCrossBrief {
  const atoms = heavy.map(([s]) => s);
  const bonds: DotCrossBond[] = links.map((order, k) => ({ atoms: [k, k + 1], order }));
  heavy.forEach(([, h], k) => {
    for (let j = 0; j < h; j++) {
      bonds.push({ atoms: [k, atoms.length], order: 1 });
      atoms.push("H");
    }
  });
  return { kind: "dot-and-cross", smiles, atoms, bonds, letter: null };
}

export const dotAndCross: FigureKind<DotCrossBrief> = {
  kind: "dot-and-cross",
  name: "a dot-and-cross diagram of a covalent molecule",
  guide:
    'smiles: the molecule as SMILES, its hydrogens left out as SMILES leaves them: "N" is NH₃, "O" is H₂O, "Cl" is HCl, "ClCl" is Cl₂, "[H][H]" is H₂, "N#N" is N₂, "O=C=O" is CO₂, "CC" is ethane, "C=C" is ethene, "CO" is methanol, "OO" is H₂O₂, "CCCC" is butane, "c1ccccc1" is benzene. One neutral molecule made of H, C, Si, N, P, O, S, F, Cl, Br and I only: one central atom bonded to up to four others; two to four central atoms in a row with no branches; or one ring of six atoms, each with at most one atom outside the ring (benzene, drawn with its single and double bonds in turn). letter: null, or a capital letter written in place of the central atom\'s symbol when the question asks which element it is (a molecule with one central atom only). Give smiles and letter and nothing else: the website works out every bond and lone pair, and draws only the outer shells, each shared pair as a dot and a cross in the overlap and each lone pair on its atom\'s shell. Never write a SMILES string in the question, an option or the mark scheme.',
  read(b) {
    const read = b.centre !== undefined || b.around !== undefined ? readCentred(b) : readAtoms(b);
    if ("problem" in read) return read;
    if (read.brief.letter && !starOf(read.brief))
      return { problem: "letter needs a molecule with one central atom" };
    const L = layout(read.brief);
    return typeof L === "string" ? { problem: L } : read;
  },
  draw(b) {
    const L = laidOut(b);
    const body: string[] = [];
    for (const { at, r } of L.atoms)
      body.push(`<circle class="qf-line" cx="${num(at[0])}" cy="${num(at[1])}" r="${r}"/>`);
    for (const m of L.marks) {
      const [x, y] = m.at;
      if (m.dot) body.push(`<circle class="qf-ink" cx="${num(x)}" cy="${num(y)}" r="${MARK}"/>`);
      else
        body.push(
          line("qf-line", x - MARK, y - MARK, x + MARK, y + MARK),
          line("qf-line", x - MARK, y + MARK, x + MARK, y - MARK),
        );
    }
    L.atoms.forEach(({ at: [x, y], symbol }, k) => {
      const lettered = k === 0 && L.dirs && b.letter;
      body.push(
        text(lettered ? "qf-strong" : "qf-text", x, y + 5.5, "middle", [
          lettered ? b.letter! : symbol,
        ]),
      );
    });
    return { svg: svgOf(L.H, body), alt: L.dirs ? starAlt(b, L) : L.ring ? ringAlt(L) : rowAlt(L) };
  },
  check(b, d, t) {
    const L = laidOut(b);
    const out: string[] = [];
    const name = (k: number) => L.atoms[k].name;
    L.atoms.forEach(({ at: p, r, symbol }, k) => {
      if (
        !d.shapes.some(
          (s) =>
            s.name === "circle" &&
            s.cls === "qf-line" &&
            t.near(s.r, r) &&
            t.near(s.at[0], p[0]) &&
            t.near(s.at[1], p[1]),
        )
      )
        out.push(`The shell of ${name(k)} is not drawn at ${t.at(p)} with radius ${r}`);
      const [label, cls] =
        k === 0 && L.dirs && b.letter
          ? [b.letter, "qf-strong" as const]
          : [symbol, "qf-text" as const];
      if (!t.writtenAt(label, p[0], p[1] + 5.5, "middle", cls))
        out.push(`"${label}" is not written in the middle of ${name(k)}'s shell`);
    });
    const shells = d.shapes.filter((s) => s.name === "circle" && s.cls === "qf-line").length;
    if (shells !== L.atoms.length)
      out.push(`The diagram has ${shells} shells; the brief has ${L.atoms.length} atoms`);

    // The electrons: a dot is a small ink circle, a cross two short lines crossing at its middle.
    const found: { at: Pt; dot: boolean }[] = d.shapes
      .filter((s) => s.name === "circle" && s.cls === "qf-ink")
      .map((s) => ({ at: s.at, dot: true }));
    for (const s of d.shapes)
      if (s.name === "circle" && s.cls === "qf-ink" && !t.near(s.r, MARK))
        out.push(`The dot at ${t.at(s.at)} is not an electron's size, radius ${MARK}`);
    const halves = d.segments.map((s) => s.seg);
    const usedHalf = new Set<number>();
    halves.forEach(([p, q], i) => {
      if (usedHalf.has(i)) return;
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const cross = (r: [Pt, Pt]) =>
        Math.abs(Math.abs(r[1][0] - r[0][0]) - 2 * MARK) < 0.6 &&
        Math.abs(Math.abs(r[1][1] - r[0][1]) - 2 * MARK) < 0.6;
      const j = halves.findIndex(
        (r, k) =>
          k !== i &&
          !usedHalf.has(k) &&
          cross(r) &&
          cross([p, q]) &&
          t.near((r[0][0] + r[1][0]) / 2, mid[0]) &&
          t.near((r[0][1] + r[1][1]) / 2, mid[1]) &&
          Math.sign((r[1][0] - r[0][0]) * (r[1][1] - r[0][1])) !==
            Math.sign((q[0] - p[0]) * (q[1] - p[1])),
      );
      if (j < 0) return;
      usedHalf.add(i).add(j);
      found.push({ at: mid, dot: false });
    });
    halves.forEach(([p, q], i) => {
      if (!usedHalf.has(i))
        out.push(`The line from ${t.at(p)} to ${t.at(q)} is not half of an electron's cross`);
    });

    // Count what each region holds: an atom's own part of its shell, and each overlap.
    const count = new Map<string, [number, number]>();
    for (const e of found) {
      const r = regionOf(e.at, L.atoms);
      if (!r) {
        out.push(`The ${e.dot ? "dot" : "cross"} at ${t.at(e.at)} is outside every shell`);
        continue;
      }
      const c = count.get(r) ?? [0, 0];
      c[e.dot ? 0 : 1]++;
      count.set(r, c);
    }
    const wanted = new Map<string, [number, number]>();
    for (const m of L.marks) {
      const c = wanted.get(m.region) ?? [0, 0];
      c[m.dot ? 0 : 1]++;
      wanted.set(m.region, c);
    }
    for (const k of L.atoms.keys()) if (!wanted.has(`${k}`)) wanted.set(`${k}`, [0, 0]);
    for (const [r, [dots, crosses]] of wanted) {
      const [hd, hc] = count.get(r) ?? [0, 0];
      if (hd === dots && hc === crosses) continue;
      const parts = r.split("+").map(Number);
      const bond = L.bonds.find(({ a, b: c }) => a === parts[0] && c === parts[1]);
      out.push(
        parts.length === 2
          ? `The overlap of ${name(parts[0])} and ${name(parts[1])} holds ${tally(hd, hc)}; its ${BONDS[bond?.order ?? 0]} bond needs ${tally(dots, crosses)}`
          : `${name(parts[0]).replace(/^t/, "T")}'s own part of its shell holds ${tally(hd, hc)}; it needs ${tally(dots, crosses)}`,
      );
    }
    for (const r of count.keys())
      if (!wanted.has(r))
        out.push(
          `Electrons are drawn where ${and(r.split("+").map((k) => name(Number(k))))} meet, which share no bond`,
        );
    // And each one where the layout puts it, so pairs read as pairs.
    for (const e of found)
      if (
        !L.marks.some(
          (m) => m.dot === e.dot && t.near(m.at[0], e.at[0]) && t.near(m.at[1], e.at[1]),
        )
      )
        out.push(`The ${e.dot ? "dot" : "cross"} at ${t.at(e.at)} is not where an electron goes`);
    if (found.length !== L.marks.length)
      out.push(
        `The diagram has ${found.length} electrons; the brief's atoms have ${L.marks.length} outer electrons`,
      );

    for (const s of d.shapes)
      if (
        !(s.name === "circle" && (s.cls === "qf-line" || s.cls === "qf-ink")) &&
        !(s.name === "line" && s.cls === "qf-line" && !s.marked)
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the dot-and-cross diagram`);
    const labels = new Set(
      L.atoms.map((a, k) => (k === 0 && L.dirs && b.letter ? b.letter : a.symbol)),
    );
    const pieces = t.pieces();
    for (const p of pieces)
      if (!labels.has(p.text)) out.push(`Text "${p.text}" is not an atom's symbol`);
    if (pieces.length !== L.atoms.length)
      out.push(
        `The diagram has ${pieces.length} texts; it has one for each of its ${L.atoms.length} atoms`,
      );
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule of ammonia. How many pairs of electrons on the nitrogen atom are not used in bonding?",
      options: ["0", "1", "2", "3"],
      brief: {
        kind: "dot-and-cross",
        centre: "N",
        around: [
          { symbol: "H", bonds: 1 },
          { symbol: "H", bonds: 1 },
          { symbol: "H", bonds: 1 },
        ],
        letter: null,
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the outer electrons in a molecule of carbon dioxide. How many electrons are shared between the carbon atom and each oxygen atom?",
      options: ["1", "2", "4", "6"],
      brief: {
        kind: "dot-and-cross",
        centre: "C",
        around: [
          { symbol: "O", bonds: 2 },
          { symbol: "O", bonds: 2 },
        ],
        letter: null,
      },
    },
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule formed between element X and hydrogen. Which group of the periodic table is element X in?",
      options: ["Group 4", "Group 5", "Group 6", "Group 7"],
      brief: {
        kind: "dot-and-cross",
        centre: "O",
        around: [
          { symbol: "H", bonds: 1 },
          { symbol: "H", bonds: 1 },
        ],
        letter: "X",
      },
    },
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule of ethane. How many electrons in the molecule are used in bonding?",
      options: ["7", "8", "14", "16"],
      brief: chainBrief(
        "CC",
        [
          ["C", 3],
          ["C", 3],
        ],
        [1],
      ),
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the outer electrons in a molecule of ethene. How many electrons are shared between the two carbon atoms?",
      options: ["1", "2", "4", "6"],
      brief: chainBrief(
        "C=C",
        [
          ["C", 2],
          ["C", 2],
        ],
        [2],
      ),
    },
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule of methanol. How many lone pairs of electrons are there in the molecule?",
      options: ["0", "1", "2", "3"],
      brief: chainBrief(
        "CO",
        [
          ["C", 3],
          ["O", 1],
        ],
        [1],
      ),
    },
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule of hydrogen peroxide. How many covalent bonds are there in the molecule?",
      options: ["2", "3", "4", "6"],
      brief: chainBrief(
        "OO",
        [
          ["O", 1],
          ["O", 1],
        ],
        [1],
      ),
    },
    {
      subject: "chemistry",
      question:
        "The dot-and-cross diagram shows the outer electrons in a molecule of butane. How many covalent bonds are there in the molecule?",
      options: ["10", "12", "13", "14"],
      brief: chainBrief(
        "CCCC",
        [
          ["C", 3],
          ["C", 2],
          ["C", 2],
          ["C", 3],
        ],
        [1, 1, 1],
      ),
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the outer electrons in a molecule of benzene, drawn with alternating single and double bonds. How many electrons are shared between the carbon atoms of the ring?",
      options: ["6", "12", "18", "24"],
      brief: ringBrief(
        "c1ccccc1",
        [
          ["C", 1],
          ["C", 1],
          ["C", 1],
          ["C", 1],
          ["C", 1],
          ["C", 1],
        ],
        [2, 1, 2, 1, 2, 1],
      ),
    },
  ],
  random(r) {
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    if (r() < 0.12) {
      // Rings of six: benzene, pyridine; cyclohexane's two hydrogens a corner are refused.
      const RINGS: [string, [string, number][], number[]][] = [
        ["c1ccccc1", Array.from({ length: 6 }, () => ["C", 1]), [2, 1, 2, 1, 2, 1]],
        [
          "c1ccncc1",
          [
            ["C", 1],
            ["C", 1],
            ["C", 1],
            ["N", 0],
            ["C", 1],
            ["C", 1],
          ],
          [2, 1, 2, 1, 2, 1],
        ],
        ["C1CCCCC1", Array.from({ length: 6 }, () => ["C", 2]), [1, 1, 1, 1, 1, 1]],
      ];
      const [smiles, ring, orders] = pick(RINGS);
      const brief = ringBrief(smiles, ring, orders);
      if (r() < 0.25) pick(brief.bonds).order = 1 + Math.floor(r() * 3);
      return brief;
    }
    if (r() < 0.4) {
      const ROWS: [string, [string, number][], number[]][] = [
        [
          "CC",
          [
            ["C", 3],
            ["C", 3],
          ],
          [1],
        ],
        [
          "C=C",
          [
            ["C", 2],
            ["C", 2],
          ],
          [2],
        ],
        [
          "C#C",
          [
            ["C", 1],
            ["C", 1],
          ],
          [3],
        ],
        [
          "CO",
          [
            ["C", 3],
            ["O", 1],
          ],
          [1],
        ],
        [
          "CN",
          [
            ["C", 3],
            ["N", 2],
          ],
          [1],
        ],
        [
          "CCl",
          [
            ["C", 3],
            ["Cl", 0],
          ],
          [1],
        ],
        [
          "OO",
          [
            ["O", 1],
            ["O", 1],
          ],
          [1],
        ],
        [
          "NN",
          [
            ["N", 2],
            ["N", 2],
          ],
          [1],
        ],
        [
          "N=N",
          [
            ["N", 1],
            ["N", 1],
          ],
          [2],
        ],
        [
          "CCC",
          [
            ["C", 3],
            ["C", 2],
            ["C", 3],
          ],
          [1, 1],
        ],
        [
          "CCO",
          [
            ["C", 3],
            ["C", 2],
            ["O", 1],
          ],
          [1, 1],
        ],
        [
          "COC",
          [
            ["C", 3],
            ["O", 0],
            ["C", 3],
          ],
          [1, 1],
        ],
        [
          "CC=C",
          [
            ["C", 3],
            ["C", 1],
            ["C", 2],
          ],
          [1, 2],
        ],
        [
          "CCCC",
          [
            ["C", 3],
            ["C", 2],
            ["C", 2],
            ["C", 3],
          ],
          [1, 1, 1],
        ],
      ];
      const [smiles, heavy, links] = pick(ROWS);
      const brief = chainBrief(smiles, heavy, links) as DotCrossBrief & { letter: unknown };
      if (r() < 0.1) brief.letter = "X";
      // A slip: a bond order wrong, so some shell no longer holds eight.
      if (r() < 0.25) pick(brief.bonds).order = 1 + Math.floor(r() * 3);
      return brief;
    }
    const MOLECULES: [string, [string, number][]][] = [
      ["H", [["H", 1]]],
      ["Cl", [["Cl", 1]]],
      ["O", [["O", 2]]],
      ["N", [["N", 3]]],
      ["H", [["Cl", 1]]],
      ["F", [["F", 1]]],
      ["Br", [["H", 1]]],
      [
        "O",
        [
          ["H", 1],
          ["H", 1],
        ],
      ],
      [
        "S",
        [
          ["H", 1],
          ["H", 1],
        ],
      ],
      [
        "N",
        [
          ["H", 1],
          ["H", 1],
          ["H", 1],
        ],
      ],
      [
        "P",
        [
          ["Cl", 1],
          ["Cl", 1],
          ["Cl", 1],
        ],
      ],
      [
        "C",
        [
          ["H", 1],
          ["H", 1],
          ["H", 1],
          ["H", 1],
        ],
      ],
      [
        "Si",
        [
          ["H", 1],
          ["H", 1],
          ["H", 1],
          ["H", 1],
        ],
      ],
      [
        "C",
        [
          ["O", 2],
          ["O", 2],
        ],
      ],
      [
        "C",
        [
          ["H", 1],
          ["N", 3],
        ],
      ],
      [
        "C",
        [
          ["H", 1],
          ["H", 1],
          ["H", 1],
          ["Cl", 1],
        ],
      ],
      [
        "C",
        [
          ["Cl", 1],
          ["Cl", 1],
          ["Cl", 1],
          ["Cl", 1],
        ],
      ],
      [
        "O",
        [
          ["F", 1],
          ["F", 1],
        ],
      ],
    ];
    const [centre, around] = pick(MOLECULES);
    const brief = {
      kind: "dot-and-cross",
      centre,
      around: around.map(([symbol, bonds]) => ({ symbol, bonds })),
      letter: r() < 0.2 ? "X" : null,
    };
    // A writer's slip: a bond order wrong, so some shell no longer holds eight.
    if (r() < 0.25) brief.around[Math.floor(r() * around.length)].bonds = 1 + Math.floor(r() * 3);
    return brief;
  },
};
