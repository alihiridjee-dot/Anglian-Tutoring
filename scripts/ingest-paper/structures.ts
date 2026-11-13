/**
 * Drawn structures carried into the exemplar library as SMILES tokens
 * (READING.md, "Carrying drawn structures"). A structure is read off a
 * picture, so nothing on the page's text layer can vouch for it; this does
 * instead, three ways:
 *
 *   bun scripts/ingest-paper/structures.ts check papers/structures/a/<stem>.json
 *     every token is one of the two styles, reads as a molecule, and breaks
 *     no valency; a carried row says what was drawn, and has a token
 *
 *   bun scripts/ingest-paper/structures.ts compare a/<stem>.json b/<stem>.json
 *     two readers who never saw each other's work must have drawn the same
 *     molecules, part by part and field by field (spelling aside);
 *     `--agreed out.json` writes the first reader's rows for the parts both
 *     carried alike, which is all that goes forward
 *
 *   bun scripts/ingest-paper/structures.ts merge papers/done/<stem>.json a/<stem>.json out.json
 *     the loaded paper with the carried parts moved from `skipped` to `rows`,
 *     for check_rows.py to hold to the page; `--delta load.json` also writes
 *     the carried rows alone, for load-exemplars.ts, each held by a flag until
 *     generated questions can draw a structure (`--release` leaves the flag off)
 *
 * Nothing here writes to the database.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as chem from "openchemlib";
import { structureProblems, structureTokens } from "../../src/lib/structures/structure";

type Option = { letter: string; text: string };
type Row = {
  label: string;
  marks: number | null;
  prompt: string;
  shared_context?: string | null;
  mark_scheme?: string | null;
  options?: Option[] | null;
  flags?: string[];
  structures_carried?: string;
  /** Words printed inside a drawing, so in no text layer: "+ 3[O] →". */
  picture_text?: string[];
  [key: string]: unknown;
};
type Paper = {
  profile?: string;
  rows: Row[];
  skipped?: { label: string; marks: number; reason: string }[];
};

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Paper;
const fields = (r: Row): [string, string][] => [
  ["shared_context", r.shared_context ?? ""],
  ["prompt", r.prompt ?? ""],
  ...(r.options ?? []).map((o): [string, string] => [`option ${o.letter}`, o.text ?? ""]),
  ["mark_scheme", r.mark_scheme ?? ""],
];
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** One structure as the same words whoever spelled it: its style and its molecule. */
function identity(style: string, smiles: string): string {
  try {
    return `${style} ${chem.Molecule.fromSmiles(smiles).getIDCode()}`;
  } catch {
    return `${style} unreadable ${smiles}`;
  }
}

function check(path: string): number {
  let bad = 0;
  for (const r of read(path).rows) {
    const problems: string[] = [];
    let tokens = 0;
    for (const [name, text] of fields(r)) {
      tokens += structureTokens(text).length;
      for (const p of structureProblems(chem, text)) problems.push(`${name}: ${p}`);
    }
    if (tokens && !r.structures_carried?.trim())
      problems.push("carries structures but does not say what was drawn (structures_carried)");
    if (!tokens && r.structures_carried) problems.push("says structures were carried but has none");
    if (problems.length) {
      bad++;
      console.log(`${r.label}\n  ${problems.join("\n  ")}`);
    }
  }
  console.log(`${path}: ${read(path).rows.length} rows, ${bad} with a structure problem`);
  return bad;
}

