/**
 * An evolutionary tree (a cladogram) of 3 to 8 species, rooted on the left
 * and drawn square: each branch point is an upright line joining its
 * branches, each branch a line across to the next branch point or to a
 * species named at the right. With a time scale the branch points stand at
 * their ages, in millions of years ago, over a scale with a faint line up
 * from each number; without one they stand a step apart. A branch point may
 * carry a letter, written just above where its branch comes in. The checker
 * reads the tree back from its lines alone and compares its grouping, the
 * order of the names, each branch point's age and each letter with the brief.
 */
import { TEXT_SIZE, textWidth } from "../figure";
import type { Pt } from "../figureCheck";
import { and, every, label, line, svgOf, text, ticks } from "../figureSvg";
import type { FigureKind } from "./kind";
import { canvasHeight, square, type Seg } from "./linework";

export type Clade = string | { branches: Clade[]; mya: number | null; letter: string };
export type EvolutionBrief = {
  kind: "evolutionary-tree";
  tree: Clade;
  /** A time scale in millions of years ago, from max on the left to 0 at the species; null for none. */
  axis: { max: number; step: number } | null;
};

/** Every species' branch ends at TIP, its name starting at NAME. */
const TIP = 232;
const NAME = 240;
/** The farthest left a branch point stands, and the root's stem. */
const LEFT = 36;
const STEM = 16;
/** The first species' line, and the step down to the next. */
const FIRST = 28;
const PITCH = 32;
/** The widest step between branch points without a scale. */
const COLUMN = 48;
/** How far apart a branch point and the one it branches from must stand: lettered, and not. */
const LETTERED_GAP = 24;
const GAP = 12;
/** The scale's line below the last species, and its title. */
const AXIS_BELOW = 28;
const AXIS_TITLE = "millions of years ago";
const TEXT = TEXT_SIZE["qf-text"]!;
const SMALL = TEXT_SIZE["qf-small"]!;

type Node = {
  /** The brief's branch point, or a species' name. */
  clade: Clade;
  x: number;
  y: number;
  top: number;
  bottom: number;
  children: Node[];
};

const isLeaf = (c: Clade): c is string => typeof c === "string";
const leavesOf = (c: Clade): string[] => (isLeaf(c) ? [c] : c.branches.flatMap(leavesOf));
const groupsOf = (c: Clade): Exclude<Clade, string>[] =>
  isLeaf(c) ? [] : [c, ...c.branches.flatMap(groupsOf)];
/** Steps from a branch point to its farthest species. */
const height = (c: Clade): number => (isLeaf(c) ? 0 : 1 + Math.max(...c.branches.map(height)));
/** A grouping written out with its branches in order: ((human, chimpanzee), gorilla). */
const written = (c: Clade): string => (isLeaf(c) ? c : `(${c.branches.map(written).join(", ")})`);
/** The same, sorted, so two drawings of one grouping compare equal. */
const sorted = (c: Clade): string =>
  isLeaf(c) ? c : `(${c.branches.map(sorted).sort().join(",")})`;

const xOfAge = (mya: number, max: number) => TIP - (mya / max) * (TIP - LEFT);

/** Where every branch point and species goes, and the canvas. */
function layout(b: EvolutionBrief) {
  const names = leavesOf(b.tree);
  const column = Math.min(COLUMN, (TIP - LEFT) / height(b.tree));
  const place = (c: Clade): Node => {
    if (isLeaf(c)) {
      const y = FIRST + PITCH * names.indexOf(c);
      return { clade: c, x: TIP, y, top: y, bottom: y, children: [] };
    }
    const children = c.branches.map(place);
    const top = children[0].y;
    const bottom = children[children.length - 1].y;
    const x = b.axis ? xOfAge(c.mya!, b.axis.max) : TIP - column * height(c);
    return { clade: c, x, y: (top + bottom) / 2, top, bottom, children };
  };
  const root = place(b.tree);
  const last = FIRST + PITCH * (names.length - 1);
  const axisY = b.axis ? last + AXIS_BELOW : null;
  return {
    root,
    names,
    axisY,
    H: canvasHeight(axisY === null ? last + 24 : axisY + 52),
  };
}
type Layout = ReturnType<typeof layout>;
const nodes = (n: Node): Node[] => [n, ...n.children.flatMap(nodes)];

