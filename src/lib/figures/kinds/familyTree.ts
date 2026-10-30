/**
 * A family tree (pedigree chart) of two or three generations. Males are
 * squares and females circles; an affected person's symbol is shaded and a
 * carrier's left half; each person's number is written under them, and a key
 * below names each symbol. A couple is joined by a line between them and
 * their children hang from a line beneath it. A spouse who married in sits on
 * their partner's right, and two founding families meet where a child of each
 * marries. The checker reads every line back to the people it touches, so a
 * child hung from the wrong couple, a missing couple or a stray line is
 * refused, and it holds each symbol to its person's sex and shading.
 */
import type { Pt } from "../figureCheck";
import { and, line, num, svgOf, text } from "../figureSvg";
import type { FigureKind } from "./kind";
import {
  canvasHeight,
  crossesBox,
  crossing,
  pieces,
  same,
  sameSeg,
  square,
  toSegment,
  type Seg,
} from "./linework";

type Sex = "male" | "female";
type Status = "unaffected" | "affected" | "carrier";
export type Person = { id: string; sex: Sex; affected: boolean; carrier: boolean };
export type Couple = { parents: [string, string]; children: string[] };
export type FamilyTreeBrief = { kind: "family-tree"; people: Person[]; couples: Couple[] };

/** Half a symbol's side, or its radius. */
const HALF = 13;
/** Centre to centre: neighbours in a row, a couple, and two families side by side. */
const SIB = 40;
const PAIR = 56;
const APART = 64;
/** The first generation's middle, and the step down to the next. */
const TOP = 28;
const ROW = 80;
/** How far below a couple their children's line runs, and a number's baseline below its person. */
const BAR = 44;
const UNDER = 30;
/** The key: its symbols' half side, each column's symbol and words, and its rows. */
const KEY = { half: 10, x: [24, 190], text: [42, 208], below: 62, row: 28 } as const;
/** Room for the whole tree: shapes stay 8 units inside the canvas. */
const ROOM = 344;

const statusOf = (p: Person): Status =>
  p.affected ? "affected" : p.carrier ? "carrier" : "unaffected";

/** How the brief's people are related: each couple's generation, and who is whose child. */
type Family = {
  gen: Map<Couple, number>;
  childOf: Map<string, Couple>;
  parentIn: Map<string, Couple>;
  /** The founding couples at the top, in the brief's order: one, or two joined by `join`. */
  founders: Couple[];
  join: Couple | null;
};

function family(b: FamilyTreeBrief): Family | string {
  const childOf = new Map<string, Couple>();
  const parentIn = new Map<string, Couple>();
  for (const c of b.couples) {
    for (const p of c.parents) {
      if (parentIn.has(p)) return `has person ${p} in two couples`;
      parentIn.set(p, c);
    }
    for (const k of c.children) {
      if (childOf.has(k)) return `gives person ${k} two sets of parents`;
      childOf.set(k, c);
    }
  }
  if (b.couples.some((c) => c.children.some((k) => c.parents.includes(k))))
    return "has a parent as their own child";
  for (const p of b.people)
    if (!childOf.has(p.id) && !parentIn.has(p.id)) return `has person ${p.id} in no couple`;
  const founders = b.couples.filter((c) => c.parents.every((p) => !childOf.has(p)));
  if (!founders.length) return "has no founding couple at the top";
  if (founders.length > 2) return "has more than two founding couples";
  const gen = new Map<Couple, number>(founders.map((c) => [c, 1]));
  for (let more = true; more;) {
    more = false;
    for (const c of b.couples) {
      if (gen.has(c)) continue;
      const above = c.parents.filter((p) => childOf.has(p)).map((p) => gen.get(childOf.get(p)!));
      if (above.some((g) => g === undefined)) continue;
      if (above.length === 2 && above[0] !== above[1])
        return "has a couple from two different generations";
      gen.set(c, above[0]! + 1);
      more = true;
    }
  }
  if (gen.size !== b.couples.length) return "has someone who is their own ancestor";
  if (b.couples.some((c) => gen.get(c)! > 2)) return "has more than three generations";
  const joins = b.couples.filter((c) => c.parents.every((p) => childOf.has(p)));
  if (joins.some((c) => childOf.get(c.parents[0]) === childOf.get(c.parents[1])))
    return "has a brother and sister as a couple";
  if (founders.length === 2 && joins.length !== 1)
    return joins.length
      ? "joins its two families by more than one couple"
      : "has two families that no couple joins";
  return { gen, childOf, parentIn, founders, join: joins[0] ?? null };
}

