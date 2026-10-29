/**
 * A displayed formula: every atom of a small molecule, or of a polymer's
 * repeat unit, written as its symbol in a cell of a grid, and every bond a
 * line (two for a double bond, three for a triple) straight across to the
 * next cell. A repeat unit stands in brackets with an n, its two open bonds
 * running out through them. A letter the question asks about sits beside its
 * bond or above its atom. Each atom's bonds add up to its valency and the
 * molecule is all one piece, so a brief no chemist would draw is refused.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { and, line, polyline, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type FormulaBrief = {
  kind: "displayed-formula";
  /** Each atom's symbol and its cell [column, row], from the top left; a letter the question asks about. */
  atoms: { symbol: string; cell: [number, number]; letter?: string }[];
  /** Each bond: the indexes of the two atoms it joins, in neighbouring cells, and its order. */
  bonds: { atoms: [number, number]; order: number; letter?: string }[];
  /** A repeat unit's two atoms whose bonds run out through the brackets, left then right; null for a molecule. */
  polymer: [number, number] | null;
};

/** How many bonds each atom (or group written as one) makes. */
const VALENCY: Record<string, number> = {
  H: 1,
  C: 4,
  N: 3,
  O: 2,
  F: 1,
  Cl: 1,
  Br: 1,
  I: 1,
  "CH₃": 1,
  OH: 1,
};
const NAMES: Record<string, string> = {
  H: "hydrogen",
  C: "carbon",
  N: "nitrogen",
  O: "oxygen",
  F: "fluorine",
  Cl: "chlorine",
  Br: "bromine",
  I: "iodine",
};
const ORDER = ["", "single", "double", "triple"];
const COUNTS = ["no", "one", "two", "three", "four", "five", "six"];
/** Each line of a bond, across it from its centre line. */
const OFFSETS = [[], [0], [-3, 3], [-5, 0, 5]];

/** One cell of the grid: the room between two atoms' centres. */
const S = 50;
/** The clear gap between a symbol's letters and the end of a bond. */
const GAP = 3;
const SIZE = TEXT_SIZE["qf-text"]!;
/** Half a symbol's width, and how far its letters reach above and below its centre (as the checker measures them). */
const half = (s: string) => textWidth(s, SIZE) / 2;
const ABOVE = 0.8 * SIZE - 5.5;
const below = (s: string) => 5.5 + (/[₂₃₄]/.test(s) ? 0.25 : 0.05) * SIZE;
const MAX_COLS = 7;
const MAX_ROWS = 5;
/** A repeat unit's brackets and open bonds take a column's room each side. */
const MAX_POLYMER_COLS = 6;

/** Whether the brief has an atom in a cell. */
const hasAtom = (b: FormulaBrief, c: number, r: number) =>
  b.atoms.some((a) => a.cell[0] === c && a.cell[1] === r);
const heightOf = (rows: number) => Math.max(200, Math.ceil(((rows - 1) * S + 80) / 20) * 20);

type Text = { text: string; x: number; y: number; anchor: "start" | "middle" | "end"; cls: Cls };
type Cls = "qf-text" | "qf-strong";

/**
 * Every position in the drawing, from the brief alone: the canvas height,
 * each atom's centre, each bond's lines, a repeat unit's open bonds,
 * brackets and n, and every text with where it is written. The drawer draws
 * this and the checker holds the drawing to it.
 */
