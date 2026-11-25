/**
 * A dot-and-cross diagram of an ionic compound: its ions side by side, each in
 * square brackets with its charge at the top right, as exam boards draw them.
 * Each ion is drawn as its outer shell only, or with every shell, as the
 * question asks. The metal's electrons are crosses and the non-metal's dots,
 * so the electrons a non-metal ion gained are the crosses in its outer shell,
 * on the side of the metal ion they came from. An outer shell of eight holds
 * its electrons in four pairs (top, right, bottom, left); a shell of two holds
 * them at the top and bottom.
 *
 * The writer gives the compound as SMILES ("[Na+].[Cl-]"); the server reads its
 * ions (structures/layout.server.ts), so this file needs no chemistry library.
 * Every ion must carry its element's own charge and the charges must cancel,
 * so a wrong formula is never drawn. A metal ion sits between two non-metal
 * ions (MgCl₂), a non-metal ion between two metal ions (Na₂O), and at most
 * three fit side by side, the shells drawn smaller when they would not.
 */
import { CANVAS_HEIGHTS, CANVAS_MARGIN, CANVAS_WIDTH, TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { line, num, polyline, svgOf, text } from "../figureSvg";
import { ELEMENTS, ION, chargeText, fill, ionName, signed } from "./electronShells";
import type { FigureKind } from "./kind";

export type Ion = { element: string; charge: number };
export type IonicBrief = {
  kind: "ionic-bonding";
  /** The compound as the writer gave it, or null for a brief written ion by ion. */
  smiles: string | null;
  /** Each ion, left to right as drawn: its element and its charge. */
  ions: Ion[];
  /** "outer": each ion's outer shell only. "all": every shell. */
  shells: "outer" | "all";
};

/** The metals and non-metals drawn: those whose compounds have at most three ions. */
const METALS = ["Li", "Na", "K", "Mg", "Ca"];
const NON_METALS = ["O", "S", "F", "Cl"];
const DRAWN = "Li, Na, K, Mg or Ca with O, S, F or Cl";
const MAX_IONS = 3;

/** Half a dot's or a cross's width; a pair's two electrons sit this far either side of its middle. */
const MARK = 3.5;
const PAIR = 6;
/** Each ring's radius, inside out, largest first: one ring for outer shells, up to three for every shell. */
const SIZES = {
  outer: [[40], [36], [32]],
  // The first ring keeps its electrons clear of the symbol inside it.
  all: [
    [16, 32, 48],
    [16, 29, 42],
    [16, 27, 38],
  ],
} as const;
/** How far an ion's brackets stand outside its outer shell, across and up and down, and their feet. */
const BRACKET = { side: 8, end: 10, foot: 8 } as const;
/** From the right bracket to its charge. */
const CHARGE_GAP = 4;
/**
 * From one ion's charge to the next ion's bracket: as much as the row has room
 * for up to SPREAD, and at least the first of GAPS that a size fits. A roomy
 * gap at a smaller size beats a cramped one at a larger.
 */
const SPREAD = 24;
const GAPS = [12, 6];
const PAD = 12;
const SIZE = TEXT_SIZE["qf-text"]!;

type Side = "up" | "right" | "down" | "left";
/** Each pair's side and the angle of its middle, anticlockwise from 3 o'clock. */
const SIDES: [Side, number][] = [
  ["up", 90],
  ["right", 0],
  ["down", 270],
  ["left", 180],
];
const PLACE: Record<number, string[]> = { 2: ["left", "right"], 3: ["left", "middle", "right"] };

type Mark = { at: Pt; dot: boolean };
type Ring = { r: number; marks: Mark[] };
type Placed = Ion & {
  at: Pt;
  rings: Ring[];
  brackets: Pt[][];
  label: { text: string; x: number; y: number };
};
type Layout = { H: number; ions: Placed[] };

/**
 * The electrons of a ring of n round c, on its line: two at the top and
 * bottom, or eight as four pairs. `crosses` says how many of a side's pair
 * are crosses on a ring of dots: the pair's lower (or right-hand) one first.
 */
function ringMarks(
  c: Pt,
  r: number,
  n: number,
  dot: boolean,
  crosses: Partial<Record<Side, number>>,
) {
  const at = (deg: number): Pt => {
    const a = (deg * Math.PI) / 180;
    return [c[0] + r * Math.cos(a), c[1] - r * Math.sin(a)];
  };
  if (n === 2)
    return [
      { at: at(90), dot },
      { at: at(270), dot },
    ];
  const d = (Math.asin(PAIR / r) * 180) / Math.PI;
  return SIDES.flatMap(([side, deg]) => {
    const k = crosses[side] ?? 0;
    // Upper or left-hand one first.
    const pair = side === "up" || side === "right" ? [deg + d, deg - d] : [deg - d, deg + d];
    return pair.map((a, i) => ({ at: at(a), dot: dot && i < 2 - k }));
  });
}

/** Where everything goes, at the largest size the row fits; null when none fits. */
function layout(b: IonicBrief): Layout | null {
  const outer = b.shells === "outer";
  const counts = b.ions.map((ion) => {
    const all = fill(ELEMENTS.indexOf(ion.element) + 1 - ion.charge);
    return outer ? all.slice(-1) : all;
  });
  const charges = b.ions.map((ion) => chargeText(ion.charge));
  const sizes = GAPS.flatMap((least) => SIZES[b.shells].map((radii) => ({ least, radii })));
  for (const { least, radii } of sizes) {
    const outerR = counts.map((c) => radii[c.length - 1]);
    const widths = outerR.map(
      (R, k) => 2 * (R + BRACKET.side) + CHARGE_GAP + textWidth(charges[k], SIZE),
    );
    const gaps = b.ions.length - 1;
    const spare = CANVAS_WIDTH - 2 * CANVAS_MARGIN - widths.reduce((s, w) => s + w, 0);
    if (spare < least * gaps) continue;
    const gap = Math.min(SPREAD, spare / gaps);
    const total = CANVAS_WIDTH - 2 * CANVAS_MARGIN - spare + gap * gaps;
    const need = 2 * (Math.max(...outerR) + BRACKET.end) + 2 * PAD;
    const H = CANVAS_HEIGHTS.find((h) => h >= need)!;
    const cy = H / 2;
    let x = (CANVAS_WIDTH - total) / 2;
    const ions = b.ions.map((ion, k): Placed => {
      const R = outerR[k];
      const c: Pt = [x + R + BRACKET.side, cy];
      x += widths[k] + gap;
      // A non-metal ion's gained electrons: crosses on the side of each metal ion beside it.
      const crosses: Partial<Record<Side, number>> = {};
      if (ion.charge < 0) {
        const donors = [k - 1, k + 1].filter((j) => (b.ions[j]?.charge ?? 0) > 0);
        for (const j of donors) crosses[j < k ? "left" : "right"] = -ion.charge / donors.length;
      }
      const last = counts[k].length - 1;
      const top = cy - R - BRACKET.end;
      const bottom = cy + R + BRACKET.end;
      const [xL, xR] = [c[0] - R - BRACKET.side, c[0] + R + BRACKET.side];
      return {
        ...ion,
        at: c,
        rings: counts[k].map((n, j) => ({
          r: radii[j],
          marks: ringMarks(c, radii[j], n, ion.charge < 0, j === last ? crosses : {}),
        })),
        brackets: [
          [
            [xL + BRACKET.foot, top],
            [xL, top],
            [xL, bottom],
            [xL + BRACKET.foot, bottom],
          ],
          [
            [xR - BRACKET.foot, top],
            [xR, top],
            [xR, bottom],
            [xR - BRACKET.foot, bottom],
          ],
        ],
        label: { text: charges[k], x: xR + CHARGE_GAP, y: top + 12 },
      };
    });
    return { H, ions };
  }
  return null;
}
const laidOut = (b: IonicBrief) => layout(b) as Layout;

const tally = (marks: Mark[]) => {
  const dots = marks.filter((m) => m.dot).length;
  const crosses = marks.length - dots;
  const words = [
    dots ? `${dots} dot${dots === 1 ? "" : "s"}` : "",
    crosses ? `${crosses} cross${crosses === 1 ? "" : "es"}` : "",
  ].filter(Boolean);
  return words.length ? words.join(" and ") : "no electrons";
};

const SMALL = "₀₁₂₃₄₅₆₇₈₉";
/** MgCl₂: the metal, then the non-metal, each with its count when more than one. */
function formulaOf(metal: Ion, other: Ion) {
  const gcd = (p: number, q: number): number => (q ? gcd(q, p % q) : p);
  const g = gcd(metal.charge, -other.charge);
  const part = (s: string, n: number) => `${s}${n > 1 ? SMALL[n] : ""}`;
  return `${part(metal.element, -other.charge / g)}${part(other.element, metal.charge / g)}`;
}

/** Where an ion is in a problem's words: "the left Cl⁻ ion". */
const named = (L: Layout, k: number) =>
  `the ${PLACE[L.ions.length][k]} ${ionName(L.ions[k].element, L.ions[k].charge)} ion`;

export const ionicBonding: FigureKind<IonicBrief> = {
  kind: "ionic-bonding",
  name: "a dot-and-cross diagram of an ionic compound",
  guide: `smiles: the compound as SMILES, each ion in square brackets with its charge, the ions joined by dots and written as many times as the formula has them: "[Na+].[Cl-]" is sodium chloride, "[Mg+2].[O-2]" is magnesium oxide, "[Mg+2].[Cl-].[Cl-]" is magnesium chloride, "[Na+].[Na+].[O-2]" is sodium oxide. One metal and one non-metal, ${DRAWN}, each as its own simple ion. shells: "outer" to draw each ion's outer shell only, or "all" to draw every shell; follow the question's words, and give "outer" when they don't say. Give smiles and shells and nothing else: the website draws each ion in square brackets with its charge at the top right, the metal's electrons as crosses and the non-metal's as dots, with the electrons the non-metal gained as crosses in its outer shell. Never write a SMILES string in the question, an option or the mark scheme.`,
  read(b) {
    const shells = b.shells ?? "outer";
    if (shells !== "outer" && shells !== "all")
      return { problem: 'shells must be "outer" or "all"' };
    if (!Array.isArray(b.ions))
      return {
        problem:
          typeof b.smiles === "string"
            ? "could not be laid out from its SMILES"
            : "needs smiles: the compound's ions, as [Na+].[Cl-]",
      };
    const ions: Ion[] = [];
    for (const raw of b.ions as unknown[]) {
      const ion = raw as Partial<Ion> | null;
      const element = typeof ion?.element === "string" ? ion.element.trim() : "";
      const charge = ion?.charge;
      if (!element || !Number.isInteger(charge))
        return { problem: "each ion needs an element and a whole-number charge" };
      if (!METALS.includes(element) && !NON_METALS.includes(element))
        return { problem: `has ${element}: the ions drawn are those of ${DRAWN}` };
      if (charge === 0)
        return {
          problem: `has ${element} with no charge: write each ion with its charge, as [Na+]`,
        };
      if (charge !== ION[element])
        return {
          problem: `has ${element} with charge ${signed(charge as number)}, but its ion is ${ionName(element, ION[element])}`,
        };
      ions.push({ element, charge: charge as number });
    }
    const metals = [...new Set(ions.filter((i) => i.charge > 0).map((i) => i.element))];
    const others = [...new Set(ions.filter((i) => i.charge < 0).map((i) => i.element))];
    if (metals.length !== 1 || others.length !== 1)
      return { problem: "must be the ions of one metal and one non-metal" };
    const metal = ions.find((i) => i.charge > 0)!;
    const other = ions.find((i) => i.charge < 0)!;
    const sum = ions.reduce((s, i) => s + i.charge, 0);
    if (sum)
      return {
        problem: `has charges adding up to ${signed(sum)}, not 0: ${ionName(metal.element, metal.charge)} and ${ionName(other.element, other.charge)} make ${formulaOf(metal, other)}`,
      };
    if (ions.length > MAX_IONS)
      return { problem: `has ${ions.length} ions; at most ${MAX_IONS} fit side by side` };
    // Left to right: the metal ion first, or the one ion of its kind between the other two.
    const cations = ions.filter((i) => i.charge > 0);
    const anions = ions.filter((i) => i.charge < 0);
    const ordered =
      ions.length === 2
        ? [metal, other]
        : cations.length === 1
          ? [anions[0], metal, anions[1]]
          : [cations[0], other, cations[1]];
    const brief: IonicBrief = {
      kind: "ionic-bonding",
      smiles: typeof b.smiles === "string" ? b.smiles.trim() : null,
      ions: ordered,
      shells,
    };
    return layout(brief) ? { brief } : { problem: "is too wide to draw" };
  },
  draw(b) {
    const L = laidOut(b);
    const body: string[] = [];
    for (const ion of L.ions) {
      const [cx, cy] = ion.at;
      for (const ring of ion.rings)
        body.push(`<circle class="qf-line" cx="${num(cx)}" cy="${num(cy)}" r="${ring.r}"/>`);
      for (const {
        at: [x, y],
        dot,
      } of ion.rings.flatMap((r) => r.marks))
        if (dot) body.push(`<circle class="qf-ink" cx="${num(x)}" cy="${num(y)}" r="${MARK}"/>`);
        else
          body.push(
            line("qf-line", x - MARK, y - MARK, x + MARK, y + MARK),
            line("qf-line", x - MARK, y + MARK, x + MARK, y - MARK),
          );
      body.push(text("qf-text", cx, cy + 5.5, "middle", [ion.element]));
      for (const pts of ion.brackets) body.push(polyline("qf-line", pts));
      body.push(text("qf-text", ion.label.x, ion.label.y, "start", [ion.label.text]));
    }
    const outer = b.shells === "outer";
    const ions = L.ions.map(
      (ion) =>
        `${ion.element} with the charge ${ion.label.text}, ${
          outer
            ? `its shell holding ${tally(ion.rings[0].marks)}`
            : ion.rings.length === 1
              ? `its one shell holding ${tally(ion.rings[0].marks)}`
              : `its ${ion.rings.length} shells holding, from the inside out, ${ion.rings
                  .map((r) => tally(r.marks))
                  .join("; ")}`
        }`,
    );
    return {
      svg: svgOf(L.H, body),
      alt: `A dot-and-cross diagram of ${L.ions.length === 2 ? "two" : "three"} ions side by side, each in square brackets with its charge at the top right and ${outer ? "only its outer shell drawn" : "every shell drawn"}. From left to right: ${ions.join(". Then ")}.`,
    };
  },
  check(b, d, t) {
    const L = laidOut(b);
    const out: string[] = [];
    const ringName = (ion: Placed, j: number) =>
      b.shells === "outer" || ion.rings.length === 1 ? "shell" : `shell ${j + 1}`;

    let rings = 0;
    L.ions.forEach((ion, k) => {
      const [cx, cy] = ion.at;
      ion.rings.forEach((ring, j) => {
        rings++;
        if (
          !d.shapes.some(
            (s) =>
              s.name === "circle" &&
              s.cls === "qf-line" &&
              t.near(s.r, ring.r) &&
              t.near(s.at[0], cx) &&
              t.near(s.at[1], cy),
          )
        )
          out.push(
            `The ${ringName(ion, j)} of ${named(L, k)} is not drawn at ${t.at(ion.at)} with radius ${ring.r}`,
          );
      });
      if (!t.writtenAt(ion.element, cx, cy + 5.5, "middle", "qf-text"))
        out.push(`"${ion.element}" is not written in the middle of ${named(L, k)}`);
      ion.brackets.forEach((pts, m) => {
        if (!pts.every((p, i) => i === 0 || t.hasLine(pts[i - 1], p)))
          out.push(
            `The ${m ? "right" : "left"} bracket of ${named(L, k)} is not drawn from ${t.at(pts[1])} to ${t.at(pts[2])}`,
          );
      });
      if (!t.writtenAt(ion.label.text, ion.label.x, ion.label.y, "start", "qf-text"))
        out.push(
          `The charge "${ion.label.text}" of ${named(L, k)} is not written at its right bracket's top`,
        );
    });
    const circles = d.shapes.filter((s) => s.name === "circle" && s.cls === "qf-line").length;
    if (circles !== rings) out.push(`The diagram has ${circles} shells; its ions need ${rings}`);

    // The electrons: a dot is a small ink circle, a cross two short lines
    // crossing at its middle. Every other line is a bracket's.
    const found: { at: Pt; dot: boolean }[] = [];
    for (const s of d.shapes)
      if (s.name === "circle" && s.cls === "qf-ink") {
        found.push({ at: s.at, dot: true });
        if (!t.near(s.r, MARK))
          out.push(`The dot at ${t.at(s.at)} is not an electron's size, radius ${MARK}`);
      }
    const sameSeg = (p: [Pt, Pt], q: Pt[]) =>
      [p, [p[1], p[0]]].some(
        ([a, c]) =>
          t.near(a[0], q[0][0]) &&
          t.near(a[1], q[0][1]) &&
          t.near(c[0], q[1][0]) &&
          t.near(c[1], q[1][1]),
      );
    const bracketSegs = L.ions.flatMap((ion) =>
      ion.brackets.flatMap((pts) => pts.slice(1).map((p, i) => [pts[i], p])),
    );
    const halves = d.segments
      .map((s) => s.seg)
      .filter((seg) => !bracketSegs.some((q) => sameSeg(seg, q)));
    const usedHalf = new Set<number>();
    const crossLike = (r: [Pt, Pt]) =>
      Math.abs(Math.abs(r[1][0] - r[0][0]) - 2 * MARK) < 0.6 &&
      Math.abs(Math.abs(r[1][1] - r[0][1]) - 2 * MARK) < 0.6;
    halves.forEach(([p, q], i) => {
      if (usedHalf.has(i) || !crossLike([p, q])) return;
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const j = halves.findIndex(
        (r, k) =>
          k !== i &&
          !usedHalf.has(k) &&
          crossLike(r) &&
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
        out.push(
          `The line from ${t.at(p)} to ${t.at(q)} is not half of an electron's cross or part of a bracket`,
        );
    });

    // Count what each shell holds, then hold each electron to its place.
    const held = L.ions.map((ion) => ion.rings.map((): Mark[] => []));
    for (const e of found) {
      // On a shell of the ion whose middle is nearest.
      const away = L.ions.map((ion) => Math.hypot(e.at[0] - ion.at[0], e.at[1] - ion.at[1]));
      const k = away.indexOf(Math.min(...away));
      const j = L.ions[k].rings.findIndex((ring) => t.near(away[k], ring.r, 1));
      if (j >= 0) held[k][j].push(e);
      else out.push(`The ${e.dot ? "dot" : "cross"} at ${t.at(e.at)} is not on any ion's shell`);
    }
    L.ions.forEach((ion, k) =>
      ion.rings.forEach((ring, j) => {
        const [has, needs] = [tally(held[k][j]), tally(ring.marks)];
        if (has !== needs)
          out.push(`The ${ringName(ion, j)} of ${named(L, k)} holds ${has}; it needs ${needs}`);
      }),
    );
    const marks = L.ions.flatMap((ion) => ion.rings.flatMap((r) => r.marks));
    for (const e of found)
      if (
        !marks.some((m) => m.dot === e.dot && t.near(m.at[0], e.at[0]) && t.near(m.at[1], e.at[1]))
      )
        out.push(`The ${e.dot ? "dot" : "cross"} at ${t.at(e.at)} is not where an electron goes`);
    if (found.length !== marks.length)
      out.push(`The diagram has ${found.length} electrons; its ions need ${marks.length}`);

    // Nothing else: two brackets an ion, a symbol and a charge.
    const brackets = d.shapes.filter((s) => s.name === "polyline").length;
    if (brackets !== 2 * L.ions.length)
      out.push(
        `The diagram has ${brackets} brackets; its ${L.ions.length} ions need ${2 * L.ions.length}`,
      );
    for (const s of d.shapes)
      if (
        !(s.name === "circle" && (s.cls === "qf-line" || s.cls === "qf-ink")) &&
        !((s.name === "line" || s.name === "polyline") && s.cls === "qf-line" && !s.marked)
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the dot-and-cross diagram`);
    const allowed = new Set(L.ions.flatMap((ion) => [ion.element, ion.label.text]));
    const pieces = t.pieces();
    for (const p of pieces)
      if (!allowed.has(p.text)) out.push(`Text "${p.text}" is not an ion's symbol or charge`);
    if (pieces.length !== 2 * L.ions.length)
      out.push(
        `The diagram has ${pieces.length} texts; each of its ${L.ions.length} ions has a symbol and a charge`,
      );
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The diagram shows the ions in sodium chloride. Describe how a sodium atom and a chlorine atom form these ions.",
      brief: {
        kind: "ionic-bonding",
        smiles: "[Na+].[Cl-]",
        ions: [
          { element: "Na", charge: 1 },
          { element: "Cl", charge: -1 },
        ],
        shells: "outer",
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the ions in magnesium chloride. What is the formula of magnesium chloride?",
      options: ["MgCl", "MgCl₂", "Mg₂Cl", "Mg₂Cl₂"],
      brief: {
        kind: "ionic-bonding",
        smiles: "[Mg+2].[Cl-].[Cl-]",
        ions: [
          { element: "Cl", charge: -1 },
          { element: "Mg", charge: 2 },
          { element: "Cl", charge: -1 },
        ],
        shells: "outer",
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the ions in magnesium oxide, with every shell drawn. Explain why magnesium oxide has a high melting point.",
      brief: {
        kind: "ionic-bonding",
        smiles: "[Mg+2].[O-2]",
        ions: [
          { element: "Mg", charge: 2 },
          { element: "O", charge: -2 },
        ],
        shells: "all",
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the ions in sodium oxide, with every shell drawn. How many electrons does each sodium atom lose?",
      options: ["1", "2", "3", "4"],
      brief: {
        kind: "ionic-bonding",
        smiles: "[Na+].[Na+].[O-2]",
        ions: [
          { element: "Na", charge: 1 },
          { element: "O", charge: -2 },
          { element: "Na", charge: 1 },
        ],
        shells: "all",
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the ions in calcium chloride, with every shell drawn. Which noble gas has the same electronic structure as each ion?",
      brief: {
        kind: "ionic-bonding",
        smiles: "[Ca+2].[Cl-].[Cl-]",
        ions: [
          { element: "Cl", charge: -1 },
          { element: "Ca", charge: 2 },
          { element: "Cl", charge: -1 },
        ],
        shells: "all",
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const metal = pick(METALS);
    const other = pick(NON_METALS);
    const [p, q] = [ION[metal], -ION[other]];
    const gcd = (a: number, c: number): number => (c ? gcd(c, a % c) : a);
    const g = gcd(p, q);
    const ions: Ion[] = [
      ...Array.from({ length: q / g }, () => ({ element: metal, charge: p })),
      ...Array.from({ length: p / g }, () => ({ element: other, charge: -q })),
    ];
    // A writer's slips: an ion too many or too few, a wrong charge, an element not drawn.
    const slip = r();
    if (slip < 0.08) ions.push({ ...ions[0] });
    else if (slip < 0.14) ions.pop();
    else if (slip < 0.2) ions[0] = { ...ions[0], charge: ions[0].charge + 1 };
    else if (slip < 0.24) ions[0] = { element: pick(["Al", "N", "Br", "H"]), charge: 1 };
    // Written in any order: the drawing puts them in theirs.
    for (let i = ions.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [ions[i], ions[j]] = [ions[j], ions[i]];
    }
    return { kind: "ionic-bonding", smiles: null, ions, shells: r() < 0.5 ? "outer" : "all" };
  },
};