/** Where everything goes: each person's middle, each couple's lines, the key and the canvas. */
type Hang = {
  left: string;
  right: string;
  y: number;
  mid: number;
  bar: number;
  from: number;
  to: number;
  children: string[];
};
/** A symbol: a person's (with their id) or the key's (id ""), and how a problem names it. */
type Mark = {
  id: string;
  sex: Sex;
  status: Status;
  x: number;
  y: number;
  half: number;
  owner: string;
};
type Layout = {
  at: Map<string, Pt>;
  hangs: Hang[];
  key: (Mark & { words: string })[];
  H: number;
  width: number;
};

/**
 * The second generation is laid out first, left to right: each child of the
 * founders alone, or with their partner on their right and their own children
 * centred under the pair, each family's children kept APART from the next.
 * The founders then sit over their children, pushed apart if two would meet.
 */
function layout(b: FamilyTreeBrief): Layout {
  const f = family(b) as Family;
  const x = new Map<string, number>();
  let lastPerson = -Infinity;
  let lastChild = -Infinity;
  for (const F of f.founders)
    for (const c of F.children) {
      if (x.has(c)) continue;
      const couple = f.parentIn.get(c);
      const row = couple ? [c, couple.parents.find((p) => p !== c)!] : [c];
      const kids = couple?.children ?? [];
      const kx = kids.map((_, i) => PAIR / 2 + (i - (kids.length - 1) / 2) * SIB);
      let o = lastPerson === -Infinity ? 0 : lastPerson + SIB;
      if (kids.length && lastChild !== -Infinity) o = Math.max(o, lastChild + APART - kx[0]);
      row.forEach((p, i) => x.set(p, o + i * PAIR));
      kids.forEach((k, i) => x.set(k, o + kx[i]));
      lastPerson = o + (row.length - 1) * PAIR;
      if (kids.length) lastChild = o + kx[kx.length - 1];
    }
  const mids = f.founders.map((F) => {
    const xs = F.children.map((k) => x.get(k)!);
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  });
  if (mids.length === 2) {
    const short = APART + PAIR - (mids[1] - mids[0]);
    if (short > 0) [mids[0], mids[1]] = [mids[0] - short / 2, mids[1] + short / 2];
  }
  f.founders.forEach((F, i) => {
    x.set(F.parents[0], mids[i] - PAIR / 2);
    x.set(F.parents[1], mids[i] + PAIR / 2);
  });

  const xs = [...x.values()];
  const shift = 180 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const width = Math.max(...xs) - Math.min(...xs) + 2 * HALF;
  const yOf = (g: number) => TOP + ROW * (g - 1);
  const at = new Map<string, Pt>();
  for (const p of b.people) {
    const own = f.parentIn.get(p.id);
    const g = own ? f.gen.get(own)! : f.gen.get(f.childOf.get(p.id)!)! + 1;
    at.set(p.id, [x.get(p.id)! + shift, yOf(g)]);
  }
  const hangs = b.couples.map((c) => {
    const [left, right] = [...c.parents].sort((p, q) => at.get(p)![0] - at.get(q)![0]);
    const y = at.get(left)![1];
    const mid = (at.get(left)![0] + at.get(right)![0]) / 2;
    const kx = c.children.map((k) => at.get(k)![0]);
    return {
      left,
      right,
      y,
      mid,
      bar: y + BAR,
      from: Math.min(mid, ...kx),
      to: Math.max(mid, ...kx),
      children: c.children,
    };
  });

  const generations = Math.max(...[...at.values()].map(([, y]) => (y - TOP) / ROW + 1));
  const carriers = (sex: Sex) => b.people.some((p) => p.sex === sex && statusOf(p) === "carrier");
  const rows: [Status, boolean, boolean][] = [
    ["unaffected", true, true],
    ["affected", true, true],
    ...(carriers("male") || carriers("female")
      ? [["carrier", carriers("male"), carriers("female")] as [Status, boolean, boolean]]
      : []),
  ];
  const top = yOf(generations) + KEY.below;
  const key = rows.flatMap(([status, male, female], i) =>
    (["male", "female"] as Sex[])
      .filter((_, col) => (col ? female : male))
      .map((sex) => {
        const col = sex === "male" ? 0 : 1;
        const words = `${status} ${sex}`;
        return {
          id: "",
          sex,
          status,
          x: KEY.x[col],
          y: top + KEY.row * i,
          half: KEY.half,
          owner: `The key's ${words} symbol`,
          words,
        };
      }),
  );
  return {
    at,
    hangs,
    key,
    H: canvasHeight(top + KEY.row * (rows.length - 1) + KEY.half + 8),
    width,
  };
}

