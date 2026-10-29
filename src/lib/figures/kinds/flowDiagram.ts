/**
 * A flow diagram: named boxes in rows, top to bottom, joined by straight
 * arrows, each of which may carry a letter the question asks about. It draws
 * a process, the National Grid, or the carbon, nitrogen and water cycles. Each
 * row's boxes share the width evenly; an arrow runs from the edge of one box
 * to the edge of the other along the line between their middles, and two
 * arrows between the same two boxes (one each way) run side by side, each
 * keeping to its own left. A letter stands beside the middle of its arrow.
 * The checker reads every arrow back to the boxes it joins and the way it
 * points, and every letter to the arrow nearest it; an arrow that would cross
 * a box, another arrow or a letter is refused before anything is drawn.
 */
import { ARROW_DEFS, TEXT_SIZE, textWidth } from "../figure";
import type { Box, Pt } from "../figureCheck";
import { and, line, num, svgOf, text, wrap } from "../figureSvg";
import type { FigureKind } from "./kind";
import { canvasHeight, crossesBox, crossing, grow, toSegment, type Seg } from "./linework";

export type FlowArrow = { from: string; to: string; letter: string };
export type FlowBrief = {
  kind: "flow-diagram";
  /** Top to bottom, each row's boxes left to right. */
  rows: string[][];
  arrows: FlowArrow[];
};

const BOX_H = 44;
/** Middle to middle of two rows: room between them for arrows and their letters. */
const PITCH = 100;
const MAX_W = 150;
const MIN_W = 64;
/** Room either side of a box's name. */
const PAD = 10;
/** An arrow ends this far from a box, and two each way run this far either side of the middle line. */
const GAP = 4;
const OFFSET = 7;
/** A letter's middle, out from the middle of its arrow. */
const ASIDE = 15;
/** The shortest arrow worth drawing. */
const SHORTEST = 24;
const TEXT = TEXT_SIZE["qf-text"]!;

type Placed = { name: string; lines: string[]; box: Box; mid: Pt };

/** Each box: its name over one or two lines, and where it stands; null when a name can't fit. */
function boxes(b: FlowBrief): Placed[] | null {
  const span = BOX_H + (b.rows.length - 1) * PITCH;
  const H = canvasHeight(span + 24);
  const top = (H - span) / 2;
  const out: Placed[] = [];
  for (const [r, row] of b.rows.entries()) {
    const slot = 344 / row.length;
    const widest = Math.min(MAX_W, slot - 24);
    for (const [i, name] of row.entries()) {
      const lines = balanced(name, widest - 2 * PAD);
      if (!lines) return null;
      const w = Math.max(MIN_W, Math.max(...lines.map((l) => textWidth(l, TEXT))) + 2 * PAD);
      const [cx, cy] = [8 + slot * (i + 0.5), top + BOX_H / 2 + r * PITCH];
      out.push({
        name,
        lines,
        box: { x0: cx - w / 2, y0: cy - BOX_H / 2, x1: cx + w / 2, y1: cy + BOX_H / 2 },
        mid: [cx, cy],
      });
    }
  }
  return out;
}

/**
 * A name on one line if it fits, otherwise on two lines as even as its words
 * allow; null when it can't fit in two.
 */
function balanced(name: string, room: number): string[] | null {
  const lines = wrap(name, room, TEXT);
  if (!lines || lines.length === 1) return lines;
  const words = name.trim().split(/\s+/);
  const widest = (ls: string[]) => Math.max(...ls.map((l) => textWidth(l, TEXT)));
  let best: string[] | null = null;
  for (let k = 1; k < words.length; k++) {
    const two = [words.slice(0, k).join(" "), words.slice(k).join(" ")];
    if (widest(two) <= room && (!best || widest(two) < widest(best))) best = two;
  }
  return best;
}

/** Where a ray from inside a box leaves it. */
const leaves = (p: Pt, v: Pt, b: Box) =>
  Math.min(
    v[0] > 0 ? (b.x1 - p[0]) / v[0] : v[0] < 0 ? (b.x0 - p[0]) / v[0] : Infinity,
    v[1] > 0 ? (b.y1 - p[1]) / v[1] : v[1] < 0 ? (b.y0 - p[1]) / v[1] : Infinity,
  );