function layout(b: FormulaBrief) {
  const cols = 1 + Math.max(...b.atoms.map((a) => a.cell[0]));
  const rows = 1 + Math.max(...b.atoms.map((a) => a.cell[1]));
  const H = heightOf(rows);
  const colX = (c: number) => 180 + (c - (cols - 1) / 2) * S;
  const rowY = (r: number) => H / 2 + (r - (rows - 1) / 2) * S;
  const at: Pt[] = b.atoms.map((a) => [colX(a.cell[0]), rowY(a.cell[1])]);
  const texts: Text[] = b.atoms.map((a, i) => ({
    text: a.symbol,
    x: at[i][0],
    y: at[i][1] + 5.5,
    anchor: "middle",
    cls: "qf-text",
  }));
  const lines = b.bonds.map((bond) => {
    // First the atom on the left, or the upper one.
    const [p, q] = [...bond.atoms].sort(
      (i, j) => b.atoms[i].cell[0] - b.atoms[j].cell[0] || b.atoms[i].cell[1] - b.atoms[j].cell[1],
    );
    const [sp, sq] = [b.atoms[p].symbol, b.atoms[q].symbol];
    const across = b.atoms[p].cell[1] === b.atoms[q].cell[1];
    const out: [Pt, Pt][] = [];
    for (const o of OFFSETS[bond.order]) {
      if (across) {
        const y = at[p][1] + o;
        out.push([
          [at[p][0] + half(sp) + GAP, y],
          [at[q][0] - half(sq) - GAP, y],
        ]);
      } else {
        const x = at[p][0] + o;
        out.push([
          [x, at[p][1] + below(sp) + GAP],
          [x, at[q][1] - ABOVE - GAP],
        ]);
      }
    }
    if (bond.letter) {
      // Above a bond across the grid; right of a bond down it, beside its upper half,
      // so it stays clear of a letter above the bond along the row below.
      const wide = bond.order === 3;
      texts.push(
        across
          ? {
              text: bond.letter,
              x: (out[0][0][0] + out[0][1][0]) / 2,
              y: at[p][1] - (wide ? 9 : 7),
              anchor: "middle",
              cls: "qf-strong",
            }
          : {
              text: bond.letter,
              x: at[p][0] + (wide ? 10 : 8),
              y: at[p][1] + 26,
              anchor: "start",
              cls: "qf-strong",
            },
      );
    }
    return out;
  });
  // An atom's letter sits in the empty cell above it, or else below: beside it, it
  // could read as part of the symbol, and between bonds as a bond's letter.
  b.atoms.forEach((a, i) => {
    if (!a.letter) return;
    const up = !hasAtom(b, a.cell[0], a.cell[1] - 1);
    texts.push({
      text: a.letter,
      x: at[i][0],
      y: up ? at[i][1] - ABOVE - 4.8 : at[i][1] + below(a.symbol) + 4 + 0.8 * SIZE,
      anchor: "middle",
      cls: "qf-strong",
    });
  });
  const open: [Pt, Pt][] = [];
  const brackets: Pt[][] = [];
  if (b.polymer) {
    const [i, j] = b.polymer;
    const xL = colX(0) - 30;
    const xR = colX(cols - 1) + 30;
    const top = rowY(0) - 18;
    const bottom = rowY(rows - 1) + 18;
    open.push([
      [at[i][0] - half(b.atoms[i].symbol) - GAP, at[i][1]],
      [xL - 14, at[i][1]],
    ]);
    open.push([
      [at[j][0] + half(b.atoms[j].symbol) + GAP, at[j][1]],
      [xR + 14, at[j][1]],
    ]);
    brackets.push([
      [xL + 6, top],
      [xL, top],
      [xL, bottom],
      [xL + 6, bottom],
    ]);
    brackets.push([
      [xR - 6, top],
      [xR, top],
      [xR, bottom],
      [xR - 6, bottom],
    ]);
    texts.push({ text: "n", x: xR + 4, y: bottom + 6, anchor: "start", cls: "qf-text" });
  }
  return { H, at, lines, open, brackets, texts };
}

const isLetter = (v: unknown) => typeof v === "string" && /^[A-Z]$/.test(v.trim());
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";

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

