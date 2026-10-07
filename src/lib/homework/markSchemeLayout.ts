/**
 * A mark scheme, laid out for reading.
 *
 * Schemes are stored as the plain text they were written in, and they have
 * been written every way there is: one point per line; a paragraph of points
 * split by semicolons, each ending "(1)"; "-", "•" and "·" bullets; (a) and (b)
 * parts; "Level 2 (3–4 marks):" descriptors; "Guidance:" notes; often several
 * of those in one line. This finds that structure and returns rows the page
 * draws as bold lines, bullets and notes (`MarkScheme`).
 *
 * It only regroups. Every word comes back, in order, so a shape it doesn't
 * recognise costs some tidiness and never any of the scheme.
 */

/** One bullet of a list that belongs to the row above it. */
export type MarkSchemeItem = { label: string | null; text: string };

export type MarkSchemeRow =
  /**
   * Drawn without a bullet: "(a)", "Guidance:", "Any two from:", a closing
   * note. A line that introduces a list carries it, so two lists never run
   * together.
   */
  | { kind: "line"; label: string | null; text: string; items: MarkSchemeItem[] }
  /** A bullet: one marking point, or one level of a levels-based scheme. */
  | {
      kind: "point";
      label: string | null;
      text: string;
      /** Its own list, drawn as bullets under it: a level's (i), (ii)… */
      items: MarkSchemeItem[];
      /** What it allows or rejects, drawn on lines under it: "Allow 0.9." */
      notes: string[];
    };

type Line = Extract<MarkSchemeRow, { kind: "line" }>;
type Point = Extract<MarkSchemeRow, { kind: "point" }>;

const line = (label: string | null, text: string, items: MarkSchemeItem[] = []): Line => ({
  kind: "line",
  label,
  text: text.replace(/;$/, ""),
  items,
});

const point = (
  label: string | null,
  text: string,
  items: MarkSchemeItem[] = [],
  notes: string[] = [],
): Point => ({ kind: "point", label, text: text.replace(/;$/, ""), items, notes });

/** "(a)" to "(h)": a part of the question, which heads its own points. */
const PART = /^\([a-h]\)(?=\s|$)/;

/** A level of response. A list inside one stays beneath it. */
const LEVEL = /^(?:Level\s*\d+(?:\s*\([^()]*\))?|0\s+marks?)\s*:(?=\s|$)/i;

/** "1 mark:", "Two marks:": the credit for what follows. */
const MARKS = /^(?:\d+|one|two|three|four|five|six)\s+marks?\s*:(?=\s|$)/i;

/** "(a) 2 marks. Correct answer 210 gains…": what a part is worth, as a sentence. */
const WORTH = /^(?:\d+|one|two|three|four|five|six)\s+marks?\.(?=\s)/i;

/** A section of guidance, drawn as a bold name over its own bullets. */
const SECTION = /^(?:(?:additional\s+)?guidance(?:\s+for\s+\([a-z]+\))?|notes?)\s*:/i;

/** Opens a heading rather than a point. */
const HEADING = /^(?:indicative content|levels?[- ]based|levels?\s*:)/i;

/**
 * Opens a line of guidance rather than a marking point. Kept narrow, since a
 * point can itself begin "If…" or "Using…".
 */
