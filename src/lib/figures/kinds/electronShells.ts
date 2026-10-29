/**
 * An atom (or a simple ion) of one of the first 20 elements: its nucleus, a
 * small circle with the element's symbol (or a letter in its place), and
 * each shell a circle around it with its electrons evenly spaced round it,
 * the first at 12 o'clock. An ion stands in square brackets with its charge
 * at the top right. The brief gives the element, the charge and the shells,
 * and the shells must be the element's (2, 8, 8, 2 filling, after the ion's
 * electrons are lost or gained), so a wrong structure is never drawn.
 */
import type { Pt } from "../figureCheck";
import { and, num, polyline, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

export type ShellsBrief = {
  kind: "electron-shells";
  /** The element's symbol, from H to Ca. */
  element: string;
  /** 0 for an atom; an ion's charge. */
  charge: number;
  /** Electrons in each shell, innermost first. */
  shells: number[];
  /** A capital letter written in the nucleus in place of the symbol, or null. */
  letter: string | null;
};

const ELEMENTS = [
  "H",
  "He",
  "Li",
  "Be",
  "B",
  "C",
  "N",
  "O",
  "F",
  "Ne",
  "Na",
  "Mg",
  "Al",
  "Si",
  "P",
  "S",
  "Cl",
  "Ar",
  "K",
  "Ca",
];
/**
 * The charge on each element's simple ion at GCSE; the rest form none here.
 * Hydrogen is drawn only as an atom: H⁺ has no electrons, and H⁻ isn't taught.
 */
const ION: Record<string, number> = {
  Li: 1,
  Na: 1,
  K: 1,
  Be: 2,
  Mg: 2,
  Ca: 2,
  Al: 3,
  N: -3,
  P: -3,
  O: -2,
  S: -2,
  F: -1,
  Cl: -1,
};
/** Electrons shell by shell, each filled in turn: 2, then 8, then 8, then the rest. */
const fill = (electrons: number) => {
  const out: number[] = [];
  for (const room of [2, 8, 8, 2]) {
    if (electrons <= 0) break;
    out.push(Math.min(room, electrons));
    electrons -= room;
  }
  return out;
};
/** A charge as an exam paper writes it at the ion's corner: +, 2+, −, 3−. */
const chargeText = (c: number) => `${Math.abs(c) > 1 ? Math.abs(c) : ""}${c > 0 ? "+" : "−"}`;
/** A charge in a problem's words: +2, −1. */
const signed = (c: number) => `${c > 0 ? "+" : "−"}${Math.abs(c)}`;
const SUPER = "⁰¹²³";
const ionName = (s: string, c: number) =>
  `${s}${Math.abs(c) > 1 ? SUPER[Math.abs(c)] : ""}${c > 0 ? "⁺" : "⁻"}`;

const NUCLEUS = 16;
/** Each shell's radius, innermost first. */
const RADII = [34, 56, 78, 100];
const ELECTRON = 4;
/** How far an ion's brackets stand outside its outer shell, across and up and down. */
const BRACKET = { side: 16, end: 12, foot: 8 } as const;

/** Where everything goes: the canvas height, the centre, each electron, an ion's brackets and its charge. */
function layout(b: ShellsBrief) {
  const outer = RADII[b.shells.length - 1];
  const H = Math.max(200, Math.ceil((2 * (outer + ELECTRON) + 24) / 20) * 20);
  const c: Pt = [180, H / 2];
  const electrons = b.shells.flatMap((n, k) =>
    Array.from({ length: n }, (_, j) => {
      const a = (2 * Math.PI * j) / n;
      return { shell: k, at: [c[0] + RADII[k] * Math.sin(a), c[1] - RADII[k] * Math.cos(a)] as Pt };
    }),
  );
  const top = c[1] - outer - BRACKET.end;
  const bottom = c[1] + outer + BRACKET.end;
  const xL = c[0] - outer - BRACKET.side;
  const xR = c[0] + outer + BRACKET.side;
  const brackets: Pt[][] = b.charge
    ? [
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
      ]
    : [];
  const charge = b.charge ? { text: chargeText(b.charge), x: xR + 4, y: top + 12 } : null;
  return { H, c, electrons, brackets, charge };
}

export const electronShells: FigureKind<ShellsBrief> = {
  kind: "electron-shells",
  name: "the electron shells of an atom or simple ion",
  guide:
    "element: the symbol of one of the first 20 elements, H to Ca; charge: 0 for an atom, or an ion's charge, only the one the element forms (Li, Na, K 1; Be, Mg, Ca 2; Al 3; N, P −3; O, S −2; F, Cl −1); shells: the electrons in each shell, innermost first, which must be the element's own (2, 8, 8, 2 filling) after an ion's electrons are lost or gained: Na [2, 8, 1], Na⁺ [2, 8], Cl⁻ [2, 8, 8]; letter: null to write the symbol in the nucleus, or a capital letter written there instead when the question asks which element it is. The website draws each shell with its electrons evenly spaced, and an ion in square brackets with its charge.",
  read(b) {
    const element = typeof b.element === "string" ? b.element.trim() : "";
    const z = ELEMENTS.indexOf(element) + 1;
    if (!z)
      return { problem: "element must be the symbol of one of the first 20 elements, H to Ca" };
    const charge = b.charge ?? 0;
    if (!Number.isInteger(charge) || Math.abs(charge as number) > 3)
      return { problem: "charge must be a whole number from −3 to 3" };
    if (charge && charge !== ION[element])
      return {
        problem: ION[element]
          ? `has ${element} with charge ${signed(charge as number)}, but its ion is ${ionName(element, ION[element])}`
          : element === "H"
            ? "has a hydrogen ion, which has no shell to draw: draw hydrogen as an atom"
            : `has ${element} with charge ${signed(charge as number)}, but ${element} forms no simple ion`,
      };
    const shells = b.shells as unknown[];
    if (
      !Array.isArray(shells) ||
      shells.length < 1 ||
      shells.length > 4 ||
      !shells.every((n) => Number.isInteger(n) && (n as number) > 0)
    )
      return { problem: "needs shells: 1 to 4 counts of electrons, innermost first" };
    const own = fill(z - (charge as number));
    if (shells.join() !== own.join())
      return {
        problem: `has shells ${shells.join(", ")}, but ${charge ? `the ${ionName(element, charge as number)} ion` : element} has ${own.join(", ")}`,
      };
    let letter: string | null = null;
    if (b.letter !== null && b.letter !== undefined && b.letter !== "") {
      if (typeof b.letter !== "string" || !/^[A-Z]$/.test(b.letter.trim()))
        return { problem: "letter must be null or one capital letter" };
      letter = b.letter.trim();
    }
    return {
      brief: {
        kind: "electron-shells",
        element,
        charge: charge as number,
        shells: own,
        letter,
      },
    };
  },
  draw(b) {
    const L = layout(b);
    const [cx, cy] = L.c;
    const body = [`<circle class="qf-line" cx="${cx}" cy="${num(cy)}" r="${NUCLEUS}"/>`];
    b.shells.forEach((_, k) =>
      body.push(`<circle class="qf-line" cx="${cx}" cy="${num(cy)}" r="${RADII[k]}"/>`),
    );
    for (const e of L.electrons)
      body.push(
        `<circle class="qf-ink" cx="${num(e.at[0])}" cy="${num(e.at[1])}" r="${ELECTRON}"/>`,
      );
    body.push(
      text(b.letter ? "qf-strong" : "qf-text", cx, cy + 5.5, "middle", [b.letter ?? b.element]),
    );
    for (const pts of L.brackets) body.push(polyline("qf-line", pts));
    if (L.charge) body.push(text("qf-text", L.charge.x, L.charge.y, "start", [L.charge.text]));
    const counts = and(b.shells.map(String));
    return {
      svg: svgOf(L.H, body),
      // What is drawn: the element's name, its group or its ion's charge may be the question.
      alt: `A diagram of ${b.charge ? `an ion, in square brackets with the charge ${L.charge!.text} at the top right` : "an atom"}: a nucleus labelled ${b.letter ?? b.element}, with ${b.shells.length === 1 ? `one shell holding ${counts} electron${b.shells[0] === 1 ? "" : "s"}` : `${b.shells.length} shells around it holding ${counts} electrons, from the inside out`}.`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    const [cx, cy] = L.c;
    const ring = (r: number) =>
      d.shapes.some(
        (s) =>
          s.name === "circle" &&
          s.cls === "qf-line" &&
          t.near(s.r, r) &&
          t.near(s.at[0], cx) &&
          t.near(s.at[1], cy),
      );
    if (!ring(NUCLEUS)) out.push(`The nucleus is not drawn at ${t.at(L.c)} with radius ${NUCLEUS}`);
    b.shells.forEach((_, k) => {
      if (!ring(RADII[k]))
        out.push(`Shell ${k + 1} is not drawn around the nucleus with radius ${RADII[k]}`);
    });
    const rings = d.shapes.filter((s) => s.name === "circle" && s.cls === "qf-line").length;
    if (rings !== b.shells.length + 1)
      out.push(
        `The diagram has ${rings} circles; the nucleus and ${b.shells.length} shell${b.shells.length === 1 ? "" : "s"} need ${b.shells.length + 1}`,
      );

    // Each electron counted on the shell whose radius it sits on.
    const onShell = b.shells.map(() => 0);
    const electrons = d.shapes.filter((s) => s.name === "circle" && s.cls === "qf-ink");
    for (const e of electrons) {
      if (!t.near(e.r, ELECTRON))
        out.push(`The electron at ${t.at(e.at)} is not drawn with radius ${ELECTRON}`);
      const r = Math.hypot(e.at[0] - cx, e.at[1] - cy);
      const k = RADII.findIndex((R) => t.near(r, R));
      if (k < 0 || k >= b.shells.length)
        out.push(`The electron at ${t.at(e.at)} is not on any of the atom's shells`);
      else onShell[k]++;
    }
    b.shells.forEach((n, k) => {
      if (onShell[k] !== n)
        out.push(
          `Shell ${k + 1} holds ${onShell[k]} electron${onShell[k] === 1 ? "" : "s"}; the brief gives it ${n}`,
        );
      else if (
        !L.electrons
          .filter((e) => e.shell === k)
          .every((e) => electrons.some((s) => t.near(s.at[0], e.at[0]) && t.near(s.at[1], e.at[1])))
      )
        out.push(`Shell ${k + 1}'s electrons are not evenly spaced round it from 12 o'clock`);
    });

    const label = b.letter ?? b.element;
    if (!t.writtenAt(label, cx, cy + 5.5, "middle", b.letter ? "qf-strong" : "qf-text"))
      out.push(`"${label}" is not written in the nucleus`);
    L.brackets.forEach((pts, k) => {
      if (!pts.every((p, m) => m === 0 || t.hasLine(pts[m - 1], p)))
        out.push(
          `The ion's ${k ? "right" : "left"} bracket is not drawn from ${t.at(pts[1])} to ${t.at(pts[2])}`,
        );
    });
    if (L.charge && !t.writtenAt(L.charge.text, L.charge.x, L.charge.y, "start", "qf-text"))
      out.push(`The charge "${L.charge.text}" is not written at the right bracket's top`);

    // Nothing else: a bracket or a charge on an atom makes it an ion.
    const brackets = d.shapes.filter((s) => s.name === "polyline").length;
    if (brackets !== L.brackets.length)
      out.push(
        L.brackets.length
          ? `The ion has ${brackets} brackets; it needs 2`
          : `An atom has no brackets; this one has ${brackets}`,
      );
    for (const s of d.shapes)
      if (
        !(s.name === "circle" && (s.cls === "qf-line" || s.cls === "qf-ink")) &&
        !(s.name === "polyline" && s.cls === "qf-line")
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the atom`);
    const allowed = new Set([label, ...(L.charge ? [L.charge.text] : [])]);
    const pieces = t.pieces();
    for (const p of pieces)
      if (!allowed.has(p.text))
        out.push(`Text "${p.text}" is not the ${b.letter ? "letter" : "symbol"} or the charge`);
    if (pieces.length !== allowed.size)
      out.push(`The diagram has ${pieces.length} texts; it needs ${allowed.size}`);
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The diagram shows the electronic structure of an atom of element X. In which group of the periodic table is element X?",
      options: ["Group 1", "Group 2", "Group 3", "Group 0"],
      brief: { kind: "electron-shells", element: "Mg", charge: 0, shells: [2, 8, 2], letter: "X" },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows the electronic structure of a sodium atom. Describe what happens to the sodium atom's electrons when it reacts with chlorine to form sodium chloride.",
      brief: { kind: "electron-shells", element: "Na", charge: 0, shells: [2, 8, 1], letter: null },
    },
    {
      subject: "chemistry",
      question:
        "The diagram shows an oxide ion. How many protons, neutrons and electrons does it have? The relative atomic mass of oxygen is 16.",
      brief: { kind: "electron-shells", element: "O", charge: -2, shells: [2, 8], letter: null },
    },
  ],
  random(r) {
    const element = ELEMENTS[Math.floor(r() * ELEMENTS.length)];
    const z = ELEMENTS.indexOf(element) + 1;
    const roll = r();
    // Mostly atoms and their own ions; now and then a charge the element never takes.
    const charge = roll < 0.55 ? 0 : roll < 0.9 ? (ION[element] ?? 0) : Math.floor(r() * 7) - 3;
    const shells = fill(z - charge);
    // A writer's slip: an ion drawn with its atom's shells, or one electron out.
    const slip = r();
    if (slip < 0.08 && charge) shells.splice(0, shells.length, ...fill(z));
    else if (slip < 0.14) shells[shells.length - 1] += 1;
    return {
      kind: "electron-shells",
      element,
      charge,
      shells,
      letter: r() < 0.25 ? "X" : null,
    };
  },
};