export const displayedFormula: FigureKind<FormulaBrief> = {
  kind: "displayed-formula",
  name: "the displayed formula of a molecule or a polymer's repeat unit",
  guide:
    'atoms: 2 to 30 {symbol: H, C, N, O, F, Cl, Br or I, or a group written as one, "CH₃" or "OH"; cell: [column, row] on a grid counted from the top left, at most 7 columns (6 for a repeat unit) and 5 rows, one atom a cell}; bonds: 1 to 40, each {atoms: [i, j], the indexes (from 0) of two atoms in cells next to each other across or down, never diagonal; order: 1, 2 or 3}; every atom\'s bonds add up to its valency (H, F, Cl, Br, I, CH₃ and OH 1, O 2, N 3, C 4) and the atoms join into one molecule. polymer: null for a molecule; for a polymer\'s repeat unit [i, j], the two atoms whose bonds run out through the brackets, i in the leftmost column and j in the rightmost, on the same row (each counts that bond towards its valency); the website draws the brackets and the n. A letter the question asks about ("which bond breaks?"): a bond, or an atom with an empty cell above or below it, may carry letter: one capital letter, each different, at most 6; otherwise leave letter out.',
  read(b, fits) {
    const atoms = b.atoms as { symbol: unknown; cell: unknown; letter?: unknown }[];
    if (!Array.isArray(atoms) || atoms.length < 2 || atoms.length > 30)
      return { problem: "needs 2 to 30 atoms" };
    const read: FormulaBrief = { kind: "displayed-formula", atoms: [], bonds: [], polymer: null };
    for (const a of atoms) {
      const symbol =
        typeof a?.symbol === "string"
          ? a.symbol.trim().replace(/[0-9]/g, (d) => SUBSCRIPTS[Number(d)])
          : "";
      if (!Object.hasOwn(VALENCY, symbol))
        return {
          problem: `has an atom "${String(a?.symbol)}" that is not H, C, N, O, F, Cl, Br, I, CH₃ or OH`,
        };
      const cell = a.cell as unknown[];
      if (
        !Array.isArray(cell) ||
        cell.length !== 2 ||
        !cell.every((v) => Number.isInteger(v) && (v as number) >= 0)
      )
        return { problem: "needs each atom's cell as [column, row], two whole numbers from 0" };
      if (a.letter !== undefined && a.letter !== null && a.letter !== "" && !isLetter(a.letter))
        return { problem: "has a letter that is not one capital letter" };
      read.atoms.push({
        symbol,
        cell: [cell[0] as number, cell[1] as number],
        ...(isLetter(a.letter) ? { letter: (a.letter as string).trim() } : {}),
      });
    }
    // The grid starts at its first used column and row, wherever the writer counted from.
    const c0 = Math.min(...read.atoms.map((a) => a.cell[0]));
    const r0 = Math.min(...read.atoms.map((a) => a.cell[1]));
    for (const a of read.atoms) a.cell = [a.cell[0] - c0, a.cell[1] - r0];
    const cols = 1 + Math.max(...read.atoms.map((a) => a.cell[0]));
    const rows = 1 + Math.max(...read.atoms.map((a) => a.cell[1]));
    if (rows > MAX_ROWS) return { problem: `has more than ${MAX_ROWS} rows` };
    if (new Set(read.atoms.map((a) => a.cell.join())).size !== read.atoms.length)
      return { problem: "has two atoms in one cell" };

    const bonds = b.bonds as { atoms: unknown; order: unknown; letter?: unknown }[];
    if (!Array.isArray(bonds) || bonds.length < 1 || bonds.length > 40)
      return { problem: "needs 1 to 40 bonds" };
    const n = read.atoms.length;
    const pairs = new Set<string>();
    for (const bond of bonds) {
      const ij = bond?.atoms as unknown[];
      if (
        !Array.isArray(ij) ||
        ij.length !== 2 ||
        !ij.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n) ||
        ij[0] === ij[1]
      )
        return { problem: "has a bond that doesn't join two of its atoms by their indexes" };
      const [i, j] = ij as [number, number];
      if (![1, 2, 3].includes(bond.order as number))
        return { problem: "has a bond whose order is not 1, 2 or 3" };
      const [p, q] = [read.atoms[i].cell, read.atoms[j].cell];
      if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) !== 1)
        return {
          problem: `has a bond between cells [${p.join(", ")}] and [${q.join(", ")}], which are not next to each other across or down`,
        };
      const key = [Math.min(i, j), Math.max(i, j)].join();
      if (pairs.has(key)) return { problem: "has the same bond twice" };
      pairs.add(key);
      if (
        bond.letter !== undefined &&
        bond.letter !== null &&
        bond.letter !== "" &&
        !isLetter(bond.letter)
      )
        return { problem: "has a letter that is not one capital letter" };
      read.bonds.push({
        atoms: [i, j],
        order: bond.order as number,
        ...(isLetter(bond.letter) ? { letter: (bond.letter as string).trim() } : {}),
      });
    }

    if (b.polymer !== null && b.polymer !== undefined) {
      const ends = b.polymer as unknown[];
      if (
        !Array.isArray(ends) ||
        ends.length !== 2 ||
        !ends.every((i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n) ||
        ends[0] === ends[1]
      )
        return { problem: "polymer must be null, or [i, j]: two of its atoms' indexes" };
      const [i, j] = ends as [number, number];
      if (cols > MAX_POLYMER_COLS)
        return { problem: `has a repeat unit wider than ${MAX_POLYMER_COLS} columns` };
      const [p, q] = [read.atoms[i].cell, read.atoms[j].cell];
      if (p[0] !== 0 || q[0] !== cols - 1 || p[1] !== q[1])
        return {
          problem:
            "has a repeat unit whose open bonds don't leave from its leftmost and rightmost columns on one row",
        };
      read.polymer = [i, j];
    } else if (cols > MAX_COLS) return { problem: `has more than ${MAX_COLS} columns` };

    // The chemistry: every atom makes exactly its number of bonds, and they make one molecule.
    const made = read.atoms.map(() => 0);
    for (const bond of read.bonds) for (const i of bond.atoms) made[i] += bond.order;
    if (read.polymer) for (const i of read.polymer) made[i] += 1;
    for (let i = 0; i < n; i++) {
      const { symbol, cell } = read.atoms[i];
      if (made[i] !== VALENCY[symbol])
        return {
          problem: `has the ${symbol} in cell [${cell.join(", ")}] making ${made[i]} bond${made[i] === 1 ? "" : "s"}, not ${VALENCY[symbol]}`,
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

    for (const a of read.atoms)
      if (
        a.letter &&
        hasAtom(read, a.cell[0], a.cell[1] - 1) &&
        hasAtom(read, a.cell[0], a.cell[1] + 1)
      )
        return {
          problem: `has a letter on the ${a.symbol} in cell [${a.cell.join(", ")}], which needs an empty cell above or below it`,
        };
    const letters = [...read.atoms, ...read.bonds].flatMap((x) => (x.letter ? [x.letter] : []));
    if (letters.length > 6) return { problem: "has more than 6 letters" };
    if (new Set(letters).size !== letters.length) return { problem: "uses a letter twice" };
    // Where letters go depends on what else is lettered nearby: the drawing decides.
    if (letters.length && fits(read).length)
      return { problem: "has letters too close together to write beside their bonds and atoms" };
    return { brief: read };
  },
  draw(b) {
    const L = layout(b);
    const body: string[] = [];
    for (const lines of L.lines) for (const [p, q] of lines) body.push(line("qf-line", ...p, ...q));
    for (const [p, q] of L.open) body.push(line("qf-line", ...p, ...q));
    for (const pts of L.brackets) body.push(polyline("qf-line", pts));
    for (const t of L.texts) body.push(text(t.cls, t.x, t.y, t.anchor, [t.text]));
    const symbols = [...new Set(b.atoms.map((a) => a.symbol))];
    const elements = symbols.filter((s) => NAMES[s]).map((s) => NAMES[s]);
    const groups = symbols.filter((s) => !NAMES[s]).map((s) => `${s} groups`);
    const made = [`${and(elements)} atoms`, ...(groups.length ? [and(groups)] : [])];
    const orders = [...new Set(b.bonds.map((x) => x.order))].sort().map((o) => ORDER[o]);
    const lettered = [
      ...b.bonds.flatMap((x) => (x.letter ? [x.letter] : [])),
      ...b.atoms.flatMap((x) => (x.letter ? [x.letter] : [])),
    ].sort();
    const onBonds = b.bonds.filter((x) => x.letter).length;
    const onAtoms = b.atoms.filter((x) => x.letter).length;
    const marks = [
      ...(onBonds ? [onBonds === 1 ? "one bond" : `${COUNTS[onBonds]} bonds`] : []),
      ...(onAtoms ? [onAtoms === 1 ? "one atom" : `${COUNTS[onAtoms]} atoms`] : []),
    ];
    return {
      svg: svgOf(L.H, body),
      // What is drawn, never what it is: the compound's name or formula may be the question.
      alt: `${b.polymer ? "The displayed formula of a polymer's repeat unit, in brackets with n, its two end bonds running out through the brackets," : "A displayed formula of a molecule,"} made of ${and(made)} joined by ${and(orders)} bonds.${lettered.length ? ` ${lettered.length === 1 ? "The letter" : "Letters"} ${and(lettered)} ${lettered.length === 1 ? "marks" : "mark"} ${and(marks)}.` : ""}`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    const where = (i: number) => `${b.atoms[i].symbol} in cell [${b.atoms[i].cell.join(", ")}]`;
    b.atoms.forEach((a, i) => {
      if (!t.writtenAt(a.symbol, L.at[i][0], L.at[i][1] + 5.5, "middle", "qf-text"))
        out.push(`The ${where(i)} is not written at ${t.at(L.at[i])}`);
    });
    b.bonds.forEach((bond, k) => {
      const lines = L.lines[k];
      if (!lines.every(([p, q]) => t.hasLine(p, q)))
        out.push(
          `The ${ORDER[bond.order]} bond between the ${where(bond.atoms[0])} and the ${where(bond.atoms[1])} is not drawn as ${lines.length === 1 ? "one line" : `${lines.length} lines`} between them`,
        );
    });
    if (b.polymer) {
      b.polymer.forEach((i, k) => {
        const [p, q] = L.open[k];
        if (!t.hasLine(p, q))
          out.push(
            `The open bond from the ${where(i)} does not run out through the ${k ? "right" : "left"} bracket to ${t.at(q)}`,
          );
      });
      L.brackets.forEach((pts, k) => {
        if (!pts.every((p, m) => m === 0 || t.hasLine(pts[m - 1], p)))
          out.push(
            `The ${k ? "right" : "left"} bracket is not drawn from ${t.at(pts[1])} to ${t.at(pts[2])}`,
          );
      });
    }
    for (const x of L.texts.slice(b.atoms.length))
      if (!t.writtenAt(x.text, x.x, x.y, x.anchor, x.cls))
        out.push(
          x.text === "n" && b.polymer
            ? "The n is not written beside the right bracket's foot"
            : `The letter ${x.text} is not written where its ${b.atoms.some((a) => a.letter === x.text) ? "atom" : "bond"}'s letter goes, ${t.at([x.x, x.y])}`,
        );

    // Nothing the brief doesn't name: another line could be a bond it hasn't got.
    const wanted: [Pt, Pt][] = [
      ...L.lines.flat(),
      ...L.open,
      ...L.brackets.flatMap((pts) => pts.slice(1).map((p, m) => [pts[m], p] as [Pt, Pt])),
    ];
    for (const s of d.segments)
      if (s.cls !== "qf-line" || !wanted.some((w) => same(w, s.seg, t.near)))
        out.push(
          `The ${s.cls} line from ${t.at(s.seg[0])} to ${t.at(s.seg[1])} is not a bond in the brief`,
        );
    if (d.segments.length !== wanted.length)
      out.push(
        `The formula has ${d.segments.length} lines; the brief's bonds need ${wanted.length}`,
      );
    for (const s of d.shapes)
      if (
        !(s.name === "line" && s.cls === "qf-line" && !s.marked) &&
        !(s.name === "polyline" && s.cls === "qf-line" && b.polymer)
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the displayed formula`);
    const pieces = t.pieces();
    for (const p of pieces)
      if (
        !L.texts.some(
          (x) =>
            x.text === p.text &&
            x.cls === p.cls &&
            x.anchor === p.anchor &&
            t.near(x.x, p.x, 1) &&
            t.near(x.y, p.y, 1),
        )
      )
        out.push(`Text "${p.text}" at ${t.at([p.x, p.y])} is not an atom, a letter or the n`);
    if (pieces.length !== L.texts.length)
      out.push(`The formula has ${pieces.length} texts; the brief has ${L.texts.length}`);
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The displayed formula of ethanol is shown. Which bond, A, B, C or D, is the bond within the –OH functional group of alcohols?",
      options: ["A", "B", "C", "D"],
      brief: {
        kind: "displayed-formula",
        atoms: [
          { symbol: "H", cell: [0, 1] },
          { symbol: "C", cell: [1, 1] },
          { symbol: "C", cell: [2, 1] },
          { symbol: "O", cell: [3, 1] },
          { symbol: "H", cell: [4, 1] },
          { symbol: "H", cell: [1, 0] },
          { symbol: "H", cell: [1, 2] },
          { symbol: "H", cell: [2, 0] },
          { symbol: "H", cell: [2, 2] },
        ],
        bonds: [
          { atoms: [0, 1], order: 1 },
          { atoms: [1, 2], order: 1, letter: "B" },
          { atoms: [2, 3], order: 1, letter: "C" },
          { atoms: [3, 4], order: 1, letter: "D" },
          { atoms: [1, 5], order: 1, letter: "A" },
          { atoms: [1, 6], order: 1 },
          { atoms: [2, 7], order: 1 },
          { atoms: [2, 8], order: 1 },
        ],
        polymer: null,
      },
    },
    {
      subject: "chemistry",
      question:
        "The displayed formula of a compound is shown. Name the homologous series the compound belongs to, and give the compound's name.",
      brief: {
        kind: "displayed-formula",
        atoms: [
          { symbol: "H", cell: [0, 1] },
          { symbol: "C", cell: [1, 1] },
          { symbol: "C", cell: [2, 1] },
          { symbol: "C", cell: [3, 1] },
          { symbol: "O", cell: [4, 1] },
          { symbol: "H", cell: [5, 1] },
          { symbol: "H", cell: [1, 0] },
          { symbol: "H", cell: [1, 2] },
          { symbol: "H", cell: [2, 0] },
          { symbol: "H", cell: [2, 2] },
          { symbol: "O", cell: [3, 0] },
        ],
        bonds: [
          { atoms: [0, 1], order: 1 },
          { atoms: [1, 2], order: 1 },
          { atoms: [2, 3], order: 1 },
          { atoms: [3, 4], order: 1 },
          { atoms: [4, 5], order: 1 },
          { atoms: [1, 6], order: 1 },
          { atoms: [1, 7], order: 1 },
          { atoms: [2, 8], order: 1 },
          { atoms: [2, 9], order: 1 },
          { atoms: [3, 10], order: 2 },
        ],
        polymer: null,
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the repeat unit of an addition polymer. Name the monomer used to make this polymer.",
      brief: {
        kind: "displayed-formula",
        atoms: [
          { symbol: "C", cell: [0, 1] },
          { symbol: "C", cell: [1, 1] },
          { symbol: "H", cell: [0, 0] },
          { symbol: "H", cell: [0, 2] },
          { symbol: "H", cell: [1, 0] },
          { symbol: "CH₃", cell: [1, 2] },
        ],
        bonds: [
          { atoms: [0, 1], order: 1 },
          { atoms: [0, 2], order: 1 },
          { atoms: [0, 3], order: 1 },
          { atoms: [1, 4], order: 1 },
          { atoms: [1, 5], order: 1 },
        ],
        polymer: [0, 1],
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const atoms: { symbol: string; cell: [number, number]; letter?: string }[] = [];
    const bonds: { atoms: [number, number]; order: number; letter?: string }[] = [];
    const add = (symbol: string, c: number, row: number) =>
      atoms.push({ symbol, cell: [c, row] }) - 1;
    const join = (i: number, j: number, order = 1) => bonds.push({ atoms: [i, j], order });
    let polymer: [number, number] | null = null;
    const shape = pick(["alkane", "alkene", "alcohol", "halo", "acid", "amine", "polymer"]);
    if (shape === "polymer") {
      // An addition polymer's repeat unit: two carbons, each with two substituents.
      const c = [add("C", 0, 1), add("C", 1, 1)];
      join(c[0], c[1]);
      const sub = pick(["H", "Cl", "F", "CH₃"]);
      for (const [k, row, s] of [
        [0, 0, sub === "F" ? "F" : "H"],
        [0, 2, sub === "F" ? "F" : "H"],
        [1, 0, sub === "F" ? "F" : "H"],
        [1, 2, sub],
      ] as const)
        join(c[k], add(s, k, row));
      polymer = [c[0], c[1]];
    } else {
      const n = 1 + Math.floor(r() * (shape === "alkane" || shape === "halo" ? 5 : 4));
      const chain = Array.from({ length: n }, (_, k) => add("C", k + 1, 1));
      join(add("H", 0, 1), chain[0]);
      for (let k = 1; k < n; k++) join(chain[k - 1], chain[k]);
      const bare = new Set<number>();
      if (shape === "alkene" && n >= 2) {
        const k = Math.floor(r() * (n - 1));
        bonds[k + 1].order = 2;
        bare.add(k).add(k + 1);
      }
      chain.forEach((c, k) => {
        if (shape === "acid" && k === n - 1) join(c, add("O", k + 1, 0), 2);
        else join(c, add("H", k + 1, 0));
        if (!bare.has(k) && !(shape === "acid" && k === n - 1)) join(c, add("H", k + 1, 2));
      });
      const last = chain[n - 1];
      if (shape === "alcohol" || shape === "acid") {
        if (r() < 0.3) join(last, add("OH", n + 1, 1));
        else {
          const o = add("O", n + 1, 1);
          join(last, o);
          join(o, add("H", n + 2, 1));
        }
      } else if (shape === "halo") join(last, add(pick(["Cl", "Br", "F", "I"]), n + 1, 1));
      else if (shape === "amine") {
        const nAtom = add("N", n + 1, 1);
        join(last, nAtom);
        join(nAtom, add("H", n + 1, 0));
        join(nAtom, add("H", n + 1, 2));
      } else join(last, add("H", n + 1, 1));
    }
    // Some briefs a writer might get wrong: a bond too many, an atom missing.
    const fault = r();
    if (fault < 0.1) bonds[Math.floor(r() * bonds.length)].order = 2;
    else if (fault < 0.15) atoms.pop();
    else if (fault < 0.2) atoms[atoms.length - 1].cell = [9, 9];
    const lettering = r();
    if (lettering < 0.45) {
      const count = 2 + Math.floor(r() * 3);
      const order = bonds.map((_, i) => i).sort(() => r() - 0.5);
      order.slice(0, count).forEach((i, k) => (bonds[i].letter = "ABCD"[k]));
    } else if (lettering < 0.6) {
      const order = atoms.map((_, i) => i).sort(() => r() - 0.5);
      order.slice(0, 2).forEach((i, k) => (atoms[i].letter = "XY"[k]));
    }
    return { kind: "displayed-formula", atoms, bonds, polymer };
  },
};