/** Each branch point's line, and each branch's, as drawn. */
function treeLines(l: Layout): Seg[] {
  const out: Seg[] = [
    [
      [l.root.x - STEM, l.root.y],
      [l.root.x, l.root.y],
    ],
  ];
  for (const n of nodes(l.root)) {
    if (!n.children.length) continue;
    out.push([
      [n.x, n.top],
      [n.x, n.bottom],
    ]);
    for (const c of n.children)
      out.push([
        [n.x, c.y],
        [c.x, c.y],
      ]);
  }
  return out;
}
/** A branch point's letter: just above its incoming branch, left of its line. */
const letterAt = (n: Node): Pt => [n.x - 5, n.y - 6];

/** The scale: each tick's value and place, and which are numbered. */
function scale(b: EvolutionBrief) {
  if (!b.axis) return [];
  const a = { title: AXIS_TITLE, min: 0, max: b.axis.max, step: b.axis.step };
  const vs = ticks(a);
  const widest = Math.max(...vs.map((v) => textWidth(label(v), SMALL)));
  const k = every((TIP - LEFT) / (vs.length - 1), widest + 6);
  return vs.map((v, i) => ({ v, x: xOfAge(v, b.axis!.max), numbered: i % k === 0 }));
}

const LETTER = /^[A-Z]$/;

/** A species or branch point as the writer gave it, tidied, or what is wrong with it. */
function readClade(v: unknown): { clade: Clade } | { problem: string } {
  if (typeof v === "string")
    return v.trim() ? { clade: v.trim() } : { problem: "has a species without a name" };
  const o = v as { branches?: unknown; mya?: unknown; letter?: unknown } | null;
  const branches = Array.isArray(v) ? v : o?.branches;
  if (!Array.isArray(branches) || branches.length < 2 || branches.length > 3)
    return { problem: "has a branch point that doesn't split into 2 or 3 branches" };
  const mya = Array.isArray(v) ? null : (o!.mya ?? null);
  if (mya !== null && (typeof mya !== "number" || !Number.isFinite(mya) || mya <= 0))
    return { problem: "has a branch point whose mya is not a number above 0, or null" };
  const letter = Array.isArray(v) ? "" : (o!.letter ?? "");
  if (typeof letter !== "string" || (letter.trim() && !LETTER.test(letter.trim())))
    return { problem: 'has a branch point whose letter is not one capital letter or ""' };
  const read: Clade[] = [];
  for (const c of branches) {
    const r = readClade(c);
    if ("problem" in r) return r;
    read.push(r.clade);
  }
  return { clade: { branches: read, mya, letter: letter.trim() } };
}

