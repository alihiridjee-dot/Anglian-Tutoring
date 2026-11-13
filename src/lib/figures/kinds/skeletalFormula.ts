/**
 * A skeletal formula: a carbon at every corner and line end, every other atom
 * written with its hydrogens, a benzene ring with its circle, a wedge where a
 * bond comes out of the page or goes into it. The writer gives the molecule
 * as SMILES; the server lays it out (lib/structures) into the atoms, bonds
 * and rings this brief holds, so nothing here needs the chemistry library and
 * the drawing is held to the brief like any other figure's. Each atom's
 * bonds and hydrogens add up to its valency and the atoms join into one
 * molecule, so a brief no chemist would draw is refused.
 */
import { CANVAS_WIDTH, TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { and, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type SkeletalBrief = {
  kind: "skeletal-formula";
  /** The molecule as SMILES, as the writer gave it. */
  smiles: string;
  /** Every atom but hydrogen: its symbol, where it is drawn (canvas units, from the drawing's top left), its hydrogens and its charge. */
  atoms: { symbol: string; at: [number, number]; h: number; charge: number }[];
  /** Each bond: the indexes of its two atoms, its order, and a wedge from the first atom if it has one. */
  bonds: { atoms: [number, number]; order: number; wedge: "up" | "down" | null }[];
  /** Each benzene ring's six atoms in order round the ring: drawn with a circle. */
  rings: number[][];
};

/** The bonds (and hydrogens) each element makes when it carries no charge. */
const VALENCY: Record<string, number[]> = {
  C: [4],
  N: [3],
  O: [2],
  S: [2, 4, 6],
  P: [3, 5],
  F: [1],
  Cl: [1],
  Br: [1],
  I: [1],
};
/** With a charge: a carbon loses a bond either way; the rest gain one when positive and lose one when negative. */
const valencies = (symbol: string, charge: number) =>
  VALENCY[symbol].map((v) => (symbol === "C" ? v - Math.abs(charge) : v + charge));

const SIZE = TEXT_SIZE["qf-text"]!;
/** The room kept between the atoms and the canvas edge: a label's width. */
export const SKELETAL_PAD = 34;
export const SKELETAL_MAX_HEIGHT = 480;
const MAX_WIDTH = CANVAS_WIDTH - 2 * SKELETAL_PAD;
const MAX_ATOMS_HEIGHT = SKELETAL_MAX_HEIGHT - 2 * SKELETAL_PAD;
const SMALL = "₀₁₂₃₄₅₆₇₈₉";
const hydrogens = (h: number) => (h ? `H${h > 1 ? SMALL[h] : ""}` : "");
const chargeOf = (q: number) =>
  q === 0 ? "" : `${Math.abs(q) > 1 ? "⁰¹²"[Math.abs(q)] : ""}${q > 0 ? "⁺" : "⁻"}`;

type Text = { text: string; x: number; y: number; anchor: "start" | "middle" | "end" };
type Box = [number, number, number, number];

/**
 * Every position in the drawing, from the brief alone: the canvas height,
 * each atom's place, each written atom's text, each bond's lines or wedge,
 * each ring's circle. The drawer draws this and the checker holds the
 * drawing to it.
 */
function layout(b: SkeletalBrief) {
  const xs = b.atoms.map((a) => a.at[0]);
  const ys = b.atoms.map((a) => a.at[1]);
  const [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  const H = Math.min(
    SKELETAL_MAX_HEIGHT,
    Math.max(200, Math.ceil((h + 2 * SKELETAL_PAD) / 20) * 20),
  );
  const at: Pt[] = b.atoms.map((a) => [
    CANVAS_WIDTH / 2 + a.at[0] - Math.min(...xs) - w / 2,
    H / 2 + a.at[1] - Math.min(...ys) - h / 2,
  ]);
  const near: number[][] = b.atoms.map(() => []);
  for (const bond of b.bonds) {
    near[bond.atoms[0]].push(bond.atoms[1]);
    near[bond.atoms[1]].push(bond.atoms[0]);
  }

  // Every atom that is not a carbon in a chain is written out, and its
  // letters' boxes kept so each bond stops short of them.
  const texts: Text[] = [];
  const boxes: Box[][] = b.atoms.map(() => []);
  const write = (i: number, x: number, anchor: Text["anchor"], words: string, dy = 0) => {
    const y = at[i][1] + dy;
    const width = textWidth(words, SIZE);
    const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    boxes[i].push([left, y - 9, left + width, y + 10]);
    texts.push({ text: words, x, y: y + 5.5, anchor });
  };
  b.atoms.forEach((a, i) => {
    const charge = chargeOf(a.charge);
    if (a.symbol === "C" && near[i].length > 0 && !charge) return;
    const hs = hydrogens(a.h);
    const x = at[i][0];
    if (!hs) return write(i, x, "middle", `${a.symbol}${charge}`);
    // The hydrogens go where the bonds leave most room: right, left, below or above.
    const angles = near[i].map((j) => Math.atan2(at[j][1] - at[i][1], at[j][0] - at[i][0]));
    const room = (side: number) =>
      Math.min(
        Math.PI,
        ...angles.map((v) => Math.abs(Math.atan2(Math.sin(v - side), Math.cos(v - side)))),
      );
    const sides = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
    const side = sides.reduce((best, s) => (room(s) > room(best) + 0.01 ? s : best));
    const half = textWidth(a.symbol, SIZE) / 2;
    if (side === 0) write(i, x - half, "start", `${a.symbol}${hs}${charge}`);
    else if (side === Math.PI) write(i, x + half, "end", `${charge}${hs}${a.symbol}`);
    else {
      write(i, x, "middle", `${a.symbol}${charge}`);
      write(i, x, "middle", hs, side > 0 ? 21 : -21);
    }
  });
  /** Where a bond leaving atom `i` along (ux, uy) is clear of that atom's letters. */
  const clearOf = (i: number, ux: number, uy: number): Pt => {
    let [x, y] = at[i];
    const inside = () =>
      boxes[i].some(([l, t, r, bottom]) => x > l - 3 && x < r + 3 && y > t - 3 && y < bottom + 3);
    for (let step = 0; step < 60 && inside(); step++) [x, y] = [x + ux, y + uy];
    return [x, y];
  };

  // A bond round a benzene ring is one line: the circle stands for the rest.
  const inRing = new Set(
    b.rings.flatMap((ring) =>
      ring.map((i, k) => [i, ring[(k + 1) % ring.length]].sort((x, y) => x - y).join()),
    ),
  );
  const lines: [Pt, Pt][] = [];
  const wedges: Pt[][] = [];
  for (const bond of b.bonds) {
    const [i, j] = bond.atoms;
    const length = Math.hypot(at[j][0] - at[i][0], at[j][1] - at[i][1]);
    const [ux, uy] = [(at[j][0] - at[i][0]) / length, (at[j][1] - at[i][1]) / length];
    const [x1, y1] = clearOf(i, ux, uy);
    const [x2, y2] = clearOf(j, -ux, -uy);
    const across = (o: number): [Pt, Pt] => [
      [x1 - uy * o, y1 + ux * o],
      [x2 - uy * o, y2 + ux * o],
    ];
    if (bond.wedge === "up")
      // A solid wedge: out of the page, narrow at the first atom.
      wedges.push([
        [x1, y1],
        [x2 - uy * 4.5, y2 + ux * 4.5],
        [x2 + uy * 4.5, y2 - ux * 4.5],
      ]);
    else if (bond.wedge === "down") {
      // A hashed wedge: into the page.
      const steps = Math.max(4, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
      for (let s = 1; s <= steps; s++) {
        const [px, py] = [x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps];
        const half = (4.5 * s) / steps;
        lines.push([
          [px - uy * half, py + ux * half],
          [px + uy * half, py - ux * half],
        ]);
      }
    } else {
      const order = inRing.has([...bond.atoms].sort((x, y) => x - y).join()) ? 1 : bond.order;
      if (order === 2) lines.push(across(-2.8), across(2.8));
      else if (order === 3) lines.push(across(-4.6), across(0), across(4.6));
      else lines.push(across(0));
    }
  }
  const circles = b.rings.map((ring) => {
    const centre: Pt = [0, 1].map(
      (k) => ring.reduce((s, i) => s + at[i][k], 0) / ring.length,
    ) as Pt;
    return { centre, r: Math.hypot(at[ring[0]][0] - centre[0], at[ring[0]][1] - centre[1]) * 0.6 };
  });
  return { H, at, texts, lines, wedges, circles };
}

/** Two segments the same, either way round. */
const same = (a: [Pt, Pt], b: [Pt, Pt], near: (x: number, y: number) => boolean) =>
  (near(a[0][0], b[0][0]) &&
    near(a[0][1], b[0][1]) &&
    near(a[1][0], b[1][0]) &&
    near(a[1][1], b[1][1])) ||
  (near(a[0][0], b[1][0]) &&
    near(a[0][1], b[1][1]) &&
    near(a[1][0], b[0][0]) &&
    near(a[1][1], b[0][1]));

const whole = (v: unknown, min: number, max: number) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

export const skeletalFormula: FigureKind<SkeletalBrief> = {
  kind: "skeletal-formula",
  name: "the skeletal formula of an organic molecule (A level only: a GCSE question draws a displayed formula)",
  guide:
    'smiles: the molecule as SMILES, "CC(=O)Nc1ccc(O)cc1": one molecule of at most 40 atoms other than hydrogen, made of C, H, N, O, S, P, F, Cl, Br and I only. Write a charge the molecule carries ("[NH3+]", "[O-]"), the E or Z form of a double bond with / and \\ when the question turns on it, and @ or @@ at a chiral centre only when the question is about optical isomers. Give smiles and nothing else: the website lays the molecule out and draws it, a carbon at every corner and line end, every other atom written with its hydrogens, and a benzene ring with its circle. Never write a SMILES string in the question, an option or the mark scheme: a student is shown the drawing, and a molecule that needs no drawing is written as a name or a structural formula.',
  read(b, fits) {
    if (typeof b.smiles !== "string" || !b.smiles.trim() || b.smiles.length > 300)
      return { problem: "needs the molecule as a SMILES string" };
    const atoms = b.atoms as { symbol: unknown; at: unknown; h: unknown; charge: unknown }[];
    if (!Array.isArray(atoms))
      return {
        problem: "could not be laid out from its SMILES",
      };
    if (atoms.length < 1 || atoms.length > 40)
      return { problem: "needs 1 to 40 atoms other than hydrogen" };
    const read: SkeletalBrief = {
      kind: "skeletal-formula",
      smiles: b.smiles.trim(),
      atoms: [],
      bonds: [],
      rings: [],
    };
    for (const a of atoms) {
      if (typeof a?.symbol !== "string" || !Object.hasOwn(VALENCY, a.symbol))
        return {
          problem: `has an atom "${String(a?.symbol)}" that is not C, N, O, S, P, F, Cl, Br or I`,
        };
      const at = a.at as unknown[];
      if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => Number.isFinite(v)))
        return { problem: "needs each atom's place as [x, y]" };
      if (!whole(a.h, 0, 4) || !whole(a.charge, -2, 2))
        return { problem: "needs each atom's hydrogens (0 to 4) and charge (−2 to 2)" };
      read.atoms.push({
        symbol: a.symbol,
        at: [at[0] as number, at[1] as number],
        h: a.h as number,
        charge: a.charge as number,
      });
    }
    // The drawing starts at its own top left, wherever the layout counted from.
    const [x0, y0] = [0, 1].map((k) => Math.min(...read.atoms.map((a) => a.at[k])));
    for (const a of read.atoms)
      a.at = [Number((a.at[0] - x0).toFixed(2)), Number((a.at[1] - y0).toFixed(2))];
    if (Math.max(...read.atoms.map((a) => a.at[0])) > MAX_WIDTH)
      return { problem: "is wider than the canvas" };
    if (Math.max(...read.atoms.map((a) => a.at[1])) > MAX_ATOMS_HEIGHT)
      return { problem: "is taller than the canvas" };
    const n = read.atoms.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (
          Math.hypot(
            read.atoms[i].at[0] - read.atoms[j].at[0],
            read.atoms[i].at[1] - read.atoms[j].at[1],
          ) < 8
        )
          return { problem: "has two atoms drawn in one place" };

    const bonds = b.bonds as { atoms: unknown; order: unknown; wedge?: unknown }[];
    if (!Array.isArray(bonds) || bonds.length > 50) return { problem: "needs at most 50 bonds" };
    const pairs = new Set<string>();
    for (const bond of bonds) {
      const ij = bond?.atoms as unknown[];
      if (
        !Array.isArray(ij) ||
        ij.length !== 2 ||
        !ij.every((i) => whole(i, 0, n - 1)) ||
        ij[0] === ij[1]
      )
        return { problem: "has a bond that doesn't join two of its atoms by their indexes" };
      const [i, j] = ij as [number, number];
      if (![1, 2, 3].includes(bond.order as number))
        return { problem: "has a bond whose order is not 1, 2 or 3" };
      const wedge = bond.wedge ?? null;
      if (wedge !== null && wedge !== "up" && wedge !== "down")
        return { problem: 'has a wedge that is not "up" or "down"' };
      if (wedge && bond.order !== 1) return { problem: "has a wedge on a double or triple bond" };
      const length = Math.hypot(
        read.atoms[i].at[0] - read.atoms[j].at[0],
        read.atoms[i].at[1] - read.atoms[j].at[1],
      );
      if (length < 12 || length > 60)
        return { problem: "has a bond far shorter or longer than the rest could be drawn" };
      const key = [Math.min(i, j), Math.max(i, j)].join();
      if (pairs.has(key)) return { problem: "has the same bond twice" };
      pairs.add(key);
      read.bonds.push({ atoms: [i, j], order: bond.order as number, wedge });
    }

    // The chemistry: every atom makes its number of bonds, and they make one molecule.
    const made = read.atoms.map((a) => a.h);
    for (const bond of read.bonds) for (const i of bond.atoms) made[i] += bond.order;
    for (let i = 0; i < n; i++) {
      const { symbol, charge } = read.atoms[i];
      if (!valencies(symbol, charge).includes(made[i]))
        return {
          problem: `has a ${symbol}${chargeOf(charge)} making ${made[i]} bond${made[i] === 1 ? "" : "s"}, counting its hydrogens, not ${valencies(symbol, charge).join(" or ")}`,
        };
    }
    const reached = new Set([0]);
    for (let grew = true; grew;) {
      grew = false;
      for (const {
        atoms: [i, j],
      } of read.bonds)
        if (reached.has(i) !== reached.has(j)) {
          reached.add(i).add(j);
          grew = true;
        }
    }
    if (reached.size !== n) return { problem: "has atoms that aren't joined to the rest" };

    const rings = (b.rings ?? []) as unknown[];
    if (!Array.isArray(rings) || rings.length > 6) return { problem: "needs at most 6 rings" };
    for (const ring of rings) {
      const r = ring as unknown[];
      if (
        !Array.isArray(r) ||
        r.length !== 6 ||
        new Set(r).size !== 6 ||
        !r.every((i) => whole(i, 0, n - 1) && read.atoms[i as number].symbol === "C") ||
        !r.every((i, k) =>
          pairs.has([i, r[(k + 1) % 6]].sort((x, y) => (x as number) - (y as number)).join()),
        )
      )
        return { problem: "has a ring that is not six carbons bonded in a circle" };
      read.rings.push(r as number[]);
    }
    // Whether a letter sits clear of every bond depends on the whole drawing: it decides.
    if (fits(read).length)
      return { problem: "has letters and bonds too close together to draw clearly" };
    return { brief: read };
  },
  draw(b) {
    const L = layout(b);
    const body: string[] = [];
    for (const [p, q] of L.lines) body.push(line("qf-line", ...p, ...q));
    for (const pts of L.wedges)
      body.push(
        `<polygon class="qf-ink" points="${pts.map(([x, y]) => `${num(x)},${num(y)}`).join(" ")}"/>`,
      );
    for (const c of L.circles)
      body.push(
        `<circle class="qf-line" cx="${num(c.centre[0])}" cy="${num(c.centre[1])}" r="${num(c.r)}"/>`,
      );
    for (const t of L.texts) body.push(text("qf-text", t.x, t.y, t.anchor, [t.text]));
    const written = [...new Set(L.texts.map((t) => t.text))];
    const wedged = b.bonds.some((x) => x.wedge);
    return {
      svg: svgOf(L.H, body),
      // What is drawn, never what it is: the compound's name or formula may be the question.
      alt: `A skeletal formula of a molecule: lines for the bonds between its carbon atoms${b.rings.length ? `, ${b.rings.length === 1 ? "a hexagon with a circle in it" : `${b.rings.length} hexagons with circles in them`}` : ""}${written.length ? `, and ${and(written)} written where ${written.length === 1 && L.texts.length === 1 ? "it joins" : "they join"}` : ""}.${wedged ? " Wedges show bonds coming out of the page or going into it." : ""}`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    for (const [p, q] of L.lines)
      if (!t.hasLine(p, q)) out.push(`A bond's line from ${t.at(p)} to ${t.at(q)} is not drawn`);
    const edges = L.wedges.flatMap((pts) => pts.map((p, k) => [p, pts[(k + 1) % 3]] as [Pt, Pt]));
    for (const e of edges)
      if (!d.segments.some((s) => s.cls === "qf-ink" && same(e, s.seg, t.near)))
        out.push(`A wedge's edge from ${t.at(e[0])} to ${t.at(e[1])} is not drawn`);
    const circles = d.shapes.filter((s) => s.name === "circle");
    for (const c of L.circles)
      if (
        !circles.some(
          (s) =>
            s.cls === "qf-line" &&
            t.near(s.at[0], c.centre[0]) &&
            t.near(s.at[1], c.centre[1]) &&
            t.near(s.r, c.r),
        )
      )
        out.push(`The circle in the ring at ${t.at(c.centre)} is not drawn`);
    if (circles.length !== L.circles.length)
      out.push(
        `The formula has ${circles.length} circles; the brief has ${L.circles.length} rings`,
      );
    for (const x of L.texts)
      if (!t.writtenAt(x.text, x.x, x.y, x.anchor, "qf-text"))
        out.push(`${x.text} is not written at ${t.at([x.x, x.y])}`);

    // Nothing the brief doesn't name: another line could be a bond it hasn't got.
    for (const s of d.segments)
      if (
        !(s.cls === "qf-line" && L.lines.some((w) => same(w, s.seg, t.near))) &&
        !(s.cls === "qf-ink" && edges.some((w) => same(w, s.seg, t.near)))
      )
        out.push(
          `The ${s.cls} line from ${t.at(s.seg[0])} to ${t.at(s.seg[1])} is not a bond in the brief`,
        );
    if (d.segments.length !== L.lines.length + edges.length)
      out.push(
        `The formula has ${d.segments.length} lines; the brief's bonds need ${L.lines.length + edges.length}`,
      );
    for (const s of d.shapes)
      if (
        !(s.name === "line" && s.cls === "qf-line" && !s.marked) &&
        !(s.name === "polygon" && s.cls === "qf-ink") &&
        !(s.name === "circle" && s.cls === "qf-line")
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the skeletal formula`);
    const pieces = t.pieces();
    for (const p of pieces)
      if (
        !L.texts.some(
          (x) =>
            x.text === p.text &&
            p.cls === "qf-text" &&
            x.anchor === p.anchor &&
            t.near(x.x, p.x, 1) &&
            t.near(x.y, p.y, 1),
        )
      )
        out.push(`Text "${p.text}" at ${t.at([p.x, p.y])} is not an atom of the brief`);
    if (pieces.length !== L.texts.length)
      out.push(`The formula has ${pieces.length} texts; the brief has ${L.texts.length}`);
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The skeletal formula of a painkiller is shown. Which two functional groups does the molecule contain?",
      options: ["alcohol and amide", "phenol and amide", "phenol and amine", "alcohol and ketone"],
      brief: {
        kind: "skeletal-formula",
        smiles: "CC(=O)Nc1ccc(O)cc1",
        atoms: [
          { symbol: "C", at: [176.67, 0], h: 3, charge: 0 },
          { symbol: "C", at: [147.22, 17], h: 0, charge: 0 },
          { symbol: "O", at: [147.22, 51], h: 0, charge: 0 },
          { symbol: "N", at: [117.78, 0], h: 1, charge: 0 },
          { symbol: "C", at: [88.33, 17], h: 0, charge: 0 },
          { symbol: "C", at: [58.89, 0], h: 1, charge: 0 },
          { symbol: "C", at: [29.44, 17], h: 1, charge: 0 },
          { symbol: "C", at: [29.44, 51], h: 0, charge: 0 },
          { symbol: "O", at: [0, 68], h: 1, charge: 0 },
          { symbol: "C", at: [58.89, 68], h: 1, charge: 0 },
          { symbol: "C", at: [88.33, 51], h: 1, charge: 0 },
        ],
        bonds: [
          { atoms: [0, 1], order: 1, wedge: null },
          { atoms: [1, 2], order: 2, wedge: null },
          { atoms: [1, 3], order: 1, wedge: null },
          { atoms: [3, 4], order: 1, wedge: null },
          { atoms: [4, 5], order: 2, wedge: null },
          { atoms: [5, 6], order: 1, wedge: null },
          { atoms: [6, 7], order: 2, wedge: null },
          { atoms: [7, 8], order: 1, wedge: null },
          { atoms: [7, 9], order: 1, wedge: null },
          { atoms: [9, 10], order: 2, wedge: null },
          { atoms: [4, 10], order: 1, wedge: null },
        ],
        rings: [[4, 5, 6, 7, 9, 10]],
      },
    },
    {
      subject: "chemistry",
      question:
        "The skeletal formula of compound X is shown. Give the molecular formula of compound X and name the homologous series it belongs to.",
      brief: {
        kind: "skeletal-formula",
        smiles: "CCC(C)=O",
        atoms: [
          { symbol: "C", at: [88.33, 34], h: 3, charge: 0 },
          { symbol: "C", at: [58.89, 51], h: 2, charge: 0 },
          { symbol: "C", at: [29.44, 34], h: 0, charge: 0 },
          { symbol: "C", at: [29.44, 0], h: 3, charge: 0 },
          { symbol: "O", at: [0, 51], h: 0, charge: 0 },
        ],
        bonds: [
          { atoms: [0, 1], order: 1, wedge: null },
          { atoms: [1, 2], order: 1, wedge: null },
          { atoms: [2, 3], order: 1, wedge: null },
          { atoms: [2, 4], order: 2, wedge: null },
        ],
        rings: [],
      },
    },
    {
      subject: "chemistry",
      question:
        "The skeletal formula shows one optical isomer of a haloalkane. State the feature of the molecule that makes optical isomers possible.",
      brief: {
        kind: "skeletal-formula",
        smiles: "C[C@@H](Cl)CC",
        atoms: [
          { symbol: "C", at: [88.33, 0], h: 3, charge: 0 },
          { symbol: "C", at: [58.89, 17], h: 1, charge: 0 },
          { symbol: "Cl", at: [58.89, 51], h: 0, charge: 0 },
          { symbol: "C", at: [29.44, 0], h: 2, charge: 0 },
          { symbol: "C", at: [0, 17], h: 3, charge: 0 },
        ],
        bonds: [
          { atoms: [0, 1], order: 1, wedge: null },
          { atoms: [1, 2], order: 1, wedge: "up" },
          { atoms: [1, 3], order: 1, wedge: null },
          { atoms: [3, 4], order: 1, wedge: null },
        ],
        rings: [],
      },
    },
  ] as FigureKind<SkeletalBrief>["samples"],
  random(r) {
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const atoms: SkeletalBrief["atoms"] = [];
    const bonds: SkeletalBrief["bonds"] = [];
    const rings: number[][] = [];
    const add = (symbol: string, x: number, y: number) =>
      atoms.push({ symbol, at: [x, y], h: 0, charge: 0 }) - 1;
    const join = (i: number, j: number, order = 1, wedge: "up" | "down" | null = null) =>
      bonds.push({ atoms: [i, j], order, wedge });
    // A zig-zag chain, 34 units a bond, or a benzene ring with a chain on it.
    const [dx, dy] = [29.44, 17];
    let chain: number[];
    if (r() < 0.3) {
      const ring = [0, 1, 2, 3, 4, 5].map((k) =>
        add(
          "C",
          34 * Math.cos((k * Math.PI) / 3 + Math.PI / 2),
          34 * Math.sin((k * Math.PI) / 3 + Math.PI / 2),
        ),
      );
      ring.forEach((i, k) => join(i, ring[(k + 1) % 6], k % 2 ? 1 : 2));
      rings.push(ring);
      // Out from the ring's right-hand corner.
      const start = ring[4];
      const first = add("C", atoms[start].at[0] + 34, atoms[start].at[1]);
      join(start, first);
      chain = [first];
      const n = Math.floor(r() * 3);
      for (let k = 1; k <= n; k++) {
        const c = add("C", atoms[first].at[0] + k * dx, atoms[first].at[1] + (k % 2 ? -dy : 0));
        join(chain[chain.length - 1], c);
        chain.push(c);
      }
    } else {
      const n = 2 + Math.floor(r() * 6);
      chain = Array.from({ length: n }, (_, k) => add("C", k * dx, k % 2 ? 0 : dy));
      for (let k = 1; k < n; k++) join(chain[k - 1], chain[k]);
      if (n >= 3 && r() < 0.3) bonds[Math.floor(r() * (n - 1))].order = 2;
    }
    // A group on the chain's last carbon, carrying on the zig-zag.
    const last = chain[chain.length - 1];
    const [lx, ly] = atoms[last].at;
    const up = chain.length % 2 === 1;
    const group = pick(["none", "OH", "NH2", "Cl", "Br", "acid", "one", "ion"]);
    const end = (symbol: string) => add(symbol, lx + dx, ly + (up ? -dy : dy));
    if (group === "OH") join(last, end("O"), 1, r() < 0.2 ? pick(["up", "down"] as const) : null);
    else if (group === "NH2") join(last, end("N"));
    else if (group === "Cl" || group === "Br") join(last, end(group));
    else if (group === "acid" || group === "one") {
      join(last, add("O", lx, ly + (up ? 34 : -34)), 2);
      if (group === "acid") join(last, end("O"));
      else join(last, end("C"));
    } else if (group === "ion") {
      const o = end("O");
      join(last, o);
      atoms[o].charge = -1;
    }
    // Each atom's hydrogens are what its bonds leave of its valency.
    const made = atoms.map(() => 0);
    for (const bond of bonds) for (const i of bond.atoms) made[i] += bond.order;
    atoms.forEach((a, i) => (a.h = Math.max(0, valencies(a.symbol, a.charge)[0] - made[i])));
    // Some briefs a layout might get wrong: a hydrogen too many, an atom on another, a piece adrift.
    const fault = r();
    if (fault < 0.08) atoms[Math.floor(r() * atoms.length)].h += 1;
    else if (fault < 0.13) atoms[atoms.length - 1].at = [...atoms[0].at];
    else if (fault < 0.18) bonds.pop();
    return { kind: "skeletal-formula", smiles: "C", atoms, bonds, rings };
  },
};
