/**
 * Mechanical gate after a GCSE-layer pass: for every draft that differs from
 * the base, only the GCSE layers' extra sections (appended) and
 * meta.checked_at may have changed.
 *
 *   bun scripts/notes/gcse-layers/gate.ts <subject> [--base <ref or tree>] [--ids a,b]
 *
 * Prints the layers gaining sections and their headings, flags any new
 * section that names a board, paper or year, and exits 1 on a violation.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [subject, ...rest] = process.argv.slice(2);
const idsAt = rest.indexOf("--ids");
const only = idsAt >= 0 ? new Set(rest[idsAt + 1].split(",")) : null;
const baseAt = rest.indexOf("--base");
const BASE = baseAt >= 0 ? rest[baseAt + 1] : "HEAD";
const git = (...a: string[]) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" });
const changed = git("diff", "--name-only", BASE, "--", `scripts/notes/drafts/${subject}/`)
  .split("\n")
  .filter(Boolean);
const NAMES =
  /\b(AQA|Edexcel|EDEXCEL|OCR|Cambridge|CAIE|Pearson|Paper \d|Trilogy|Gateway|Combined Science|(19|20)\d\d)\b/;
let layers = 0,
  sections = 0,
  bad = 0;
const headings: string[] = [];
for (const f of changed) {
  const id = f
    .split("/")
    .pop()!
    .replace(/\.json$/, "");
  if (only && !only.has(id)) continue;
  const head = JSON.parse(git("show", `${BASE}:${f}`));
  const now = JSON.parse(readFileSync(join(ROOT, f), "utf8"));
  const problems: string[] = [];
  for (const b of ["aqa", "edexcel", "ocr"]) {
    const h = head.boards?.[b],
      n = now.boards?.[b];
    if (!h !== !n) {
      problems.push(`${b} layer created or removed`);
      continue;
    }
    if (!h) continue;
    const he = h.extra ?? [],
      ne = n.extra ?? [];
    if (JSON.stringify(he) !== JSON.stringify(ne.slice(0, he.length)))
      problems.push(`${b}: existing extra sections changed`);
    const added = ne.slice(he.length);
    if (added.length) {
      layers++;
      sections += added.length;
      for (const s of added) headings.push(`${id} ${b}: ${s.heading}`);
    }
    for (const s of added) {
      const m = JSON.stringify(s).match(NAMES);
      if (m) problems.push(`${b}: new section "${s.heading}" mentions "${m[0]}"`);
    }
    const strip = (l: object) => JSON.stringify({ ...l, extra: undefined });
    if (strip(h) !== strip(n))
      problems.push(`${b}: something other than extra changed in the layer`);
  }
  const stripNote = (x: unknown) => {
    const c = JSON.parse(JSON.stringify(x));
    for (const b of ["aqa", "edexcel", "ocr"]) if (c.boards?.[b]) delete c.boards[b].extra;
    delete c.meta.checked_at;
    return JSON.stringify(c);
  };
  if (stripNote(head) !== stripNote(now))
    problems.push("something outside the GCSE layers' extra / meta.checked_at changed");
  if (problems.length) {
    bad++;
    console.log(`✗ ${id}: ${problems.join("; ")}`);
  }
}
console.log(headings.join("\n"));
console.log(
  `\n${subject}: ${changed.length} drafts differ from ${BASE.slice(0, 12)}, ${layers} layers gain ${sections} sections, ${bad} drafts with violations`,
);
if (bad) process.exit(1);
