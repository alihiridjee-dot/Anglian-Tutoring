/**
 * A spec point's list, one item per line.
 *
 * The boards print a point's parts as a list: "(a) cholera – water", "(b)
 * tuberculosis – airborne", each on its own line. About 500 points were
 * imported with those lines run together into one sentence, so the page drew
 * "including: (a) cholera (bacteria) – water (b) tuberculosis …" as a wall of
 * text. This puts each part back on its own line, the way the points imported
 * with their line breaks already read ("limited to:\n• … \n• …").
 *
 * Only a real run of parts is split: (a) then (b) then (c) …, or (i) then (ii)
 * …, each standing on its own after a space or the start, and at least two of
 * them. So "iron(ii)", the speed of light "(c)" and "(HT only: b and c)" stay
 * as they are, and a lone "(a)" is left alone. A run of "•" between spaces is
 * split too ("the terms: • shells • orbitals"), but not the dot in CuSO₄•5H₂O.
 * A list inside a part (a part's own (i), (ii) or bullets) is indented under it.
 *
 * Text that already has line breaks was laid out by the import and is returned
 * as it is.
 */

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"];

/** A marker standing on its own: "(b)" after the start, a space or a colon. */
const MARKER = /(^|[\s:;,])\(([a-z]{1,4})\)(?=\s)/g;

type Marker = { label: string; at: number };

/** The run a list makes: its first label, then the next, in order. */
function run(markers: Marker[], order: string[]): Marker[] {
  const out: Marker[] = [];
  let next = 0;
  for (const m of markers) {
    if (m.label === order[next]) {
      out.push(m);
      next++;
    }
  }
  return out.length >= 2 ? out : [];
}

/** Where each inline bullet starts: a "•" with a space either side. */
function bullets(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\s•(?=\s)/g)) out.push((m.index ?? 0) + 1);
  return out;
}

const INDENT = "    ";

export function breakSpecList(text: string | null | undefined): string {
  const t = text ?? "";
  if (!t || /\n/.test(t)) return t;

  const markers: Marker[] = [];
  for (const m of t.matchAll(MARKER)) {
    markers.push({ label: m[2], at: (m.index ?? 0) + m[1].length });
  }
  const lettered = run(markers, LETTERS);
  const roman = run(markers, ROMAN);
  const dots = bullets(t);

  // The outer list is the one that starts first; the other, inside its parts,
  // is indented. Bullets on their own count only when there are two or more.
  const lists = [lettered, roman].filter((l) => l.length).sort((x, y) => x[0].at - y[0].at);
  const outer = lists[0] ?? [];
  const inner = lists[1] ?? [];
  const breaks = new Map<number, string>();
  for (const m of outer) breaks.set(m.at, "");
  for (const m of inner) if (m.at > outer[0].at) breaks.set(m.at, INDENT);
  if (outer.length || dots.length >= 2) {
    for (const at of dots) breaks.set(at, outer.length && at > outer[0].at ? INDENT : "");
  }
  if (!breaks.size) return t;

  let out = "";
  let from = 0;
  for (const at of [...breaks.keys()].sort((a, b) => a - b)) {
    out += tidyEnd(t.slice(from, at));
    if (out) out += "\n";
    out += breaks.get(at);
    from = at;
  }
  return out + t.slice(from).trim();
}

/** The words before a break, without the space, or a joining "and", left hanging. */
function tidyEnd(s: string): string {
  return s.replace(/\s+$/, "").replace(/([;,])\s+(and|or)$/, "$1");
}
