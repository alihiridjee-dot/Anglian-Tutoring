/**
 * Particle diagrams: one to four boxes, lettered A, B, C, D when there is
 * more than one, each holding particles of one to three atoms in a row. An
 * atom is black, shaded or white, and the atoms of one particle overlap a
 * little, so a particle reads as one even where it touches its neighbours.
 * A solid's particles touch in regular rows from the box's floor; a
 * liquid's touch but lie irregularly at the bottom, a first row with gaps
 * and the rest settled on it; a gas's are spread far apart. Every atom's
 * place follows from the brief, so the checker can count each box's
 * particles by their atoms and hold each box to its arrangement's rule.
 */
import type { Pt } from "../figureCheck";
import { and, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";

const ATOMS = ["black", "shaded", "white"] as const;
type Atom = (typeof ATOMS)[number];
const ARRANGEMENTS = ["solid", "liquid", "gas"] as const;
type Arrangement = (typeof ARRANGEMENTS)[number];

export type ParticleBrief = {
  kind: "particle-diagram";
  /** In order: A, B, C, D. */
  boxes: {
    arrangement: Arrangement;
    /** Each kind of particle: its atoms in a row, and how many of it. */
    particles: { atoms: Atom[]; count: number }[];
  }[];
};

const CLASS: Record<Atom, string> = { black: "qf-ink", shaded: "qf-dot", white: "qf-line" };
/** An atom's radius; how far apart a particle's own atoms are (overlapping); two particles touching. */
const R = 7;
const BOND = 11;
const TOUCH = 2 * R;
/** The least room between two gas particles' atoms. */
const GAS_GAP = 8;
/** The least room between an atom and its box's wall. */
const PAD = 4;
const LETTERS = "ABCD";
/** Most particles a box may hold, by arrangement. */
const MOST: Record<Arrangement, number> = { solid: 30, liquid: 30, gas: 10 };
const LEAST: Record<Arrangement, number> = { solid: 4, liquid: 4, gas: 2 };

/** The boxes for each number of them: the canvas height, each box's size and top-left corner. */
const FRAMES: Record<number, { H: number; w: number; h: number; at: Pt[] }> = {
  1: { H: 200, w: 200, h: 140, at: [[80, 30]] },
  2: {
    H: 200,
    w: 156,
    h: 140,
    at: [
      [16, 16],
      [188, 16],
    ],
  },
  3: {
    H: 200,
    w: 104,
    h: 120,
    at: [
      [12, 24],
      [128, 24],
      [244, 24],
    ],
  },
  4: {
    H: 320,
    w: 156,
    h: 110,
    at: [
      [16, 16],
      [188, 16],
      [16, 166],
      [188, 166],
    ],
  },
};
/** Where a box's letter is written: centred under it. */
const letterAt = (x0: number, y0: number, w: number, h: number): Pt => [x0 + w / 2, y0 + h + 22];

/** Where atom centres may go in a box: its walls less the padding and an atom's radius. */
type Room = { left: number; right: number; top: number; floor: number };
const roomOf = (x0: number, y0: number, w: number, h: number): Room => ({
  left: x0 + PAD + R,
  right: x0 + w - PAD - R,
  top: y0 + PAD + R,
  floor: y0 + h - PAD - R,
});

type Placed = { atoms: Atom[]; x: number; y: number };
/** The centre-to-centre span of a particle's atoms. */
const span = (atoms: Atom[]) => BOND * (atoms.length - 1);
/** Each atom's centre in a particle placed with its first atom at (x, y). */
const centres = (p: Placed): Pt[] => p.atoms.map((_, i) => [p.x + i * BOND, p.y]);

/**
 * The box's particles in the order they are placed: each kind spread
 * evenly through the others, so a few particles of one kind among many of
 * another are scattered, not bunched at one end.
 */
function sequence(particles: { atoms: Atom[]; count: number }[]): Atom[][] {
  return particles
    .flatMap((p, k) =>
      Array.from({ length: p.count }, (_, j) => ({ atoms: p.atoms, key: (j + 0.5) / p.count, k })),
    )
    .sort((a, b) => a.key - b.key || a.k - b.k)
    .map((p) => p.atoms);
}

/** A solid: touching rows from the floor up, every row starting at the same x, as near square as fits. */
function solid(seq: Atom[][], room: Room): Placed[] | null {
  const n = seq.length;
  const foot = seq.reduce((s, a) => s + span(a) + TOUCH, 0) / n;
  const most = Math.floor((room.floor - room.top) / TOUCH) + 1;
  for (
    let rows = Math.max(1, Math.round(Math.sqrt((n * foot) / (TOUCH * 1.3))));
    rows <= most;
    rows++
  ) {
    const per = Math.ceil(n / rows);
    const lines = Array.from({ length: Math.ceil(n / per) }, (_, k) =>
      seq.slice(k * per, (k + 1) * per),
    );
    const width = Math.max(...lines.map((l) => l.reduce((s, a) => s + span(a) + TOUCH, 0) - TOUCH));
    if (width > room.right - room.left) continue;
    const left = (room.left + room.right) / 2 - width / 2;
    return lines.flatMap((l, k) => {
      let x = left;
      return l.map((atoms) => {
        const p = { atoms, x, y: room.floor - k * TOUCH };
        x += span(atoms) + TOUCH;
        return p;
      });
    });
  }
  return null;
}

/** Where a particle comes to rest dropped at x: on the floor, or on the highest atom beneath it. */
function settle(atoms: Atom[], x: number, placed: Placed[], floor: number): number {
  let y = floor;
  for (let i = 0; i < atoms.length; i++)
    for (const p of placed)
      for (const [ex, ey] of centres(p)) {
        const dx = Math.abs(x + i * BOND - ex);
        if (dx < TOUCH) y = Math.min(y, ey - Math.sqrt(TOUCH ** 2 - dx ** 2));
      }
  return y;
}

/**
 * A liquid: a first row along the floor, touching in twos and threes with
 * gaps between, then the rest dropped onto it at scattered places, each
 * settling where it first touches another. The first lands in the hollow
 * between the first two, so the liquid is never a solid's rows.
 */
function liquid(seq: Atom[][], room: Room): Placed[] | null {
  const n = seq.length;
  // Gaps after the 2nd, 5th, 8th… particle, so each sits beside a touching neighbour.
  const rowWidth = (k: number) =>
    seq
      .slice(0, k)
      .reduce((s, a, j) => s + span(a) + TOUCH + (j % 3 === 1 && j + 2 < k ? 6 : 0), 0) - TOUCH;
  let k = Math.min(n - 1, Math.ceil(n * 0.6));
  while (k > 2 && rowWidth(k) > room.right - room.left) k--;
  if (rowWidth(k) > room.right - room.left) return null;
  const placed: Placed[] = [];
  let x = (room.left + room.right) / 2 - rowWidth(k) / 2;
  seq.slice(0, k).forEach((atoms, j) => {
    placed.push({ atoms, x, y: room.floor });
    x += span(atoms) + TOUCH + (j % 3 === 1 && j + 2 < k ? 6 : 0);
  });
  const from = placed[0].x;
  const to = placed[k - 1].x + span(placed[k - 1].atoms);
  for (let j = k; j < n; j++) {
    const atoms = seq[j];
    const reach = Math.max(0, to - from - span(atoms));
    const x =
      j === k
        ? placed[0].x + span(placed[0].atoms) + TOUCH / 2
        : from + (((j - k) * 0.618034 + 0.37) % 1) * reach;
    const y = settle(atoms, x, placed, room.floor);
    if (y < room.top || x + span(atoms) > room.right) return null;
    placed.push({ atoms, x, y });
  }
  // Settled where they first touch, they never all fall into a solid's rows; if they did, refuse.
  return inRows(placed, room.floor) ? null : placed;
}

/** The least distance between two particles' atoms. */
const apartAt = (a: Pt[], b: Pt[]) =>
  Math.min(...a.flatMap(([x, y]) => b.map(([u, v]) => Math.hypot(x - u, y - v))));
const apart = (a: Placed, b: Placed) => apartAt(centres(a), centres(b));

/**
 * Whether particles sit as a solid's do: in rows a touch apart from the
 * floor up, every row starting at the same x, each particle touching the
 * next along its row.
 */
function inRows(placed: Placed[], floor: number): boolean {
  const close = (a: number, b: number, by = 0.6) => Math.abs(a - b) <= by;
  const level = (y: number) => (floor - y) / TOUCH;
  if (!placed.every((p) => close(level(p.y), Math.round(level(p.y)), 0.05))) return false;
  const lines = new Map<number, Placed[]>();
  for (const p of placed) {
    const k = Math.round(level(p.y));
    lines.set(k, [...(lines.get(k) ?? []), p]);
  }
  const rows = [...lines.values()].map((l) => [...l].sort((p, q) => p.x - q.x));
  return (
    lines.has(0) &&
    rows.every((l) => close(l[0].x, rows[0][0].x)) &&
    rows.every((l) =>
      l.every((p, j) => j === 0 || close(p.x - (l[j - 1].x + span(l[j - 1].atoms)), TOUCH)),
    )
  );
}

/**
 * A gas: each particle in turn at the spot farthest from those already
 * placed and from the walls, so however many there are they spread out.
 */
function gas(seq: Atom[][], room: Room): Placed[] | null {
  const placed: Placed[] = [];
  for (const atoms of seq) {
    const s = span(atoms);
    let best: Placed | null = null;
    let score = -Infinity;
    for (let x = room.left; x + s <= room.right + 1e-9; x += 6)
      for (let y = room.top; y <= room.floor + 1e-9; y += 6) {
        const p = { atoms, x, y };
        const wall = Math.min(x - room.left, room.right - x - s, y - room.top, room.floor - y);
        const near = Math.min(2 * wall + TOUCH, ...placed.map((q) => apart(p, q)));
        if (near > score + 1e-9) [best, score] = [p, near];
      }
    if (!best || placed.some((q) => apart(best!, q) < TOUCH + GAS_GAP)) return null;
    placed.push(best);
  }
  return placed;
}

const ARRANGE: Record<Arrangement, (seq: Atom[][], room: Room) => Placed[] | null> = {
  solid,
  liquid,
  gas,
};

/** Every box's frame, letter and particles, or null when a box can't hold its particles. */
function layout(b: ParticleBrief) {
  const F = FRAMES[b.boxes.length];
  const boxes = b.boxes.map((box, i) => {
    const [x0, y0] = F.at[i];
    const room = roomOf(x0, y0, F.w, F.h);
    return {
      x0,
      y0,
      room,
      letter: b.boxes.length > 1 ? LETTERS[i] : null,
      letterAt: letterAt(x0, y0, F.w, F.h),
      placed: ARRANGE[box.arrangement](sequence(box.particles), room),
    };
  });
  return { H: F.H, w: F.w, h: F.h, boxes };
}

/** A particle's atoms read the same either way along it. */
const signature = (atoms: Atom[]) => {
  const there = atoms.join("–");
  const back = [...atoms].reverse().join("–");
  return there < back ? there : back;
};
const WORDS = ["", "one", "two", "three"];
/** A particle in words: "two white atoms joined", "a black atom between two white atoms". */
function describe(atoms: Atom[]): string {
  if (atoms.every((a) => a === atoms[0]))
    return atoms.length === 1
      ? `a single ${atoms[0]} atom`
      : `${WORDS[atoms.length]} ${atoms[0]} atoms joined`;
  if (atoms.length === 3 && atoms[0] === atoms[2])
    return `a ${atoms[1]} atom between two ${atoms[0]} atoms`;
  return `${and(atoms.map((a) => `a ${a}`))} atom joined in a row`;
}
/** A word from the brief as the kind spells it: "Solid " is "solid". */
const word = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const HOW: Record<Arrangement, string> = {
  solid: "touching in regular rows",
  liquid: "touching but arranged irregularly at the bottom",
  gas: "spread far apart",
};

export const particleDiagram: FigureKind<ParticleBrief> = {
  kind: "particle-diagram",
  name: "particle diagrams of states and mixtures",
  guide:
    'boxes: 1 to 4, in order (with more than one the website letters them A, B, C, D), each {arrangement: "solid" (particles touching in regular rows), "liquid" (touching, irregular) or "gas" (far apart); particles: 1 to 3 kinds, each {atoms: the particle\'s 1 to 3 atoms in a row, each "black", "shaded" or "white" (["white", "white"] is a molecule of an element, ["white", "black", "white"] one of a compound); count: how many of it}}. A box holds 4 to 30 particles as a solid or liquid and 2 to 10 as a gas, fewer when the boxes are many or the particles long; a mixture is one box with more than one kind. Every atom is drawn the same size, and the same kind of atom keeps its colour in every box.',
  read(b) {
    const boxes = b.boxes as { arrangement: unknown; particles: unknown }[];
    if (!Array.isArray(boxes) || boxes.length < 1 || boxes.length > 4)
      return { problem: "needs 1 to 4 boxes" };
    const read: ParticleBrief = { kind: "particle-diagram", boxes: [] };
    for (const [i, box] of boxes.entries()) {
      const name = boxes.length > 1 ? `box ${LETTERS[i]}` : "the box";
      const arrangement = word(box?.arrangement) as Arrangement;
      if (!ARRANGEMENTS.includes(arrangement))
        return { problem: `${name} needs an arrangement: "solid", "liquid" or "gas"` };
      const particles = box.particles as { atoms: unknown; count: unknown }[];
      if (!Array.isArray(particles) || particles.length < 1 || particles.length > 3)
        return { problem: `${name} needs 1 to 3 kinds of particle` };
      const kinds: ParticleBrief["boxes"][number]["particles"] = [];
      for (const p of particles) {
        const atoms = Array.isArray(p?.atoms) ? (p.atoms as unknown[]).map(word) : null;
        if (
          !atoms ||
          atoms.length < 1 ||
          atoms.length > 3 ||
          !atoms.every((a) => ATOMS.includes(a as Atom))
        )
          return {
            problem: `${name} has a particle that is not 1 to 3 atoms, each "black", "shaded" or "white"`,
          };
        if (!Number.isInteger(p.count) || (p.count as number) < 1)
          return { problem: `${name} has a particle count that is not a whole number from 1` };
        kinds.push({ atoms: atoms as Atom[], count: p.count as number });
      }
      if (new Set(kinds.map((k) => signature(k.atoms))).size !== kinds.length)
        return { problem: `${name} lists the same particle twice` };
      const total = kinds.reduce((s, k) => s + k.count, 0);
      if (total < LEAST[arrangement] || total > MOST[arrangement])
        return {
          problem: `${name} needs ${LEAST[arrangement]} to ${MOST[arrangement]} particles as a ${arrangement}`,
        };
      read.boxes.push({ arrangement, particles: kinds });
    }
    const L = layout(read);
    const full = L.boxes.findIndex((x) => !x.placed);
    if (full >= 0)
      return {
        problem: `${read.boxes.length > 1 ? `box ${LETTERS[full]}` : "the box"} can't hold its particles as a ${read.boxes[full].arrangement}: use fewer`,
      };
    return { brief: read };
  },
  draw(b) {
    const L = layout(b);
    const body: string[] = [];
    for (const box of L.boxes) {
      body.push(
        `<rect class="qf-line" x="${box.x0}" y="${box.y0}" width="${L.w}" height="${L.h}"/>`,
      );
      for (const p of box.placed!)
        centres(p).forEach(([x, y], i) =>
          body.push(
            `<circle class="${CLASS[p.atoms[i]]}" cx="${num(x)}" cy="${num(y)}" r="${R}"/>`,
          ),
        );
      if (box.letter) body.push(text("qf-strong", ...box.letterAt, "middle", [box.letter]));
    }
    const said = b.boxes.map((box, i) => {
      const kinds = box.particles.map(
        (p) => `${p.count} particle${p.count === 1 ? "" : "s"} of ${describe(p.atoms)}`,
      );
      return `${b.boxes.length > 1 ? `Box ${LETTERS[i]}` : "The box"} holds ${and(kinds)}, ${HOW[box.arrangement]}.`;
    });
    return {
      svg: svgOf(L.H, body),
      // What is drawn, never what it is: "a mixture", "a gas" may be the answer.
      alt: `${b.boxes.length > 1 ? `${b.boxes.length} boxes of particles, lettered ${and([...LETTERS.slice(0, b.boxes.length)])}` : "A box of particles"}, their atoms drawn as ${and(ATOMS.filter((a) => b.boxes.some((x) => x.particles.some((p) => p.atoms.includes(a)))))} circles. ${said.join(" ")}`,
    };
  },
  check(b, d, t) {
    const L = layout(b);
    const out: string[] = [];
    const atoms = d.shapes
      .filter((s) => s.name === "circle" && ["qf-ink", "qf-dot", "qf-line"].includes(s.cls))
      .map((s) => ({ at: s.at, cls: s.cls, r: s.r }));
    const used = new Set<number>();
    L.boxes.forEach((box, i) => {
      const name = box.letter ? `Box ${box.letter}` : "The box";
      const { x0, y0 } = box;
      const [x1, y1] = [x0 + L.w, y0 + L.h];
      if (
        !t.hasLine([x0, y0], [x1, y0]) ||
        !t.hasLine([x1, y0], [x1, y1]) ||
        !t.hasLine([x1, y1], [x0, y1]) ||
        !t.hasLine([x0, y1], [x0, y0])
      )
        out.push(`${name} is not drawn from (${x0}, ${y0}) to (${x1}, ${y1})`);
      if (box.letter && !t.writtenAt(box.letter, ...box.letterAt, "middle", "qf-strong"))
        out.push(`The letter ${box.letter} is not written under its box`);

      // This box's atoms, joined into particles where they overlap.
      const mine = atoms.flatMap((a, k) =>
        a.at[0] > x0 && a.at[0] < x1 && a.at[1] > y0 && a.at[1] < y1 ? [k] : [],
      );
      mine.forEach((k) => used.add(k));
      const group = mine.map((_, j) => j);
      const root = (j: number): number => (group[j] === j ? j : (group[j] = root(group[j])));
      mine.forEach((k, j) =>
        mine.forEach((m, l) => {
          if (
            l > j &&
            Math.hypot(atoms[k].at[0] - atoms[m].at[0], atoms[k].at[1] - atoms[m].at[1]) <
              BOND + 1.5
          )
            group[root(l)] = root(j);
        }),
      );
      const parts = new Map<number, number[]>();
      mine.forEach((k, j) => parts.set(root(j), [...(parts.get(root(j)) ?? []), k]));
      const particles = [...parts.values()].map((ks) =>
        ks.map((k) => atoms[k]).sort((p, q) => p.at[0] - q.at[0] || p.at[1] - q.at[1]),
      );
      const kindOf = (cls: string) => ATOMS.find((a) => CLASS[a] === cls)!;
      const counted = new Map<string, number>();
      for (const p of particles) {
        const sig = signature(p.map((a) => kindOf(a.cls)));
        counted.set(sig, (counted.get(sig) ?? 0) + 1);
      }
      const brief = b.boxes[i];
      for (const p of brief.particles) {
        const sig = signature(p.atoms);
        const n = counted.get(sig) ?? 0;
        if (n !== p.count)
          out.push(
            `${name} has ${n} particle${n === 1 ? "" : "s"} of ${describe(p.atoms)}; the brief has ${p.count}`,
          );
      }
      for (const [sig, n] of counted)
        if (!brief.particles.some((p) => signature(p.atoms) === sig))
          out.push(
            `${name} has ${n} particle${n === 1 ? "" : "s"} of ${sig} atoms, which the brief doesn't`,
          );

      // The arrangement's rule, read from where the particles are.
      const placed = particles.map((p) => ({
        atoms: p.map((a) => kindOf(a.cls)),
        x: p[0].at[0],
        y: p[0].at[1],
      }));
      const gaps = particles.map((p, j) =>
        Math.min(
          Infinity,
          ...particles
            .filter((_, l) => l !== j)
            .map((q) =>
              apartAt(
                p.map((a) => a.at),
                q.map((a) => a.at),
              ),
            ),
        ),
      );
      if (gaps.some((g) => g < TOUCH - 0.6))
        out.push(`${name} has particles drawn over each other`);
      const rows = inRows(placed, box.room.floor);
      if (brief.arrangement === "solid" && !rows)
        out.push(`${name}'s particles are not in touching rows from its floor, as a solid's are`);
      if (brief.arrangement === "liquid") {
        if (rows)
          out.push(`${name}'s particles are in regular rows, as a solid's are, not a liquid's`);
        placed.forEach((p, j) => {
          if (placed.length > 1 && gaps[j] > TOUCH + 0.6)
            out.push(
              `In ${box.letter ? `box ${box.letter}` : "the box"}, the particle at ${t.at([p.x, p.y])} touches no other, as a liquid's do`,
            );
        });
      }
      if (brief.arrangement === "gas" && gaps.some((g) => g < TOUCH + GAS_GAP - 0.6))
        out.push(
          `${name}'s particles are not far apart, as a gas's are: keep ${GAS_GAP} units between them`,
        );

      // And every atom exactly where the layout puts it.
      const want = box.placed!.flatMap((p) =>
        centres(p).map((at, j) => ({ at, cls: CLASS[p.atoms[j]] })),
      );
      const off = mine.filter(
        (k) =>
          !want.some(
            (w) =>
              w.cls === atoms[k].cls &&
              t.near(w.at[0], atoms[k].at[0]) &&
              t.near(w.at[1], atoms[k].at[1]),
          ),
      );
      if (off.length || mine.length !== want.length)
        out.push(
          `${name} has ${off.length ? `atoms not where its layout puts them, the first at ${t.at(atoms[off[0]].at)}` : `${mine.length} atoms; its particles have ${want.length}`}`,
        );
    });
    atoms.forEach((a, k) => {
      if (!used.has(k)) out.push(`The atom at ${t.at(a.at)} is not inside any box`);
      if (!t.near(a.r, R)) out.push(`The atom at ${t.at(a.at)} is not drawn with radius ${R}`);
    });
    for (const s of d.shapes)
      if (
        !(s.name === "rect" && s.cls === "qf-line") &&
        !(s.name === "circle" && ["qf-ink", "qf-dot", "qf-line"].includes(s.cls))
      )
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the particle diagram`);
    const rects = d.shapes.filter((s) => s.name === "rect").length;
    if (rects !== L.boxes.length)
      out.push(`The diagram has ${rects} boxes; the brief has ${L.boxes.length}`);
    const letters = new Set(L.boxes.flatMap((x) => (x.letter ? [x.letter] : [])));
    const pieces = t.pieces();
    for (const p of pieces)
      if (!letters.has(p.text)) out.push(`Text "${p.text}" is not a box's letter`);
    if (pieces.length !== letters.size)
      out.push(`The diagram has ${pieces.length} texts; it has a letter for each box`);
    return out;
  },
  samples: [
    {
      subject: "chemistry",
      question:
        "The diagrams show the particles in four substances. Which box shows a mixture of an element and a compound?",
      options: ["A", "B", "C", "D"],
      brief: {
        kind: "particle-diagram",
        boxes: [
          { arrangement: "gas", particles: [{ atoms: ["white", "white"], count: 6 }] },
          {
            arrangement: "gas",
            particles: [
              { atoms: ["white", "white"], count: 3 },
              { atoms: ["black", "black"], count: 3 },
            ],
          },
          {
            arrangement: "gas",
            particles: [
              { atoms: ["white", "black", "white"], count: 3 },
              { atoms: ["black", "black"], count: 3 },
            ],
          },
          { arrangement: "gas", particles: [{ atoms: ["white", "black", "white"], count: 5 }] },
        ],
      },
    },
    {
      subject: "chemistry",
      question:
        "The diagrams show how the particles are arranged in the three states of matter. Which box shows the particles in a liquid?",
      options: ["A", "B", "C"],
      brief: {
        kind: "particle-diagram",
        boxes: [
          { arrangement: "gas", particles: [{ atoms: ["shaded"], count: 6 }] },
          { arrangement: "solid", particles: [{ atoms: ["shaded"], count: 20 }] },
          { arrangement: "liquid", particles: [{ atoms: ["shaded"], count: 16 }] },
        ],
      },
    },
    {
      subject: "chemistry",
      question:
        "Box A shows the particles in a substance at room temperature. Box B shows the same substance after it has been heated. Name the change of state shown.",
      brief: {
        kind: "particle-diagram",
        boxes: [
          { arrangement: "solid", particles: [{ atoms: ["black"], count: 16 }] },
          { arrangement: "liquid", particles: [{ atoms: ["black"], count: 16 }] },
        ],
      },
    },
  ],
  random(r) {
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const n = 1 + Math.floor(r() * 4);
    return {
      kind: "particle-diagram",
      boxes: Array.from({ length: n }, () => {
        const arrangement = pick(ARRANGEMENTS);
        const kinds = 1 + Math.floor(r() * (r() < 0.6 ? 1 : 3));
        const shapes = [
          ["white"],
          ["black"],
          ["shaded"],
          ["white", "white"],
          ["black", "black"],
          ["white", "black"],
          ["white", "black", "white"],
          ["shaded", "white"],
        ];
        const chosen = Array.from({ length: kinds }, () => pick(shapes));
        const total =
          arrangement === "gas" ? 2 + Math.floor(r() * 8) : 4 + Math.floor(r() * (n > 2 ? 12 : 22));
        return {
          arrangement,
          particles: chosen.map((atoms, k) => ({
            atoms,
            count: Math.max(1, Math.round(total / kinds) + (k === 0 ? 0 : -k)),
          })),
        };
      }),
    };
  },
};