export const evolutionaryTree: FigureKind<EvolutionBrief> = {
  kind: "evolutionary-tree",
  name: "an evolutionary tree",
  guide:
    'tree: the species\' grouping, nested: a species is its name (at most 20 characters, short enough to write beside its branch), and a branch point is {branches: 2 or 3 species or branch points, top to bottom; mya: how many millions of years ago it split, or null; letter: one capital letter the question asks about, or ""}, or just a list of its branches when it has neither; 3 to 8 species in all, each named once. axis: {max, step} for a time scale in millions of years ago from max on the left to 0 at the species, 2 to 12 steps, every branch point then given its mya, each younger than the one it branches from by at least a sixteenth of max (an eighth when it is lettered), and the youngest at least a sixteenth of max ago; or null for no scale, with every mya null. The website draws the tree square, rooted on the left, with the species named at the right in the order given.',
  read(b) {
    const got = readClade(b.tree);
    if ("problem" in got) return got;
    const tree = got.clade;
    if (isLeaf(tree)) return { problem: "needs a tree that branches" };
    const names = leavesOf(tree);
    if (names.length < 3 || names.length > 8) return { problem: "needs 3 to 8 species" };
    if (new Set(names).size !== names.length) return { problem: "names a species twice" };
    if (names.some((n) => [...n].length > 20 || textWidth(n, TEXT) > 358 - NAME))
      return { problem: "has a species name too long to write beside its branch" };
    const groups = groupsOf(tree);
    const letters = groups.map((g) => g.letter).filter(Boolean);
    if (new Set(letters).size !== letters.length)
      return { problem: "gives two branch points one letter" };
    let axis: EvolutionBrief["axis"] = null;
    if (b.axis !== null && b.axis !== undefined) {
      const a = b.axis as { max: unknown; step: unknown };
      const { max, step } = a ?? {};
      if (typeof max !== "number" || typeof step !== "number" || !(max > 0) || !(step > 0))
        return { problem: "axis needs a max and a step above 0" };
      const steps = max / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-6 || steps < 2 - 1e-6 || steps > 12 + 1e-6)
        return { problem: "axis must run from max to 0 in 2 to 12 whole steps" };
      if (textWidth(label(max), SMALL) > 2 * LEFT - 8)
        return { problem: "axis numbers are too long to fit" };
      axis = { max, step };
      // Each branch point younger than the one it branches from, and far enough
      // from it to be told apart, or to hold its letter.
      const ages = (g: Exclude<Clade, string>, parent: number | null): string | null => {
        if (g.mya === null) return "has a time scale, so every branch point needs its mya";
        if (g.mya > max + 1e-9) return "has a branch point older than the scale's max";
        if (TIP - xOfAge(g.mya, max) < GAP)
          return "has a branch point too close to the present to draw its branches";
        if (parent !== null) {
          if (g.mya >= parent) return "has a branch point older than the one it branches from";
          const gap = xOfAge(g.mya, max) - xOfAge(parent, max);
          if (gap < (g.letter ? LETTERED_GAP : GAP))
            return `has branch points too close in time to draw apart${g.letter ? ` with the letter ${g.letter}` : ""}`;
        }
        for (const c of g.branches) {
          if (isLeaf(c)) continue;
          const p = ages(c, g.mya);
          if (p) return p;
        }
        return null;
      };
      const problem = ages(tree, null);
      if (problem) return { problem };
    } else if (groups.some((g) => g.mya !== null))
      return { problem: "gives a branch point's mya but has no time scale" };
    return { brief: { kind: "evolutionary-tree", tree, axis } };
  },
  draw(b) {
    const l = layout(b);
    const body: string[] = [];
    if (b.axis && l.axisY !== null) {
      for (const s of scale(b)) {
        body.push(line("qf-thin", s.x, FIRST - 16, s.x, l.axisY));
        body.push(line("qf-line", s.x, l.axisY, s.x, l.axisY + 6));
        if (s.numbered) body.push(text("qf-small", s.x, l.axisY + 22, "middle", [label(s.v)]));
      }
      body.push(line("qf-line", LEFT, l.axisY, TIP, l.axisY));
      body.push(text("qf-text", (LEFT + TIP) / 2, l.axisY + 44, "middle", [AXIS_TITLE]));
    }
    for (const [a, c] of treeLines(l)) body.push(line("qf-line", a[0], a[1], c[0], c[1]));
    for (const n of nodes(l.root)) {
      if (isLeaf(n.clade)) body.push(text("qf-text", NAME, n.y + 5.5, "start", [n.clade]));
      else if (n.clade.letter)
        body.push(text("qf-strong", ...letterAt(n), "end", [n.clade.letter]));
    }
    const letters = groupsOf(b.tree)
      .map((g) => g.letter)
      .filter(Boolean);
    return {
      svg: svgOf(l.H, body),
      // Neither the grouping nor the ages: which species are closest, and when they split, are the questions.
      alt: `An evolutionary tree branching from a common ancestor on the left to ${l.names.length} species named on the right, from top to bottom: ${and(l.names)}.${b.axis ? ` A time scale below runs from ${label(b.axis.max)} million years ago to the present.` : ""}${letters.length ? ` ${letters.length === 1 ? "One branch point is" : "Branch points are"} lettered ${and(letters)}.` : ""}`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const l = layout(b);
    const segs = d.segments.filter((s) => s.cls === "qf-line").map((s) => s.seg);
    const take = (want: Seg) => {
      const i = segs.findIndex(
        (s) =>
          (t.near(s[0][0], want[0][0]) &&
            t.near(s[0][1], want[0][1]) &&
            t.near(s[1][0], want[1][0]) &&
            t.near(s[1][1], want[1][1])) ||
          (t.near(s[1][0], want[0][0]) &&
            t.near(s[1][1], want[0][1]) &&
            t.near(s[0][0], want[1][0]) &&
            t.near(s[0][1], want[1][1])),
      );
      if (i >= 0) segs.splice(i, 1);
      return i >= 0;
    };

    // The scale: its line, a tick and a faint line at each value, its numbers and title.
    const marks = scale(b);
    if (b.axis && l.axisY !== null) {
      const y = l.axisY;
      if (
        !take([
          [LEFT, y],
          [TIP, y],
        ])
      )
        out.push(`The time scale's line is not drawn from (${LEFT}, ${y}) to (${TIP}, ${y})`);
      for (const s of marks) {
        if (
          !take([
            [s.x, y],
            [s.x, y + 6],
          ])
        )
          out.push(`The time scale has no tick at ${label(s.v)} (x = ${t.fmt(s.x)})`);
        if (
          !d.segments.some(
            (g) => g.cls === "qf-thin" && t.near(g.seg[0][0], s.x) && t.near(g.seg[1][0], s.x),
          )
        )
          out.push(`There is no faint line up from ${label(s.v)} on the time scale`);
        if (s.numbered && !t.writtenAt(label(s.v), s.x, y + 22, "middle", "qf-small"))
          out.push(`The time scale's number ${label(s.v)} is not under its tick`);
      }
      if (!t.writtenAt(AXIS_TITLE, (LEFT + TIP) / 2, y + 44, "middle", "qf-text"))
        out.push(`The time scale is not titled "${AXIS_TITLE}"`);
    }
    for (const s of d.segments)
      if (
        s.cls === "qf-thin" &&
        !(
          b.axis &&
          marks.some(
            (m) =>
              t.near(s.seg[0][0], m.x) &&
              t.near(s.seg[1][0], m.x) &&
              t.near(s.seg[0][1], FIRST - 16) &&
              t.near(s.seg[1][1], l.axisY!),
          )
        )
      )
        out.push(
          `The faint line from ${t.at(s.seg[0])} to ${t.at(s.seg[1])} is not one of the time scale's`,
        );

    // The tree read back from its lines: upright lines are branch points,
    // lines across are branches, each from the branch point at its left end
    // to the branch point or species name at its right.
    const ups = segs
      .filter((s) => square(s) && Math.abs(s[0][0] - s[1][0]) <= 0.5)
      .map((s) => ({
        x: s[0][0],
        top: Math.min(s[0][1], s[1][1]),
        bottom: Math.max(s[0][1], s[1][1]),
      }));
    const across = segs.filter(
      (s) => square(s) && Math.abs(s[0][1] - s[1][1]) <= 0.5 && Math.abs(s[0][0] - s[1][0]) > 0.5,
    );
    for (const s of segs)
      if (!square(s))
        out.push(
          `The line from ${t.at(s[0])} to ${t.at(s[1])} is slanted: the tree's lines run across or up and down`,
        );
    type Up = (typeof ups)[number];
    const upAt = ([x, y]: Pt) =>
      ups.find((u) => t.near(u.x, x) && y >= u.top - 0.75 && y <= u.bottom + 0.75);
    const nameAt = ([x, y]: Pt) =>
      t
        .pieces()
        .find(
          (p) =>
            p.cls === "qf-text" &&
            t.near(p.x, x + NAME - TIP, 1) &&
            t.near(p.y, y + 5.5, 1) &&
            p.anchor === "start",
        )?.text;
    type Read = { up: Up | null; name: string | null; y: number; children: Read[] };
    const branches = across.map((s) => {
      const [a, c] = s[0][0] < s[1][0] ? s : [s[1], s[0]];
      return {
        from: upAt(a),
        to: upAt(c) ?? null,
        name: upAt(c) ? null : nameAt(c),
        y: a[1],
        seg: [a, c] as Seg,
      };
    });
    const stems = branches.filter((h) => !h.from);
    for (const h of stems)
      if (!h.to)
        out.push(`The branch from ${t.at(h.seg[0])} to ${t.at(h.seg[1])} joins no branch point`);
    for (const h of branches)
      if (!h.to && !h.name)
        out.push(
          `The branch from ${t.at(h.seg[0])} to ${t.at(h.seg[1])} ends at neither a branch point nor a species' name`,
        );
    // The root is the one branch point with a stem into it from nothing.
    const rooted = stems.filter((h) => h.to);
    if (rooted.length !== 1) {
      out.push(
        `The tree must have one root: one branch point with a short stem into it from the left (it has ${rooted.length})`,
      );
      return out;
    }
    const root = rooted[0].to!;
    for (const u of ups) {
      const into = branches.filter((h) => h.to === u).length;
      if (into > 1)
        out.push(`The branch point at x = ${t.fmt(u.x)} has ${into} branches coming into it`);
      if (!into)
        out.push(
          `The upright line from ${t.at([u.x, u.top])} to ${t.at([u.x, u.bottom])} has no branch into it`,
        );
    }
    const seen = new Set<Up>();
    const build = (u: Up): Read | null => {
      if (seen.has(u)) return null;
      seen.add(u);
      const kids = branches.filter((h) => h.from === u).sort((p, q) => p.y - q.y);
      if (kids.length < 2)
        out.push(
          `The branch point at x = ${t.fmt(u.x)} has ${kids.length} branch: it needs 2 or 3`,
        );
      else if (!t.near(u.top, kids[0].y) || !t.near(u.bottom, kids[kids.length - 1].y))
        out.push(
          `The branch point at x = ${t.fmt(u.x)} does not run exactly from its top branch to its bottom one`,
        );
      const children: Read[] = [];
      for (const h of kids) {
        if (h.to) {
          const c = build(h.to);
          if (c) children.push(c);
        } else if (h.name) children.push({ up: null, name: h.name, y: h.y, children: [] });
      }
      return { up: u, name: null, y: (u.top + u.bottom) / 2, children };
    };
    const tree = build(root)!;
    for (const u of ups)
      if (!seen.has(u) && branches.some((h) => h.to === u))
        out.push(`The branch point at x = ${t.fmt(u.x)} is not joined to the tree`);
    const asClade = (r: Read): Clade =>
      r.name ?? { branches: r.children.map(asClade), mya: null, letter: "" };
    const drawnTree = asClade(tree);
    if (sorted(drawnTree) !== sorted(b.tree)) {
      out.push(
        `The branches drawn group the species as ${written(drawnTree)}; the brief groups them as ${written(b.tree)}`,
      );
      return out;
    }
    const order = leavesOf(drawnTree);
    if (order.join() !== l.names.join())
      out.push(
        `The species are named top to bottom as ${and(order)}; the brief has ${and(l.names)}`,
      );

    // Each branch point found by the species it joins: at its age, with its letter.
    const reads = (r: Read): Read[] => [r, ...r.children.flatMap(reads)];
    const joining = (c: Clade) => leavesOf(c).sort().join();
    const byLeaves = new Map(
      reads(tree)
        .filter((r) => r.up)
        .map((r) => [joining(asClade(r)), r]),
    );
    for (const g of groupsOf(b.tree)) {
      const r = byLeaves.get(joining(g));
      if (!r?.up) continue;
      const who = `joining ${and(leavesOf(g))}`;
      if (b.axis && !t.near(r.up.x, xOfAge(g.mya!, b.axis.max)))
        out.push(
          `The branch point ${who} is not at ${label(g.mya!)} million years ago (x = ${t.fmt(xOfAge(g.mya!, b.axis.max))})`,
        );
      if (!g.letter) continue;
      const beside = t.letterBeside([r.up.x, r.y]);
      if (!beside) out.push(`The letter ${g.letter} is not beside the branch point ${who}`);
      else if (beside.text !== g.letter)
        out.push(
          `The letter beside the branch point ${who} is "${beside.text}"; the brief gives it ${g.letter}`,
        );
    }

    // Nothing else: lines only, and only the names, letters and scale.
    for (const s of d.shapes)
      if (s.name !== "line" || s.marked || (s.cls !== "qf-line" && s.cls !== "qf-thin"))
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the evolutionary tree`);
    // Each letter only at its own branch point: a letter by another reads as that one's.
    const words = [
      ...nodes(l.root).flatMap((n) =>
        isLeaf(n.clade)
          ? [{ text: n.clade, at: [NAME, n.y + 5.5] as Pt }]
          : n.clade.letter
            ? [{ text: n.clade.letter, at: letterAt(n) }]
            : [],
      ),
      ...(l.axisY === null
        ? []
        : [
            ...marks
              .filter((m) => m.numbered)
              .map((m) => ({ text: label(m.v), at: [m.x, l.axisY! + 22] as Pt })),
            { text: AXIS_TITLE, at: [(LEFT + TIP) / 2, l.axisY + 44] as Pt },
          ]),
    ];
    for (const p of t.pieces())
      if (
        !words.some((w) => w.text === p.text && t.near(p.x, w.at[0], 1) && t.near(p.y, w.at[1], 1))
      )
        out.push(
          `Text "${p.text}" is not a species' name, a branch point's letter or part of the time scale`,
        );
    return out;
  },
  samples: [
    {
      subject: "biology",
      question:
        "The evolutionary tree shows how some species of big cat are related. Which letter shows the most recent common ancestor of the lion and the jaguar?",
      options: ["A", "B", "C", "D"],
      brief: {
        kind: "evolutionary-tree",
        tree: {
          branches: [
            { branches: ["tiger", "snow leopard"], mya: null, letter: "B" },
            {
              branches: ["jaguar", { branches: ["lion", "leopard"], mya: null, letter: "D" }],
              mya: null,
              letter: "C",
            },
          ],
          mya: null,
          letter: "A",
        },
        axis: null,
      },
    },
    {
      subject: "biology",
      question:
        "The evolutionary tree shows how some groups of vertebrates are related. How many millions of years ago did the most recent common ancestor of mammals and birds live?",
      options: ["250", "300", "350", "400"],
      brief: {
        kind: "evolutionary-tree",
        tree: {
          branches: [
            "fish",
            {
              branches: [
                "amphibians",
                {
                  branches: ["mammals", { branches: ["reptiles", "birds"], mya: 250, letter: "" }],
                  mya: 300,
                  letter: "",
                },
              ],
              mya: 350,
              letter: "",
            },
          ],
          mya: 400,
          letter: "",
        },
        axis: { max: 450, step: 50 },
      },
    },
    {
      subject: "biology",
      question:
        "The evolutionary tree shows how humans and other apes are related. Which species is most closely related to humans?",
      options: ["chimpanzee", "gibbon", "gorilla", "orangutan"],
      brief: {
        kind: "evolutionary-tree",
        tree: [[[["human", "chimpanzee"], "gorilla"], "orangutan"], "gibbon"],
        axis: null,
      },
    },
  ],
  random(r) {
    const pool = [
      "human",
      "chimpanzee",
      "gorilla",
      "orangutan",
      "gibbon",
      "lemur",
      "mouse",
      "rat",
      "rabbit",
      "cow",
      "whale",
      "dog",
      "cat",
    ];
    const names = [...pool].sort(() => r() - 0.5).slice(0, 3 + Math.floor(r() * 6));
    const axis = r() < 0.5 ? { max: [10, 20, 60, 100, 300][Math.floor(r() * 5)], step: 0 } : null;
    if (axis) axis.step = axis.max / [2, 4, 5, 10][Math.floor(r() * 4)];
    let letter = 0;
    // Joins neighbours at random until one clade is left, ages rising as it goes.
    let parts: { c: unknown; age: number }[] = names.map((n) => ({ c: n, age: 0 }));
    while (parts.length > 1) {
      const i = Math.floor(r() * (parts.length - 1));
      const k = parts.length > 2 && r() < 0.15 ? 3 : 2;
      const join = parts.slice(i, i + k);
      const age = Math.max(...join.map((p) => p.age)) + (axis ? axis.max * (0.08 + r() * 0.25) : 1);
      const c = {
        branches: join.map((p) => p.c),
        mya: axis ? Math.round(age) : null,
        letter: r() < 0.4 ? "ABCDEFG"[letter++] : "",
      };
      parts = [...parts.slice(0, i), { c, age }, ...parts.slice(i + k)];
    }
    return { kind: "evolutionary-tree", tree: parts[0].c, axis };
  },
};