/** Every person's symbol, then the key's, as the drawing and the checker both see them. */
const marks = (b: FamilyTreeBrief, l: Layout): Mark[] => [
  ...b.people.map((p) => ({
    id: p.id,
    sex: p.sex,
    status: statusOf(p),
    x: l.at.get(p.id)![0],
    y: l.at.get(p.id)![1],
    half: HALF,
    owner: `Person ${p.id}`,
  })),
  ...l.key,
];

/** A carrier female's shading: her left half, from the top round to the bottom. */
const halfDisc = (m: Mark): Pt[] =>
  Array.from({ length: 17 }, (_, k) => {
    const a = (Math.PI * k) / 16;
    return [m.x - m.half * Math.sin(a), m.y - m.half * Math.cos(a)];
  });
/** A rectangle's four edges, as the checker reads a <rect>. */
const rectEdges = (x0: number, y0: number, w: number, h: number): Seg[] => {
  const c: Pt[] = [
    [x0, y0],
    [x0 + w, y0],
    [x0 + w, y0 + h],
    [x0, y0 + h],
  ];
  return c.map((p, i) => [p, c[(i + 1) % 4]]);
};
/** The edges a symbol's shading is drawn with: none, its whole square, or its left half. */
function inkEdges(m: Mark): Seg[] {
  const h = m.half;
  if (m.status === "unaffected" || (m.sex === "female" && m.status === "affected")) return [];
  if (m.sex === "male")
    return rectEdges(m.x - h, m.y - h, m.status === "affected" ? 2 * h : h, 2 * h);
  const pts = halfDisc(m);
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
}

const rect = (cls: string, x0: number, y0: number, w: number, h: number) =>
  `<rect class="${cls}" x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}"/>`;
const circle = (cls: string, cx: number, cy: number, r: number) =>
  `<circle class="${cls}" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"/>`;

/** A symbol: its shading first, then its outline over it. */
function symbol(m: Mark): string[] {
  const h = m.half;
  const out: string[] = [];
  if (m.status === "affected")
    out.push(
      m.sex === "male"
        ? rect("qf-ink", m.x - h, m.y - h, 2 * h, 2 * h)
        : circle("qf-ink", m.x, m.y, h),
    );
  if (m.status === "carrier")
    out.push(
      m.sex === "male"
        ? rect("qf-ink", m.x - h, m.y - h, h, 2 * h)
        : `<polygon class="qf-ink" points="${halfDisc(m)
            .map(([px, py]) => `${num(px)},${num(py)}`)
            .join(" ")}"/>`,
    );
  out.push(
    m.sex === "male"
      ? rect("qf-line", m.x - h, m.y - h, 2 * h, 2 * h)
      : circle("qf-line", m.x, m.y, h),
  );
  return out;
}

