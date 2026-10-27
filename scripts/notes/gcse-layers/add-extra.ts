/**
 * Append `extra` sections to one GCSE board layer of a draft note, keeping the
 * file's existing JSON layout: only that layer's extra block changes on disk.
 *
 *   bun scripts/notes/gcse-layers/add-extra.ts <subject> <concept id> <aqa|edexcel|ocr> <sections.json> [--dry]
 *
 * sections.json is an array of { heading, blocks } (the shape of BoardLayer.extra).
 * Refuses: an unknown layer (it never creates one), a duplicate heading, a
 * section whose blocks fail the note validator, and any text that names a
 * board, paper or year (students must never see those).
 *
 * Drafts come in two layouts (prettier, or plain JSON.stringify with two
 * spaces) and a few mix both. The tool renders the whole note in the file's
 * own style and splices just the layer's extra block into the original text,
 * then proves the result parses to exactly the intended note.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateNote } from "../../../src/lib/notes/noteFormat";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
/** Prettier from this checkout, or from the main checkout when run in a worktree without node_modules. */
function prettierBin(): string {
  const local = join(ROOT, "node_modules/prettier/bin/prettier.cjs");
  if (existsSync(local)) return local;
  const common = execFileSync("git", ["-C", ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const main = join(dirname(common), "node_modules/prettier/bin/prettier.cjs");
  if (existsSync(main)) return main;
  throw new Error("prettier not found: run bun install in the main checkout");
}

const [subject, id, board, sectionsPath, ...flags] = process.argv.slice(2);
if (!subject || !id || !board || !sectionsPath) {
  console.error(
    "Usage: add-extra.ts <subject> <concept id> <aqa|edexcel|ocr> <sections.json> [--dry]",
  );
  process.exit(2);
}
if (!["aqa", "edexcel", "ocr"].includes(board)) fail(`layer must be aqa, edexcel or ocr, not ${board}`);
const dry = flags.includes("--dry");
const file = join(ROOT, "scripts/notes/drafts", subject, `${id}.json`);
if (!existsSync(file)) fail(`no draft at ${file}`);
const original = readFileSync(file, "utf8");
const note = JSON.parse(original);
const sections = JSON.parse(readFileSync(sectionsPath, "utf8"));
if (!Array.isArray(sections) || !sections.length)
  fail("sections.json must be a non-empty array of {heading, blocks}");
const NAMES =
  /\b(AQA|Edexcel|EDEXCEL|OCR|Cambridge|CAIE|Pearson|Paper \d|Trilogy|Gateway|Combined Science|(19|20)\d\d)\b/;
for (const s of sections) {
  if (typeof s?.heading !== "string" || !s.heading.trim()) fail("every section needs a heading");
  if (!Array.isArray(s.blocks) || !s.blocks.length) fail(`section "${s.heading}" needs blocks`);
  const bad = JSON.stringify(s).match(NAMES);
  if (bad)
    fail(`section "${s.heading}" names a board, paper or year: "${bad[0]}". Students must never see these.`);
}
const layer = note.boards?.[board];
if (!layer) fail(`${id} has no ${board} layer; this tool never creates layers`);
const existing = Array.isArray(layer.extra) ? layer.extra : [];
for (const s of sections)
  if (existing.some((e: { heading: string }) => e.heading === s.heading))
    fail(`${board} layer already has a section headed "${s.heading}"`);
layer.extra = [...existing, ...sections];
const errs = validateNote(note);
if (errs.length) fail(`the note would fail validation:\n  ${errs.join("\n  ")}`);

// Render the whole note in the file's own style, then splice only the layer's extra block.
const plain = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const pretty = (text: string) =>
  execFileSync(
    "bun",
    [prettierBin(), "--config", join(ROOT, ".prettierrc"), "--stdin-filepath", "x.json"],
    { input: text, encoding: "utf8" },
  );
const originalParsed = JSON.parse(original);
const style =
  plain(originalParsed) === original
    ? "plain"
    : pretty(plain(originalParsed)) === original
      ? "prettier"
      : "mixed";
const candidate = style === "prettier" ? pretty(plain(note)) : plain(note);

const origLines = original.split("\n");
const candLines = candidate.split("\n");
const region = (lines: string[]) => {
  const open = lines.findIndex((l) => l === `    "${board}": {`);
  if (open < 0) throw new Error(`cannot find the ${board} layer line`);
  let close = open + 1;
  while (close < lines.length && !/^    },?$/.test(lines[close])) close++;
  if (close >= lines.length) throw new Error(`cannot find the end of the ${board} layer`);
  return { open, close };
};
const extraBlock = (lines: string[], r: { open: number; close: number }) => {
  const start = lines.slice(r.open, r.close).findIndex((l) => l === `      "extra": [`);
  if (start < 0) return null;
  const s = r.open + start;
  let e = s + 1;
  while (e < r.close && !/^      \],?$/.test(lines[e])) e++;
  if (e >= r.close) throw new Error("cannot find the end of the extra block");
  return { s, e };
};
const cr = region(candLines);
const cb = extraBlock(candLines, cr);
if (!cb) throw new Error("candidate has no extra block (bug)");
const newBlock = candLines.slice(cb.s, cb.e + 1);
const or = region(origLines);
const ob = extraBlock(origLines, or);
let out: string[];
if (ob) {
  // Keep the original closing line's comma: extra may not be the layer's last key there.
  const closing = origLines[ob.e].endsWith(",") ? "      ]," : "      ]";
  out = [...origLines.slice(0, ob.s), ...newBlock.slice(0, -1), closing, ...origLines.slice(ob.e + 1)];
} else {
  const lastProp = or.close - 1;
  const withComma = origLines[lastProp].endsWith(",") ? origLines[lastProp] : origLines[lastProp] + ",";
  out = [
    ...origLines.slice(0, lastProp),
    withComma,
    ...newBlock.slice(0, -1),
    "      ]",
    ...origLines.slice(or.close),
  ];
}
const result = out.join("\n");
// The spliced text must parse to exactly the intended note, and nothing else may have moved.
const reparsed = JSON.parse(result);
if (JSON.stringify(reparsed) !== JSON.stringify(note))
  throw new Error("splice produced a different note (bug)");
const strip = (n: any) => {
  const c = JSON.parse(JSON.stringify(n));
  delete c.boards[board].extra;
  return JSON.stringify(c);
};
if (strip(reparsed) !== strip(originalParsed))
  throw new Error("something outside the extra block changed (bug)");
if (JSON.stringify(reparsed) === JSON.stringify(originalParsed)) throw new Error("nothing changed (bug)");
if (dry) {
  console.log(`[dry] ${id} ${board}: would add ${sections.length} section(s) (${style} layout):`);
  console.log(newBlock.join("\n"));
} else {
  writeFileSync(file, result);
  console.log(
    `${id} ${board}: added ${sections.length} section(s): ${sections.map((s: { heading: string }) => s.heading).join(" | ")} (${style} layout, ${result.split("\n").length - origLines.length} lines added)`,
  );
}
function fail(msg: string): never {
  console.error(`add-extra: ${msg}`);
  process.exit(1);
}