const GUIDANCE =
  /^\(?(?:accept|also accept|allow|do not|don['’]t|reject|ignore|award\b|credit (?:any|other|equivalent|correct)|no (?:marks?|credit)\b|error carried forward|ecf\b|max(?:imum)?\s+(?:\d|level|mark|of)|total max|full marks|correct (?:final )?answers?\b|an? answers?\b|answers? (?:of|that|which|to|with|giving)\b|the units? (?:is|are|must|need)|list rule|marks? (?:should|awarded|are)\b|mark using|read the whole|any (?:one|two|three|four|five|six|\d+) (?:points?|from|marks?)\b)/i;

/** Opens a sentence of guidance on the point before it: wider, as that point is already made. */
const NOTE = new RegExp(
  `${GUIDANCE.source}|^(?:an? (?:response|conclusion|candidate)|candidates?\\b|working\\s*:|examples?\\s*:|if\\b|using\\b|treating\\b|stating\\b|units?\\b|each part|this (?:one )?mark|penalise|guidance\\b|note\\b)`,
  "i",
);

/** Words that open a sentence, not a label: "The case must be correct:" is a sentence. */
const NOT_A_LABEL =
  /^(?:The|A|An|This|These|That|Those|It|Its|They|Their|There|If|When|Where|Each|All|Both|Only|Any|No|So|But|And|Or|Then|As|In|On|For|To|With|At|By|Of)\b/;

/**
 * "(1)", "(2 marks)", "(1, both products needed)": the credit a point carries.
 * A bare number is a credit only up to 4: "(6)" and "(38)" are values.
 */
const CREDIT = /\((?:[1-4]|[½¼¾])(?:\s*,[^()]*)?\)|\(\d{1,2}\s*marks?(?:\s*,[^()]*)?\)/g;

/** Bullets written inline: "… wording): • it does not … • it does not …", "180 (1) · 75% (1)". */
const BULLET = /\s[•·]\s/g;

/** "(i)", "(ii)", "(a)": a list numbered inside a line. */
const ENUMERATOR = /\((?:[a-h]|i{1,3}|iv|vi{0,3}|ix|x)\)(?=\s)/g;

/** A point's own number at its start: "(ii) ", "(b) ", "(1) ". */
const NUMBERED = /^\((?:[a-h]|i{1,3}|iv|vi{0,3}|ix|x|\d{1,2})\)\s+/;

/** A bullet or number written at the start of a line. */
const MARKER = /^(?:[-–•·*]|(\d{1,2}[.)]))\s+/;

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];
const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** A full stop that ends one of these is not the end of a sentence. */
const ABBREVIATION = /(?:^|[\s(/])(?:e\.g|i\.e|etc|approx|vs|cf|figs?|eqn?|incl)$/i;

/** Bracket depth at each character. Both brackets of an outermost pair read 0. */
function depths(s: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    out.push(depth);
    if (c === "(" || c === "[") depth++;
  }
  return out;
}

/** Matches of a global `re` that start outside every bracket. */
function topLevel(s: string, re: RegExp, depth = depths(s)): RegExpExecArray[] {
  return [...s.matchAll(re)].filter((m) => depth[m.index] === 0);
}

/** `s` cut before each index, each piece trimmed, empty ones dropped. */
function cut(s: string, at: Iterable<number>): string[] {
  const bounds = [...new Set([0, ...[...at].filter((i) => i > 0 && i < s.length), s.length])].sort(
    (a, b) => a - b,
  );
  const pieces: string[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const piece = s.slice(bounds[k], bounds[k + 1]).trim();
    if (piece) pieces.push(piece);
  }
  return pieces;
}

/** Where each sentence after the first begins: after ". " outside brackets, before a capital, digit, quote or bracket. */
function sentenceStarts(s: string, depth = depths(s)): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/[.!?]\s+(?=[A-Z0-9'"‘“([])/g)) {
    if (depth[m.index] !== 0 || ABBREVIATION.test(s.slice(0, m.index))) continue;
    out.push(m.index + m[0].length);
  }
  return out;
}

const sentences = (s: string) => cut(s, sentenceStarts(s));

/** Credit markers outside brackets that close a point: after its words, not numbering the next. */
function credits(s: string, depth = depths(s)): RegExpExecArray[] {
  return topLevel(s, CREDIT, depth).filter((m) => {
    const before = s.slice(0, m.index).trimEnd();
    return before !== "" && !/[:;([]$/.test(before);
  });
}

/**
 * The text up to the first colon outside brackets, and what follows it. Short
 * is a label ("Plan:", "1 mark:", "C₆₀ (drug delivery):"); longer is a lead-in
 * ("Award 1 mark for any one of the following:").
 */
function leadingLabel(s: string): { label: string; rest: string; short: boolean } | null {
  const colon = topLevel(s, /:(?=\s|$)/g)[0];
  if (!colon) return null;
  const label = s.slice(0, colon.index + 1);
  // "N₂ : H₂" is a ratio, and "Mᵣ = 44:" is working.
  if (/\s:$/.test(label) || label.includes("=")) return null;
  const short =
    label.length <= 48 &&
    label.trim().split(/\s+/).length <= 6 &&
    sentenceStarts(label).length === 0;
  return { label, rest: s.slice(colon.index + 1).trim(), short };
}

/** Labels that run in order: (i), (ii), (iii) or (a), (b), (c). */
function inSequence(labels: string[]): boolean {
  const runs = (order: string[]) =>
    labels.every(
      (l, k) =>
        order.includes(l) && (k === 0 || order.indexOf(l) === order.indexOf(labels[k - 1]) + 1),
    );
  return labels.length >= 2 && (runs(ROMAN) || runs(LETTERS));
}

/** Where a new piece of a line begins: a part, a level, a label or a guidance section. */
function segmentStarts(s: string): number[] {
  const depth = depths(s);
  const starts = new Set<number>();
  const opens = (rest: string) =>
    PART.test(rest) ||
    LEVEL.test(rest) ||
    MARKS.test(rest) ||
    SECTION.test(rest) ||
    HEADING.test(rest) ||
    // "Plan:", "Cystic fibrosis:", but not "Do not accept plasmids:", which
    // is guidance still going on.
    (/^[A-Z]/.test(rest) &&
      !NOT_A_LABEL.test(rest) &&
      !GUIDANCE.test(rest) &&
      leadingLabel(rest)?.short === true);
  for (const i of sentenceStarts(s, depth)) if (opens(s.slice(i))) starts.add(i);
  // "Levels: Level 0 (0 marks): …": a level straight after a colon.
  for (const m of topLevel(s, /:\s+/g, depth)) {
    const i = m.index + m[0].length;
    if (LEVEL.test(s.slice(i))) starts.add(i);
  }
  // "… (1) (b) …": a part after a credit, with no full stop between.
  for (const m of credits(s, depth)) {
    const end = m.index + m[0].length;
    const gap = /^\s+/.exec(s.slice(end));
    if (gap && PART.test(s.slice(end + gap[0].length))) starts.add(end + gap[0].length);
  }
  return [...starts].sort((a, b) => a - b);
}

/** Bullets written inside the line. */
function byBullets(s: string, depth: number[]): { lead: string; pieces: string[] } | null {
  const bullets = topLevel(s, BULLET, depth);
  if (!bullets.length) return null;
  const pieces = cut(
    s,
    bullets.map((m) => m.index),
  ).map((p) => p.replace(/^[•·]\s*/, ""));
  // "… (or equivalent wording): • it does not …": what precedes the first bullet introduces them.
  const lead = /:$/.test(pieces[0]) && !/^[•·]/.test(s) ? (pieces.shift() ?? "") : "";
  return { lead, pieces };
}

/**
 * Points closed by their credits: cut after each "(1); ", "(1), " or "(1). ",
 * and at a semicolon once the point before it has its credit ("correct
 * balancing (1) – award only if…; all four state symbols (1)"). A semicolon
 * before the credit is inside the point.
 */
function byCredits(s: string, depth: number[]): string[] | null {
  const marks = credits(s, depth);
  if (marks.length < 2) return null;
  const cuts = new Set<number>();
  for (const m of marks) {
    const end = m.index + m[0].length;
    const sep = /^(?:\s*(?:\[[^\]]*\]|\([^()]*\)))?\s*[;,.]\s+/.exec(s.slice(end));
    if (sep) cuts.add(end + sep[0].length);
  }
  for (const m of topLevel(s, /;\s+/g, depth)) {
    const since = Math.max(0, ...[...cuts].filter((c) => c <= m.index));
    if (marks.some((c) => c.index >= since && c.index < m.index)) cuts.add(m.index + m[0].length);
  }
  const pieces = cut(s, cuts);
  // One credited point and a sentence after it is not a run of points.
  return pieces.filter((p) => credits(p).length > 0).length >= 2 ? pieces : null;
}

/** Three or more clauses split by semicolons: "1 mark each for: physical; mental; social". */
function bySemicolons(s: string, depth: number[]): string[] | null {
  const semis = topLevel(s, /;\s+/g, depth);
  return semis.length >= 2
    ? cut(
        s,
        semis.map((m) => m.index + m[0].length),
      )
    : null;
}

/** "(i) Na (1) (ii) Cl (1)…", or "mechanism: (i) …; (ii) …". */
function byNumbers(s: string, depth: number[]): { lead: string; pieces: string[] } | null {
  const numbered = topLevel(s, ENUMERATOR, depth).filter((m) => {
    const before = s.slice(0, m.index).trimEnd();
    return (
      before === "" ||
      /[:;.]$/.test(before) ||
      credits(before).some((c) => c.index + c[0].length === before.length)
    );
  });
  if (numbered.length < 2 || !inSequence(numbered.map((m) => m[0].slice(1, -1)))) return null;
  const pieces = cut(
    s,
    numbered.map((m) => m.index),
  );
  const lead = NUMBERED.test(pieces[0]) ? "" : (pieces.shift() ?? "");
  return { lead, pieces };
}

type List = { lead: string; items: MarkSchemeItem[]; tail: string };

/**
 * A run of points written inside one line: by bullets, by credits, by
 * semicolons (when `semicolons`) or by (i), (ii)… Returns what introduces it,
 * its points, and what follows the last one.
 */
function splitList(s: string, semicolons: boolean): List | null {
  const depth = depths(s);
  let lead = "";
  let pieces: string[] | null = null;
  let credited = false;

  const bullets = byBullets(s, depth);
  if (bullets) ({ lead, pieces } = bullets);
  if (!pieces) {
    pieces = byCredits(s, depth);
    credited = pieces !== null;
  }
  if (!pieces && semicolons) pieces = bySemicolons(s, depth);
  if (!pieces) {
    const numbers = byNumbers(s, depth);
    if (numbers) ({ lead, pieces } = numbers);
  }
  if (!pieces || pieces.length < (lead ? 1 : 2)) return null;

  // "Any two from: X (1); Y (1)": the first point carries the run's lead-in,
  // unless the others have labels of their own ("0.20 g: … ; 0.50 g: …").
  if (!lead) {
    const first = leadingLabel(pieces[0]);
    const othersLabelled = pieces.slice(1).some((p) => leadingLabel(p)?.short);
    if (first?.rest && !othersLabelled && !LEVEL.test(pieces[0])) {
      lead = first.label;
      pieces[0] = first.rest;
    }
  }

  // What follows the last point: a closing sentence of guidance, or more.
  let tail = "";
  if (credited) {
    while (pieces.length > 1 && credits(pieces[pieces.length - 1]).length === 0) {
      tail = [pieces.pop(), tail].filter(Boolean).join(" ");
    }
  }
  const last = pieces.length - 1;
  const lastMarks = credits(pieces[last]);
  if (lastMarks.length) {
    const m = lastMarks[lastMarks.length - 1];
    let end = m.index + m[0].length;
    end +=
      /^(?:\s*(?:\[[^\]]*\]|\([^()]*\)))?\s*[.;,]?/.exec(pieces[last].slice(end))?.[0].length ?? 0;
    tail = [
      pieces[last]
        .slice(end)
        .trim()
        .replace(/^[–-]\s+/, ""),
      tail,
    ]
      .filter(Boolean)
      .join(" ");
    pieces[last] = pieces[last].slice(0, end).trim();
  } else {
    const at = sentenceStarts(pieces[last])[0];
    if (at !== undefined) {
      tail = [pieces[last].slice(at).trim(), tail].filter(Boolean).join(" ");
      pieces[last] = pieces[last].slice(0, at).trim();
    }
  }

  const items = pieces
    .map((p) => p.replace(/[;,]$/, "").trim())
    .filter(Boolean)
    .map(item);
  return items.length ? { lead, items, tail } : null;
}

/** One point of a run, with its own label: "(ii)", "(1)", "conclusion:". */
function item(text: string): MarkSchemeItem {
  const numbered = NUMBERED.exec(text);
  if (numbered) return { label: numbered[0].trim(), text: text.slice(numbered[0].length) };
  const own = leadingLabel(text);
  if (own?.short && own.rest) return { label: own.label, text: own.rest };
  return { label: null, text };
}

/** A point, and the sentences of guidance after it: "6.02 × 10²³ (1). Allow 6.0 × 10²³." */
function withNotes(s: string): { main: string; notes: string[] } {
  const parts = sentences(s);
  const k = parts.findIndex((p, i) => i > 0 && NOTE.test(p));
  if (k < 0) return { main: s, notes: [] };
  return { main: parts.slice(0, k).join(" "), notes: parts.slice(k) };
}

/**
 * What introduces a list, as lines, the last of which carries it. "… from the
 * following (or equivalent wording): Dot and cross diagram:" is two lines.
 */
function leadRows(lead: string, items: MarkSchemeItem[]): Line[] {
  const rows = sentences(lead).flatMap((sentence) => {
    for (const c of topLevel(sentence, /:\s+/g)) {
      const heading = sentence.slice(c.index + c[0].length);
      const label = leadingLabel(heading);
      if (label?.short && !label.rest) {
        return [line(null, sentence.slice(0, c.index + 1)), line(heading, "")];
      }
    }
    const label = leadingLabel(sentence);
    return [label?.short && !label.rest ? line(sentence, "") : line(null, sentence)];
  });
  rows[rows.length - 1].items = items;
  return rows;
}

/** Guidance written as sentences, or failing that as a run split by semicolons. */
function guidancePieces(s: string): string[] {
  const starts = sentenceStarts(s);
  if (starts.length) return cut(s, starts);
  return cut(
    s,
    topLevel(s, /;\s+/g).map((m) => m.index + m[0].length),
  ).map((p) => p.replace(/;$/, ""));
}

/** Wholly in brackets: "(Any two, 1 mark each)". */
function bracketed(s: string): boolean {
  const body = s.replace(/\.$/, "");
  if (!body.startsWith("(") || !body.endsWith(")")) return false;
  return depths(body)
    .slice(1, -1)
    .every((d) => d > 0);
}

/**
 * The rows for one piece of a line. `bulleted` when it was written as a
 * bullet; `plain` when the scheme bullets its points and this piece wasn't
 * one, so it is a line of guidance, not a point.
 */
function layoutSegment(text: string, bulleted: boolean, plain: boolean): MarkSchemeRow[] {
  const worth = WORTH.exec(text);
  if (worth && text.length > worth[0].length) {
    return prefixed(layoutSegment(text.slice(worth[0].length).trim(), bulleted, plain), worth[0]);
  }

  const section = SECTION.exec(text);
  if (section) {
    const label = text.slice(0, section[0].length);
    const rest = text.slice(section[0].length).trim();
    const pieces = guidancePieces(rest);
    return pieces.length > 1
      ? [
          line(
            label,
            "",
            pieces.map((p) => ({ label: null, text: p })),
          ),
        ]
      : [line(label, rest)];
  }

  const level = LEVEL.exec(text);
  if (level) {
    const rest = text.slice(level[0].length).trim();
    const list = splitList(rest, false);
    if (list) return [point(level[0], list.lead, list.items, sentences(list.tail))];
    const { main, notes } = withNotes(rest);
    return [point(level[0], main, [], notes)];
  }

  // "Indicative content (not prescriptive; …)." introduces what follows.
  if (HEADING.test(text) && !leadingLabel(text)?.rest)
    return sentences(text).map((t) => line(null, t));

  const list = splitList(text, true);
  if (list) {
    const points = list.items.map(({ label, text }) => point(label, text));
    return [
      ...(list.lead ? leadRows(list.lead, list.items) : points),
      ...sentences(list.tail).map((t) => line(null, t)),
    ];
  }

  const label = leadingLabel(text);
  if (!bulleted) {
    // "Award 1 mark for: contains enzymes … (1)": the lead-in, then the point.
    if (label?.rest && credits(label.rest).length && (GUIDANCE.test(text) || !label.short)) {
      return [...leadRows(label.label, []), ...layoutSegment(label.rest, true, false)];
    }
    if (text.endsWith(":"))
      return [label?.short && !label.rest ? line(text, "") : line(null, text)];
    // Guidance reads one rule to a line.
    if (plain || GUIDANCE.test(text) || bracketed(text))
      return sentences(text).map((t) => line(null, t));
  }
  const own = label?.short && label.rest ? label : null;
  const { main, notes } = withNotes(own ? own.rest : text);
  return [point(own?.label ?? null, main, [], notes)];
}

/** `rows` with `prefix` before the first one's label: "(a)" and "1 mark:" read "(a) 1 mark:". */
function prefixed(rows: MarkSchemeRow[], prefix: string): MarkSchemeRow[] {
  if (rows.length === 0) return [line(prefix, "")];
  const [first, ...rest] = rows;
  return [{ ...first, label: first.label ? `${prefix} ${first.label}` : prefix }, ...rest];
}

export function layoutMarkScheme(scheme: string | null | undefined): MarkSchemeRow[] {
  const lines = (scheme ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // A scheme that bullets its points makes every unbulleted line a line of
  // its own: an introduction or a note, never a point.
  const bulletsItsPoints = lines.some((l) => MARKER.test(l));

  // Each part of the question collects the rows under it until the next part,
  // or until a guidance section closes it.
  const blocks: { part: string | null; rows: MarkSchemeRow[] }[] = [{ part: null, rows: [] }];

  for (const raw of lines) {
    const marker = MARKER.exec(raw);
    const text = marker ? raw.slice(marker[0].length).trim() : raw;
    if (!text) continue;

    let previous: Point | null = null;
    const segments = cut(text, segmentStarts(text));
    for (const [k, segment] of segments.entries()) {
      const part = PART.exec(segment);
      const body = part ? segment.slice(part[0].length).trim() : segment;

      // "(c) 8 (1). Working: 32 ÷ 4 = 8.": guidance on the point just made.
      if (k > 0 && !part && previous && NOTE.test(body) && !SECTION.test(body)) {
        previous.notes.push(...sentences(body));
        continue;
      }

      const bulleted = marker !== null && k === 0;
      let rows = body ? layoutSegment(body, bulleted, bulletsItsPoints && !bulleted) : [];
      if (marker?.[1] && k === 0) rows = prefixed(rows, marker[1]);
      if (part) blocks.push({ part: part[0], rows });
      else if (SECTION.test(body)) blocks.push({ part: null, rows });
      else blocks[blocks.length - 1].rows.push(...rows);
      const only = rows.length === 1 ? rows[0] : undefined;
      previous = only?.kind === "point" ? only : null;
    }
  }

  // Parts of one point each read "(a) 19 (1)". If any part has more under it,
  // every part gets a line of its own, so the parts look alike.
  const headed = blocks.some((b) => b.part && !(b.rows.length === 1 && b.rows[0].kind === "point"));
  return blocks.flatMap(({ part, rows }) => {
    if (!part) return rows;
    if (!headed || rows[0]?.kind === "line") return prefixed(rows, part);
    return [line(part, ""), ...rows];
  });
}