/** The lines a couple's children hang from: the couple line, the drop from its middle, and one to each child. */
function hangLines(h: Hang, at: Map<string, Pt>): Seg[] {
  const out: Seg[] = [
    [
      [at.get(h.left)![0] + HALF, h.y],
      [at.get(h.right)![0] - HALF, h.y],
    ],
    [
      [h.mid, h.y],
      [h.mid, h.bar],
    ],
  ];
  if (h.to - h.from > 0.5)
    out.push([
      [h.from, h.bar],
      [h.to, h.bar],
    ]);
  for (const k of h.children) {
    const [kx, ky] = at.get(k)!;
    out.push([
      [kx, h.bar],
      [kx, ky - HALF],
    ]);
  }
  return out;
}

const ID = /^([1-9][0-9]?|[A-Z])$/;

export const familyTree: FigureKind<FamilyTreeBrief> = {
  kind: "family-tree",
  name: "a family tree",
  guide:
    'people: 3 to 14, each {id: the number or capital letter written under them, "1" to "99" or "A" to "Z"; sex: "male" or "female"; affected: true or false; carrier: true only for an unaffected carrier, drawn half shaded, otherwise false}; couples: 1 to 6, each {parents: [id, id], one male and one female; children: 1 to 6 ids, eldest first}. Two or three generations: one founding couple at the top, or two whose families are joined by one child of each marrying; anyone else with no parents married in, and sits beside their partner. Each person is a child of at most one couple and a parent in at most one; keep a generation to about 7 people side by side. The website draws males as squares and females as circles, shades the affected, joins each couple and hangs their children beneath, and adds a key.',
  read(b) {
    const people = b.people as {
      id: unknown;
      sex: unknown;
      affected: unknown;
      carrier?: unknown;
    }[];
    if (!Array.isArray(people) || people.length < 3 || people.length > 14)
      return { problem: "needs 3 to 14 people" };
    const read: FamilyTreeBrief = { kind: "family-tree", people: [], couples: [] };
    for (const p of people) {
      const id =
        typeof p?.id === "string" ? p.id.trim() : typeof p?.id === "number" ? String(p.id) : "";
      if (!ID.test(id))
        return { problem: "has a person whose id is not a number or a capital letter" };
      if (p.sex !== "male" && p.sex !== "female")
        return { problem: 'has a person whose sex is not "male" or "female"' };
      if (typeof p.affected !== "boolean")
        return { problem: "has a person without affected true or false" };
      const carrier = p.carrier ?? false;
      if (typeof carrier !== "boolean")
        return { problem: "has a carrier that is not true or false" };
      if (p.affected && carrier) return { problem: `has person ${id} both affected and a carrier` };
      read.people.push({ id, sex: p.sex, affected: p.affected, carrier });
    }
    const ids = read.people.map((p) => p.id);
    if (new Set(ids).size !== ids.length) return { problem: "numbers two people the same" };
    const sexOf = new Map(read.people.map((p) => [p.id, p.sex]));
    const couples = b.couples as { parents: unknown; children: unknown }[];
    if (!Array.isArray(couples) || couples.length < 1 || couples.length > 6)
      return { problem: "needs 1 to 6 couples" };
    const idOf = (v: unknown) =>
      typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
    for (const c of couples) {
      const parents = c?.parents;
      const children = c?.children;
      if (!Array.isArray(parents) || parents.length !== 2 || !Array.isArray(children))
        return { problem: "has a couple without two parents and a list of children" };
      const [p, q] = parents.map(idOf);
      const kids = children.map(idOf);
      if (![p, q, ...kids].every((id) => sexOf.has(id)))
        return { problem: "has a couple naming someone who is not among the people" };
      if (sexOf.get(p) === sexOf.get(q))
        return { problem: `has ${p} and ${q} as a couple, who are not one male and one female` };
      if (kids.length < 1 || kids.length > 6)
        return { problem: "has a couple without 1 to 6 children" };
      if (new Set(kids).size !== kids.length) return { problem: "lists a child twice" };
      read.couples.push({ parents: [p, q], children: kids });
    }
    const f = family(read);
    if (typeof f === "string") return { problem: f };
    // Two families meet where their children marry: the left family's joined
    // child goes last among its brothers and sisters, the right one's first.
    if (f.join) {
      const [F1, F2] = f.founders;
      const l = f.join.parents.find((p) => F1.children.includes(p))!;
      const r = f.join.parents.find((p) => F2.children.includes(p))!;
      F1.children = [...F1.children.filter((k) => k !== l), l];
      F2.children = [r, ...F2.children.filter((k) => k !== r)];
    }
    if (layout(read).width > ROOM)
      return { problem: "is too wide to fit: fewer people side by side in a generation" };
    return { brief: read };
  },
  draw(b) {
    const l = layout(b);
    const body: string[] = [];
    for (const m of marks(b, l)) body.push(...symbol(m));
    for (const p of b.people) {
      const [x, y] = l.at.get(p.id)!;
      body.push(text("qf-text", x, y + UNDER, "middle", [p.id]));
    }
    for (const h of l.hangs)
      for (const [a, c] of hangLines(h, l.at)) body.push(line("qf-line", a[0], a[1], c[0], c[1]));
    for (const k of l.key) body.push(text("qf-text", k.x + 18, k.y + 5.5, "start", [k.words]));
    // Each person described once, where first named: their sex, and their shading if any.
    const said = new Set<string>();
    const person = new Map(b.people.map((p) => [p.id, p]));
    const name = (id: string) => {
      if (said.has(id)) return id;
      said.add(id);
      const p = person.get(id)!;
      const s = statusOf(p);
      return `${id} (${p.sex}${s === "unaffected" ? "" : s === "affected" ? ", affected" : ", a carrier"})`;
    };
    const sentences = [...l.hangs]
      .sort((a, c) => a.y - c.y)
      .map(
        (h) =>
          `${name(h.left)} and ${name(h.right)} are a couple; their ${h.children.length === 1 ? "child is" : "children are"} ${and(h.children.map(name))}.`,
      );
    const generations = new Set([...l.at.values()].map(([, y]) => y)).size;
    const carriers = b.people.some((p) => statusOf(p) === "carrier");
    return {
      svg: svgOf(l.H, body),
      alt: `A family tree of ${b.people.length} people in ${generations} generations, numbered, with a key: squares are males, circles are females, shaded symbols are affected${carriers ? " and half-shaded symbols are carriers" : ""}. ${sentences.join(" ")}`,
    };
  },
  check(b, d, t) {
    const out: string[] = [];
    const l = layout(b);
    const all = marks(b, l);
    const people = all.filter((m) => m.half === HALF);

    // Each symbol: its outline (a square's four edges are taken out of the
    // lines, so what is left is the lines between people), and its shading.
    const lines: Seg[] = d.segments.filter((s) => s.cls === "qf-line").map((s) => s.seg);
    const take = (s: Seg) => {
      const i = lines.findIndex((u) => sameSeg(u, s));
      if (i >= 0) lines.splice(i, 1);
      return i >= 0;
    };
    const circles = d.shapes.filter((s) => s.name === "circle");
    const circleAt = (m: Mark, cls: string) =>
      circles.some((s) => s.cls === cls && t.near(s.r, m.half) && same(s.at, [m.x, m.y], 0.6));
    for (const m of all) {
      const h = m.half;
      const drawn =
        m.sex === "male"
          ? rectEdges(m.x - h, m.y - h, 2 * h, 2 * h)
              .map(take)
              .every(Boolean)
          : circleAt(m, "qf-line");
      if (!drawn)
        out.push(
          `${m.owner} is not drawn as a ${m.sex === "male" ? "square" : "circle"} at ${t.at([m.x, m.y])}`,
        );
    }
    const ink = d.segments.filter((s) => s.cls === "qf-ink").map((s) => s.seg);
    const inside = (m: Mark, p: Pt) =>
      Math.abs(p[0] - m.x) <= m.half + 1 && Math.abs(p[1] - m.y) <= m.half + 1;
    const wrongInk = new Set<Mark>();
    for (const m of all) {
      const want = inkEdges(m);
      if (!want.every((e) => ink.some((s) => sameSeg(s, e)))) wrongInk.add(m);
      const disc = m.sex === "female" && m.status === "affected";
      if (disc !== circleAt(m, "qf-ink")) wrongInk.add(m);
    }
    for (const s of ink) {
      const owner = all.find((m) => inside(m, s[0]) && inside(m, s[1]));
      if (!owner) out.push(`Shading at ${t.at(s[0])} is not on a person's symbol`);
      else if (!inkEdges(owner).some((e) => sameSeg(s, e))) wrongInk.add(owner);
    }
    for (const s of circles)
      if (
        s.cls === "qf-ink" &&
        !all.some(
          (m) =>
            m.sex === "female" &&
            m.status === "affected" &&
            t.near(s.r, m.half) &&
            same(s.at, [m.x, m.y], 0.6),
        )
      )
        out.push(`The shaded circle at ${t.at(s.at)} is not an affected female's symbol`);
    for (const m of all)
      if (wrongInk.has(m))
        out.push(
          `${m.owner} is not shaded as the brief has them: ${m.status === "affected" ? "affected, shaded all over" : m.status === "carrier" ? "a carrier, its left half shaded" : "unaffected, not shaded"}`,
        );
    for (const p of b.people) {
      const [x, y] = l.at.get(p.id)!;
      if (!t.writtenAt(p.id, x, y + UNDER, "middle", "qf-text"))
        out.push(`Person ${p.id}'s number is not written under their symbol`);
    }
    for (const k of l.key)
      if (!t.writtenAt(k.words, k.x + 18, k.y + 5.5, "start", "qf-text"))
        out.push(`The key's words "${k.words}" are not beside their symbol`);

    // The lines left, read back: each piece of joined lines must be one
    // couple, joined at their sides, with exactly their children hanging from
    // it, each joined at the top of their symbol.
    const side = (m: Mark): Pt[] => [
      [m.x - HALF, m.y],
      [m.x + HALF, m.y],
    ];
    const top = (m: Mark): Pt => [m.x, m.y - HALF];
    const id = (m: Mark) => m.id;
    for (const s of lines) {
      if (!square(s))
        out.push(
          `The line from ${t.at(s[0])} to ${t.at(s[1])} is slanted: a family tree's lines run across or up and down`,
        );
      const through = all.find((m) =>
        crossesBox(s, {
          x0: m.x - m.half + 2,
          y0: m.y - m.half + 2,
          x1: m.x + m.half - 2,
          y1: m.y + m.half - 2,
        }),
      );
      if (through)
        out.push(
          `The line from ${t.at(s[0])} to ${t.at(s[1])} runs through ${through.id ? `person ${through.id}'s symbol` : "the key"}`,
        );
      for (const e of s)
        if (
          !lines.some((u) => u !== s && toSegment(e, u) <= 0.75) &&
          !people.some((m) => [...side(m), top(m)].some((p) => same(p, e)))
        )
          out.push(
            `The line from ${t.at(s[0])} to ${t.at(s[1])} ends at ${t.at(e)}, where it joins nothing: lines join a couple at their sides and a child at the top of their symbol`,
          );
    }
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const p = crossing(lines[i], lines[j]);
        if (p)
          out.push(
            `The lines from ${t.at(lines[i][0])} and from ${t.at(lines[j][0])} cross at ${t.at(p)}`,
          );
      }
    const found = new Set<Couple>();
    const hangsFrom = new Map<string, number>();
    for (const piece of pieces(lines)) {
      const ends = piece.flatMap((i) => lines[i]);
      const parents = people
        .filter((m) => side(m).some((p) => ends.some((e) => same(p, e))))
        .map(id);
      const children = people.filter((m) => ends.some((e) => same(top(m), e))).map(id);
      for (const k of children) hangsFrom.set(k, (hangsFrom.get(k) ?? 0) + 1);
      if (!parents.length && !children.length) {
        out.push(`The lines at ${t.at(lines[piece[0]][0])} join no one`);
        continue;
      }
      if (parents.length !== 2) {
        out.push(
          `The lines joining ${and([...parents, ...children])} are not one couple and their children: a couple is two people joined at their sides`,
        );
        continue;
      }
      const couple = b.couples.find((c) => c.parents.every((p) => parents.includes(p)));
      if (!couple) {
        out.push(
          `Persons ${parents[0]} and ${parents[1]} are joined as a couple; the brief has no such couple`,
        );
        continue;
      }
      found.add(couple);
      const h = l.hangs[b.couples.indexOf(couple)];
      const join: Seg = [
        [l.at.get(h.left)![0] + HALF, h.y],
        [l.at.get(h.right)![0] - HALF, h.y],
      ];
      if (!piece.some((i) => sameSeg(lines[i], join)))
        out.push(`Persons ${h.left} and ${h.right} are not joined by a line between them`);
      const want = [...couple.children].sort();
      if (want.join() !== [...children].sort().join())
        out.push(
          `The children drawn hanging from persons ${h.left} and ${h.right} are ${children.length ? and(children) : "none"}; the brief gives ${and(couple.children)}`,
        );
    }
    for (const c of b.couples)
      if (!found.has(c))
        out.push(
          `Persons ${c.parents[0]} and ${c.parents[1]} are not joined as a couple with their children hanging from them`,
        );
    for (const [k, n] of hangsFrom) if (n > 1) out.push(`Person ${k} hangs from ${n} couples`);

    // Nothing else: no other symbol, line, shape or word.
    for (const s of d.shapes) {
      const at = (m: Mark) => same(s.at, [m.x - m.half, m.y - m.half], 0.6);
      const ok =
        (s.name === "line" && s.cls === "qf-line" && !s.marked) ||
        (s.name === "rect" && s.cls === "qf-line" && all.some((m) => m.sex === "male" && at(m))) ||
        (s.name === "circle" &&
          s.cls === "qf-line" &&
          all.some(
            (m) => m.sex === "female" && t.near(s.r, m.half) && same(s.at, [m.x, m.y], 0.6),
          )) ||
        (s.cls === "qf-ink" && ["rect", "circle", "polygon"].includes(s.name));
      if (!ok) out.push(`The ${t.tagOf(s)} at ${t.at(s.at)} is not part of the family tree`);
    }
    const words = [
      ...b.people.map((p) => ({
        text: p.id,
        x: l.at.get(p.id)![0],
        y: l.at.get(p.id)![1] + UNDER,
      })),
      ...l.key.map((k) => ({ text: k.words, x: k.x + 18, y: k.y + 5.5 })),
    ];
    for (const p of t.pieces())
      if (!words.some((w) => w.text === p.text && t.near(p.x, w.x, 1) && t.near(p.y, w.y, 1)))
        out.push(`Text "${p.text}" is not a person's number or part of the key`);
    return out;
  },
  samples: [
    {
      subject: "biology",
      question:
        "The family tree shows the inheritance of cystic fibrosis (CF) in one family. CF is caused by a recessive allele. Persons 5 and 6 are going to have another child. What is the probability that this child will have CF?",
      options: ["0%", "25%", "50%", "75%"],
      brief: {
        kind: "family-tree",
        people: [
          { id: "1", sex: "male", affected: false },
          { id: "2", sex: "female", affected: false },
          { id: "3", sex: "female", affected: true },
          { id: "4", sex: "male", affected: false },
          { id: "5", sex: "male", affected: false },
          { id: "6", sex: "female", affected: false },
          { id: "7", sex: "female", affected: true },
          { id: "8", sex: "male", affected: false },
        ],
        couples: [
          { parents: ["1", "2"], children: ["3", "4", "5"] },
          { parents: ["5", "6"], children: ["7", "8"] },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The family tree shows how polydactyly is inherited in two families. Polydactyly is caused by a dominant allele, D. What is the genotype of person 6?",
      options: ["DD", "Dd", "dd", "It cannot be worked out"],
      brief: {
        kind: "family-tree",
        people: [
          { id: "1", sex: "male", affected: true },
          { id: "2", sex: "female", affected: false },
          { id: "3", sex: "male", affected: false },
          { id: "4", sex: "female", affected: false },
          { id: "5", sex: "female", affected: false },
          { id: "6", sex: "male", affected: true },
          { id: "7", sex: "female", affected: false },
          { id: "8", sex: "male", affected: false },
          { id: "9", sex: "male", affected: true },
          { id: "10", sex: "female", affected: false },
          { id: "11", sex: "female", affected: true },
        ],
        couples: [
          { parents: ["1", "2"], children: ["5", "6"] },
          { parents: ["3", "4"], children: ["7", "8"] },
          { parents: ["6", "7"], children: ["9", "10", "11"] },
        ],
      },
    },
    {
      subject: "biology",
      question:
        "The family tree shows the inheritance of haemophilia, a sex-linked disorder caused by a recessive allele on the X chromosome. Persons 5 and 6 are expecting another son. What is the probability that he will have haemophilia?",
      options: ["0%", "25%", "50%", "100%"],
      brief: {
        kind: "family-tree",
        people: [
          { id: "1", sex: "male", affected: false },
          { id: "2", sex: "female", affected: false, carrier: true },
          { id: "3", sex: "male", affected: true },
          { id: "4", sex: "male", affected: false },
          { id: "5", sex: "female", affected: false, carrier: true },
          { id: "6", sex: "male", affected: false },
          { id: "7", sex: "male", affected: true },
          { id: "8", sex: "female", affected: false },
        ],
        couples: [
          { parents: ["1", "2"], children: ["3", "4", "5"] },
          { parents: ["5", "6"], children: ["7", "8"] },
        ],
      },
    },
  ],
  random(r) {
    const people: { id: string; sex: Sex; affected: boolean; carrier: boolean }[] = [];
    const add = (sex?: Sex) => {
      const s: Sex = sex ?? (r() < 0.5 ? "male" : "female");
      const affected = r() < 0.3;
      people.push({
        id: String(people.length + 1),
        sex: s,
        affected,
        carrier: !affected && r() < 0.12,
      });
      return people[people.length - 1];
    };
    const other = (s: Sex): Sex => (s === "male" ? "female" : "male");
    const couples: { parents: string[]; children: string[] }[] = [];
    const founders = r() < 0.3 ? 2 : 1;
    const deep = r() < 0.7;
    const tops = Array.from({ length: founders }, () => {
      const a = add();
      const c = { parents: [a.id, add(other(a.sex)).id], children: [] as string[] };
      couples.push(c);
      return c;
    });
    const second = tops.map((c) => {
      const kids = Array.from({ length: 1 + Math.floor(r() * (founders === 2 ? 3 : 4)) }, () =>
        add(),
      );
      c.children = kids.map((k) => k.id);
      return kids;
    });
    const families: { parents: string[]; children: string[] }[] = [];
    if (founders === 2) {
      const [l, rt] = [second[0][second[0].length - 1], second[1][0]];
      rt.sex = other(l.sex);
      families.push({ parents: [l.id, rt.id], children: [] });
    }
    if (deep)
      for (const k of second.flat())
        if (!families.some((f) => f.parents.includes(k.id)) && r() < 0.35)
          families.push({ parents: [k.id, add(other(k.sex)).id], children: [] });
    for (const f of families) {
      f.children = Array.from({ length: 1 + Math.floor(r() * 3) }, () => add().id);
      couples.push(f);
    }
    return { kind: "family-tree", people, couples };
  },
};