/**
 * An arrow's two ends and where its letter goes. It runs along the line
 * between the boxes' middles, moved OFFSET to its own left when an arrow runs
 * back the other way; its letter stands ASIDE out on that same side, or, alone,
 * to the right of an arrow running up or down and above one running across.
 */
function arrowOf(a: FlowArrow, b: FlowBrief, placed: Placed[]) {
  const [p, q] = [a.from, a.to].map((n) => placed.find((x) => x.name === n)!);
  const len = Math.hypot(q.mid[0] - p.mid[0], q.mid[1] - p.mid[1]);
  const dir: Pt = [(q.mid[0] - p.mid[0]) / len, (q.mid[1] - p.mid[1]) / len];
  const left: Pt = [dir[1], -dir[0]];
  const paired = b.arrows.some((o) => o.from === a.to && o.to === a.from);
  const off = paired ? OFFSET : 0;
  const s: Pt = [p.mid[0] + left[0] * off, p.mid[1] + left[1] * off];
  const e: Pt = [q.mid[0] + left[0] * off, q.mid[1] + left[1] * off];
  const v: Pt = [e[0] - s[0], e[1] - s[1]];
  const t0 = leaves(s, v, grow(p.box, GAP));
  const t1 = 1 - leaves(e, [-v[0], -v[1]], grow(q.box, GAP));
  const ends: Seg = [
    [s[0] + v[0] * t0, s[1] + v[1] * t0],
    [s[0] + v[0] * t1, s[1] + v[1] * t1],
  ];
  const across = Math.abs(dir[0]) > Math.abs(dir[1]);
  const side: Pt = paired
    ? left
    : across
      ? left[1] < 0
        ? left
        : [-left[0], -left[1]]
      : left[0] > 0
        ? left
        : [-left[0], -left[1]];
  const middle: Pt = [(ends[0][0] + ends[1][0]) / 2, (ends[0][1] + ends[1][1]) / 2];
  return {
    ends,
    middle,
    letter: [middle[0] + side[0] * ASIDE, middle[1] + side[1] * ASIDE + 5.5] as Pt,
    length: (t1 - t0) * Math.hypot(v[0], v[1]),
  };
}

const LETTER = /^[A-Z]$/;

