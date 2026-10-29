/**
 * A dot-and-cross diagram of a simple covalent molecule: one central atom
 * with up to four atoms bonded to it (or just two atoms), each drawn as its
 * outer shell, a circle with its symbol in the middle. Each bonded atom's
 * shell overlaps the central one's, and each shared pair sits in the overlap
 * as one dot and one cross; lone pairs sit inside an atom's own shell. Only
 * outer electrons are drawn: the central atom's are dots, the others' are
 * crosses. The brief gives the atoms and the bonds, and the code places every
 * electron, so each atom brings exactly its group's outer electrons and ends
 * with a full shell; a brief that would break either is refused.
 */
import type { Pt } from "../figureCheck";
import { and, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type DotCrossBrief = {
  kind: "dot-and-cross";
  /** The central atom, or the left of two: its electrons are dots. */
  centre: string;
  /** The atoms bonded to it, placed left, right, below, then above (one alone goes right); their electrons are crosses. */
  around: { symbol: string; bonds: number }[];
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

/** Each shell's radius, how far apart two bonded atoms' centres are, and where lone pairs sit. */
const R = 48;
const D = 72;
const LONE = 37;
/** Half a dot's or a cross's width; a lone pair's two electrons sit this far either side of its middle. */
const MARK = 3.5;
const PAIR = 6;
/** Shared pairs stack across the overlap this far apart; a pair's dot and cross sit this far either side of its middle. */
const STACK = 11;
const SPLIT = 5;

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

type Mark = { at: Pt; dot: boolean; region: string };

/** Each atom's centre, every electron's place and which shells it is inside, and the canvas height. */
function layout(b: DotCrossBrief) {
  const n = b.around.length;
  const H = n === 4 ? 260 : 200;
  const centre: Pt = n === 1 ? [180 - D / 2, 100] : [180, n === 3 ? (H - D) / 2 : H / 2];
  const dirs = PLACES[n];
  const atoms: Pt[] = [
    centre,
    ...dirs.map((d) => [centre[0] + STEP[d][0] * D, centre[1] + STEP[d][1] * D] as Pt),
  ];
  const marks: Mark[] = [];
  const lone = (p: Pt, w: Pt, dot: boolean, region: string) => {
    for (const s of [-1, 1])
      marks.push({
        at: [p[0] + w[0] * LONE - w[1] * PAIR * s, p[1] + w[1] * LONE + w[0] * PAIR * s],
        dot,
        region,
      });
  };
  b.around.forEach((a, k) => {
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
    const ws: Pt[] = [[], [u], [v, [-v[0], -v[1]]], [u, v, [-v[0], -v[1]]]][pairs] as Pt[];
    for (const w of ws) lone(atoms[k + 1], w, false, `${k + 1}`);
  });
  const shared = b.around.reduce((s, a) => s + a.bonds, 0);
  const pairs = (OUTER[b.centre] - shared) / 2;
  for (const d of CENTRE_LONE[n][pairs]) lone(centre, STEP[d], true, "0");
  return { H, atoms, dirs, marks };
}

/** Each atom as a problem names it: "the central N", "the left H", "the H below". */
function nameOf(b: DotCrossBrief, dirs: Dir[], k: number) {
  if (b.around.length === 1)
    return `the ${k ? "right" : "left"} ${k ? b.around[0].symbol : b.centre}`;
  if (!k) return `the central ${b.centre}`;
  const [d, symbol] = [dirs[k - 1], b.around[k - 1].symbol];
  return d === "left" || d === "right" ? `the ${d} ${symbol}` : `the ${symbol} ${PHRASE[d]}`;
}
const tally = (dots: number, crosses: number) =>
  `${dots} dot${dots === 1 ? "" : "s"} and ${crosses} cross${crosses === 1 ? "" : "es"}`;
const BONDS = ["", "single", "double", "triple"];

export const dotAndCross: FigureKind<DotCrossBrief> = {
  kind: "dot-and-cross",
  name: "a dot-and-cross diagram of a covalent molecule",
  guide:
    'centre: the symbol of the central atom (or the left of two atoms), whose outer electrons are drawn as dots; around: 1 to 4 {symbol, bonds: 1, 2 or 3, the covalent bonds it makes to the centre}, drawn left, right, below, then above the centre (a single one goes to its right), their electrons drawn as crosses; symbols from H, C, Si, N, P, O, S, F, Cl, Br, I. Every atom must end with a full outer shell, 8 electrons (H 2), counting each bond\'s shared pair: H₂O is centre "O", around two {symbol "H", bonds 1}; CO₂ is centre "C", around two {symbol "O", bonds 2}. letter: null, or a capital letter written in place of the central atom\'s symbol when the question asks which element it is. The website draws only the outer shells, each shared pair as a dot and a cross in the overlap and the rest as lone pairs.',
  read(b) {
    const centre = typeof b.centre === "string" ? b.centre.trim() : "";
    if (!Object.hasOwn(OUTER, centre))
      return { problem: "centre must be one of H, C, Si, N, P, O, S, F, Cl, Br, I" };
    const around = b.around as { symbol: unknown; bonds: unknown }[];
    if (!Array.isArray(around) || around.length < 1 || around.length > 4)
      return { problem: "needs 1 to 4 atoms around the centre" };
    const read: DotCrossBrief = { kind: "dot-and-cross", centre, around: [], letter: null };
    for (const a of around) {
      const symbol = typeof a?.symbol === "string" ? a.symbol.trim() : "";
      if (!Object.hasOwn(OUTER, symbol))
        return {
          problem: "has an atom around the centre that is not H, C, Si, N, P, O, S, F, Cl, Br or I",
        };
      if (![1, 2, 3].includes(a.bonds as number))
        return { problem: "has an atom whose bonds to the centre are not 1, 2 or 3" };
      read.around.push({ symbol, bonds: a.bonds as number });
    }
    if (b.letter !== null && b.letter !== undefined && b.letter !== "") {
      if (typeof b.letter !== "string" || !/^[A-Z]$/.test(b.letter.trim()))
        return { problem: "letter must be null or one capital letter" };
      read.letter = b.letter.trim();
    }
    // The chemistry: each atom brings its group's outer electrons, and a shared pair counts in
    // both shells, so a shell holds its own electrons plus one more for each bond it makes.
    const shared = read.around.reduce((s, a) => s + a.bonds, 0);
    const shell = OUTER[centre] + shared;
    if (shell !== full(centre))
      return {
        problem: `gives the ${read.around.length > 1 ? "central " : ""}${centre} ${shell} outer electrons once bonded, not ${full(centre)}`,
      };
    for (const a of read.around)
      if (OUTER[a.symbol] + a.bonds !== full(a.symbol))
        return {
          problem: `gives a bonded ${a.symbol} ${OUTER[a.symbol] + a.bonds} outer electrons, not ${full(a.symbol)}`,
        };
    return { brief: read };
  },
  draw(b) {
    const L = layout(b);
    const body: string[] = [];
    for (const [x, y] of L.atoms)
      body.push(`<circle class="qf-line" cx="${num(x)}" cy="${num(y)}" r="${R}"/>`);
    for (const m of L.marks) {
      const [x, y] = m.at;
      if (m.dot) body.push(`<circle class="qf-ink" cx="${num(x)}" cy="${num(y)}" r="${MARK}"/>`);
      else
        body.push(
          line("qf-line", x - MARK, y - MARK, x + MARK, y + MARK),
          line("qf-line", x - MARK, y + MARK, x + MARK, y - MARK),
        );
    }
    L.atoms.forEach(([x, y], k) => {
      const lettered = k === 0 && b.letter;
      body.push(
        text(lettered ? "qf-strong" : "qf-text", x, y + 5.5, "middle", [
          lettered ? b.letter! : k ? b.around[k - 1].symbol : b.centre,
        ]),
      );
    });
    const shown = b.letter ?? b.centre;
    const more = (k: number, what: string) => {
      const n = L.marks.filter((m) => m.region === `${k}`).length;
      return n ? `${n} more ${what}` : `no more ${what}`;
    };
    const two = b.around.length === 1;
    const at = (k: number) => `${b.around[k].symbol} ${PHRASE[L.dirs[k]]}`;
    const alike = b.around.every(
      (a) => a.symbol === b.around[0].symbol && a.bonds === b.around[0].bonds,
    );
    const overlaps = alike
      ? `${two ? "The" : "Each"} overlap holds ${tally(b.around[0].bonds, b.around[0].bonds)}.`
      : `${b.around.map((a, k) => `the overlap with ${at(k)} holds ${tally(a.bonds, a.bonds)}`).join("; ")}.`.replace(
          /^t/,
          "T",
        );
    const others = alike
      ? `${two ? `the ${b.around[0].symbol} on the right` : `each ${b.around[0].symbol}`} has ${more(1, "crosses")}`
      : and(b.around.map((a, k) => `${at(k)} has ${more(k + 1, "crosses")}`));
    return {
      svg: svgOf(L.H, body),
      // What is drawn, never what it means: the bond's type or the molecule's name may be the question.
      alt: `A dot-and-cross diagram of the outer electrons in a molecule: ${
        two
          ? `two overlapping shells, ${shown} on the left with its electrons drawn as dots and ${b.around[0].symbol} on the right with its electrons drawn as crosses.`
          : `${b.letter ? `an atom labelled ${b.letter}` : shown} in the middle with its electrons drawn as dots, its shell overlapping those of ${and(b.around.map((_, k) => at(k)))}, whose electrons are drawn as crosses.`
      } ${overlaps} Outside the overlaps, ${two ? `the ${shown} on the left` : shown} has ${more(0, "dots")} and ${others}.`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    const name = (k: number) => nameOf(b, L.dirs, k);
    L.atoms.forEach((p, k) => {
      if (
        !d.shapes.some(
          (s) =>
            s.name === "circle" &&
            s.cls === "qf-line" &&
            t.near(s.r, R) &&
            t.near(s.at[0], p[0]) &&
            t.near(s.at[1], p[1]),
        )
      )
        out.push(`The shell of ${name(k)} is not drawn at ${t.at(p)} with radius ${R}`);
      const [label, cls] =
        k === 0 && b.letter
          ? [b.letter, "qf-strong" as const]
          : [k ? b.around[k - 1].symbol : b.centre, "qf-text" as const];
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
    const used = new Set<number>();
    halves.forEach(([p, q], i) => {
      if (used.has(i)) return;
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const cross = (r: [Pt, Pt]) =>
        Math.abs(Math.abs(r[1][0] - r[0][0]) - 2 * MARK) < 0.6 &&
        Math.abs(Math.abs(r[1][1] - r[0][1]) - 2 * MARK) < 0.6;
      const j = halves.findIndex(
        (r, k) =>
          k !== i &&
          !used.has(k) &&
          cross(r) &&
          cross([p, q]) &&
          t.near((r[0][0] + r[1][0]) / 2, mid[0]) &&
          t.near((r[0][1] + r[1][1]) / 2, mid[1]) &&
          Math.sign((r[1][0] - r[0][0]) * (r[1][1] - r[0][1])) !==
            Math.sign((q[0] - p[0]) * (q[1] - p[1])),
      );
      if (j < 0) return;
      used.add(i).add(j);
      found.push({ at: mid, dot: false });
    });
    halves.forEach(([p, q], i) => {
      if (!used.has(i))
        out.push(`The line from ${t.at(p)} to ${t.at(q)} is not half of an electron's cross`);
    });

    // Count what each region holds: an atom's own part of its shell, and each overlap.
    const regionOf = (p: Pt) => {
      const inside = L.atoms.flatMap((a, k) =>
        Math.hypot(p[0] - a[0], p[1] - a[1]) < R ? [k] : [],
      );
      return inside.join("+");
    };
    const count = new Map<string, [number, number]>();
    for (const e of found) {
      const r = regionOf(e.at);
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
      out.push(
        parts.length === 2
          ? `The overlap of ${name(0)} and ${name(parts[1])} holds ${tally(hd, hc)}; its ${BONDS[b.around[parts[1] - 1].bonds]} bond needs ${tally(dots, crosses)}`
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
    const labels = new Set([b.letter ?? b.centre, ...b.around.map((a) => a.symbol)]);
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
  ],
  random(r) {
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
    const [centre, around] = MOLECULES[Math.floor(r() * MOLECULES.length)];
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