function compare(pathA: string, pathB: string, agreedPath?: string): number {
  const [a, b] = [read(pathA), read(pathB)].map((p) => new Map(p.rows.map((r) => [r.label, r])));
  const labels = [...new Set([...a.keys(), ...b.keys()])].sort(natural);
  let agreed = 0;
  let differ = 0;
  const kept: Row[] = [];
  const notes: string[] = [];
  const alone: string[] = [];
  for (const label of labels) {
    const [x, y] = [a.get(label), b.get(label)];
    if (!x || !y) {
      alone.push(`${label} (only ${x ? "the first" : "the second"} reader carried it)`);
      continue;
    }
    const lines: string[] = [];
    if (x.marks !== y.marks) lines.push(`marks ${x.marks} against ${y.marks}`);
    const [fx, fy] = [new Map(fields(x)), new Map(fields(y))];
    for (const name of new Set([...fx.keys(), ...fy.keys()])) {
      const [tx, ty] = [fx.get(name) ?? "", fy.get(name) ?? ""].map((t) => structureTokens(t));
      // The molecule is what must agree. Which of the two styles a mixed
      // drawing counts as is a judgement: the first reader's stands, and it is said.
      const [ix, iy] = [tx, ty].map((ts) => ts.map((t) => identity("", t.smiles)));
      if (ix.join("\n") === iy.join("\n")) {
        if (tx.some((t, k) => t.style !== ty[k].style))
          notes.push(`${label} ${name}: the readers name the drawing's style differently`);
        continue;
      }
      // The same molecules in another order is a difference of layout, not of reading.
      const sameSet = [...ix].sort().join("\n") === [...iy].sort().join("\n");
      lines.push(
        `${name}: ${sameSet ? "same structures, different order" : "different structures"}\n` +
          `      first:  ${tx.map((t) => t.raw).join(" ") || "(none)"}\n` +
          `      second: ${ty.map((t) => t.raw).join(" ") || "(none)"}`,
      );
    }
    // Words read off a picture have only the two readings to vouch for them:
    // whichever reader listed them, the other must have written the same.
    const squeezed = (r: Row) =>
      fields(r)
        .map(([, text]) => text.replace(/⟦[^⟧]*⟧/g, ""))
        .join("")
        .replace(/\s+/g, "");
    for (const [mine, other, who] of [
      [x, y, "second"],
      [y, x, "first"],
    ] as const)
      for (const words of mine.picture_text ?? [])
        if (!squeezed(other).includes(words.replace(/\s+/g, "")))
          lines.push(`picture words "${words}" are not in the ${who} reader's row`);
    if (lines.length) {
      differ++;
      console.log(`${label}\n    ${lines.join("\n    ")}`);
    } else {
      agreed++;
      kept.push(x);
    }
  }
  // Only what both readers carried, and carried alike, goes forward: the first reader's rows.
  if (agreedPath)
    writeFileSync(
      agreedPath,
      `${JSON.stringify({ profile: "structures-carried", rows: kept }, null, 1)}\n`,
    );
  if (notes.length) console.log(`style only (first reader's kept):\n  ${notes.join("\n  ")}`);
  if (alone.length) console.log(`carried by one reader only:\n  ${alone.join("\n  ")}`);
  console.log(
    `${agreed} parts agree, ${differ} differ, ${alone.length} carried by one reader only`,
  );
  return differ + alone.length;
}

/** Why a carried row waits: nothing shown to a student may print a token as text. */
const HOLD = "carries drawn structures as SMILES: held until generated questions can draw them";

function merge(
  donePath: string,
  carriedPath: string,
  outPath: string,
  deltaPath?: string,
  release = false,
) {
  const [done, carried] = [read(donePath), read(carriedPath)];
  const have = new Set(done.rows.map((r) => r.label));
  const clash = carried.rows.filter((r) => have.has(r.label)).map((r) => r.label);
  if (clash.length) throw new Error(`already rows in the loaded paper: ${clash.join(", ")}`);
  const labels = new Set(carried.rows.map((r) => r.label));
  const out: Paper = {
    ...done,
    rows: [...done.rows, ...carried.rows].sort((x, y) => natural(x.label, y.label)),
    skipped: (done.skipped ?? []).filter((s) => !labels.has(s.label)),
  };
  writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`);
  if (deltaPath)
    writeFileSync(
      deltaPath,
      `${JSON.stringify(
        {
          profile: "structures-carried",
          rows: carried.rows.map((r) => ({
            ...r,
            flags: release ? (r.flags ?? []) : [...(r.flags ?? []), HOLD],
          })),
        },
        null,
        1,
      )}\n`,
    );
  console.log(
    `${outPath}: ${out.rows.length} rows (${carried.rows.length} carried), ${out.skipped!.length} still skipped`,
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === "check" && args.length === 1) process.exitCode = check(args[0]) ? 1 : 0;
else if (
  command === "compare" &&
  (args.length === 2 || (args.length === 4 && args[2] === "--agreed"))
)
  process.exitCode = compare(args[0], args[1], args[3]) ? 1 : 0;
else if (command === "merge" && args.length >= 3) {
  const delta = args.indexOf("--delta");
  merge(
    args[0],
    args[1],
    args[2],
    delta >= 0 ? args[delta + 1] : undefined,
    args.includes("--release"),
  );
} else {
  console.error(
    "Usage: structures.ts check <rows> | compare <a> <b> [--agreed <out>] | merge <done> <carried> <out> [--delta <load> [--release]]",
  );
  process.exitCode = 2;
}