export const flowDiagram: FigureKind<FlowBrief> = {
  kind: "flow-diagram",
  name: "a flow diagram or cycle",
  guide:
    'rows: 1 to 5 rows of boxes, top to bottom, each 1 to 4 box names left to right (12 boxes in all), each name at most 28 characters and short enough to fit its box in two lines; arrows: 1 to 14 {from, to: two box names exactly; letter: one capital letter the question asks about, or ""}, at most one each way between two boxes. An arrow within a row joins neighbours only. Order the rows and boxes so that no arrow would cross a box, another arrow or a letter: arrows between neighbouring rows, or neighbours in a row, are safest. The website draws each arrow straight from box to box.',
  read(b, fits) {
    const rows = b.rows as unknown[][];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5)
      return { problem: "needs 1 to 5 rows of boxes" };
    if (rows.some((r) => !Array.isArray(r) || r.length < 1 || r.length > 4))
      return { problem: "needs 1 to 4 boxes in each row" };
    const names = rows.flat();
    if (names.length < 2 || names.length > 12) return { problem: "needs 2 to 12 boxes" };
    if (names.some((n) => typeof n !== "string" || !n.trim() || [...n.trim()].length > 28))
      return { problem: "has a box without a name of at most 28 characters" };
    const read: FlowBrief = {
      kind: "flow-diagram",
      rows: rows.map((r) => r.map((n) => (n as string).trim())),
      arrows: [],
    };
    const all = read.rows.flat();
    if (new Set(all).size !== all.length) return { problem: "names a box twice" };
    const placed = boxes(read);
    if (!placed) return { problem: "has a box name too long for its box" };
    const arrows = b.arrows as { from: unknown; to: unknown; letter?: unknown }[];
    if (!Array.isArray(arrows) || arrows.length < 1 || arrows.length > 14)
      return { problem: "needs 1 to 14 arrows" };
    const where = new Map(read.rows.flatMap((r, i) => r.map((n, j) => [n, [i, j]] as const)));
    for (const a of arrows) {
      const [from, to] = [a?.from, a?.to].map((n) => (typeof n === "string" ? n.trim() : ""));
      if (!where.has(from) || !where.has(to) || from === to)
        return { problem: "has an arrow that doesn't join two of its boxes by name" };
      const letter = typeof a.letter === "string" ? a.letter.trim() : a.letter == null ? "" : null;
      if (letter === null || (letter && !LETTER.test(letter)))
        return { problem: 'has an arrow whose letter is not one capital letter or ""' };
      const [[r1, i1], [r2, i2]] = [where.get(from)!, where.get(to)!];
      if (r1 === r2 && Math.abs(i1 - i2) !== 1)
        return { problem: `has an arrow from ${from} to ${to} past the box between them` };
      read.arrows.push({ from, to, letter });
    }
    if (new Set(read.arrows.map((a) => `${a.from}→${a.to}`)).size !== read.arrows.length)
      return { problem: "has the same arrow twice" };
    const letters = read.arrows.map((a) => a.letter).filter(Boolean);
    if (new Set(letters).size !== letters.length) return { problem: "gives two arrows one letter" };
    for (const a of read.arrows)
      if (arrowOf(a, read, placed).length < SHORTEST)
        return { problem: `has ${a.from} and ${a.to} too close for an arrow between them` };
    // Whether an arrow crosses a box, an arrow or a letter depends on the whole layout.
    const problems = fits(read);
    if (problems.length)
      return {
        problem: `can't be drawn cleanly: ${problems[0].replace(/^./, (c) => c.toLowerCase())}`,
      };
    return { brief: read };
  },
  draw(b) {
    const placed = boxes(b)!;
    const span = BOX_H + (b.rows.length - 1) * PITCH;
    const body = [ARROW_DEFS];
    for (const p of placed) {
      const { x0, y0, x1, y1 } = p.box;
      body.push(
        `<rect class="qf-box" x="${num(x0)}" y="${num(y0)}" width="${num(x1 - x0)}" height="${num(y1 - y0)}" rx="6"/>`,
      );
      body.push(text("qf-text", p.mid[0], firstLine(p), "middle", p.lines));
    }
    for (const a of b.arrows) {
      const { ends, letter } = arrowOf(a, b, placed);
      body.push(line("qf-line", ...ends[0], ...ends[1], ' marker-end="url(#qf-head)"'));
      if (a.letter) body.push(text("qf-strong", letter[0], letter[1], "middle", [a.letter]));
    }
    const rows = b.rows.map(
      (r, i) => `${i === 0 ? "Top" : i === b.rows.length - 1 ? "Bottom" : "Next"} row: ${and(r)}`,
    );
    const arrows = b.arrows.map(
      (a) => `${a.letter ? `${a.letter}, ` : ""}from ${a.from} to ${a.to}`,
    );
    return {
      svg: svgOf(canvasHeight(span + 24), body),
      alt: `A flow diagram of ${placed.length} boxes${b.rows.length > 1 ? ` in ${b.rows.length} rows` : ""} joined by arrows. ${b.rows.length > 1 ? rows.join(". ") : `Boxes: ${and(b.rows[0])}`}. Arrows: ${arrows.join("; ")}.`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const placed = boxes(b)!;
    for (const p of placed) {
      const { x0, y0, x1, y1 } = p.box;
      const edges: Seg[] = [
        [
          [x0, y0],
          [x1, y0],
        ],
        [
          [x1, y0],
          [x1, y1],
        ],
        [
          [x1, y1],
          [x0, y1],
        ],
        [
          [x0, y1],
          [x0, y0],
        ],
      ];
      const has = (e: Seg) =>
        d.segments.some(
          (s) =>
            s.cls === "qf-box" &&
            ((t.near(s.seg[0][0], e[0][0]) &&
              t.near(s.seg[0][1], e[0][1]) &&
              t.near(s.seg[1][0], e[1][0]) &&
              t.near(s.seg[1][1], e[1][1])) ||
              (t.near(s.seg[1][0], e[0][0]) &&
                t.near(s.seg[1][1], e[0][1]) &&
                t.near(s.seg[0][0], e[1][0]) &&
                t.near(s.seg[0][1], e[1][1]))),
        );
      if (!edges.every(has))
        out.push(`The box for ${p.name} is not drawn from ${t.at([x0, y0])} to ${t.at([x1, y1])}`);
      if (!t.writtenAt(p.lines.join(" "), p.mid[0], firstLine(p), "middle", "qf-text"))
        out.push(`The name "${p.name}" is not written in its box`);
    }

    // Each arrow read back: the box by its tail, the box by its head.
    const boxAt = (e: Pt) => placed.find((p) => inBox(e, grow(p.box, GAP + 1.5)))?.name;
    const drawn: { from: string; to: string; seg: Seg }[] = [];
    for (const a of d.arrows) {
      if (a.start || !a.end) {
        out.push(
          `The arrow from ${t.at(a.from)} to ${t.at(a.to)} needs one head, at the box it points to`,
        );
        continue;
      }
      const [from, to] = [boxAt(a.from), boxAt(a.to)];
      if (!from || !to) {
        out.push(
          `The arrow from ${t.at(a.from)} to ${t.at(a.to)} ${from ? "ends" : "starts"} away from every box`,
        );
        continue;
      }
      drawn.push({ from, to, seg: [a.from, a.to] });
    }
    const count = (f: string, to: string) =>
      drawn.filter((a) => a.from === f && a.to === to).length;
    for (const a of b.arrows) {
      const n = count(a.from, a.to);
      if (n > 1) out.push(`There are ${n} arrows from ${a.from} to ${a.to}`);
      else if (!n)
        out.push(
          count(a.to, a.from) && !b.arrows.some((o) => o.from === a.to && o.to === a.from)
            ? `The arrow between ${a.from} and ${a.to} points the wrong way: it must point from ${a.from} to ${a.to}`
            : `There is no arrow from ${a.from} to ${a.to}`,
        );
    }
    for (const a of drawn)
      if (!b.arrows.some((w) => w.from === a.from && w.to === a.to))
        out.push(`The arrow from ${a.from} to ${a.to} is not in the brief`);

    // Nothing in an arrow's way: no box but its own two, no other arrow.
    for (const a of drawn)
      for (const p of placed)
        if (p.name !== a.from && p.name !== a.to && crossesBox(a.seg, p.box))
          out.push(`The arrow from ${a.from} to ${a.to} crosses the box for ${p.name}`);
    for (let i = 0; i < drawn.length; i++)
      for (let j = i + 1; j < drawn.length; j++)
        if (crossing(drawn[i].seg, drawn[j].seg))
          out.push(
            `The arrows from ${drawn[i].from} to ${drawn[i].to} and from ${drawn[j].from} to ${drawn[j].to} cross`,
          );

    // Each letter beside its own arrow, and nearer it than any other.
    for (const a of b.arrows) {
      if (!a.letter) continue;
      const own = drawn.find((x) => x.from === a.from && x.to === a.to);
      if (!own) continue;
      const middle: Pt = [(own.seg[0][0] + own.seg[1][0]) / 2, (own.seg[0][1] + own.seg[1][1]) / 2];
      const letter = t.letterBeside(middle);
      if (!letter)
        out.push(`The letter ${a.letter} is not beside the arrow from ${a.from} to ${a.to}`);
      else if (letter.text !== a.letter)
        out.push(
          `The letter beside the arrow from ${a.from} to ${a.to} is "${letter.text}"; the brief gives it ${a.letter}`,
        );
    }
    const letters = t.pieces().filter((p) => p.cls === "qf-strong");
    for (const l of letters) {
      const centre: Pt = [(l.box.x0 + l.box.x1) / 2, (l.box.y0 + l.box.y1) / 2];
      const nearest = [...drawn].sort(
        (p, q) => toSegment(centre, p.seg) - toSegment(centre, q.seg),
      )[0];
      const owner = nearest && b.arrows.find((a) => a.from === nearest.from && a.to === nearest.to);
      if (owner && owner.letter !== l.text)
        out.push(
          `The letter ${l.text} is nearest the arrow from ${owner.from} to ${owner.to}, which the brief ${owner.letter ? `letters ${owner.letter}` : "leaves unlettered"}`,
        );
    }

    // Nothing else: the boxes, the arrows, the names and the letters.
    for (const s of d.shapes) {
      const box =
        s.name === "rect" &&
        s.cls === "qf-box" &&
        placed.some((p) => t.near(s.at[0], p.box.x0) && t.near(s.at[1], p.box.y0));
      const arrow = s.name === "line" && s.cls === "qf-line" && s.marked;
      if (!box && !arrow)
        out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the flow diagram`);
    }
    const allowed = new Set(b.arrows.map((a) => a.letter).filter(Boolean));
    for (const p of t.pieces())
      if (
        !(p.cls === "qf-strong" && allowed.has(p.text)) &&
        !placed.some(
          (x) =>
            p.cls === "qf-text" &&
            p.text === x.lines.join(" ") &&
            t.near(p.x, x.mid[0], 1) &&
            t.near(p.y, firstLine(x), 1),
        )
      )
        out.push(`Text "${p.text}" is not a box's name or an arrow's letter`);
    return out;
  },
  samples: [
    {
      subject: "biology",
      question: "The diagram shows part of the carbon cycle. Which arrow shows photosynthesis?",
      options: ["A", "B", "D", "E"],
      brief: {
        kind: "flow-diagram",
        rows: [["carbon dioxide in the air"], ["plants", "animals", "fossil fuels"]],
        arrows: [
          { from: "carbon dioxide in the air", to: "plants", letter: "A" },
          { from: "plants", to: "carbon dioxide in the air", letter: "B" },
          { from: "plants", to: "animals", letter: "C" },
          { from: "animals", to: "carbon dioxide in the air", letter: "D" },
          { from: "fossil fuels", to: "carbon dioxide in the air", letter: "E" },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The diagram shows part of the nitrogen cycle. Which arrow shows the process carried out by nitrifying bacteria?",
      options: ["A", "B", "E", "F"],
      brief: {
        kind: "flow-diagram",
        rows: [
          ["nitrogen in the air"],
          ["nitrates in the soil", "ammonium compounds"],
          ["proteins in plants", "dead plants and animals"],
        ],
        arrows: [
          { from: "nitrogen in the air", to: "nitrates in the soil", letter: "A" },
          { from: "nitrates in the soil", to: "nitrogen in the air", letter: "B" },
          { from: "nitrates in the soil", to: "proteins in plants", letter: "C" },
          { from: "proteins in plants", to: "dead plants and animals", letter: "D" },
          { from: "dead plants and animals", to: "ammonium compounds", letter: "E" },
          { from: "ammonium compounds", to: "nitrates in the soil", letter: "F" },
        ],
      },
    },
    {
      subject: "physics",
      question:
        "The diagram shows how electricity is transmitted from a power station to homes by the National Grid. What are the parts labelled X and Y?",
      options: [
        "X is a step-up transformer and Y is a step-down transformer",
        "X is a step-down transformer and Y is a step-up transformer",
        "X and Y are both step-up transformers",
        "X and Y are both step-down transformers",
      ],
      brief: {
        kind: "flow-diagram",
        rows: [["power station", "X"], ["transmission cables"], ["Y", "homes"]],
        arrows: [
          { from: "power station", to: "X", letter: "" },
          { from: "X", to: "transmission cables", letter: "" },
          { from: "transmission cables", to: "Y", letter: "" },
          { from: "Y", to: "homes", letter: "" },
        ],
      },
    },
  ],
  random(r) {
    const pool = [
      "plants",
      "animals",
      "decomposers",
      "fossil fuels",
      "carbon dioxide in the air",
      "water vapour",
      "clouds",
      "rain",
      "rivers",
      "sea",
      "glucose",
      "starch",
      "dead matter",
      "nitrates",
      "power station",
      "homes",
    ];
    const names = [...pool].sort(() => r() - 0.5);
    const rows: string[][] = [];
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) rows.push(names.splice(0, 1 + Math.floor(r() * 3)));
    const flat = rows.flatMap((row, i) => row.map((name, j) => ({ name, i, j })));
    const arrows: { from: string; to: string; letter: string }[] = [];
    const letters = "ABCDEFGH";
    for (const a of flat)
      for (const c of flat) {
        const near = (c.i === a.i && c.j === a.j + 1) || c.i === a.i + 1;
        if (near && r() < 0.45) {
          const [from, to] = r() < 0.5 ? [a.name, c.name] : [c.name, a.name];
          arrows.push({ from, to, letter: r() < 0.6 ? (letters[arrows.length] ?? "") : "" });
          if (r() < 0.15) arrows.push({ from: to, to: from, letter: "" });
        }
      }
    return { kind: "flow-diagram", rows, arrows };
  },
};

/** The baseline of a box's first line: its lines centred on the box's middle. */
const firstLine = (p: Placed) => p.mid[1] + 5.5 - 9 * (p.lines.length - 1);

/** Whether a point lies in a box. */
const inBox = (p: Pt, b: Box) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1;
