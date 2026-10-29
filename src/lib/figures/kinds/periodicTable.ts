/**
 * The outline of the periodic table, periods 1 to 6 or fewer: every cell of
 * those periods drawn empty, the 18 columns in their real places with the
 * gap above the transition metals, and the group numbers 1 to 7 and 0 above
 * the main groups if asked. A letter sits in the cell of each element the
 * brief names. The writer gives element symbols, never places: each cell
 * comes from the element's atomic number, so a letter can't land in the
 * wrong group or period.
 */
import type { Pt } from "../figureCheck";
import { and, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type TableBrief = {
  kind: "periodic-table";
  /** How many periods, from the top, are drawn. */
  periods: number;
  /** Whether 1 to 7 and 0 stand above the main groups. */
  groupNumbers: boolean;
  /** Each letter, in the cell of its element. */
  letters: { element: string; letter: string }[];
};

/** Elements 1 to 86 by atomic number. */
const SYMBOLS =
  "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn".split(
    " ",
  );
/** Where an element sits: its period and its column (1 to 18), or null for a lanthanide after La. */
function place(z: number): [number, number] | null {
  if (z === 1) return [1, 1];
  if (z === 2) return [1, 18];
  if (z <= 18) {
    const period = z <= 10 ? 2 : 3;
    const k = z - (period === 2 ? 2 : 10);
    return [period, k <= 2 ? k : k + 10];
  }
  if (z <= 36) return [4, z - 18];
  if (z <= 54) return [5, z - 36];
  if (z <= 57) return [6, z - 54];
  if (z <= 71) return null;
  return [6, z - 68];
}
/** The columns each period has. */
const columns = (period: number) =>
  period === 1 ? [1, 18] : period <= 3 ? [1, 2, 13, 14, 15, 16, 17, 18] : range(1, 18);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** The UK numbering of the main groups, by column. */
const GROUPS: [number, string][] = [
  [1, "1"],
  [2, "2"],
  [13, "3"],
  [14, "4"],
  [15, "5"],
  [16, "6"],
  [17, "7"],
  [18, "0"],
];

const H = 200;
/** A cell's size; the table's left edge, so its 18 columns sit centred. */
const W = 19;
const CELL_H = 22;
const LEFT = (360 - 18 * W) / 2;

/** Every cell's top-left corner, the group numbers' places and each letter's place. */
function layout(b: TableBrief) {
  const top = Math.round((H - b.periods * CELL_H + (b.groupNumbers ? 18 : 0)) / 2);
  const corner = (period: number, col: number): Pt => [
    LEFT + (col - 1) * W,
    top + (period - 1) * CELL_H,
  ];
  const cells = range(1, b.periods).flatMap((p) => columns(p).map((c) => corner(p, c)));
  const numbers = b.groupNumbers
    ? GROUPS.map(([col, n]) => ({ text: n, x: corner(1, col)[0] + W / 2, y: top - 6 }))
    : [];
  const letters = b.letters.map((l) => {
    const [x, y] = corner(...place(SYMBOLS.indexOf(l.element) + 1)!);
    return { text: l.letter, x: x + W / 2, y: y + CELL_H / 2 + 5.5 };
  });
  return { top, cells, numbers, letters };
}

const COUNTS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

export const periodicTable: FigureKind<TableBrief> = {
  kind: "periodic-table",
  name: "an outline of the periodic table with lettered elements",
  guide:
    "periods: how many periods to draw from the top, 2 to 6 (6 leaves out the lanthanides after La); groupNumbers: true to write 1 to 7 and 0 above the main groups, false when the question asks the student to work out a group; letters: 1 to 8 {element: the symbol of an element in the periods drawn, letter: one capital letter written in its cell}, each element and letter once. The website draws every cell of those periods empty, and puts each letter in its element's cell itself.",
  read(b) {
    if (!Number.isInteger(b.periods) || (b.periods as number) < 2 || (b.periods as number) > 6)
      return { problem: "periods must be a whole number from 2 to 6" };
    if (typeof b.groupNumbers !== "boolean")
      return { problem: "groupNumbers must be true or false" };
    const periods = b.periods as number;
    const letters = b.letters as { element: unknown; letter: unknown }[];
    if (!Array.isArray(letters) || letters.length < 1 || letters.length > 8)
      return { problem: "needs 1 to 8 letters" };
    const read: TableBrief = {
      kind: "periodic-table",
      periods,
      groupNumbers: b.groupNumbers,
      letters: [],
    };
    for (const l of letters) {
      const element = typeof l?.element === "string" ? l.element.trim() : "";
      const z = SYMBOLS.indexOf(element) + 1;
      if (!z)
        return {
          problem: `has "${String(l?.element)}", which is not an element's symbol up to Rn`,
        };
      const at = place(z);
      if (!at)
        return { problem: `has ${element}, a lanthanide, which the table's outline leaves out` };
      if (at[0] > periods)
        return {
          problem: `has ${element}, which is in period ${at[0]}, below the ${periods} drawn`,
        };
      if (typeof l.letter !== "string" || !/^[A-Z]$/.test(l.letter.trim()))
        return { problem: "has a letter that is not one capital letter" };
      read.letters.push({ element, letter: l.letter.trim() });
    }
    if (new Set(read.letters.map((l) => l.element)).size !== read.letters.length)
      return { problem: "letters an element twice" };
    if (new Set(read.letters.map((l) => l.letter)).size !== read.letters.length)
      return { problem: "uses a letter twice" };
    return { brief: read };
  },
  draw(b) {
    const L = layout(b);
    const body = L.cells.map(
      ([x, y]) => `<rect class="qf-line" x="${x}" y="${y}" width="${W}" height="${CELL_H}"/>`,
    );
    for (const n of L.numbers) body.push(text("qf-small", n.x, n.y, "middle", [n.text]));
    for (const l of L.letters) body.push(text("qf-strong", l.x, l.y, "middle", [l.text]));
    const letters = b.letters.map((l) => l.letter).sort();
    return {
      svg: svgOf(H, body),
      // Never which element a letter marks: where it sits is what the question asks about.
      alt: `An outline of the first ${COUNTS[b.periods]} periods of the periodic table, every cell empty${b.groupNumbers ? ", with the group numbers 1 to 7 and 0 above the main groups" : ""}. ${letters.length === 1 ? `The letter ${letters[0]} is written in one cell` : `The letters ${and(letters)} are written in ${COUNTS[letters.length]} of its cells`}.`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    const rects = d.shapes.filter((s) => s.name === "rect" && s.cls === "qf-line");
    const missing = L.cells.filter(
      ([x, y]) => !rects.some((s) => t.near(s.at[0], x) && t.near(s.at[1], y)),
    );
    if (missing.length)
      out.push(
        `The table is missing ${missing.length === 1 ? "the cell" : `${missing.length} cells, the first`} at ${t.at(missing[0])}`,
      );
    if (rects.length !== L.cells.length)
      out.push(
        `The table has ${rects.length} cells; its ${b.periods} periods have ${L.cells.length}`,
      );
    // Every line an edge of a cell where the table has one: a cell drawn too big, or one the
    // table hasn't got, moves where a letter appears to be.
    const edges = L.cells.flatMap(([x, y]): [Pt, Pt][] => [
      [
        [x, y],
        [x + W, y],
      ],
      [
        [x + W, y],
        [x + W, y + CELL_H],
      ],
      [
        [x + W, y + CELL_H],
        [x, y + CELL_H],
      ],
      [
        [x, y + CELL_H],
        [x, y],
      ],
    ]);
    const on = (s: [Pt, Pt], e: [Pt, Pt]) =>
      (t.near(s[0][0], e[0][0]) &&
        t.near(s[0][1], e[0][1]) &&
        t.near(s[1][0], e[1][0]) &&
        t.near(s[1][1], e[1][1])) ||
      (t.near(s[0][0], e[1][0]) &&
        t.near(s[0][1], e[1][1]) &&
        t.near(s[1][0], e[0][0]) &&
        t.near(s[1][1], e[0][1]));
    const stray = d.segments.find((s) => !edges.some((e) => on(s.seg, e)));
    if (stray)
      out.push(
        `The line from ${t.at(stray.seg[0])} to ${t.at(stray.seg[1])} is not the edge of one of the table's cells`,
      );
    b.letters.forEach((l, i) => {
      const at = L.letters[i];
      if (!t.writtenAt(at.text, at.x, at.y, "middle", "qf-strong"))
        out.push(
          `The letter ${l.letter} is not written in ${l.element}'s cell, at ${t.at([at.x, at.y])}`,
        );
    });
    for (const n of L.numbers)
      if (!t.writtenAt(n.text, n.x, n.y, "middle", "qf-small"))
        out.push(`The group number ${n.text} is not written above its column`);
    for (const s of d.shapes)
      if (!(s.name === "rect" && s.cls === "qf-line"))
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the table`);
    const texts = [
      ...L.letters.map((l) => ({ ...l, cls: "qf-strong" })),
      ...L.numbers.map((n) => ({ ...n, cls: "qf-small" })),
    ];
    const pieces = t.pieces();
    for (const p of pieces)
      if (
        !texts.some(
          (x) => x.text === p.text && x.cls === p.cls && t.near(x.x, p.x, 1) && t.near(x.y, p.y, 1),
        )
      )
        out.push(
          `Text "${p.text}" at ${t.at([p.x, p.y])} is not a letter in its cell or a group number`,
        );
    if (pieces.length !== texts.length)
      out.push(`The table has ${pieces.length} texts; the brief has ${texts.length}`);
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The diagram shows an outline of part of the periodic table. Which letter shows the position of an alkali metal?",
      options: ["A", "B", "C", "D"],
      brief: {
        kind: "periodic-table",
        periods: 4,
        groupNumbers: false,
        letters: [
          { element: "Na", letter: "A" },
          { element: "Fe", letter: "B" },
          { element: "Cl", letter: "C" },
          { element: "Ar", letter: "D" },
        ],
      },
    },
    {
      subject: "chemistry",
      question:
        "The letters show the positions of four elements in the periodic table. Which two elements have similar chemical properties?",
      options: ["A and B", "B and C", "C and D", "A and D"],
      brief: {
        kind: "periodic-table",
        periods: 3,
        groupNumbers: true,
        letters: [
          { element: "Li", letter: "A" },
          { element: "O", letter: "B" },
          { element: "S", letter: "C" },
          { element: "Ne", letter: "D" },
        ],
      },
    },
    {
      subject: "chemistry",
      question:
        "The letter X shows the position of an element in the periodic table. Give two ways in which the properties of element X differ from those of the elements in Group 1.",
      brief: {
        kind: "periodic-table",
        periods: 6,
        groupNumbers: true,
        letters: [{ element: "Cu", letter: "X" }],
      },
    },
  ],
  random(r) {
    const periods = 2 + Math.floor(r() * 5);
    const n = 1 + Math.floor(r() * 6);
    // Mostly elements in the periods drawn; now and then one below them, or a lanthanide.
    const most = [2, 10, 18, 36, 54, 86][periods - 1];
    const zs = Array.from({ length: n }, () => 1 + Math.floor(r() * (r() < 0.9 ? most : 86)));
    return {
      kind: "periodic-table",
      periods,
      groupNumbers: r() < 0.5,
      letters: zs.map((z, i) => ({ element: SYMBOLS[z - 1], letter: "ABCDEFGH"[i] })),
    };
  },
};
